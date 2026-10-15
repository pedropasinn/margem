import type pg from 'pg';
import { ulid } from 'ulid';
import type { JobResultV1, ValorJson } from '@margem/contratos';
import { comTransacao, type Transacao } from '../db/transacao.js';

export type EstadoJob = 'fila' | 'reservado' | 'ok' | 'falhou' | 'adiado' | 'cancelado';
export interface Job {
  id: string; tipo: string; documento_id: string | null; versao_id: string | null; parte_id: string | null;
  dedup_key: string; input_snapshot_hash: string; estado: EstadoJob; attempt: number; not_before: Date | null;
  lease_owner: string | null; lease_token: string | null; lease_expires_at: Date | null; heartbeat_at: Date | null;
  cancel_requested_at: Date | null; output_artifact_hash: string | null; error_code: string | null;
  diagnosticos: JobResultV1['diagnosticos']; criado_em: Date; atualizado_em: Date;
  /** 0 a 100; maior sai primeiro (migração 0006). */
  prioridade: number;
  /**
   * Em pausa desde a partida do worker (migração 0036, V-F1): trabalho do Codex parado há horas que só roda
   * quando a pessoa mandar (`servico/src/pausa/`). O worker não reserva job com esta marca.
   */
  retido_em: Date | null;
}
export class ConcessaoPerdida extends Error {
  constructor() { super('Concessão perdida, vencida ou cancelada.'); this.name = 'ConcessaoPerdida'; }
}
export interface EntradaJob {
  tipo: string; dedup_key: string; input_snapshot_hash: string;
  documento_id?: string; versao_id?: string; parte_id?: string; not_before?: Date;
  /** 0 a 100, padrão 50. Reenfileirar com prioridade maior sobe a do job existente. */
  prioridade?: number;
}
export const PRIORIDADE = { capitulo_aberto: 100, artefato_pedido: 90, padrao: 50, proximo_provavel: 50, reprocessamento: 20 } as const;
function conferirPrioridade(prioridade: number): void {
  if (!Number.isInteger(prioridade) || prioridade < 0 || prioridade > 100) throw new Error('Prioridade deve ser inteiro de 0 a 100.');
}
const limparConcessao = 'lease_token=NULL, lease_owner=NULL, lease_expires_at=NULL, heartbeat_at=NULL';
function conferirTtl(ttlMs: number): void {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error('TTL deve ser inteiro positivo em milissegundos.');
}
async function evento(cliente: Transacao, jobId: string, tipo: string, detalhe: ValorJson = {}): Promise<void> {
  await cliente.query('INSERT INTO evento_job(job_id,tipo,detalhe) VALUES ($1,$2,$3)', [jobId, tipo, JSON.stringify(detalhe)]);
}
export async function enfileirar(cliente: Transacao, entrada: EntradaJob): Promise<Job> {
  const prioridade = entrada.prioridade ?? PRIORIDADE.padrao;
  conferirPrioridade(prioridade);
  const existente = (await cliente.query<Job>('SELECT * FROM job WHERE dedup_key=$1', [entrada.dedup_key])).rows[0];
  if (existente) {
    // Um pedido feito agora (prioridade de quem espera o resultado) tira da pausa o mesmo trabalho que estava
    // parado: a pessoa pediu de novo, não há o que perguntar (V-F1). Os encadeamentos automáticos (o capítulo
    // seguinte em segundo plano) pedem com prioridade menor e não mexem na pausa.
    if (existente.retido_em !== null && prioridade >= PRIORIDADE.artefato_pedido && ['fila', 'adiado'].includes(existente.estado)) {
      const liberado = (await cliente.query<Job>(`WITH pendente AS (
        SELECT id FROM job WHERE id=$1 AND estado IN ('fila','adiado') AND retido_em IS NOT NULL FOR UPDATE SKIP LOCKED
      ) UPDATE job SET retido_em=NULL, prioridade=greatest(prioridade,$2), atualizado_em=clock_timestamp()
        WHERE id IN (SELECT id FROM pendente) RETURNING *`, [existente.id, prioridade])).rows[0];
      if (liberado) { await evento(cliente, liberado.id, 'retomado', { motivo: 'pedido' }); return liberado; }
      return existente;
    }
    if (prioridade <= existente.prioridade || !['fila', 'adiado'].includes(existente.estado)) return existente;
    // Não esperar por um job publicando enquanto o chamador segura o lock do capítulo.
    // A prioridade nunca diminui e só muda se ele continuar pendente depois do lock.
    return (await cliente.query<Job>(`WITH pendente AS (
      SELECT id FROM job WHERE id=$1 AND estado IN ('fila','adiado') FOR UPDATE SKIP LOCKED
    ) UPDATE job SET prioridade=greatest(prioridade,$2), atualizado_em=clock_timestamp()
      WHERE id IN (SELECT id FROM pendente) RETURNING *`, [existente.id, prioridade])).rows[0] ?? existente;
  }
  let versaoId = entrada.versao_id;
  let documentoId = entrada.documento_id;
  if (entrada.parte_id) {
    const parte = (await cliente.query<{ versao_id: string }>(`SELECT e.versao_id FROM parte p
      JOIN execucao_leitura e ON e.id=p.execucao_id WHERE p.id=$1`, [entrada.parte_id])).rows[0];
    if (!parte || (versaoId && parte.versao_id !== versaoId)) throw new Error('Parte incompatível com a versão do job.');
    versaoId = parte.versao_id;
  }
  if (versaoId) {
    const versao = (await cliente.query<{ documento_id: string }>('SELECT documento_id FROM versao_texto WHERE id=$1', [versaoId])).rows[0];
    if (!versao || (documentoId && versao.documento_id !== documentoId)) throw new Error('Versão incompatível com o documento do job.');
    documentoId = versao.documento_id;
  }
  const inserido = await cliente.query<Job>(`INSERT INTO job
    (id,tipo,dedup_key,input_snapshot_hash,documento_id,versao_id,parte_id,not_before,prioridade)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (dedup_key) DO NOTHING RETURNING *`,
  [ulid(), entrada.tipo, entrada.dedup_key, entrada.input_snapshot_hash, documentoId ?? null, versaoId ?? null, entrada.parte_id ?? null, entrada.not_before ?? null, prioridade]);
  const job = inserido.rows[0];
  if (job) { await evento(cliente, job.id, 'enfileirado'); return job; }
  return (await cliente.query<Job>('SELECT * FROM job WHERE dedup_key=$1', [entrada.dedup_key])).rows[0]!;
}
export async function reservar(banco: pg.Pool, owner: string, tipos: string[], agora = new Date(), ttlMs = 60_000): Promise<Job | null> {
  conferirTtl(ttlMs);
  if (!owner.trim()) throw new Error('Responsável pela concessão obrigatório.');
  return comTransacao(banco, async cliente => {
    const resultado = await cliente.query<Job>(`WITH proximo AS (
      SELECT id FROM job WHERE estado IN ('fila','adiado') AND (not_before IS NULL OR not_before <= $1)
      AND cancel_requested_at IS NULL AND retido_em IS NULL AND tipo = ANY($2::text[])
      ORDER BY prioridade DESC,criado_em,id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE job SET estado='reservado', lease_owner=$3,lease_token=$4,
      lease_expires_at=$1::timestamptz + $5 * interval '1 millisecond', heartbeat_at=$1,atualizado_em=$1
      FROM proximo WHERE job.id=proximo.id RETURNING job.*`, [agora, tipos, owner, ulid(), ttlMs]);
    const job = resultado.rows[0];
    if (!job) return null;
    await evento(cliente, job.id, 'reservado', { attempt: job.attempt, owner });
    return job;
  });
}
async function conferirConcessao(cliente: Transacao, jobId: string, token: string): Promise<void> {
  // Primeiro espera pelo lock; só depois lê o relógio. Um heartbeat não ressuscita concessão vencida.
  await cliente.query('SELECT id FROM job WHERE id=$1 FOR UPDATE', [jobId]);
  const valido = await cliente.query(`SELECT id FROM job WHERE id=$1 AND lease_token=$2 AND estado='reservado'
    AND lease_expires_at > clock_timestamp() AND cancel_requested_at IS NULL`, [jobId, token]);
  if (valido.rowCount !== 1) throw new ConcessaoPerdida();
}
export async function heartbeat(banco: pg.Pool, jobId: string, token: string, ttlMs = 60_000): Promise<void> {
  conferirTtl(ttlMs);
  await comTransacao(banco, async cliente => {
    await conferirConcessao(cliente, jobId, token);
    await cliente.query(`UPDATE job SET heartbeat_at=clock_timestamp(), atualizado_em=clock_timestamp(),
      lease_expires_at=clock_timestamp()+$2 * interval '1 millisecond' WHERE id=$1`, [jobId, ttlMs]);
  });
}
type Diagnosticos = JobResultV1['diagnosticos'];
/**
 * `artefatoHash` também aceita uma função do resultado: a fila do J07 só conhece o hash
 * depois que o efeito rodou, e o `UPDATE` acontece dentro da mesma transação.
 *
 * `diagnosticos` (J14) são os da tentativa vencedora e substituem os que a coluna
 * guardava. Os anteriores não se perdem: vão para o evento `publicado`, que é o
 * histórico de tentativas do job (os eventos `falhou` e `adiado` já os carregam).
 */
