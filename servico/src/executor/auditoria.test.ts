import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { manipuladorDeTeste } from '../../testes/manipulador.js';
import { FilaEmMemoria } from '../worker/fila.js';
import { Worker } from '../worker/worker.js';
import {
  comAuditoria, diretorioDaTentativa, executorAuditado, raizDaAuditoria, registrarNaAuditoria,
} from './auditoria.js';
import { ARQUIVO_PROMPT, PONTEIRO_DO_PROMPT } from './entrada.js';
import { carregarRoteiro, criarExecutorFalso } from './fake.js';

const raizRepo = fileURLToPath(new URL('../../../', import.meta.url));
const schema = join(raizRepo, 'fixtures/codex/schema-teste.json');

let base = '';
beforeEach(async () => { base = await mkdtemp(join(tmpdir(), 'margem-teste-auditoria-')); });
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

async function executorDoRoteiro() {
  return criarExecutorFalso(await carregarRoteiro(join(raizRepo, 'fixtures/codex/roteiro-worker.json')));
}

test('uma tentativa do worker grava prompt, entrada, schema, metadados, resultado e resposta', async () => {
  const entrada = join(base, 'entrada');
  await mkdir(entrada, { recursive: true });
  await writeFile(join(entrada, 'digest.md'), '# digest\n');
  const fila = new FilaEmMemoria();
  const job = fila.enfileirar({
    tipo: 'teste',
    entrada: { diretorioEntrada: entrada, prompt: 'leia a parte com cuidado', schema, diretorioArtefatos: join(base, 'artefatos') },
  });
  const raiz = join(base, 'auditoria');
  const executor = executorAuditado(await executorDoRoteiro(), { commit: () => 'abc123' });
  const worker = new Worker({
    fila, manipuladores: { teste: manipuladorDeTeste(executor) }, auditoria: raiz,
    slots: 1, diretorioSlots: join(base, 'slots'), intervaloMs: 5, maximoCiclos: 1,
  });
  await worker.rodar();
  const dir = diretorioDaTentativa(raiz, job.id, 1);
  expect(await readFile(join(dir, 'prompt.txt'), 'utf8')).toBe('leia a parte com cuidado');
  expect(await readFile(join(dir, 'entrada/digest.md'), 'utf8')).toBe('# digest\n');
  expect(JSON.parse(await readFile(join(dir, 'schema.json'), 'utf8'))).toBeTypeOf('object');
  const metadados = JSON.parse(await readFile(join(dir, 'metadados.json'), 'utf8')) as Record<string, unknown>;
  expect(metadados).toMatchObject({ job_id: job.id, tipo: 'teste', attempt: 1, commit: 'abc123', prompt_em_arquivo: false });
  expect(metadados.sha256_prompt).toMatch(/^[0-9a-f]{64}$/);
  const resultado = JSON.parse(await readFile(join(dir, 'resultado.json'), 'utf8')) as Record<string, unknown>;
  expect(resultado).toMatchObject({ estado: 'ok', modelo: 'executor-falso' });
  const resposta = JSON.parse(await readFile(join(dir, 'resposta.bruta.json'), 'utf8')) as { marcas: unknown[] };
  expect(resposta.marcas).toHaveLength(1);
});

test('prompt que foi para prompt.md é gravado inteiro, não o ponteiro', async () => {
  const entrada = join(base, 'entrada');
  await mkdir(entrada, { recursive: true });
  await writeFile(join(entrada, ARQUIVO_PROMPT), 'o prompt enorme de verdade');
  const executor = executorAuditado(await executorDoRoteiro(), { commit: () => 'x' });
  const raiz = join(base, 'auditoria');
  await comAuditoria({ job_id: 'J1', tipo: 'ler_parte', attempt: 2, raiz }, () => executor({
    diretorioEntrada: entrada, prompt: PONTEIRO_DO_PROMPT, schema, prazoMs: 5_000, diretorioArtefatos: join(base, 'artefatos'),
  }));
  const dir = diretorioDaTentativa(raiz, 'J1', 2);
  expect(await readFile(join(dir, 'prompt.txt'), 'utf8')).toBe('o prompt enorme de verdade');
  expect(await readdir(join(dir, 'entrada')).catch(() => [])).not.toContain(ARQUIVO_PROMPT);
});

test('sem contexto o executor auditado só repassa, e registrarNaAuditoria não grava nada', async () => {
  const executor = executorAuditado(await executorDoRoteiro());
  const resultado = await executor({ diretorioEntrada: base, prompt: 'p', schema, prazoMs: 5_000, diretorioArtefatos: join(base, 'artefatos') });
  expect(resultado.estado).toBe('ok');
  await registrarNaAuditoria('diagnosticos.json', []);
  expect(await readdir(base)).not.toContain('jobs');
});

test('registrarNaAuditoria grava no diretório da tentativa em curso', async () => {
  const raiz = join(base, 'auditoria');
  await comAuditoria({ job_id: 'J2', tipo: 'x', attempt: 1, raiz }, () => registrarNaAuditoria('diagnosticos.json', [{ codigo: 'a' }]));
  expect(JSON.parse(await readFile(join(diretorioDaTentativa(raiz, 'J2', 1), 'diagnosticos.json'), 'utf8'))).toEqual([{ codigo: 'a' }]);
});

test('a raiz vem de MARGEM_ARTEFATOS quando existe', () => {
  expect(raizDaAuditoria({ MARGEM_ARTEFATOS: '/tmp/x' })).toBe('/tmp/x/auditoria');
  expect(raizDaAuditoria({})).toMatch(/\.cache\/margem\/auditoria$/);
});
