import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { comBanco } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import { comAuditoria, registrarNaAuditoria } from '../executor/auditoria.js';
import * as jobsRepo from '../repos/jobs.js';
import { relatorioDaMarca, relatorioDaParte, relatorioDoJob } from './auditar.js';

test('o relatório de um job junta estado, eventos e os arquivos da auditoria', async () => {
  await comBanco('auditar_job', async (banco) => {
    const raiz = await mkdtemp(join(tmpdir(), 'margem-auditar-'));
    try {
      const job = await comTransacao(banco, (cliente) => jobsRepo.enfileirar(cliente, {
        tipo: 'responder', dedup_key: 'responder:x', input_snapshot_hash: 'a'.repeat(64),
      }));
      await banco.query('INSERT INTO evento_job(job_id,tipo,detalhe) VALUES ($1,$2,$3)', [job.id, 'teste', '{"n":1}']);
      await comAuditoria({ job_id: job.id, tipo: 'responder', attempt: 1, raiz }, async () => {
        await registrarNaAuditoria('prompt.txt', 'PROMPT COMPLETO '.repeat(200));
        await registrarNaAuditoria('diagnosticos.json', [{ codigo: 'citacao_recusada' }]);
      });
      const completo = await relatorioDoJob(banco, job.id, { raiz });
      expect(completo).toContain(`Job ${job.id} · responder · fila`);
      expect(completo).toContain('teste {"n":1}');
      expect(completo).toContain('┌─ PROMPT');
      expect(completo).toContain('citacao_recusada');
      expect(completo).not.toContain('caracteres omitidos');
      const resumido = await relatorioDoJob(banco, job.id, { raiz, resumo: true });
      expect(resumido).toContain('caracteres omitidos');
      expect(await relatorioDoJob(banco, '01ZZZZZZZZZZZZZZZZZZZZZZZZ', { raiz })).toContain('não encontrado');
      expect(await relatorioDaParte(banco, '01ZZZZZZZZZZZZZZZZZZZZZZZZ', { raiz })).toContain('sem job');
      expect(await relatorioDaMarca(banco, '01ZZZZZZZZZZZZZZZZZZZZZZZZ', { raiz })).toContain('não encontrada');
    } finally {
      await rm(raiz, { recursive: true, force: true });
    }
  });
});

test('job sem auditoria gravada avisa em vez de falhar', async () => {
  await comBanco('auditar_vazio', async (banco) => {
    const job = await comTransacao(banco, (cliente) => jobsRepo.enfileirar(cliente, {
      tipo: 'responder', dedup_key: 'responder:y', input_snapshot_hash: 'b'.repeat(64),
    }));
    expect(await relatorioDoJob(banco, job.id, { raiz: join(tmpdir(), 'margem-inexistente') })).toContain('Sem auditoria gravada');
  });
});
