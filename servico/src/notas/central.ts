/**
 * Central de Notas (J145): tudo o que foi produzido em todos os documentos, numa lista só, paginada e agregada
 * no banco (um pedido, não um por documento). Entram:
 *
 * - grifos do leitor e do Codex (a camada de execução mais recente de cada modo, na versão atual), com a função
 *   e a cor no modo do próprio grifo, a nota do leitor e o comentário do Codex;
 * - notas antigas soltas (só leitura);
 * - relações: as conexões (do leitor e as do Codex ainda não rejeitadas) e as relações da leitura do Codex
 *   (modelo do capítulo, revisão >= 2) que não viraram conexão, com os dois trechos;
 * - dificuldades: os sinais gravados (do leitor e as do Codex decididas, menos as descartadas) e as do modelo
 *   ainda sem decisão (sugeridas);
 * - resoluções de exercícios, flashcards, perguntas presas a trechos e visuais (imagem, diagrama).
 *
 * As relações e dificuldades do modelo vêm de `item_do_modelo` (migração 0035), preenchida por gatilho.
 * Cada item traz o trecho, o documento, o capítulo, a página e o que abrir no leitor (`abrir`).
 */
import { ROTULOS_DA_RELACAO, ROTULOS_DA_RELACAO_SEMANTICA, type Id, type OrigemBloco, type RelacaoConexao, type TipoDificuldadeTextual, type TipoRelacaoSemantica } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import { modoOuNada } from '../modos.js';
import { ROTULO_DA_DIFICULDADE } from '../obsidian/exportar-v2.js';
import { DATA } from '../repos/anotacoes.js';

export type TipoDaCentral = 'grifo' | 'nota_antiga' | 'relacao' | 'dificuldade' | 'resolucao' | 'flashcard' | 'conversa' | 'visual';
/** O filtro de tipo: os tipos dos itens, mais `nota` (grifos com nota do leitor e notas antigas) e `comentario`
 *  (grifos com comentário do Codex). */
export type FiltroDeTipo = Exclude<TipoDaCentral, 'nota_antiga'> | 'nota' | 'comentario';
export const FILTROS_DE_TIPO: readonly FiltroDeTipo[] = ['grifo', 'nota', 'comentario', 'relacao', 'dificuldade', 'resolucao', 'flashcard', 'conversa', 'visual'];
export type OrdemDaCentral = 'recentes' | 'antigos' | 'documento';
export const ORDENS_DA_CENTRAL: readonly OrdemDaCentral[] = ['recentes', 'antigos', 'documento'];

export interface FiltroDaCentral {
  documento_id?: Id;
  tipo?: FiltroDeTipo;
  /** `leitor`: o que é do leitor ou tem nota dele; `codex`: o que o Codex fez. */
  autoria?: 'leitor' | 'codex';
  funcao?: string;
  modo?: string;
  texto?: string;
  /** Datas ISO (criação do item), inclusivas. */
  desde?: string;
  ate?: string;
  ordem?: OrdemDaCentral;
  limite?: number;
  deslocamento?: number;
}

/** O que o leitor abre ao tocar o item: o capítulo, o trecho e, quando há, o painel certo. */
export interface AberturaNoLeitor {
  documento_id: Id;
  secao_id: Id | null;
  bloco_id: Id | null;
  faixa: { inicio_utf16: number; fim_utf16: number } | null;
  painel: 'balao' | 'nota' | 'conexao' | 'relacao' | 'conversa' | 'resolucao' | 'visual' | 'flashcards' | 'trecho';
  /** Id do grifo, da conexão, da relação do modelo, da conversa, da resolução ou do visual. */
  alvo_id: string | null;
}

export interface ItemDaCentral {
  /** Chave única na lista: `<tipo>:<id>`. */
  chave: string;
  tipo: TipoDaCentral;
  /** Id do registro (grifo, conexão, relação do modelo, dificuldade, resolução, cartão, conversa, visual). */
  id: string;
  autoria: 'leitor' | 'codex';
  /** Rótulo curto: a função do grifo, o tipo da relação ou da dificuldade, o número do exercício… */
  rotulo: string;
  /** Situação, quando faz sentido: `sugerida`, `aceita`, `confirmada`, `pendente`, `pronta`, `aberta`… */
  estado: string | null;
  funcao: string | null;
  modo: { id: string; revisao: number; nome: string } | null;
  cor: { claro: string; escuro: string } | null;
  /** O trecho (curto). */
  citacao: string;
  /** A nota do leitor (grifo, nota antiga). */
  nota: string | null;
  nota_id: Id | null;
  /** O comentário do Codex no grifo; a resposta no flashcard e na conversa; a resposta final na resolução. */
  comentario: string | null;
  /** O texto próprio do item: explicação da relação, descrição da dificuldade, frente do cartão, pergunta,
   *  ideia da resolução, pedido do visual. */
  texto: string | null;
  /** Relação: a outra ponta. */
  destino: { citacao: string | null; documento: { id: Id; titulo: string } | null; titulo_externo: string | null; abrir: AberturaNoLeitor | null } | null;
  mensagens: number | null;
  documento: { id: Id; titulo: string; autor: string | null };
  versao_id: Id;
  capitulo: { id: Id; titulo: string } | null;
  pagina: string | null;
  abrir: AberturaNoLeitor;
  /** A relação ou a dificuldade que está só na análise do Codex: onde apagá-la (V-T8, J143). */
  analise: { execucao_id: Id; secao_id: Id } | null;
  /** Volta ao trecho por URL (`/ler/<documento>/<capítulo>?bloco=`), para abrir em outra aba. */
  link: string;
  criada_em: string;
  atualizada_em: string;
}

