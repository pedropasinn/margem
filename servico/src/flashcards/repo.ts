/**
 * Flashcards no Postgres (migração 0020): cartões ancorados e a trilha de revisões. O estado da
 * agenda de um cartão é a revisão mais recente; sem revisão, o cartão é novo e está na fila de hoje.
 */
import { ulid } from 'ulid';
import { conferirAncora, type AncoraV1, type Id } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import { DadoRecusado, DATA, OBJETO_ANCORA } from '../repos/anotacoes.js';
import { agendar, ESTADO_INICIAL, type NotaDaRevisao } from './agenda.js';

export type OrigemDoCartao = 'ia' | 'manual';

export interface AgendaDoCartao {
  facilidade: number;
  intervalo_dias: number;
  repeticoes: number;
  /** `null`: cartão novo, nunca revisado (entra na fila de hoje). */
  proxima_revisao: string | null;
  revisoes: number;
}

export interface Flashcard {
  id: Id;
  documento: { id: Id; titulo: string; autor: string | null };
  versao_id: Id;
  capitulo: { id: Id; titulo: string };
  ancora: AncoraV1;
  frente: string;
  verso: string;
  origem: OrigemDoCartao;
  criado_em: string;
  atualizado_em: string;
  agenda: AgendaDoCartao;
  /** Volta ao trecho no leitor: `/ler/<documento>/<capítulo>?bloco=<bloco>`. */
  link: string;
}

export const FRENTE_MAXIMA = 1000;
export const VERSO_MAXIMO = 4000;

interface Linha {
  id: Id; documento_id: Id; titulo: string; autor: string | null; versao_id: Id; secao_id: Id; secao_titulo: string;
  ancora: AncoraV1; frente: string; verso: string; origem: OrigemDoCartao; criado_em: string; atualizado_em: string;
  facilidade: number | null; intervalo_dias: number | null; repeticoes: number | null; proxima_revisao: string | null; revisoes: number;
}

const SELECAO = `SELECT f.id, f.documento_id, d.titulo, d.autor, f.versao_id, f.secao_id, s.titulo AS secao_titulo,
    ${OBJETO_ANCORA('f.')} AS ancora, f.frente, f.verso, f.origem, ${DATA('f.criado_em')} AS criado_em, ${DATA('f.atualizado_em')} AS atualizado_em,
    r.facilidade, r.intervalo_dias, r.repeticoes, ${DATA('r.proxima_revisao')} AS proxima_revisao,
    (SELECT count(*)::int FROM revisao_flashcard t WHERE t.flashcard_id = f.id) AS revisoes
  FROM flashcard f
  JOIN documento d ON d.id = f.documento_id
  JOIN secao s ON s.versao_id = f.versao_id AND s.id = f.secao_id
  JOIN bloco b ON b.versao_id = f.versao_id AND b.id = f.bloco_id
  LEFT JOIN LATERAL (
    SELECT facilidade, intervalo_dias, repeticoes, proxima_revisao FROM revisao_flashcard t
    WHERE t.flashcard_id = f.id ORDER BY t.revisado_em DESC, t.id DESC LIMIT 1
  ) r ON true`;

function cartao(linha: Linha): Flashcard {
  return {
    id: linha.id, documento: { id: linha.documento_id, titulo: linha.titulo, autor: linha.autor }, versao_id: linha.versao_id,
    capitulo: { id: linha.secao_id, titulo: linha.secao_titulo }, ancora: { ...linha.ancora, inicio_utf16: Number(linha.ancora.inicio_utf16), fim_utf16: Number(linha.ancora.fim_utf16) },
    frente: linha.frente, verso: linha.verso, origem: linha.origem, criado_em: linha.criado_em, atualizado_em: linha.atualizado_em,
    agenda: {
      facilidade: linha.facilidade ?? ESTADO_INICIAL.facilidade, intervalo_dias: linha.intervalo_dias ?? 0,
      repeticoes: linha.repeticoes ?? 0, proxima_revisao: linha.proxima_revisao, revisoes: linha.revisoes,
    },
    link: `/ler/${linha.documento_id}/${linha.secao_id}?bloco=${linha.ancora.bloco_id}`,
  };
}

