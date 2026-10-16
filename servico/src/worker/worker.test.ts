import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import adicionarFormatos from 'ajv-formats';
import type { AnySchema } from 'ajv';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { carregarRoteiro } from '../executor/fake.js';
import { criarExecutorFalso } from '../executor/fake.js';
import type { ResultadoExecutor } from '../executor/tipos.js';
import { FilaEmMemoria } from './fila.js';
import type { FilaDeJobs } from './fila.js';
import { manipuladorDeTeste } from '../../testes/manipulador.js';
import { LimiteDeEntrada } from '../entrada-json.js';
import { Worker, resultadoDoJob } from './worker.js';
import type { AnotacaoWorker, Manipulador, Tarefa } from './worker.js';

const raiz = fileURLToPath(new URL('../../../', import.meta.url));
const schema = join(raiz, 'fixtures/codex/schema-teste.json');

let base = '';
let entrada = '';
let artefatos = '';
let slots = '';

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'margem-teste-worker-'));
  entrada = join(base, 'entrada');
  artefatos = join(base, 'artefatos');
  slots = join(base, 'slots');
  await mkdir(entrada, { recursive: true });
  await writeFile(join(entrada, 'parte.txt'), 'texto\n');
});

afterEach(async () => { await rm(base, { recursive: true, force: true }); });

function entradaDoJob() {
  return { diretorioEntrada: entrada, prompt: 'ler a parte', schema, prazoMs: 5_000, diretorioArtefatos: artefatos };
}

/** Manipulador de laboratório: encena o desfecho e conta as execuções simultâneas. */
function manipuladorControlado(
  desfecho: (tarefa: Tarefa) => Promise<ResultadoExecutor>,
  aoPublicar?: () => Promise<void>,
): Manipulador & { simultaneosMaximo: number; execucoes: number } {
  const estado = { simultaneos: 0, simultaneosMaximo: 0, execucoes: 0 };
  const manipulador: Manipulador = {
    executar: async (tarefa) => {
      estado.simultaneos += 1;
      estado.execucoes += 1;
      estado.simultaneosMaximo = Math.max(estado.simultaneosMaximo, estado.simultaneos);
      try {
        return await desfecho(tarefa);
      } finally {
        estado.simultaneos -= 1;
      }
    },
    publicar: async (_tarefa, execucao, contexto) => {
      if (aoPublicar) await aoPublicar();
      return resultadoDoJob(contexto.job, contexto.lease_token, execucao);
    },
  };
  return Object.defineProperties(manipulador, {
    simultaneosMaximo: { get: () => estado.simultaneosMaximo },
    execucoes: { get: () => estado.execucoes },
  }) as Manipulador & { simultaneosMaximo: number; execucoes: number };
}

function execucaoOk(duracaoMs: number): (tarefa: Tarefa) => Promise<ResultadoExecutor> {
  return () => new Promise((resolver) => setTimeout(() => {
    resolver({ estado: 'ok', artefato: join(artefatos, 'x.json'), sha256: 'a'.repeat(64), duracao_ms: duracaoMs, modelo: 'executor-falso' });
  }, duracaoMs));
}

test('o laço completo publica o resultado do executor falso', async () => {
  const fila = new FilaEmMemoria();
  const job = fila.enfileirar({ tipo: 'teste', entrada: entradaDoJob() });
  const roteiro = await carregarRoteiro(join(raiz, 'fixtures/codex/roteiro-worker.json'));
  const worker = new Worker({
    fila, manipuladores: { teste: manipuladorDeTeste(criarExecutorFalso(roteiro)) },
    slots: 2, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: 2,
  });
  await worker.rodar();
  const lido = fila.ler(job.id);
  expect(lido?.estado).toBe('concluido');
  expect(lido?.resultado?.estado).toBe('ok');
  expect(fila.publicados).toHaveLength(1);
  expect(fila.publicados[0]?.job_id).toBe(job.id);
  expect(fila.publicados[0]?.lease_token).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
});

test('dois workers concorrentes não executam a mesma concessão', async () => {
  const fila = new FilaEmMemoria();
  fila.enfileirar({ tipo: 'teste', entrada: entradaDoJob() });
  const manipulador = manipuladorControlado(execucaoOk(40));
  const comum = { fila, manipuladores: { teste: manipulador }, slots: 4, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: 4 };
  await Promise.all([
    new Worker({ ...comum, owner: 'worker-a' }).rodar(),
    new Worker({ ...comum, owner: 'worker-b' }).rodar(),
  ]);
  expect(manipulador.execucoes).toBe(1);
  expect(fila.publicados).toHaveLength(1);
});