export interface FacetasDaCentral {
  tipos: Record<FiltroDeTipo | 'total', number>;
  autorias: { leitor: number; codex: number };
  documentos: { id: Id; titulo: string; autor: string | null; total: number }[];
  funcoes: { funcao: string; modo: { id: string; revisao: number; nome: string } | null; rotulo: string; cor: { claro: string; escuro: string } | null; total: number }[];
}

export interface PaginaDaCentral { itens: ItemDaCentral[]; total: number; limite: number; deslocamento: number; facetas?: FacetasDaCentral }

export const LIMITE_PADRAO = 50;
export const LIMITE_MAXIMO = 200;
const TRECHO_MAXIMO = 600;

// ------------------------------------------------------------------ consulta

/** Colunas comuns às fontes, na ordem do UNION. */
const COLUNAS: readonly (readonly [string, string])[] = [
  ['tipo', 'text'], ['ref_id', 'text'], ['autoria', 'text'], ['versao_id', 'text'], ['bloco_id', 'text'],
  ['inicio_utf16', 'bigint'], ['fim_utf16', 'bigint'], ['citacao', 'text'], ['nota', 'text'], ['nota_id', 'text'],
  ['comentario', 'text'], ['texto', 'text'], ['funcao', 'text'], ['modo_id', 'text'], ['modo_revisao', 'integer'],
  ['estado', 'text'], ['chave', 'text'], ['secao_id', 'text'], ['pagina_recorte', 'integer'], ['destino_tipo', 'text'],
  ['destino_versao_id', 'text'], ['destino_bloco_id', 'text'], ['destino_inicio_utf16', 'bigint'], ['destino_fim_utf16', 'bigint'],
  ['destino_citacao', 'text'], ['destino_documento_id', 'text'], ['destino_titulo', 'text'], ['mensagens', 'integer'],
  ['execucao_id', 'text'], ['criada_em', 'timestamptz'], ['atualizada_em', 'timestamptz'],
];

function selecao(valores: Readonly<Record<string, string>>, resto: string): string {
  for (const chave of Object.keys(valores)) if (!COLUNAS.some(([nome]) => nome === chave)) throw new Error(`Coluna desconhecida: ${chave}`);
  return `SELECT ${COLUNAS.map(([nome, tipo]) => `(${valores[nome] ?? 'NULL'})::${tipo} AS ${nome}`).join(', ')}\n    ${resto}`;
}

const PAGINA_DO_PDF = `(b.origens->0->>'pagina')::integer`;

