/**
 * O que "Preparar leitura" cria (v0.1, decisão MV-P04): a pessoa marca, numa janela, tudo o
 * que quer de uma vez; nas Configurações, define o padrão aplicado sozinho ao importar um arquivo.
 *
 * Cada item usa os jobs que já existem no serviço:
 *   grifos_relacoes  compreensão do capítulo (grifos, relações, dificuldades, síntese e roteiro)
 *   flashcards       gerar_flashcards, por capítulo
 *   mapa             gerar_esquema, por capítulo (precisa do modelo da compreensão)
 *   fluxograma       gerar_diagrama (visual do capítulo inteiro)
 *   ocr              transcrever_escaneado (páginas de PDF sem texto)
 *   exercicios       descoberta + resolver_exercicio (a janela chama as rotas dos exercícios)
 * Ainda sem job próprio (aparecem desabilitados, "em breve"): narração em lote, marcadores do PDF e
 * imagens para alguns grifos.
 *
 * Com a compreensão marcada, flashcards, mapa e fluxograma de um capítulo são pedidos quando ele fica
 * pronto (`aoCapituloPronto`, chamado pela publicação do plano); sem ela, na hora.
 */
import type { Id } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import { enfileirarTranscricao, ErroDaTranscricao } from '../escaneado/transcricao.js';
import { FlashcardsEmCurso, pedirFlashcards, prefixoDosFlashcards, TIPO_GERAR_FLASHCARDS } from '../flashcards/manipuladores.js';
import { EsquemaEmCurso, pedirEsquema, prefixoDoEsquema, TIPO_GERAR_ESQUEMA } from '../esquema/manipuladores.js';
import * as visuaisRepo from '../repos/visuais.js';
import { enfileirarVisual } from '../visuais/manipuladores.js';

export type IdDoItem = 'grifos_relacoes' | 'flashcards' | 'mapa' | 'fluxograma' | 'ocr' | 'exercicios' | 'narracao' | 'marcadores' | 'imagens';

export interface ItemDaPreparacao {
  id: IdDoItem;
  rotulo: string;
  descricao: string;
  /** `false`: ainda não há job para isso; a janela mostra "em breve". */
  disponivel: boolean;
  /** Pode entrar no padrão aplicado ao importar (os que pedem a janela ou um original não podem). */
  ao_importar: boolean;
  /** Itens que este precisa: marcar este marca aqueles. */
  requer: IdDoItem[];
}

export const ITENS_DA_PREPARACAO: readonly ItemDaPreparacao[] = Object.freeze([
  { id: 'grifos_relacoes', rotulo: 'Grifos e relações', descricao: 'Grifos por função, relações entre os trechos, dificuldades, síntese e roteiro de leitura.', disponivel: true, ao_importar: true, requer: [] },
  { id: 'flashcards', rotulo: 'Flashcards', descricao: 'Cartões de estudo de cada capítulo, a partir do texto e dos grifos.', disponivel: true, ao_importar: true, requer: [] },
  { id: 'mapa', rotulo: 'Mapa do capítulo', descricao: 'Esquema das ideias e das relações de cada capítulo.', disponivel: true, ao_importar: true, requer: ['grifos_relacoes'] },
  { id: 'fluxograma', rotulo: 'Fluxograma', descricao: 'Um fluxograma de cada capítulo.', disponivel: true, ao_importar: true, requer: [] },
  { id: 'ocr', rotulo: 'Texto das páginas escaneadas', descricao: 'Lê por imagem as páginas do PDF que não têm texto.', disponivel: true, ao_importar: true, requer: [] },
  { id: 'exercicios', rotulo: 'Resolver os exercícios', descricao: 'Encontra os exercícios do livro e pede as resoluções (até 50 por vez).', disponivel: true, ao_importar: false, requer: [] },
  { id: 'narracao', rotulo: 'Áudio (narração)', descricao: 'Em breve aqui: por enquanto, o custo da voz é confirmado capítulo a capítulo, no leitor.', disponivel: false, ao_importar: false, requer: [] },
  { id: 'marcadores', rotulo: 'Marcadores do PDF', descricao: 'Em breve: o sumário do PDF como marcadores.', disponivel: false, ao_importar: false, requer: [] },
  { id: 'imagens', rotulo: 'Imagens para grifos', descricao: 'Em breve: imagens para alguns grifos escolhidos pela leitura.', disponivel: false, ao_importar: false, requer: [] },
] satisfies ItemDaPreparacao[]);

/** Por capítulo, depois da compreensão (ou na hora, sem ela). */
const POR_CAPITULO: readonly IdDoItem[] = ['flashcards', 'mapa', 'fluxograma'];