test('concessão perdida no meio do caminho não publica e o job volta à fila', async () => {
  const fila = new FilaEmMemoria({ concessaoMs: 20 });
  const job = fila.enfileirar({ tipo: 'teste', entrada: entradaDoJob() });
  const anotacoes: AnotacaoWorker[] = [];
  const worker = new Worker({
    fila, manipuladores: { teste: manipuladorControlado(execucaoOk(120)) },
    slots: 1, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: 1,
    heartbeatMs: 10_000, anotar: (a) => anotacoes.push(a),
  });
  await worker.rodar();
  expect(anotacoes.map((a) => a.evento)).toContain('concessao_perdida');
  expect(fila.publicados).toHaveLength(0);
  expect(await fila.expirarConcessoes()).toBe(1);
  const lido = fila.ler(job.id);
  expect(lido?.estado).toBe('pendente');
  expect(lido?.attempt).toBe(2);
});

test('R-05: varredura de vencidas que falha é registrada e o laço segue reservando', async () => {
  const fila = new FilaEmMemoria();
  const job = fila.enfileirar({ tipo: 'teste', entrada: entradaDoJob() });
  const original = fila.expirarConcessoes.bind(fila);
  let falhas = 1;
  fila.expirarConcessoes = (agora?: Date) => (falhas-- > 0 ? Promise.reject(new Error('Query read timeout')) : original(agora));
  const anotacoes: AnotacaoWorker[] = [];
  await new Worker({
    fila, manipuladores: { teste: manipuladorControlado(execucaoOk(1)) },
    slots: 1, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: 2, anotar: (a) => anotacoes.push(a),
  }).rodar();
  expect(anotacoes[0]).toEqual({ evento: 'expiracao_falhou', detalhe: 'Query read timeout' });
  expect(anotacoes.map((a) => a.evento)).toContain('publicado');
  expect(fila.publicados).toHaveLength(1);
  expect(fila.ler(job.id)?.estado).not.toBe('pendente');
});

test('falha do manipulador na publicação faz rollback e encerra como falhou', async () => {
  const fila = new FilaEmMemoria();
  const job = fila.enfileirar({ tipo: 'teste', entrada: entradaDoJob() });
  const anotacoes: AnotacaoWorker[] = [];
  const worker = new Worker({
    fila,
    manipuladores: { teste: manipuladorControlado(execucaoOk(5), () => Promise.reject(new Error('transação abortada'))) },
    slots: 1, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: 1, anotar: (a) => anotacoes.push(a),
  });
  await worker.rodar();
  expect(fila.publicados).toHaveLength(0);
  const lido = fila.ler(job.id);
  expect(lido?.estado).toBe('falhou');
  expect(lido?.resultado?.diagnosticos[0]?.mensagem).toBe('transação abortada');
  expect(anotacoes.at(-1)?.evento).toBe('falhou');
});

test('adiado por cota devolve o job com not_before respeitado', async () => {
  const fila = new FilaEmMemoria();
  const job = fila.enfileirar({ tipo: 'teste', entrada: entradaDoJob() });
  const volta = new Date(Date.now() + 3_600_000);
  const worker = new Worker({
    fila,
    manipuladores: { teste: manipuladorControlado(() => Promise.resolve({
      estado: 'adiado', codigo: 'cota', not_before: volta, mensagem: 'cota esgotada', duracao_ms: 3,
    })) },
    slots: 1, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: 1,
  });
  await worker.rodar();
  const lido = fila.ler(job.id);
  expect(lido?.estado).toBe('pendente');
  expect(lido?.not_before?.toISOString()).toBe(volta.toISOString());
  expect(await fila.reservar('outro', ['teste'])).toHaveLength(0);
});