const FONTES = [
  // Grifos: do leitor (não rejeitados), os anotados pelo leitor e os do Codex da camada atual de cada modo.
  selecao({
    tipo: `'grifo'`, ref_id: 'm.id', autoria: `CASE WHEN m.origem = 'manual' THEN 'leitor' ELSE 'codex' END`, versao_id: 'm.versao_id',
    bloco_id: 'm.bloco_id', inicio_utf16: 'm.inicio_utf16', fim_utf16: 'm.fim_utf16', citacao: 'm.citacao', nota: 'n.texto', nota_id: 'n.id',
    comentario: `nullif(m.comentario->>'texto', '')`, funcao: 'm.funcao', modo_id: 'm.modo_id', modo_revisao: 'm.modo_revisao',
    criada_em: 'm.criada_em', atualizada_em: 'greatest(m.atualizada_em, n.atualizada_em)',
  }, `FROM marca m
    LEFT JOIN anotacao n ON n.marca_id = m.id AND n.fundida_em IS NULL
    WHERE (m.origem = 'manual' AND m.avaliacao <> 'rejeitada') OR n.id IS NOT NULL
      OR (m.origem <> 'manual' AND m.visivel AND m.avaliacao <> 'rejeitada' AND m.validade = 'resolvida' AND m.camada_id IN (SELECT id FROM camada_atual))`),
  // Notas antigas soltas (banco antigo, API).
  selecao({
    tipo: `'nota_antiga'`, ref_id: 'a.id', autoria: `'leitor'`, versao_id: 'a.versao_id', bloco_id: 'a.bloco_id', inicio_utf16: 'a.inicio_utf16',
    fim_utf16: 'a.fim_utf16', citacao: 'a.citacao', nota: 'a.texto', nota_id: 'a.id', criada_em: 'a.criada_em', atualizada_em: 'a.atualizada_em',
  }, 'FROM anotacao a WHERE a.marca_id IS NULL AND a.fundida_em IS NULL'),
  // Conexões: do leitor e as do Codex ainda não rejeitadas.
  selecao({
    tipo: `'relacao'`, ref_id: 'c.id', autoria: `CASE WHEN c.autor = 'leitor' THEN 'leitor' ELSE 'codex' END`, versao_id: 'c.versao_id',
    bloco_id: 'c.bloco_id', inicio_utf16: 'c.inicio_utf16', fim_utf16: 'c.fim_utf16', citacao: 'c.citacao', texto: 'c.justificativa',
    estado: 'c.estado', chave: 'coalesce(c.relacao_semantica, c.relacao)', destino_tipo: 'c.destino_tipo', destino_versao_id: 'c.destino_versao_id',
    destino_bloco_id: 'c.destino_bloco_id', destino_inicio_utf16: 'c.destino_inicio_utf16', destino_fim_utf16: 'c.destino_fim_utf16',
    destino_citacao: 'c.destino_citacao', destino_documento_id: 'c.destino_documento_id', destino_titulo: 'c.destino_titulo',
    criada_em: 'c.criada_em', atualizada_em: 'coalesce(c.decidida_em, c.criada_em)',
  }, `FROM conexao c WHERE c.estado <> 'rejeitada'`),
  // Relações da leitura do Codex (modelo atual do capítulo) que não viraram conexão.
  selecao({
    tipo: `'relacao'`, ref_id: 'i.item_id', autoria: `'codex'`, versao_id: 'i.versao_id', bloco_id: 'i.bloco_id', inicio_utf16: 'i.inicio_utf16',
    fim_utf16: 'i.fim_utf16', citacao: 'i.citacao', texto: `nullif(i.texto, '')`, estado: `'da_leitura'`, chave: 'i.chave', secao_id: 'i.secao_id', execucao_id: 'i.execucao_id',
    destino_tipo: `CASE WHEN i.destino_bloco_id IS NULL THEN NULL ELSE 'trecho' END`, destino_versao_id: 'i.destino_versao_id',
    destino_bloco_id: 'i.destino_bloco_id', destino_inicio_utf16: 'i.destino_inicio_utf16', destino_fim_utf16: 'i.destino_fim_utf16',
    destino_citacao: 'i.destino_citacao', criada_em: 'i.criada_em', atualizada_em: 'i.criada_em',
  }, `FROM item_do_modelo i JOIN modelo_atual ma ON ma.id = i.modelo_id
    WHERE i.tipo = 'relacao' AND NOT EXISTS (SELECT 1 FROM relacao_adotada ra WHERE ra.relacao_id = i.item_id)
    -- O que a pessoa apagou da análise (V-T8, J143): a relação, ou um elemento de uma das pontas.
    AND NOT EXISTS (SELECT 1 FROM elemento_apagado ea WHERE ea.execucao_id = i.execucao_id
      AND ea.item_id IN (i.item_id, i.origem_id, i.destino_id))`),
  // Sinais de dificuldade gravados (menos os descartados).
  selecao({
    tipo: `'dificuldade'`, ref_id: 'd.id', autoria: `CASE WHEN d.origem = 'leitor' THEN 'leitor' ELSE 'codex' END`, versao_id: 'd.versao_id',
    bloco_id: 'd.bloco_id', inicio_utf16: 'd.inicio_utf16', fim_utf16: 'd.fim_utf16', citacao: 'd.citacao', texto: 'd.descricao', estado: 'd.estado',
    chave: 'd.tipo', criada_em: 'd.criada_em', atualizada_em: 'd.atualizada_em',
  }, `FROM dificuldade d WHERE d.estado <> 'descartada'`),
  // Dificuldades do modelo ainda sem decisão: sugestões do Codex.
  selecao({
    tipo: `'dificuldade'`, ref_id: 'i.item_id', autoria: `'codex'`, versao_id: 'i.versao_id', bloco_id: 'i.bloco_id', inicio_utf16: 'i.inicio_utf16',
    fim_utf16: 'i.fim_utf16', citacao: 'i.citacao', texto: `nullif(i.texto, '')`, estado: `'sugerida'`, chave: 'i.chave', secao_id: 'i.secao_id', execucao_id: 'i.execucao_id',
    criada_em: 'i.criada_em', atualizada_em: 'i.criada_em',
  }, `FROM item_do_modelo i JOIN modelo_atual ma ON ma.id = i.modelo_id
    WHERE i.tipo = 'dificuldade' AND NOT EXISTS (SELECT 1 FROM dificuldade d WHERE d.codex_dificuldade_id = i.item_id)
    AND NOT EXISTS (SELECT 1 FROM elemento_apagado ea WHERE ea.execucao_id = i.execucao_id AND ea.item_id = i.item_id)`),
  // Resoluções de exercícios (do trecho ou do recorte de uma página do PDF).
  selecao({
    tipo: `'resolucao'`, ref_id: 'r.id', autoria: `'codex'`, versao_id: 'r.versao_id',
    bloco_id: `CASE WHEN r.dados->'origem'->>'tipo' = 'trecho' THEN r.dados->'origem'->'ancora'->>'bloco_id' ELSE (
      SELECT b.id FROM bloco b WHERE b.versao_id = r.versao_id AND b.origens->0->>'tipo' = 'pdf' AND ${PAGINA_DO_PDF} >= (r.dados->'origem'->>'pagina')::integer
      ORDER BY ${PAGINA_DO_PDF}, b.ordem LIMIT 1) END`,
    inicio_utf16: `coalesce((r.dados->'origem'->'ancora'->>'inicio_utf16')::bigint, 0)`,
    fim_utf16: `(r.dados->'origem'->'ancora'->>'fim_utf16')::bigint`,
    citacao: `coalesce(nullif(r.dados->'resolucao'->>'enunciado', ''), nullif(r.dados->>'texto_extraido', ''), 'Exercício recortado')`,
    texto: `nullif(r.dados->'resolucao'->'itens'->0->>'estrategia', '')`, comentario: `nullif(r.dados->'resolucao'->'itens'->0->>'resposta', '')`,
    estado: `CASE WHEN jsonb_typeof(r.dados->'resolucao') = 'object' THEN 'pronta' ELSE 'pendente' END`, chave: `r.dados->'exercicio'->>'numero'`,
    pagina_recorte: `CASE WHEN r.dados->'origem'->>'tipo' = 'recorte' THEN (r.dados->'origem'->>'pagina')::integer END`,
    mensagens: `jsonb_array_length(coalesce(r.dados->'mensagens', '[]'::jsonb))`, criada_em: 'r.criada_em', atualizada_em: 'r.atualizada_em',
  }, 'FROM resolucao r'),
  // Flashcards (do leitor ou do Codex).
  selecao({
    tipo: `'flashcard'`, ref_id: 'f.id', autoria: `CASE WHEN f.origem = 'manual' THEN 'leitor' ELSE 'codex' END`, versao_id: 'f.versao_id',
    bloco_id: 'f.bloco_id', inicio_utf16: 'f.inicio_utf16', fim_utf16: 'f.fim_utf16', citacao: 'f.citacao', texto: 'f.frente', comentario: 'f.verso',
    secao_id: 'f.secao_id', criada_em: 'f.criado_em', atualizada_em: 'f.atualizado_em',
  }, 'FROM flashcard f'),
  // Perguntas presas a trechos: a primeira pergunta e a última resposta.
  selecao({
    tipo: `'conversa'`, ref_id: 'c.id', autoria: `'leitor'`, versao_id: 'c.versao_id', bloco_id: 'c.bloco_id', inicio_utf16: 'c.inicio_utf16',
    fim_utf16: 'c.fim_utf16', citacao: 'c.citacao', texto: 'mp.texto', comentario: 'mr.texto', estado: 'c.estado', mensagens: 'mc.total',
    criada_em: 'c.criada_em', atualizada_em: 'greatest(c.criada_em, mc.ultima)',
  }, `FROM conversa c
    LEFT JOIN LATERAL (SELECT texto FROM mensagem WHERE conversa_id = c.id ORDER BY ordem LIMIT 1) mp ON true
    LEFT JOIN LATERAL (SELECT texto FROM mensagem WHERE conversa_id = c.id AND autor = 'ia' ORDER BY ordem DESC LIMIT 1) mr ON true
    LEFT JOIN LATERAL (SELECT count(*) AS total, max(criada_em) AS ultima FROM mensagem WHERE conversa_id = c.id) mc ON true`),
  // Visuais (imagem, diagrama): o mais novo de cada série, não apagado.
  selecao({
    tipo: `'visual'`, ref_id: 'v.id', autoria: `'codex'`, versao_id: 'v.versao_id',
    bloco_id: `coalesce(v.alvo->'ancora'->>'bloco_id', (SELECT s.bloco_inicio FROM secao s WHERE s.versao_id = v.versao_id AND s.id = v.secao_id))`,
    inicio_utf16: `coalesce((v.alvo->'ancora'->>'inicio_utf16')::bigint, 0)`, fim_utf16: `(v.alvo->'ancora'->>'fim_utf16')::bigint`,
    citacao: `coalesce(v.alvo->'ancora'->>'citacao', '')`, texto: 'v.pedido', chave: 'v.tipo', secao_id: 'v.secao_id',
    estado: `CASE WHEN v.artefato IS NOT NULL THEN 'pronto' ELSE 'pendente' END`, criada_em: 'v.criado_em', atualizada_em: 'coalesce(v.publicado_em, v.criado_em)',
  }, `FROM visual v WHERE v.apagado_em IS NULL AND NOT EXISTS (SELECT 1 FROM visual w WHERE w.substitui = v.id AND w.apagado_em IS NULL)`),
];

