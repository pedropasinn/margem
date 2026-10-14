/**
 * Quadros da pessoa (0029, J118). A obra guarda o que a pessoa informou e o job mais recente; o estado
 * (na fila, preparando, pronto, falhou) vem do job, como nas perguntas do agente.
 */
import { ulid } from 'ulid';
import type { Id, IdentificacaoDaObraV1, JobResultV1 } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import type { FormatoDaImagem } from './imagem-enviada.js';

export interface LinhaDoQuadro {
  id: Id; slug: string; formato: FormatoDaImagem; bytes: number; nome_do_arquivo: string | null; sha256_original: string;
  /** O que a pessoa informou ou corrigiu; `null`: o Codex propõe a partir da imagem. */
  identificacao: IdentificacaoDaObraV1 | null;
  rotulo: string; job_id: Id | null; pronto_em: Date | null; criado_em: Date; atualizado_em: Date;
  job_estado: string | null; job_diagnosticos: JobResultV1['diagnosticos'] | null; job_erro: string | null; job_not_before: Date | null;
}

const SELECAO = `SELECT q.id, q.slug, q.formato, q.bytes::int AS bytes, q.nome_do_arquivo, q.sha256_original, q.identificacao, q.rotulo, q.job_id,
    q.pronto_em, q.criado_em, q.atualizado_em, j.estado AS job_estado, j.diagnosticos AS job_diagnosticos, j.error_code AS job_erro, j.not_before AS job_not_before
  FROM quadro_da_pessoa q LEFT JOIN job j ON j.id = q.job_id`;

export async function listar(cliente: Transacao): Promise<LinhaDoQuadro[]> {
  return (await cliente.query<LinhaDoQuadro>(`${SELECAO} ORDER BY q.criado_em, q.id`)).rows;
}

export async function obterPorSlug(cliente: Transacao, slug: string, opcoes: { travar?: boolean } = {}): Promise<LinhaDoQuadro | null> {
  if (opcoes.travar) await cliente.query('SELECT id FROM quadro_da_pessoa WHERE slug=$1 FOR UPDATE', [slug]);
  return (await cliente.query<LinhaDoQuadro>(`${SELECAO} WHERE q.slug=$1`, [slug])).rows[0] ?? null;
}

export async function obter(cliente: Transacao, id: Id, opcoes: { travar?: boolean } = {}): Promise<LinhaDoQuadro | null> {
  if (opcoes.travar) await cliente.query('SELECT id FROM quadro_da_pessoa WHERE id=$1 FOR UPDATE', [id]);
  return (await cliente.query<LinhaDoQuadro>(`${SELECAO} WHERE q.id=$1`, [id])).rows[0] ?? null;
}

export async function porImagem(cliente: Transacao, sha: string): Promise<LinhaDoQuadro | null> {
  return (await cliente.query<LinhaDoQuadro>(`${SELECAO} WHERE q.sha256_original=$1 ORDER BY q.criado_em LIMIT 1`, [sha])).rows[0] ?? null;
}

export async function slugEmUso(cliente: Transacao, slug: string): Promise<boolean> {
  return (await cliente.query('SELECT 1 FROM quadro_da_pessoa WHERE slug=$1', [slug])).rowCount === 1;
}

export async function criar(cliente: Transacao, dados: {
  slug: string; formato: FormatoDaImagem; bytes: number; nome_do_arquivo: string | null; sha256_original: string;
  identificacao: IdentificacaoDaObraV1 | null; rotulo: string;
}): Promise<Id> {
  const id = ulid();
  await cliente.query(`INSERT INTO quadro_da_pessoa (id, slug, formato, bytes, nome_do_arquivo, sha256_original, identificacao, rotulo)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
  [id, dados.slug, dados.formato, dados.bytes, dados.nome_do_arquivo, dados.sha256_original, dados.identificacao === null ? null : JSON.stringify(dados.identificacao), dados.rotulo]);
  return id;
}

/** Liga o job que prepara a obra agora (um "tentar de novo" ou uma correção troca o job). */
export async function ligarJob(cliente: Transacao, id: Id, jobId: Id, rotulo: string): Promise<void> {
  await cliente.query('UPDATE quadro_da_pessoa SET job_id=$2, rotulo=$3, atualizado_em=clock_timestamp() WHERE id=$1', [id, jobId, rotulo]);
}

export async function gravarIdentificacao(cliente: Transacao, id: Id, identificacao: IdentificacaoDaObraV1): Promise<void> {
  await cliente.query('UPDATE quadro_da_pessoa SET identificacao=$2, atualizado_em=clock_timestamp() WHERE id=$1', [id, JSON.stringify(identificacao)]);
}

export async function marcarPronto(cliente: Transacao, id: Id): Promise<void> {
  await cliente.query('UPDATE quadro_da_pessoa SET pronto_em=coalesce(pronto_em, clock_timestamp()), atualizado_em=clock_timestamp() WHERE id=$1', [id]);
}

export async function apagar(cliente: Transacao, id: Id): Promise<boolean> {
  return ((await cliente.query('DELETE FROM quadro_da_pessoa WHERE id=$1', [id])).rowCount ?? 0) > 0;
}