export class ItemInvalido extends Error {
  constructor(id: string) { super(`Item de preparação desconhecido ou indisponível: ${id}.`); this.name = 'ItemInvalido'; }
}

/** Confere a lista pedida e acrescenta os itens requeridos. */
export function normalizarItens(bruto: readonly unknown[], paraImportar = false): IdDoItem[] {
  const escolhidos = new Set<IdDoItem>();
  for (const valor of bruto) {
    const item = ITENS_DA_PREPARACAO.find((candidato) => candidato.id === valor);
    if (!item || !item.disponivel || (paraImportar && !item.ao_importar)) throw new ItemInvalido(String(valor));
    escolhidos.add(item.id);
    for (const requerido of item.requer) escolhidos.add(requerido);
  }
  return ITENS_DA_PREPARACAO.map((item) => item.id).filter((id) => escolhidos.has(id));
}

// ---------------------------------------------------------------- padrão ao importar

export interface PadraoDaPreparacao {
  /** Preparar sozinho ao importar um arquivo. */
  ao_importar: boolean;
  itens: IdDoItem[];
}
/** Grifos e relações sempre marcados por padrão. */
export const PADRAO_INICIAL: PadraoDaPreparacao = Object.freeze({ ao_importar: true, itens: ['grifos_relacoes'] }) as PadraoDaPreparacao;

export async function lerPadrao(cliente: Transacao): Promise<PadraoDaPreparacao> {
  const valor = (await cliente.query<{ valor: PadraoDaPreparacao }>("SELECT valor FROM preferencia_geral WHERE chave='preparacao'")).rows[0]?.valor;
  if (!valor) return { ...PADRAO_INICIAL, itens: [...PADRAO_INICIAL.itens] };
  try { return { ao_importar: valor.ao_importar === true, itens: normalizarItens(Array.isArray(valor.itens) ? valor.itens : [], true) }; }
  catch { return { ...PADRAO_INICIAL, itens: [...PADRAO_INICIAL.itens] }; }
}

export async function gravarPadrao(cliente: Transacao, padrao: { ao_importar: unknown; itens: unknown }): Promise<PadraoDaPreparacao> {
  if (typeof padrao.ao_importar !== 'boolean' || !Array.isArray(padrao.itens)) throw new ItemInvalido('padrão');
  const valor: PadraoDaPreparacao = { ao_importar: padrao.ao_importar, itens: normalizarItens(padrao.itens, true) };
  await cliente.query(`INSERT INTO preferencia_geral (chave, valor) VALUES ('preparacao', $1)
    ON CONFLICT (chave) DO UPDATE SET valor=excluded.valor, atualizada_em=clock_timestamp()`, [JSON.stringify(valor)]);
  return valor;
}

// ---------------------------------------------------------------- pedidos

export async function itensPedidos(cliente: Transacao, documentoId: Id): Promise<IdDoItem[]> {
  const valor = (await cliente.query<{ preparacao_itens: { itens?: unknown[] } | null }>('SELECT preparacao_itens FROM documento WHERE id=$1', [documentoId])).rows[0]?.preparacao_itens;
  try { return normalizarItens(valor?.itens ?? []); } catch { return []; }
}

export async function gravarItensPedidos(cliente: Transacao, documentoId: Id, itens: readonly IdDoItem[]): Promise<void> {
  await cliente.query('UPDATE documento SET preparacao_itens=$2 WHERE id=$1', [documentoId, JSON.stringify({ itens, em: new Date().toISOString() })]);
}

async function temJob(cliente: Transacao, tipo: string, prefixo: string): Promise<boolean> {
  return ((await cliente.query('SELECT 1 FROM job WHERE tipo=$1 AND starts_with(dedup_key, $2) LIMIT 1', [tipo, prefixo])).rowCount ?? 0) > 0;
}

/**
 * Pede para um capítulo os itens marcados que são por capítulo. Idempotente: o que já foi pedido (em
 * qualquer estado) não é pedido de novo; refazer é ação explícita no leitor.
 */