/** Título sem acento e em minúsculas, para ordenar em português sem depender da collation do banco. */
const tituloOrdenavel = (p = '') => `translate(lower(${p}titulo), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')`;

/**
 * As fontes, a versão atual de cada documento, a camada atual de cada modo e o modelo atual de cada capítulo,
 * e a base já com documento, ordem do bloco, busca e datas. `$1`…`$8`: documento, tipo, autoria, função, modo,
 * texto, desde, até (os quatro primeiros e o último par só nos filtros de quem usa a base).
 */
const BASE = `WITH versao_atual AS (
    SELECT DISTINCT ON (documento_id) id FROM versao_texto ORDER BY documento_id, numero DESC
  ), camada_atual AS (
    SELECT id FROM (
      SELECT DISTINCT ON (c.versao_id, c.modo_id, c.modo_revisao) c.id FROM camada c
      WHERE c.tipo = 'execucao' AND c.versao_id IN (SELECT id FROM versao_atual) AND EXISTS (SELECT 1 FROM marca m WHERE m.camada_id = c.id)
      ORDER BY c.versao_id, c.modo_id, c.modo_revisao, c.criada_em DESC, c.id DESC) recente
    UNION ALL
    SELECT c.id FROM camada c WHERE c.tipo = 'importacao' AND c.versao_id IN (SELECT id FROM versao_atual)
  ), modelo_atual AS (
    SELECT DISTINCT ON (e.versao_id, mc.secao_id, e.modo_id) mc.id FROM modelo_capitulo mc
    JOIN execucao_leitura e ON e.id = mc.execucao_id
    WHERE mc.revisao >= 2 AND e.versao_id IN (SELECT id FROM versao_atual)
    ORDER BY e.versao_id, mc.secao_id, e.modo_id, e.criada_em DESC, e.id DESC, mc.revisao DESC
  ), itens AS (
    ${FONTES.join('\n    UNION ALL\n    ')}
  ), base AS MATERIALIZED (
    SELECT i.*, d.id AS documento_id, d.titulo, d.autor, v.numero AS versao_numero, b.ordem AS bloco_ordem
    FROM itens i
    JOIN versao_texto v ON v.id = i.versao_id
    JOIN documento d ON d.id = v.documento_id
    LEFT JOIN bloco b ON b.versao_id = i.versao_id AND b.id = i.bloco_id
    WHERE ($6::text IS NULL OR strpos(lower(concat_ws(' ', i.citacao, i.nota, i.comentario, i.texto, i.destino_citacao, i.destino_titulo, d.titulo)), lower($6::text)) > 0)
      AND ($7::timestamptz IS NULL OR i.criada_em >= $7::timestamptz)
      AND ($8::timestamptz IS NULL OR i.criada_em < $8::timestamptz)
  )`;