export async function publicar<T>(banco: pg.Pool, jobId: string, token: string,
  fn: (cliente: Transacao) => Promise<T>, artefatoHash?: string | ((resultado: T) => string | undefined),
  diagnosticos?: Diagnosticos | ((resultado: T) => Diagnosticos)): Promise<T> {
  return comTransacao(banco, async cliente => {
    await conferirConcessao(cliente, jobId, token);
    const resultado = await fn(cliente);
    const hash = typeof artefatoHash === 'function' ? artefatoHash(resultado) : artefatoHash;
    const vencedores = (typeof diagnosticos === 'function' ? diagnosticos(resultado) : diagnosticos) ?? [];
    // A escrita pode ter demorado: perder a concessão durante fn também provoca rollback.
    await conferirConcessao(cliente, jobId, token);
    const anteriores = (await cliente.query<{ diagnosticos: Diagnosticos }>(
      'SELECT diagnosticos FROM job WHERE id=$1', [jobId])).rows[0]?.diagnosticos ?? [];
    await cliente.query(`UPDATE job SET estado='ok',output_artifact_hash=$2,error_code=NULL,diagnosticos=$3,
      not_before=NULL,${limparConcessao},atualizado_em=clock_timestamp() WHERE id=$1`,
    [jobId, hash ?? null, JSON.stringify(vencedores)]);
    await evento(cliente, jobId, 'publicado', {
      artefato_hash: hash ?? null,
      ...(anteriores.length > 0 ? { diagnosticos_anteriores: anteriores as unknown as ValorJson } : {}),
    });
    return resultado;
  });
}
export async function falhar(banco: pg.Pool, jobId: string, token: string, errorCode: string,
  diagnosticos: JobResultV1['diagnosticos'], retry?: Date): Promise<void> {
  await comTransacao(banco, async cliente => {
    await conferirConcessao(cliente, jobId, token);
    await cliente.query(`UPDATE job SET estado=$2,error_code=$3,diagnosticos=$4,not_before=$5,
      attempt=attempt+$6,${limparConcessao},atualizado_em=clock_timestamp() WHERE id=$1`,
    [jobId, retry ? 'adiado' : 'falhou', errorCode, JSON.stringify(diagnosticos), retry ?? null, retry ? 1 : 0]);
    await evento(cliente, jobId, retry ? 'adiado' : 'falhou', {
      error_code: errorCode, not_before: retry?.toISOString() ?? null,
      diagnosticos: diagnosticos as unknown as ValorJson,
    });
  });
}
/** Estados em que um job pode ser cancelado: pendente, adiado ou em execução. */
export const CANCELAVEIS: readonly EstadoJob[] = ['fila', 'adiado', 'reservado'];
/** Estados de onde um job pode voltar à fila. */
export const REENFILEIRAVEIS: readonly EstadoJob[] = ['falhou', 'cancelado'];

