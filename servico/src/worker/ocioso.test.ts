/**
 * V-W7 (B-09): o worker ocioso não gira. No Windows o laço fixo de 200 ms criava e apagava um arquivo
 * de vaga cinco vezes por segundo e fazia ~10 consultas por segundo com o app parado. Agora a reserva
 * vem antes da vaga, a espera ociosa cresce até o teto e o aviso de job novo acorda o laço na hora.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { ulid } from 'ulid';
import { comBanco } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import { ouvinteDoPool } from '../http/ouvinte.js';
import * as jobsRepo from '../repos/jobs.js';
import type { ResultadoExecutor } from '../executor/tipos.js';
import { FilaPostgres } from './fila-postgres.js';
import { FilaEmMemoria, type FilaDeJobs } from './fila.js';
import { resultadoDoJob, Worker, type Manipulador } from './worker.js';

let base = '';
beforeEach(async () => { base = await mkdtemp(join(tmpdir(), 'margem-teste-ocioso-')); });
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

const ok = (): Promise<ResultadoExecutor> => Promise.resolve({ estado: 'ok', artefato: '/x.json', sha256: 'a'.repeat(64), duracao_ms: 1, modelo: 'executor-falso' });
const manipulador: Manipulador = {
  executar: ok,
  publicar: (_tarefa, execucao, contexto) => Promise.resolve(resultadoDoJob(contexto.job, contexto.lease_token, execucao)),
};

/** A fila em memória contando as consultas que o laço faz. */
function filaContada(fila: FilaEmMemoria): FilaDeJobs & { consultas: number } {
  const contada = {
    consultas: 0,
    expirarConcessoes: (agora?: Date) => { contada.consultas += 1; return fila.expirarConcessoes(agora); },
    reservar: (owner: string, tipos: readonly string[], limite?: number) => { contada.consultas += 1; return fila.reservar(owner, tipos, limite); },
    heartbeat: fila.heartbeat.bind(fila), publicar: fila.publicar.bind(fila), falhar: fila.falhar.bind(fila),
    adiar: fila.adiar.bind(fila), pedirCancelamento: fila.pedirCancelamento.bind(fila),
  };
  return contada;
}

test('ocioso: a espera cresce até o teto e o diretório de vagas nem é criado', async () => {
  const fila = filaContada(new FilaEmMemoria());
  const vagas = join(base, 'vagas');
  const worker = new Worker({ fila, manipuladores: { teste: manipulador }, slots: 2, diretorioSlots: vagas, intervaloMs: 10, intervaloMaximoMs: 80 });
  const laco = worker.rodar();
  await new Promise((r) => setTimeout(r, 600));
  worker.pedirParada();
  await laco;
  // 10 + 20 + 40 + 80 + 80 + … em 600 ms: no máximo ~10 ciclos (2 consultas cada). O laço antigo, com
  // intervalo fixo de 10 ms, faria uns 60 ciclos e tomaria e devolveria a vaga em cada um.
  expect(fila.consultas).toBeLessThanOrEqual(24);
  expect(existsSync(vagas)).toBe(false);
});

test('um job enfileirado enquanto o laço dorme é pego pelo aviso, sem esperar o teto', async () => {
  const fila = new FilaEmMemoria();
  const acordar = new Set<() => void>();
  const esperarNovidade = (limiteMs: number, sinal: AbortSignal) => new Promise<void>((resolver) => {
    const fim = () => { clearTimeout(relogio); acordar.delete(fim); resolver(); };
    const relogio = setTimeout(fim, limiteMs);
    acordar.add(fim);
    sinal.addEventListener('abort', fim, { once: true });
  });
  const worker = new Worker({
    fila, manipuladores: { teste: manipulador }, slots: 1, diretorioSlots: join(base, 'vagas'),
    intervaloMs: 60_000, intervaloMaximoMs: 60_000, esperarNovidade,
  });
  const laco = worker.rodar();
  await new Promise((r) => setTimeout(r, 50));
  const inicio = Date.now();
  const job = fila.enfileirar({ tipo: 'teste' });
  for (const fim of [...acordar]) fim();
  while (fila.ler(job.id)?.estado !== 'concluido' && Date.now() - inicio < 5_000) await new Promise((r) => setTimeout(r, 5));
  expect(fila.ler(job.id)?.estado).toBe('concluido');
  expect(Date.now() - inicio).toBeLessThan(1_000);
  worker.pedirParada();
  await laco;
});

test('vagas locais cheias: o laço espera um job terminar em vez de reservar mais', async () => {
  const fila = new FilaEmMemoria();
  for (let i = 0; i < 3; i += 1) fila.enfileirar({ tipo: 'teste' });
  let simultaneos = 0, maximo = 0;
  const lento: Manipulador = {
    executar: async () => { simultaneos += 1; maximo = Math.max(maximo, simultaneos); await new Promise((r) => setTimeout(r, 40)); simultaneos -= 1; return ok(); },
    publicar: manipulador.publicar,
  };
  const reservas: string[] = [];
  const worker = new Worker({
    fila, manipuladores: { teste: lento }, slots: 1, diretorioSlots: join(base, 'vagas'), intervaloMs: 5, maximoCiclos: 3,
    anotar: (a) => { if (a.evento === 'reservado') reservas.push(a.job_id); },
  });
  await worker.rodar();
  expect(reservas).toHaveLength(3);
  expect(maximo).toBe(1);
});

test('Postgres: o NOTIFY do enfileiramento acorda o worker em menos de 1 s', async () => comBanco('worker_ocioso', async (banco) => {
  const ouvinte = ouvinteDoPool(banco);
  await ouvinte.iniciar();
  const publicados: string[] = [];
  const worker = new Worker({
    fila: new FilaPostgres(banco), manipuladores: { teste_ocioso: manipulador }, slots: 1, diretorioSlots: join(base, 'vagas'),
    // Sem o aviso, um job novo esperaria até 30 s.
    intervaloMs: 30_000, intervaloMaximoMs: 30_000, heartbeatMs: 60_000,
    esperarNovidade: (limiteMs, sinal) => ouvinte.esperar(limiteMs, sinal),
    anotar: (a) => { if (a.evento === 'publicado') publicados.push(a.job_id); },
  });
  const laco = worker.rodar();
  try {
    await new Promise((r) => setTimeout(r, 300));
    const inicio = Date.now();
    const chave = `ocioso:${ulid()}`;
    const job = await comTransacao(banco, (cliente) => jobsRepo.enfileirar(cliente, { tipo: 'teste_ocioso', dedup_key: chave, input_snapshot_hash: 'b'.repeat(64) }));
    while (!publicados.includes(job.id) && Date.now() - inicio < 5_000) await new Promise((r) => setTimeout(r, 10));
    expect(publicados).toContain(job.id);
    expect(Date.now() - inicio).toBeLessThan(1_000);
  } finally {
    worker.pedirParada();
    await laco;
    await ouvinte.encerrar();
  }
}));