const F_DOCUMENTO = '($1::text IS NULL OR documento_id = $1::text)';
const F_TIPO = `($2::text IS NULL
    OR ($2::text = 'nota' AND nota IS NOT NULL)
    OR ($2::text = 'comentario' AND tipo = 'grifo' AND comentario IS NOT NULL)
    OR tipo = $2::text)`;
const F_AUTORIA = `($3::text IS NULL OR ($3::text = 'leitor' AND (autoria = 'leitor' OR nota IS NOT NULL)) OR ($3::text = 'codex' AND autoria = 'codex'))`;
const F_FUNCAO = `($4::text IS NULL OR (tipo = 'grifo' AND funcao = $4::text AND ($5::text IS NULL OR modo_id = $5::text)))`;

/** A ordem da lista; `p` qualifica as colunas na consulta de fora (que repete os nomes das datas formatadas). */
function ordenacao(ordem: OrdemDaCentral, p = ''): string {
  switch (ordem) {
    case 'antigos': return `${p}criada_em ASC, ${p}tipo, ${p}ref_id`;
    case 'documento': return `${tituloOrdenavel(p)}, ${p}documento_id, ${p}versao_numero, ${p}bloco_ordem NULLS LAST, ${p}inicio_utf16, ${p}criada_em, ${p}tipo, ${p}ref_id`;
    default: return `${p}criada_em DESC, ${p}tipo, ${p}ref_id`;
  }
}

interface Linha {
  tipo: TipoDaCentral; ref_id: string; autoria: 'leitor' | 'codex'; versao_id: Id; bloco_id: Id | null; inicio_utf16: string | null; fim_utf16: string | null;
  citacao: string; nota: string | null; nota_id: Id | null; comentario: string | null; texto: string | null; funcao: string | null;
  modo_id: string | null; modo_revisao: number | null; estado: string | null; chave: string | null; secao_id: Id | null; pagina_recorte: number | null;
  destino_tipo: string | null; destino_bloco_id: Id | null; destino_inicio_utf16: string | null; destino_fim_utf16: string | null; destino_citacao: string | null;
  destino_titulo: string | null; mensagens: number | null; execucao_id: Id | null; documento_id: Id; titulo: string; autor: string | null;
  origens: OrigemBloco[] | null; capitulo_id: Id | null; capitulo_titulo: string | null;
  destino_doc_id: Id | null; destino_doc_titulo: string | null; destino_capitulo_id: Id | null;
  criada_iso: string; atualizada_iso: string; total: string;
}