export interface FiltroDosCartoes {
  documento_id?: Id;
  /** Só a fila de hoje: os novos e os vencidos até `agora`. */
  hoje?: boolean;
  agora?: Date;
}

/**
 * Lista na ordem de estudo quando `hoje` (vencidos primeiro, pelo vencimento; depois os novos, na ordem
 * do texto); senão, por documento e na ordem do texto.
 */
export async function listarCartoes(cliente: Transacao, filtro: FiltroDosCartoes = {}): Promise<Flashcard[]> {
  const hoje = filtro.hoje === true;
  const { rows } = await cliente.query<Linha>(`${SELECAO}
    WHERE ($1::text IS NULL OR f.documento_id = $1)
      AND (NOT $2::boolean OR r.proxima_revisao IS NULL OR r.proxima_revisao <= $3)
    ORDER BY ${hoje ? '(r.proxima_revisao IS NULL), r.proxima_revisao,' : 'lower(d.titulo), f.documento_id,'} b.ordem, f.inicio_utf16, f.criado_em, f.id`,
  [filtro.documento_id ?? null, hoje, filtro.agora ?? new Date()]);
  return rows.map(cartao);
}

export async function obterCartao(cliente: Transacao, id: Id): Promise<Flashcard | null> {
  const linha = (await cliente.query<Linha>(`${SELECAO} WHERE f.id = $1`, [id])).rows[0];
  return linha ? cartao(linha) : null;
}

/** As frentes já guardadas do capítulo (para o Codex não repetir). */
export async function frentesDoCapitulo(cliente: Transacao, versaoId: Id, secaoId: Id): Promise<string[]> {
  return (await cliente.query<{ frente: string }>('SELECT frente FROM flashcard WHERE versao_id=$1 AND secao_id=$2 ORDER BY criado_em, id',
    [versaoId, secaoId])).rows.map((linha) => linha.frente);
}

function texto(valor: unknown, campo: string, maximo: number): string {
  if (typeof valor !== 'string' || valor.trim() === '') throw new DadoRecusado(`${campo}_vazia`, `Escreva ${campo === 'frente' ? 'a frente' : 'o verso'} do cartão.`);
  const limpo = valor.trim();
  if (limpo.length > maximo) throw new DadoRecusado(`${campo}_longa`, `${campo === 'frente' ? 'A frente' : 'O verso'} passa de ${String(maximo)} caracteres.`);
  return limpo;
}

export interface NovoCartao {
  ancora: AncoraV1;
  frente: unknown;
  verso: unknown;
  origem: OrigemDoCartao;
  job_id?: Id;
  /** O capítulo pedido (job); sem ele, o capítulo é o de menor nível que contém o bloco. */
  secao_id?: Id;
}

