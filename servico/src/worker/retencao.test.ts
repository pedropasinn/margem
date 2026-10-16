import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { comBanco, idTeste } from '../../testes/apoio.js';
import { apagarJobs } from '../apagar/compreensao.js';
import { comTransacao } from '../db/transacao.js';
import { diretorioDaTentativa, raizDaAuditoria } from '../executor/auditoria.js';
import * as jobs from '../repos/jobs.js';
import { limparAuditoriaAntiga } from './retencao.js';

const temporarios: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const p of temporarios.splice(0)) await rm(p, { recursive: true, force: true }); });

async function tentativa(raiz: string, job: string, attempt: number, diasAtras: number, agora: Date): Promise<void> {
  const pasta = diretorioDaTentativa(raiz, job, attempt);
  await mkdir(pasta, { recursive: true });
  await writeFile(join(pasta, 'prompt.md'), 'texto do documento');
  const quando = new Date(agora.getTime() - diasAtras * 86_400_000);
  await utimes(pasta, quando, quando);
  await utimes(join(raiz, 'jobs', job), quando, quando);
}

test('retenção: auditoria com mais de 30 dias sai; recente e desconhecido ficam', async () => {
  const raiz = await mkdtemp(join(tmpdir(), 'margem-retencao-')); temporarios.push(raiz);
  const agora = new Date();
  const velho = idTeste('J', 1), recente = idTeste('J', 2), misto = idTeste('J', 3);
  await tentativa(raiz, velho, 1, 31, agora);
  await tentativa(raiz, recente, 1, 2, agora);
  // Uma tentativa nova num job antigo mantém o job inteiro.
  await tentativa(raiz, misto, 1, 40, agora);
  const nova = diretorioDaTentativa(raiz, misto, 2);
  await mkdir(nova); const ontem = new Date(agora.getTime() - 86_400_000); await utimes(nova, ontem, ontem);
  await utimes(join(raiz, 'jobs', misto), new Date(agora.getTime() - 40 * 86_400_000), new Date(agora.getTime() - 40 * 86_400_000));
  await mkdir(join(raiz, 'jobs', 'nao-e-job'));
  await utimes(join(raiz, 'jobs', 'nao-e-job'), new Date(0), new Date(0));
  expect(await limparAuditoriaAntiga(raiz, agora)).toBe(1);
  expect((await readdir(join(raiz, 'jobs'))).sort()).toEqual([recente, misto, 'nao-e-job'].sort());
  expect(await limparAuditoriaAntiga(join(raiz, 'nao-existe'), agora)).toBe(0);
});

test('retenção: apagar o job (análise descartada) apaga a auditoria dele', async () => comBanco('retencao_apagar', async (banco) => {
  const base = await mkdtemp(join(tmpdir(), 'margem-retencao-db-')); temporarios.push(base);
  vi.stubEnv('MARGEM_ARTEFATOS', base);
  const job = await comTransacao(banco, (c) => jobs.enfileirar(c, { tipo: 'ler_parte', dedup_key: 'x', input_snapshot_hash: 'a'.repeat(64) }));
  const outro = idTeste('J', 7);
  await tentativa(raizDaAuditoria(), job.id, 1, 0, new Date());
  await tentativa(raizDaAuditoria(), outro, 1, 0, new Date());
  expect(await comTransacao(banco, (c) => apagarJobs(c, [job.id]))).toBe(1);
  expect(await readdir(join(raizDaAuditoria(), 'jobs'))).toEqual([outro]);
}));