/** O capítulo (seção de nível 1) que contém o bloco `<b>` da versão `<v>`. */
const CAPITULO = (v: string, b: string) => `SELECT s.id, s.titulo FROM secao s
      JOIN bloco bi ON bi.versao_id = s.versao_id AND bi.id = s.bloco_inicio
      JOIN bloco bf ON bf.versao_id = s.versao_id AND bf.id = s.bloco_fim
      JOIN bloco bx ON bx.versao_id = s.versao_id AND bx.id = ${b}
      WHERE s.versao_id = ${v} AND s.nivel = 1 AND bx.ordem BETWEEN bi.ordem AND bf.ordem
      ORDER BY s.ordem LIMIT 1`;

function parametros(filtro: FiltroDaCentral): unknown[] {
  return [filtro.documento_id ?? null, filtro.tipo ?? null, filtro.autoria ?? null, filtro.funcao ?? null, filtro.modo ?? null,
    filtro.texto ?? null, filtro.desde ?? null, filtro.ate ?? null];
}

export async function listarCentral(cliente: Transacao, filtro: FiltroDaCentral = {}, opcoes: { facetas?: boolean } = {}): Promise<PaginaDaCentral> {
  const limite = Math.max(1, Math.min(LIMITE_MAXIMO, Math.trunc(filtro.limite ?? LIMITE_PADRAO)));
  const deslocamento = Math.max(0, Math.trunc(filtro.deslocamento ?? 0));
  const ordem = ordenacao(filtro.ordem ?? 'recentes');
  const ordemDeFora = ordenacao(filtro.ordem ?? 'recentes', 'p.');
  // A consulta é larga (dez fontes) e custa o bastante para o Postgres compilá-la com JIT, o que leva mais
  // tempo do que a consulta inteira (medido: ~0,3–0,5 s a menos com 53 mil itens). Só nesta transação.
  await cliente.query('SET LOCAL jit = off');
  const { rows } = await cliente.query<Linha>(`${BASE}
    SELECT p.*, b.origens, cap.id AS capitulo_id, cap.titulo AS capitulo_titulo,
      dd.id AS destino_doc_id, dd.titulo AS destino_doc_titulo, dcap.id AS destino_capitulo_id,
      ${DATA('p.criada_em')} AS criada_iso, ${DATA('p.atualizada_em')} AS atualizada_iso
    FROM (
      SELECT *, count(*) OVER () AS total FROM base
      WHERE ${F_DOCUMENTO} AND ${F_TIPO} AND ${F_AUTORIA} AND ${F_FUNCAO}
      ORDER BY ${ordem} LIMIT $9 OFFSET $10
    ) p
    LEFT JOIN bloco b ON b.versao_id = p.versao_id AND b.id = p.bloco_id
    LEFT JOIN LATERAL (${CAPITULO('p.versao_id', 'p.bloco_id')}) cap ON p.bloco_id IS NOT NULL
    LEFT JOIN versao_texto dv ON dv.id = p.destino_versao_id
    LEFT JOIN documento dd ON dd.id = coalesce(dv.documento_id, p.destino_documento_id)
    LEFT JOIN LATERAL (${CAPITULO('p.destino_versao_id', 'p.destino_bloco_id')}) dcap ON p.destino_bloco_id IS NOT NULL
    ORDER BY ${ordemDeFora}`, [...parametros(filtro), limite, deslocamento]);
  const pagina: PaginaDaCentral = { itens: rows.map(item), total: Number(rows[0]?.total ?? 0), limite, deslocamento };
  if (rows.length === 0 && deslocamento > 0) {
    // Página além do fim: o total vem da contagem simples.
    const contagem = await cliente.query<{ total: string }>(`${BASE} SELECT count(*) AS total FROM base
      WHERE ${F_DOCUMENTO} AND ${F_TIPO} AND ${F_AUTORIA} AND ${F_FUNCAO}`, parametros(filtro));
    pagina.total = Number(contagem.rows[0]?.total ?? 0);
  }
  if (opcoes.facetas) pagina.facetas = await facetas(cliente, filtro);
  return pagina;
}

interface LinhaDasFacetas {
  tipos: Record<FiltroDeTipo | 'total', number>;
  autorias: { leitor: number; codex: number };
  documentos: { id: Id; titulo: string; autor: string | null; total: number }[];
  funcoes: { funcao: string; modo_id: string; modo_revisao: number; total: number }[];
}

/**
 * Contagens para os filtros, cada uma com os outros filtros aplicados e sem o seu (o padrão de facetas): por tipo,
 * por autoria, por documento e por função (só as que aparecem).
 */