test('seis jobs com duas vagas nunca passam de duas execuções simultâneas', async () => {
  const fila = new FilaEmMemoria();
  for (let i = 0; i < 6; i += 1) fila.enfileirar({ tipo: 'teste', entrada: entradaDoJob() });
  const manipulador = manipuladorControlado(execucaoOk(30));
  const worker = new Worker({
    fila, manipuladores: { teste: manipulador },
    slots: 2, diretorioSlots: slots, intervaloMs: 2, maximoCiclos: 6,
  });
  await worker.rodar();
  expect(manipulador.execucoes).toBe(6);
  expect(manipulador.simultaneosMaximo).toBeLessThanOrEqual(2);
  expect(fila.publicados).toHaveLength(6);
});

test('pedido de parada (SIGTERM) deixa o job em curso terminar', async () => {
  const fila = new FilaEmMemoria();
  const job = fila.enfileirar({ tipo: 'teste', entrada: entradaDoJob() });
  const manipulador = manipuladorControlado(execucaoOk(60));
  const worker = new Worker({
    fila, manipuladores: { teste: manipulador },
    slots: 2, diretorioSlots: slots, intervaloMs: 5, prazoEncerramentoMs: 5_000,
  });
  const laco = worker.rodar();
  await new Promise((r) => setTimeout(r, 25));
  expect(worker.tarefasEmCurso).toBe(1);
  worker.pedirParada();
  await laco;
  expect(fila.ler(job.id)?.estado).toBe('concluido');
  expect(manipulador.execucoes).toBe(1);
});

test('parada do worker que estoura o prazo não marca o job como falho: ele volta pela concessão vencida (auditoria 02/10)', async () => {
  const fila = new FilaEmMemoria();
  const job = fila.enfileirar({ tipo: 'teste', entrada: entradaDoJob() });
  const anotacoes: AnotacaoWorker[] = [];
  const manipulador = manipuladorControlado((tarefa) => new Promise((resolver) => {
    tarefa.sinal.addEventListener('abort', () => {
      resolver({ estado: 'falhou', codigo: 'cancelado', mensagem: 'Cancelamento pedido para o job.', duracao_ms: 0 });
    }, { once: true });
  }));
  const worker = new Worker({
    fila, manipuladores: { teste: manipulador },
    slots: 1, diretorioSlots: slots, intervaloMs: 5, prazoEncerramentoMs: 20, anotar: (a) => anotacoes.push(a),
  });
  const laco = worker.rodar();
  await new Promise((r) => setTimeout(r, 25));
  worker.pedirParada();
  await laco;
  expect(anotacoes.at(-1)?.evento).toBe('interrompido');
  expect(fila.ler(job.id)?.estado).not.toBe('falhou');
});

test('cancelamento pedido antes da execução aborta o job', async () => {
  const fila = new FilaEmMemoria();
  const job = fila.enfileirar({ tipo: 'teste', entrada: entradaDoJob() });
  await fila.pedirCancelamento(job.id);
  const anotacoes: AnotacaoWorker[] = [];
  const worker = new Worker({
    fila,
    manipuladores: { teste: manipuladorControlado((tarefa) => Promise.resolve(
      tarefa.sinal.aborted
        ? { estado: 'falhou', codigo: 'cancelado', mensagem: 'Cancelamento pedido para o job.', duracao_ms: 0 }
        : { estado: 'ok', artefato: 'x', sha256: 'a'.repeat(64), duracao_ms: 0, modelo: 'executor-falso' },
    )) },
    slots: 1, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: 1, anotar: (a) => anotacoes.push(a),
  });
  await worker.rodar();
  expect(anotacoes.at(-1)?.evento).toBe('cancelado');
  expect(fila.ler(job.id)?.estado).toBe('falhou');
});

test('job de tipo sem manipulador registrado falha explicitamente', async () => {
  const fila = new FilaEmMemoria();
  const job = fila.enfileirar({ tipo: 'orfao', entrada: entradaDoJob() });
  const concessao = (await fila.reservar('a', ['orfao']))[0];
  if (!concessao) throw new Error('sem concessão');
  // Fila de laboratório: entrega uma vez uma concessão de tipo que o worker não conhece.
  let entregue = false;
  const filaTorta: FilaDeJobs = {
    expirarConcessoes: () => Promise.resolve(0),
    reservar: () => { const lote = entregue ? [] : [concessao]; entregue = true; return Promise.resolve(lote); },
    heartbeat: (id, token) => fila.heartbeat(id, token),
    publicar: (id, token, efeito) => fila.publicar(id, token, efeito),
    falhar: (id, token, resultado) => fila.falhar(id, token, resultado),
    adiar: (id, token, resultado) => fila.adiar(id, token, resultado),
    pedirCancelamento: (id) => fila.pedirCancelamento(id),
  };
  const anotacoes: AnotacaoWorker[] = [];
  const worker = new Worker({
    fila: filaTorta, manipuladores: { teste: manipuladorControlado(execucaoOk(1)) },
    slots: 1, diretorioSlots: slots, intervaloMs: 2, maximoCiclos: 1, anotar: (a) => anotacoes.push(a),
  });
  await worker.rodar();
  expect(anotacoes.at(-1)).toMatchObject({ evento: 'falhou', detalhe: 'sem manipulador' });
  expect(fila.ler(job.id)?.estado).toBe('falhou');
});