/**
 * Cancela na hora, inclusive um job em execução: a concessão é revogada, então o worker
 * que ainda está rodando recebe `ConcessaoPerdida` ao tentar publicar (o `lease_token`
 * dele não existe mais) e nada é escrito. A próxima batida também aborta a execução.
 */
export async function cancelar(banco: pg.Pool, jobId: string): Promise<boolean> {
  return comTransacao(banco, async cliente => {
    const resultado = await cliente.query<{ id: string }>(`WITH antes AS (SELECT id, estado FROM job WHERE id=$1 FOR UPDATE)
      UPDATE job SET estado='cancelado',cancel_requested_at=clock_timestamp(),
      ${limparConcessao},atualizado_em=clock_timestamp() FROM antes
      WHERE job.id=antes.id AND antes.estado = ANY($2::text[]) RETURNING antes.estado AS estado_anterior`,
    [jobId, CANCELAVEIS]);
    const linha = resultado.rows[0] as { estado_anterior?: string } | undefined;
    if (resultado.rowCount !== 1 || !linha) return false;
    await evento(cliente, jobId, 'cancelado', { estado_anterior: linha.estado_anterior ?? null });
    return true;
  });
}

/**
 * Devolve à fila um job que falhou ou foi cancelado: tentativa nova, sem `not_before`,
 * sem pedido de cancelamento. Os diagnósticos da tentativa encerrada vão para o evento
 * `reenfileirado` e a coluna recomeça vazia.
 */