/** Confere a âncora no bloco real, acha documento e capítulo e grava. */
export async function criarCartao(cliente: Transacao, novo: NovoCartao): Promise<Id> {
  const frente = texto(novo.frente, 'frente', FRENTE_MAXIMA);
  const verso = texto(novo.verso, 'verso', VERSO_MAXIMO);
  const a = novo.ancora;
  const bloco = (await cliente.query<{ id: Id; texto: string; documento_id: Id }>(`SELECT b.id, b.texto, v.documento_id FROM bloco b
    JOIN versao_texto v ON v.id = b.versao_id WHERE b.versao_id=$1 AND b.id=$2`, [a.versao_id, a.bloco_id])).rows[0];
  if (!bloco || !conferirAncora(bloco, a)) throw new DadoRecusado('ancora_invalida', 'A âncora não confere no bloco da versão.');
  const secao = novo.secao_id ?? (await cliente.query<{ id: Id }>(`SELECT s.id FROM secao s
      JOIN bloco bi ON bi.versao_id = s.versao_id AND bi.id = s.bloco_inicio
      JOIN bloco bf ON bf.versao_id = s.versao_id AND bf.id = s.bloco_fim
      JOIN bloco b ON b.versao_id = s.versao_id AND b.id = $2
    WHERE s.versao_id = $1 AND b.ordem BETWEEN bi.ordem AND bf.ordem ORDER BY s.nivel, s.ordem LIMIT 1`, [a.versao_id, a.bloco_id])).rows[0]?.id;
  if (!secao) throw new DadoRecusado('sem_capitulo', 'O trecho não está em nenhum capítulo.');
  const id = ulid();
  await cliente.query(`INSERT INTO flashcard (id, documento_id, versao_id, secao_id, bloco_id, inicio_utf16, fim_utf16, citacao, prefixo, sufixo,
      frente, verso, origem, job_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
  [id, bloco.documento_id, a.versao_id, secao, a.bloco_id, a.inicio_utf16, a.fim_utf16, a.citacao, a.prefixo, a.sufixo, frente, verso, novo.origem, novo.job_id ?? null]);
  return id;
}

export async function atualizarCartao(cliente: Transacao, id: Id, mudanca: { frente?: unknown; verso?: unknown }): Promise<boolean> {
  const frente = mudanca.frente === undefined ? null : texto(mudanca.frente, 'frente', FRENTE_MAXIMA);
  const verso = mudanca.verso === undefined ? null : texto(mudanca.verso, 'verso', VERSO_MAXIMO);
  const { rowCount } = await cliente.query(`UPDATE flashcard SET frente = coalesce($2, frente), verso = coalesce($3, verso),
    atualizado_em = clock_timestamp() WHERE id = $1`, [id, frente, verso]);
  return (rowCount ?? 0) > 0;
}

export async function apagarCartao(cliente: Transacao, id: Id): Promise<boolean> {
  return ((await cliente.query('DELETE FROM flashcard WHERE id = $1', [id])).rowCount ?? 0) > 0;
}

/** Grava a resposta e o agendamento que ela produz; `null` se o cartão não existe. */
export async function revisarCartao(cliente: Transacao, id: Id, nota: NotaDaRevisao, agora = new Date()): Promise<AgendaDoCartao | null> {
  const existe = await cliente.query('SELECT 1 FROM flashcard WHERE id = $1 FOR UPDATE', [id]);
  if (!existe.rowCount) return null;
  const anterior = (await cliente.query<{ facilidade: number; intervalo_dias: number; repeticoes: number }>(`SELECT facilidade, intervalo_dias, repeticoes
    FROM revisao_flashcard WHERE flashcard_id = $1 ORDER BY revisado_em DESC, id DESC LIMIT 1`, [id])).rows[0] ?? ESTADO_INICIAL;
  const novo = agendar(anterior, nota, agora);
  await cliente.query(`INSERT INTO revisao_flashcard (id, flashcard_id, nota, facilidade, intervalo_dias, repeticoes, proxima_revisao, revisado_em)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [ulid(), id, nota, novo.facilidade, novo.intervalo_dias, novo.repeticoes, novo.proxima_revisao, agora]);
  const revisoes = (await cliente.query<{ n: number }>('SELECT count(*)::int AS n FROM revisao_flashcard WHERE flashcard_id = $1', [id])).rows[0]?.n ?? 1;
  return { facilidade: novo.facilidade, intervalo_dias: novo.intervalo_dias, repeticoes: novo.repeticoes, proxima_revisao: novo.proxima_revisao.toISOString(), revisoes };
}

// ------------------------------------------------------------------ Anki

/** Etiqueta do Anki: sem espaços, em minúsculas e sem acento. */
export function etiquetaDoAnki(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'sem-titulo';
}

function campo(valor: string): string {
  return /[;"\n\r]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
}

/**
 * CSV para "Importar" do Anki: `frente;verso;tags`, com as linhas de cabeçalho que o Anki 2.1.55+
 * lê (separador, sem HTML, coluna de etiquetas). Etiquetas: `margem`, o documento e o capítulo.
 */
export function cartoesEmCsv(cartoes: readonly Flashcard[]): string {
  const linhas = ['#separator:semicolon', '#html:false', '#tags column:3'];
  for (const c of cartoes) {
    const etiquetas = ['margem', `margem::${etiquetaDoAnki(c.documento.titulo)}`, `margem::${etiquetaDoAnki(c.documento.titulo)}::${etiquetaDoAnki(c.capitulo.titulo)}`];
    linhas.push([campo(c.frente), campo(c.verso), campo(etiquetas.join(' '))].join(';'));
  }
  return `${linhas.join('\n')}\n`;
}
