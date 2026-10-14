/**
 * Visuais ancorados (J70). A linha guarda o pedido e, publicada, o artefato; o estado vem do job.
 */
import { ulid } from 'ulid';
import {
  validarVisual, type AlvoDoVisual, type DiagramaDoVisualV1, type EstadoDoVisual, type Id, type ImagemDoVisualV1,
  type JobResultV1, type TipoDoVisual, type VisualV1,
} from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';

interface Linha {
  id: Id; versao_id: Id; secao_id: Id; tipo: TipoDoVisual; alvo: AlvoDoVisual; pedido: string | null; job_id: Id | null;
  artefato: ImagemDoVisualV1 | DiagramaDoVisualV1 | null; sha256_imagem: string | null;
  diagnosticos: VisualV1['diagnosticos']; execucao: VisualV1['execucao'] | null; substitui: Id | null;
  criado_em: Date; publicado_em: Date | null; apagado_em: Date | null;
  job_estado: string | null; job_diagnosticos: JobResultV1['diagnosticos'] | null; job_erro: string | null;
  job_atualizado_em: Date | null; job_not_before: Date | null;
}

const SELECAO = `SELECT v.*, j.estado AS job_estado, j.diagnosticos AS job_diagnosticos, j.error_code AS job_erro,
  j.atualizado_em AS job_atualizado_em, j.not_before AS job_not_before
  FROM visual v LEFT JOIN job j ON j.id = v.job_id`;

/** Motivos legíveis para códigos de falha sem mensagem própria. */
const MOTIVOS: Record<string, string> = {
  sem_imagem: 'O Codex terminou sem gerar imagem.',
  publicacao: 'A imagem foi gerada, mas não pôde ser guardada no disco.',
  timeout: 'O Codex passou do prazo.',
  cancelado: 'O pedido foi cancelado.',
  auth: 'A conta do Codex está sem sessão válida.',
  cli_incompativel: 'A versão local do Codex não oferece o que o visual precisa.',
  schema: 'A resposta do Codex veio fora do formato.',
  json_invalido: 'A resposta do Codex veio truncada.',
  processo: 'O Codex terminou com erro.',
};

function estadoDaLinha(linha: Linha): { estado: EstadoDoVisual; motivo?: string; aviso?: VisualV1['diagnosticos'][number] } {
  if (linha.artefato !== null) return { estado: 'pronto' };
  switch (linha.job_estado) {
    case null: case 'fila': return { estado: 'pendente' };
    case 'adiado': {
      const quando = linha.job_not_before?.toISOString();
      return { estado: 'pendente', aviso: { codigo: 'adiado', mensagem: quando ? `Cota do Codex esgotada; volta a tentar em ${quando}.` : 'Adiado pela fila.' } };
    }
    case 'reservado': return { estado: 'executando' };
    case 'ok': return { estado: 'falhou', motivo: 'O job terminou sem publicar o visual.' };
    default: {
      const diagnostico = (linha.job_diagnosticos ?? []).find((item) => item.nivel === 'erro') ?? linha.job_diagnosticos?.[0];
      const bruto = diagnostico?.mensagem ?? (linha.job_erro === null ? undefined : MOTIVOS[linha.job_erro]) ?? 'O Codex não conseguiu gerar o visual.';
      return { estado: 'falhou', motivo: bruto.slice(0, 1000) };
    }
  }
}

function maisRecente(...datas: (Date | null)[]): string {
  return new Date(Math.max(...datas.filter((data): data is Date => data !== null).map((data) => data.getTime()))).toISOString();
}

export function visualDaLinha(linha: Linha): VisualV1 {
  const { estado, motivo, aviso } = estadoDaLinha(linha);
  const visual: VisualV1 = {
    versao: 1, id: linha.id, versao_id: linha.versao_id, secao_id: linha.secao_id, tipo: linha.tipo, alvo: linha.alvo,
    ...(linha.pedido === null ? {} : { pedido: linha.pedido }),
    estado,
    ...(motivo === undefined ? {} : { motivo }),
    ...(linha.artefato === null ? {} : { artefato: linha.artefato }),
    diagnosticos: [...linha.diagnosticos, ...(aviso === undefined ? [] : [aviso])],
    ...(linha.substitui === null ? {} : { substitui: linha.substitui }),
    ...(linha.execucao === null ? {} : { execucao: linha.execucao }),
    criado_em: linha.criado_em.toISOString(),
    atualizado_em: maisRecente(linha.criado_em, linha.publicado_em, linha.job_atualizado_em),
  };
  if (!validarVisual(visual)) throw new Error(`Visual ${linha.id} fora do contrato VisualV1: ${JSON.stringify(validarVisual.errors?.slice(0, 2))}`);
  return visual;
}

