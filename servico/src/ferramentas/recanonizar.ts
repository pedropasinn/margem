/**
 * Recanonização de operador: pede ao worker uma versão de texto nova de documentos já importados,
 * com o motor atual (depois de uma correção no motor, como colunas ou títulos de paper). A versão
 * anterior fica intacta, com as marcas e notas dela; a nova entra como `numero + 1`.
 *
 *   node --import tsx servico/src/ferramentas/recanonizar.ts --rotulo <nome-da-rodada> <documento_id>…
 *
 * O rótulo entra na chave de deduplicação: rodar de novo com o mesmo rótulo não enfileira outra vez.
 */
import type { Id } from '@margem/contratos';
import { pool } from '../db/conexao.js';
import { comTransacao, type Transacao } from '../db/transacao.js';
import * as jobsRepo from '../repos/jobs.js';
import { TIPO_CANONIZAR } from '../worker/canonizar.js';

export async function enfileirarRecanonizacao(cliente: Transacao, documentoId: Id, rotulo: string): Promise<jobsRepo.Job> {
  if (!/^[\w.-]{1,40}$/.test(rotulo)) throw new Error('Rótulo: até 40 letras, números, ponto, hífen ou sublinhado.');
  const documento = (await cliente.query<{ sha256_original: string }>('SELECT sha256_original FROM documento WHERE id=$1', [documentoId])).rows[0];
  if (!documento) throw new Error(`Documento inexistente: ${documentoId}`);
  return jobsRepo.enfileirar(cliente, {
    tipo: TIPO_CANONIZAR, dedup_key: `canonizar:${documentoId}:${rotulo}`,
    input_snapshot_hash: documento.sha256_original, documento_id: documentoId,
  });
}

async function main(): Promise<void> {
  const argumentos = process.argv.slice(2);
  const indice = argumentos.indexOf('--rotulo');
  const rotulo = indice >= 0 ? argumentos[indice + 1] : undefined;
  const ids = argumentos.filter((_, i) => i !== indice && i !== indice + 1);
  if (rotulo === undefined || ids.length === 0) throw new Error('Uso: recanonizar.ts --rotulo <nome> <documento_id>…');
  try {
    for (const id of ids) {
      const job = await comTransacao(pool, (cliente) => enfileirarRecanonizacao(cliente, id, rotulo));
      console.log(`${id}\t${job.id}\t${job.estado}`);
    }
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) await main();
