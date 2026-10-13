/**
 * Worker só do agente da página "Perguntar" (e da canonização, para semear um banco de teste),
 * para provar a resposta real antes do merge: os workers da produção rodam o código do main e não
 * conhecem `responder_agente`. Mesmo `Worker`, fila e executor auditado do `main.ts`; nunca dispara
 * leituras (os outros tipos de job ficam parados na fila do banco de teste).
 *
 *   systemd-run --user --unit margem-agente-prova-worker -p WorkingDirectory=… \
 *     -E DATABASE_URL=…/margem_agente_prova -E MARGEM_SLOTS=1 -E MARGEM_SLOTS_DIR=… -E MARGEM_MODELO=conta … \
 *     node --import tsx servico/src/ferramentas/worker-agente.ts
 */
import { join } from 'node:path';
import { esforcoDoAgente, manipuladoresDoAgente } from '../agente/manipulador.js';
import { pool } from '../db/conexao.js';
import { executorAuditado } from '../executor/auditoria.js';
import { manipuladorCanonizar, TIPO_CANONIZAR } from '../worker/canonizar.js';
import { baseDosArtefatos, configuracaoDaCompreensao, escolherExecutor } from '../worker/configuracao.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { montarWorker } from '../worker/main.js';

const executor = executorAuditado(await escolherExecutor());
const compreensao = configuracaoDaCompreensao({ banco: pool, executor });
const base = baseDosArtefatos();
const worker = montarWorker(new FilaPostgres(pool), {
  [TIPO_CANONIZAR]: manipuladorCanonizar({ banco: pool }),
  ...manipuladoresDoAgente({
    banco: pool, executor, modelo: compreensao.modelo, esforco: esforcoDoAgente(),
    ...(base === undefined ? {} : { diretorioArtefatos: join(base, 'agente'), diretorioBiblioteca: join(base, 'biblioteca') }),
  }),
});
for (const sinal of ['SIGTERM', 'SIGINT'] as const) process.on(sinal, () => worker.pedirParada());
try { await worker.rodar(); } finally { await pool.end(); }