async function facetas(cliente: Transacao, filtro: FiltroDaCentral): Promise<FacetasDaCentral> {
  const tiposDeGrifo = `($2::text IS NULL OR $2::text NOT IN ('grifo', 'nota', 'comentario') OR ${F_TIPO})`;
  const contar = (nome: string, condicao: string) => `'${nome}', count(*) FILTER (WHERE ${condicao})`;
  const { rows } = await cliente.query<LinhaDasFacetas>(`${BASE}
    SELECT
      (SELECT jsonb_build_object('total', count(*), ${contar('grifo', `tipo = 'grifo'`)}, ${contar('nota', 'nota IS NOT NULL')},
        ${contar('comentario', `tipo = 'grifo' AND comentario IS NOT NULL`)}, ${contar('relacao', `tipo = 'relacao'`)},
        ${contar('dificuldade', `tipo = 'dificuldade'`)}, ${contar('resolucao', `tipo = 'resolucao'`)}, ${contar('flashcard', `tipo = 'flashcard'`)},
        ${contar('conversa', `tipo = 'conversa'`)}, ${contar('visual', `tipo = 'visual'`)})
        FROM base WHERE ${F_DOCUMENTO} AND ${F_AUTORIA} AND ${F_FUNCAO}) AS tipos,
      (SELECT jsonb_build_object(${contar('leitor', `autoria = 'leitor' OR nota IS NOT NULL`)}, ${contar('codex', `autoria = 'codex'`)})
        FROM base WHERE ${F_DOCUMENTO} AND ${F_TIPO} AND ${F_FUNCAO}) AS autorias,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id', documento_id, 'titulo', titulo, 'autor', autor, 'total', total) ORDER BY ${tituloOrdenavel()}, documento_id), '[]'::jsonb)
        FROM (SELECT documento_id, titulo, autor, count(*) AS total FROM base WHERE ${F_TIPO} AND ${F_AUTORIA} AND ${F_FUNCAO}
          GROUP BY documento_id, titulo, autor) x) AS documentos,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('funcao', funcao, 'modo_id', modo_id, 'modo_revisao', modo_revisao, 'total', total)), '[]'::jsonb)
        FROM (SELECT funcao, CASE WHEN funcao = 'nenhuma' THEN '' ELSE modo_id END AS modo_id, CASE WHEN funcao = 'nenhuma' THEN 0 ELSE modo_revisao END AS modo_revisao,
            count(*) AS total
          FROM base WHERE tipo = 'grifo' AND ${F_DOCUMENTO} AND ${F_AUTORIA} AND ${tiposDeGrifo}
          GROUP BY 1, 2, 3) y) AS funcoes`, parametros(filtro));
  const linha = rows[0];
  if (!linha) throw new Error('Facetas sem linha.');
  const funcoes = linha.funcoes.map((f) => {
    const { modo, rotulo, cor } = funcaoNoModo(f.funcao, f.modo_id || null, f.modo_id ? f.modo_revisao : null);
    return { funcao: f.funcao, modo: f.funcao === 'nenhuma' ? null : modo, rotulo, cor, total: Number(f.total) };
  });
  // O mesmo rótulo em modos diferentes ganha o nome do modo ("Imagem · Poesia").
  const repetido = (rotulo: string) => new Set(funcoes.filter((f) => f.rotulo === rotulo).map((f) => f.modo?.id ?? '')).size > 1;
  return {
    tipos: Object.fromEntries(Object.entries(linha.tipos).map(([chave, valor]) => [chave, Number(valor)])) as FacetasDaCentral['tipos'],
    autorias: { leitor: Number(linha.autorias.leitor), codex: Number(linha.autorias.codex) },
    documentos: linha.documentos.map((d) => ({ ...d, total: Number(d.total) })),
    funcoes: funcoes.map((f) => ({ ...f, rotulo: f.modo && repetido(f.rotulo) ? `${f.rotulo} · ${f.modo.nome}` : f.rotulo }))
      .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR')),
  };
}

// ------------------------------------------------------------------ itens

function funcaoNoModo(chave: string | null, modoId: string | null, revisao: number | null): {
  modo: { id: string; revisao: number; nome: string } | null; rotulo: string; cor: { claro: string; escuro: string } | null;
} {
  const modo = modoId !== null && revisao !== null ? modoOuNada({ id: modoId, revisao }) : undefined;
  const funcao = chave === null || chave === 'nenhuma' ? undefined : modo?.funcoes.find((candidata) => candidata.chave === chave);
  return {
    modo: modoId === null || revisao === null ? null : { id: modoId, revisao, nome: modo?.nome ?? modoId },
    rotulo: chave === null || chave === 'nenhuma' ? 'Grifo' : funcao?.rotulo ?? rotuloDaChave(chave),
    cor: funcao ? { claro: funcao.cor.claro, escuro: funcao.cor.escuro } : null,
  };
}