export async function pedirItensDoCapitulo(
  cliente: Transacao, itens: readonly IdDoItem[], alvo: { versaoId: Id; secaoId: Id; compreensaoId: Id | null },
): Promise<IdDoItem[]> {
  const pedidos: IdDoItem[] = [];
  if (itens.includes('flashcards') && !await temJob(cliente, TIPO_GERAR_FLASHCARDS, prefixoDosFlashcards(alvo.versaoId, alvo.secaoId))) {
    try { await pedirFlashcards(cliente, { versaoId: alvo.versaoId, secaoId: alvo.secaoId }); pedidos.push('flashcards'); }
    catch (erro) { if (!(erro instanceof FlashcardsEmCurso)) throw erro; }
  }
  if (itens.includes('mapa') && alvo.compreensaoId !== null && !await temJob(cliente, TIPO_GERAR_ESQUEMA, prefixoDoEsquema(alvo.compreensaoId, alvo.secaoId))) {
    try { await pedirEsquema(cliente, { compreensaoId: alvo.compreensaoId, secaoId: alvo.secaoId, versaoId: alvo.versaoId }); pedidos.push('mapa'); }
    catch (erro) { if (!(erro instanceof EsquemaEmCurso)) throw erro; }
  }
  if (itens.includes('fluxograma')) {
    const existe = (await cliente.query(`SELECT 1 FROM visual WHERE versao_id=$1 AND secao_id=$2 AND tipo='diagrama' AND alvo->>'tipo'='capitulo' LIMIT 1`,
      [alvo.versaoId, alvo.secaoId])).rowCount;
    if (!existe) {
      const novo: visuaisRepo.NovoVisual = { versao_id: alvo.versaoId, secao_id: alvo.secaoId, tipo: 'diagrama', alvo: { tipo: 'capitulo' }, pedido: null, substitui: null };
      const id = await visuaisRepo.criar(cliente, novo);
      await enfileirarVisual(cliente, { id, versao_id: alvo.versaoId, tipo: 'diagrama' });
      pedidos.push('fluxograma');
    }
  }
  return pedidos;
}

/** Itens que não dependem de capítulo: o texto das páginas escaneadas. */
export async function pedirItensDoDocumento(cliente: Transacao, documentoId: Id, itens: readonly IdDoItem[]): Promise<void> {
  if (!itens.includes('ocr')) return;
  try { await enfileirarTranscricao(cliente, documentoId); }
  catch (erro) { if (!(erro instanceof ErroDaTranscricao)) throw erro; }
}

/** Chamado quando o plano de um capítulo é publicado (o capítulo ficou pronto). */
export async function aoCapituloPronto(cliente: Transacao, execucao: { id: Id; versao_id: Id }, secaoId: Id): Promise<void> {
  const documento = (await cliente.query<{ documento_id: Id }>('SELECT documento_id FROM versao_texto WHERE id=$1', [execucao.versao_id])).rows[0]?.documento_id;
  if (!documento) return;
  const itens = (await itensPedidos(cliente, documento)).filter((item) => POR_CAPITULO.includes(item));
  if (itens.length > 0) await pedirItensDoCapitulo(cliente, itens, { versaoId: execucao.versao_id, secaoId, compreensaoId: execucao.id });
}

// ---------------------------------------------------------------- progresso

export type EstadoDoItem = 'aguardando' | 'preparando' | 'pronto' | 'falhou';
export interface ProgressoDoItem { id: IdDoItem; rotulo: string; estado: EstadoDoItem; prontos: number; total: number }

const TIPO_DO_ITEM: Partial<Record<IdDoItem, string>> = {
  flashcards: TIPO_GERAR_FLASHCARDS, mapa: TIPO_GERAR_ESQUEMA, fluxograma: 'gerar_diagrama', ocr: 'transcrever_escaneado', exercicios: 'resolver_exercicio',
};

/** O andamento de cada item pedido (menos a compreensão, que tem estado por capítulo), pelos jobs da versão. */
export async function progressoDosItens(cliente: Transacao, documentoId: Id, versaoId: Id): Promise<ProgressoDoItem[]> {
  const itens = await itensPedidos(cliente, documentoId);
  const saida: ProgressoDoItem[] = [];
  for (const id of itens) {
    const tipo = TIPO_DO_ITEM[id];
    if (!tipo) continue;
    const linhas = (await cliente.query<{ estado: string; n: number }>(`SELECT estado, count(*)::int AS n FROM job
      WHERE tipo=$1 AND (versao_id=$2 OR (versao_id IS NULL AND documento_id=$3)) GROUP BY estado`, [tipo, versaoId, documentoId])).rows;
    const conta = (estados: string[]) => linhas.filter((linha) => estados.includes(linha.estado)).reduce((soma, linha) => soma + linha.n, 0);
    const total = conta(['fila', 'reservado', 'adiado', 'ok', 'falhou', 'cancelado']);
    const prontos = conta(['ok']);
    const estado: EstadoDoItem = conta(['fila', 'reservado', 'adiado']) > 0 ? 'preparando' : conta(['falhou', 'cancelado']) > 0 ? 'falhou'
      : total > 0 ? 'pronto' : 'aguardando';
    saida.push({ id, rotulo: ITENS_DA_PREPARACAO.find((item) => item.id === id)?.rotulo ?? id, estado, prontos, total });
  }
  return saida;
}