export async function reenfileirar(banco: pg.Pool, jobId: string): Promise<Job | null> {
  return comTransacao(banco, cliente => reenfileirarNa(cliente, jobId));
}
/** O mesmo que `reenfileirar`, dentro de uma transação já aberta. */
export async function reenfileirarNa(cliente: Transacao, jobId: string): Promise<Job | null> {
  const antes = (await cliente.query<Job>('SELECT * FROM job WHERE id=$1 FOR UPDATE', [jobId])).rows[0];
  if (!antes || !REENFILEIRAVEIS.includes(antes.estado)) return null;
  const depois = (await cliente.query<Job>(`UPDATE job SET estado='fila',attempt=attempt+1,not_before=NULL,retido_em=NULL,
    cancel_requested_at=NULL,error_code=NULL,diagnosticos='[]',${limparConcessao},atualizado_em=clock_timestamp()
    WHERE id=$1 RETURNING *`, [jobId])).rows[0]!;
  await evento(cliente, jobId, 'reenfileirado', {
    estado_anterior: antes.estado, attempt_anterior: antes.attempt, error_code: antes.error_code,
    diagnosticos: antes.diagnosticos as unknown as ValorJson,
  });
  return depois;
}
/**
 * Teto de tentativas automáticas. Uma concessão que vence (worker morto, OOM, motor travado)
 * conta como tentativa perdida: o job volta à fila com espera crescente (`ESPERA_MINUTOS`,
 * indexada pela tentativa que acabou) até `MAXIMO_TENTATIVAS`; ao estourar, vai para
 * `falhou` com `error_code='tentativas_esgotadas'` e não volta sozinho ("poison job").
 * Adiamento por cota (`falhar` com `retry`) não conta: é espera, não defeito do job.
 * Reenfileirar à mão continua possível e dá mais uma tentativa.
 */
export const MAXIMO_TENTATIVAS = 3;
export const ESPERA_MINUTOS: readonly number[] = [1, 5, 15];
export async function expirarConcessoes(banco: pg.Pool, agora = new Date()): Promise<number> {
  return comTransacao(banco, async cliente => {
    const esgotados = await cliente.query<{ id: string; attempt: number }>(`UPDATE job SET estado='falhou',
      error_code='tentativas_esgotadas',not_before=NULL,${limparConcessao},atualizado_em=$1
      WHERE estado='reservado' AND lease_expires_at <= $1 AND attempt >= $2 RETURNING id, attempt`, [agora, MAXIMO_TENTATIVAS]);
    for (const job of esgotados.rows) {
      await evento(cliente, job.id, 'concessao_expirada');
      await evento(cliente, job.id, 'falhou', { error_code: 'tentativas_esgotadas', attempt: job.attempt, maximo: MAXIMO_TENTATIVAS });
    }
    const devolvidos = await cliente.query<{ id: string; not_before: Date }>(`UPDATE job SET estado='fila',attempt=attempt+1,
      not_before=$1::timestamptz + ($2::int[])[least(attempt, cardinality($2::int[]))] * interval '1 minute',
      ${limparConcessao},atualizado_em=$1 WHERE estado='reservado' AND lease_expires_at <= $1 RETURNING id, not_before`,
    [agora, ESPERA_MINUTOS]);
    for (const job of devolvidos.rows) await evento(cliente, job.id, 'concessao_expirada', { not_before: job.not_before.toISOString() });
    return (esgotados.rowCount ?? 0) + (devolvidos.rowCount ?? 0);
  });
}
export async function obter(cliente: Transacao, jobId: string): Promise<Job | null> {
  return (await cliente.query<Job>('SELECT * FROM job WHERE id=$1', [jobId])).rows[0] ?? null;
}