function rotuloDaChave(chave: string): string {
  const texto = chave.replace(/_/g, ' ');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function curto(texto: string): string {
  return texto.length <= TRECHO_MAXIMO ? texto : `${texto.slice(0, TRECHO_MAXIMO - 1).trimEnd()}…`;
}

function paginaDoBloco(origens: readonly OrigemBloco[] | null): string | null {
  const pdf = origens?.find((origem) => origem.tipo === 'pdf');
  return pdf?.tipo === 'pdf' ? pdf.impressa ?? String(pdf.pagina) : null;
}

function rotuloDoItem(linha: Linha): string {
  switch (linha.tipo) {
    case 'nota_antiga': return 'Nota antiga';
    case 'relacao': {
      const chave = linha.chave ?? '';
      return ROTULOS_DA_RELACAO_SEMANTICA[chave as TipoRelacaoSemantica] ?? ROTULOS_DA_RELACAO[chave as RelacaoConexao] ?? 'Relação';
    }
    case 'dificuldade': return linha.chave ? ROTULO_DA_DIFICULDADE[linha.chave as TipoDificuldadeTextual] ?? rotuloDaChave(linha.chave) : 'Dificuldade';
    case 'resolucao': return linha.chave ? `Exercício ${linha.chave}` : 'Exercício';
    case 'flashcard': return 'Flashcard';
    case 'conversa': return 'Pergunta';
    case 'visual': return linha.chave === 'imagem' ? 'Imagem' : 'Diagrama';
    default: return funcaoNoModo(linha.funcao, linha.modo_id, linha.modo_revisao).rotulo;
  }
}

function painelDoItem(linha: Linha): AberturaNoLeitor['painel'] {
  switch (linha.tipo) {
    case 'grifo': return linha.nota !== null ? 'nota' : 'balao';
    case 'relacao': return linha.estado === 'da_leitura' ? 'relacao' : 'conexao';
    case 'conversa': return 'conversa';
    case 'resolucao': return 'resolucao';
    case 'visual': return 'visual';
    case 'flashcard': return 'flashcards';
    default: return 'trecho';
  }
}

function numero(valor: string | null): number | null {
  return valor === null ? null : Number(valor);
}

function item(linha: Linha): ItemDaCentral {
  const grifo = linha.tipo === 'grifo';
  const { modo, cor } = grifo ? funcaoNoModo(linha.funcao, linha.modo_id, linha.modo_revisao) : { modo: null, cor: null };
  const capitulo = linha.capitulo_id === null ? null : { id: linha.capitulo_id, titulo: linha.capitulo_titulo ?? '' };
  const secao = capitulo?.id ?? linha.secao_id;
  const inicio = numero(linha.inicio_utf16);
  const fim = numero(linha.fim_utf16);
  const faixa = inicio !== null && fim !== null && fim > inicio ? { inicio_utf16: inicio, fim_utf16: fim } : null;
  const alvo = linha.tipo === 'grifo' || linha.tipo === 'relacao' || linha.tipo === 'conversa' || linha.tipo === 'resolucao' || linha.tipo === 'visual' ? linha.ref_id : null;
  const abrir: AberturaNoLeitor = { documento_id: linha.documento_id, secao_id: secao, bloco_id: linha.bloco_id, faixa, painel: painelDoItem(linha), alvo_id: alvo };
  const destinoInicio = numero(linha.destino_inicio_utf16);
  const destinoFim = numero(linha.destino_fim_utf16);
  const destino = linha.tipo !== 'relacao' ? null : {
    citacao: linha.destino_citacao === null ? null : curto(linha.destino_citacao),
    documento: linha.destino_doc_id === null ? null : { id: linha.destino_doc_id, titulo: linha.destino_doc_titulo ?? '' },
    titulo_externo: linha.destino_titulo,
    abrir: linha.destino_doc_id === null || (linha.destino_tipo === 'trecho' && linha.destino_bloco_id === null) ? null : {
      documento_id: linha.destino_doc_id, secao_id: linha.destino_capitulo_id, bloco_id: linha.destino_bloco_id,
      faixa: destinoInicio !== null && destinoFim !== null && destinoFim > destinoInicio ? { inicio_utf16: destinoInicio, fim_utf16: destinoFim } : null,
      painel: 'trecho' as const, alvo_id: null,
    },
  };
  const pagina = linha.pagina_recorte !== null ? String(linha.pagina_recorte) : paginaDoBloco(linha.origens);
  return {
    chave: `${linha.tipo}:${linha.ref_id}`, tipo: linha.tipo, id: linha.ref_id, autoria: linha.autoria, rotulo: rotuloDoItem(linha),
    estado: linha.estado, funcao: grifo ? linha.funcao : null, modo, cor,
    citacao: curto(linha.citacao), nota: linha.nota, nota_id: linha.nota_id, comentario: linha.comentario, texto: linha.texto,
    destino, mensagens: linha.mensagens,
    documento: { id: linha.documento_id, titulo: linha.titulo, autor: linha.autor }, versao_id: linha.versao_id, capitulo, pagina, abrir,
    analise: linha.execucao_id !== null && linha.secao_id !== null ? { execucao_id: linha.execucao_id, secao_id: linha.secao_id } : null,
    link: `/ler/${linha.documento_id}${secao ? `/${secao}${linha.bloco_id ? `?bloco=${linha.bloco_id}` : ''}` : ''}`,
    criada_em: linha.criada_iso, atualizada_em: linha.atualizada_iso,
  };
}
