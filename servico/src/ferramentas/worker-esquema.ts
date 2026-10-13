/**
 * Worker só do esquema do capítulo, para provar a geração real antes do merge (os workers da
 * produção rodam o código do main e não conhecem `gerar_esquema`). Mesmo `Worker`, fila e
 * executor auditado do `main.ts`, mas com um único manipulador: nunca dispara leituras.
 *
 *   systemd-run --user --unit margem-previa-worker-esquema -p WorkingDirectory=… \
 *     -E MARGEM_SLOTS=1 -E MARGEM_MODELO=conta … node --import tsx servico/src/ferramentas/worker-esquema.ts
 */
import { join } from 'node:path';
import { pool } from '../db/conexao.js';
import { manipuladoresDoEsquema } from '../esquema/manipuladores.js';
import { executorAuditado } from '../executor/auditoria.js';
import { baseDosArtefatos, configuracaoDaCompreensao, escolherExecutor, esforcoDosVisuais } from '../worker/configuracao.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { montarWorker } from '../worker/main.js';

const executor = executorAuditado(await escolherExecutor());
const compreensao = configuracaoDaCompreensao({ banco: pool, executor });
const base = baseDosArtefatos();
const worker = montarWorker(new FilaPostgres(pool), manipuladoresDoEsquema({
  banco: pool, executor, modelo: compreensao.modelo, esforco: esforcoDosVisuais(),
  ...(base === undefined ? {} : { diretorioArtefatos: join(base, 'esquemas') }),
}));
for (const sinal of ['SIGTERM', 'SIGINT'] as const) process.on(sinal, () => worker.pedirParada());
try { await worker.rodar(); } finally { await pool.end(); }