test('resultadoDoJob monta JobResultV1 coerente com o contrato', () => {
  const job = { id: '01J0000000000000000000000A', tipo: 'teste', entrada: null, attempt: 2, dedup_key: null, input_snapshot_hash: null, not_before: null, cancel_requested_at: null };
  const ok = resultadoDoJob(job, '01J0000000000000000000000B', { estado: 'ok', artefato: '/a.json', sha256: 'b'.repeat(64), duracao_ms: 9, modelo: 'm' });
  expect(ok).toMatchObject({ estado: 'ok', attempt: 2, artefato: { caminho: '/a.json' }, modelo: 'm' });
  const adiado = resultadoDoJob(job, '01J0000000000000000000000B', { estado: 'adiado', codigo: 'cota', not_before: new Date('2026-09-21T10:27:00Z'), mensagem: 'x', duracao_ms: 1 });
  expect(adiado).toMatchObject({ estado: 'adiado', not_before: '2026-09-21T10:27:00.000Z' });
  expect(adiado).not.toHaveProperty('artefato');

  // Conferência contra o schema versionado, sem tocar em contratos/.
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  adicionarFormatos(ajv);
  const validar = ajv.compile(JSON.parse(readFileSync(join(raiz, 'contratos/schemas/JobResultV1.schema.json'), 'utf8')) as AnySchema);
  expect(validar(ok), JSON.stringify(validar.errors)).toBe(true);
  expect(validar(adiado), JSON.stringify(validar.errors)).toBe(true);
});

test('D-08 e D-13: exceção do manipulador vira falha visível do job e não roda de novo', async () => {
  const fila = new FilaEmMemoria();
  const limite = fila.enfileirar({ tipo: 'limite', entrada: entradaDoJob() });
  const disco = fila.enfileirar({ tipo: 'disco', entrada: entradaDoJob() });
  const outro = fila.enfileirar({ tipo: 'outro', entrada: entradaDoJob() });
  const semEspaco = Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
  const manipuladores = {
    limite: manipuladorControlado(() => Promise.reject(new LimiteDeEntrada('bytes'))),
    disco: manipuladorControlado(() => Promise.reject(semEspaco)),
    outro: manipuladorControlado(() => Promise.reject(new Error('falhou ao ler /home/pessoa/segredo/arquivo.json'))),
  };
  const anotacoes: AnotacaoWorker[] = [];
  await new Worker({ fila, manipuladores, slots: 3, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: 6, anotar: (a) => anotacoes.push(a) }).rodar();
  expect(fila.ler(limite.id)).toMatchObject({ estado: 'falhou', resultado: { diagnosticos: [{ nivel: 'erro', codigo: 'limite_de_entrada' }] } });
  expect(fila.ler(disco.id)?.resultado?.diagnosticos[0]?.codigo).toBe('sem_espaco');
  expect(fila.ler(disco.id)?.resultado?.diagnosticos[0]?.mensagem).toMatch(/^Sem espaço no disco/);
  const mensagem = fila.ler(outro.id)?.resultado?.diagnosticos[0]?.mensagem ?? '';
  expect(fila.ler(outro.id)?.estado).toBe('falhou');
  expect(mensagem).not.toContain('/home/pessoa');
  // Nada volta sozinho: cada um rodou uma vez, e a concessão não ficou pendurada.
  expect(Object.values(manipuladores).map((m) => m.execucoes)).toEqual([1, 1, 1]);
  expect(await fila.expirarConcessoes(new Date(Date.now() + 3_600_000))).toBe(0);
  expect(anotacoes.filter((a) => a.evento === 'falhou')).toHaveLength(3);
});