export interface NovoVisual {
  versao_id: Id; secao_id: Id; tipo: TipoDoVisual; alvo: AlvoDoVisual; pedido: string | null; substitui: Id | null;
}

export async function criar(cliente: Transacao, novo: NovoVisual): Promise<Id> {
  const id = ulid();
  await cliente.query(`INSERT INTO visual (id,versao_id,secao_id,tipo,alvo,pedido,substitui) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, novo.versao_id, novo.secao_id, novo.tipo, JSON.stringify(novo.alvo), novo.pedido, novo.substitui]);
  return id;
}

export async function ligarJob(cliente: Transacao, id: Id, jobId: Id): Promise<void> {
  await cliente.query('UPDATE visual SET job_id=$2 WHERE id=$1 AND job_id IS NULL', [id, jobId]);
}

export async function obter(cliente: Transacao, id: Id, opcoes: { travar?: boolean; apagados?: boolean } = {}): Promise<VisualV1 | null> {
  if (opcoes.travar) await cliente.query('SELECT id FROM visual WHERE id=$1 FOR UPDATE', [id]);
  const linha = (await cliente.query<Linha>(`${SELECAO} WHERE v.id=$1${opcoes.apagados ? '' : ' AND v.apagado_em IS NULL'}`, [id])).rows[0];
  return linha ? visualDaLinha(linha) : null;
}

/** Os visuais vivos do capítulo, do mais antigo para o mais novo. */
export async function doCapitulo(cliente: Transacao, versaoId: Id, secaoId: Id): Promise<VisualV1[]> {
  const { rows } = await cliente.query<Linha>(`${SELECAO} WHERE v.versao_id=$1 AND v.secao_id=$2 AND v.apagado_em IS NULL
    ORDER BY v.criado_em, v.id`, [versaoId, secaoId]);
  return rows.map(visualDaLinha);
}

export async function apagar(cliente: Transacao, id: Id): Promise<boolean> {
  const { rowCount } = await cliente.query('UPDATE visual SET apagado_em=clock_timestamp() WHERE id=$1 AND apagado_em IS NULL', [id]);
  return (rowCount ?? 0) > 0;
}

/** Hash da imagem de um visual vivo e pronto. */
export async function imagem(cliente: Transacao, id: Id): Promise<string | null> {
  const { rows } = await cliente.query<{ sha256_imagem: string | null }>('SELECT sha256_imagem FROM visual WHERE id=$1 AND apagado_em IS NULL', [id]);
  return rows[0]?.sha256_imagem ?? null;
}

export class VisualJaPublicado extends Error {
  constructor(id: Id) { super(`O visual ${id} já foi publicado.`); this.name = 'VisualJaPublicado'; }
}

/** Grava o artefato; publicação dupla é recusada (a concessão já recusa antes). */
export async function publicar(cliente: Transacao, id: Id, dados: {
  artefato: ImagemDoVisualV1 | DiagramaDoVisualV1; diagnosticos: VisualV1['diagnosticos']; execucao: NonNullable<VisualV1['execucao']>;
}): Promise<void> {
  const { rowCount } = await cliente.query(`UPDATE visual SET artefato=$2, sha256_imagem=$3, diagnosticos=$4, execucao=$5, publicado_em=clock_timestamp()
    WHERE id=$1 AND artefato IS NULL`, [id, JSON.stringify(dados.artefato), dados.artefato.tipo === 'png' ? dados.artefato.sha256 : null,
    JSON.stringify(dados.diagnosticos), JSON.stringify(dados.execucao)]);
  if ((rowCount ?? 0) !== 1) throw new VisualJaPublicado(id);
}

/** O que o manipulador lê do visual (não depende do estado). */
export async function pedidoDoVisual(cliente: Transacao, id: Id): Promise<NovoVisual & { id: Id; publicado: boolean; apagado: boolean }> {
  const { rows } = await cliente.query<Linha>('SELECT * FROM visual WHERE id=$1', [id]);
  const linha = rows[0];
  if (!linha) throw new Error('Visual inexistente.');
  return { id: linha.id, versao_id: linha.versao_id, secao_id: linha.secao_id, tipo: linha.tipo, alvo: linha.alvo, pedido: linha.pedido,
    substitui: linha.substitui, publicado: linha.artefato !== null, apagado: linha.apagado_em !== null };
}
