/**
 * Prepara a leitura comentada de alguns capítulos (J92) sem o worker de produção: enfileira cada
 * capítulo e roda um worker só com o job `comentar_leitura`, até todos terminarem.
 *
 *   npm run preparar-leitura-comentada -- <execução> <seção> [<seção>…]
 *
 * Usa DATABASE_URL, MARGEM_MODELO (padrão `conta`) e MARGEM_ESFORCO_LEITURA_COMENTADA (padrão
 * `medium`). Com MARGEM_EXECUTOR=falso, o executor determinístico de sempre.
 */
import { join } from 'node:path';
import type { Id } from '@margem/contratos';
import { pool } from '../db/conexao.js';
import { migrar } from '../db/migrar.js';
import { comTransacao } from '../db/transacao.js';
import { executorAuditado, raizDaAuditoria } from '../executor/auditoria.js';
import { MODELO_DA_CONTA, baseDosArtefatos, escolherExecutor, esforcoDaLeituraComentada } from '../worker/configuracao.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { Worker } from '../worker/worker.js';
import { manipuladoresDaLeituraComentada, pedirLeituraComentada } from '../leitura-comentada/manipuladores.js';

const [execucao, ...secoes] = process.argv.slice(2);
try {
  if (!execucao || secoes.length === 0) throw new Error('Use: <execução> <seção> [<seção>…]');
  await migrar(pool);
  const jobs: Id[] = [];
  for (const secao of secoes) jobs.push((await comTransacao(pool, (cliente) => pedirLeituraComentada(cliente, execucao, secao))).id);
  const base = baseDosArtefatos();
  const worker = new Worker({
    fila: new FilaPostgres(pool, { concessaoMs: 60_000 }),
    manipuladores: manipuladoresDaLeituraComentada({
      banco: pool, executor: executorAuditado(await escolherExecutor()), modelo: process.env.MARGEM_MODELO ?? MODELO_DA_CONTA, esforco: esforcoDaLeituraComentada(),
      ...(base === undefined ? {} : { diretorioArtefatos: join(base, 'leituras-comentadas') }),
    }),
    slots: Math.min(3, secoes.length), heartbeatMs: 30_000, prazoEncerramentoMs: 30_000,
    auditoria: raizDaAuditoria(),
    anotar: (anotacao) => { console.log(JSON.stringify({ ...anotacao, em: new Date().toISOString() })); },
  });
  const vigia = setInterval(() => {
    void pool.query<{ estado: string }>('SELECT estado FROM job WHERE id = ANY($1::text[])', [jobs]).then(({ rows }) => {
      if (rows.every((linha) => ['ok', 'falhou', 'cancelado'].includes(linha.estado))) { clearInterval(vigia); worker.pedirParada(); }
    });
  }, 5000);
  await worker.rodar();
  const { rows } = await pool.query<{ id: Id; estado: string; error_code: string | null }>('SELECT id, estado, error_code FROM job WHERE id = ANY($1::text[])', [jobs]);
  console.log(JSON.stringify({ jobs: rows }));
  if (rows.some((linha) => linha.estado !== 'ok')) process.exitCode = 1;
} catch (erro) {
  console.error(erro instanceof Error ? erro.message : 'Falha ao preparar a leitura comentada.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
