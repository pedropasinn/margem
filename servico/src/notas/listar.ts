/**
 * Notas do leitor fora do capítulo aberto (modelo D, J138): um item por grifo, com o trecho, o rótulo e a cor da
 * função **no modo do próprio grifo**, a nota do leitor (uma por grifo, sem tipo) e, à parte, o comentário do
 * Codex. Entram os grifos do leitor (não rejeitados) e as marcas do Codex que o leitor anotou. As anotações
 * fundidas pela migração 0032 não aparecem, e a anotação ligada a um grifo não é item próprio: é a nota dele.
 * Uma anotação solta que sobrar (banco antigo, API) vira item "Nota antiga", só leitura. Cada item tem o
 * capítulo, o bloco, a página (quando o bloco veio de um PDF) e a data. É a mesma lista que a tela "Notas"
 * mostra e que a exportação CSV/JSON grava.
 */
import type { Id, OrigemBloco } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import { DATA } from '../repos/anotacoes.js';
import { modoOuNada } from '../modos.js';

/** `com_nota`: só os itens com nota do leitor (grifos e notas antigas); `grifos`: só os grifos sem nota. */
export type RecorteDeNotas = 'com_nota' | 'grifos';
export const RECORTES_DE_NOTAS: readonly RecorteDeNotas[] = ['com_nota', 'grifos'];

export interface FiltroDeNotas {
  documento_id?: Id;
  mostrar?: RecorteDeNotas;
  /** Chave da função do grifo (`tese`, `imagem`, `nenhuma`…): a "cor". */
  funcao?: string;
  /** Id do modo, para separar funções de mesma chave em modos diferentes. */
  modo?: string;
  /** Procura no trecho, na nota e no comentário do Codex, sem diferença de maiúsculas. */
  texto?: string;
}

export type EspecieDeNota = 'grifo' | 'nota_antiga';

export interface ItemDeNota {
  /** O id do grifo (a marca); na nota antiga, o da anotação. */
  id: Id;
  especie: EspecieDeNota;
  /** Chave da função do grifo (`nenhuma`: sem função); `null` na nota antiga. */
  funcao: string | null;
  /** O modo do grifo (rótulo e cor da função vêm dele); `null` na nota antiga. */
  modo: { id: string; revisao: number; nome: string } | null;
  /** Rótulo da função no modo do grifo; "Grifo" sem função; "Nota antiga". */
  rotulo: string;
  /** Cor da função, no tema claro e no escuro; `null` sem função e na nota antiga. */
  cor: { claro: string; escuro: string } | null;
  /** De quem é o grifo: do leitor, ou uma marca do Codex que o leitor anotou. */
  autoria: 'leitor' | 'codex';
  citacao: string;
  /** A nota do leitor (texto simples, sem tipo), ou `null`. */
  nota: string | null;
  /** O id da nota do leitor (o da anotação), ou `null`. */
  nota_id: Id | null;
  /** O comentário do Codex no grifo, voz separada da nota do leitor. */
  comentario_codex: string | null;
  documento: { id: Id; titulo: string; autor: string | null };
  versao_id: Id;
  bloco_id: Id;
  capitulo: { id: Id; titulo: string } | null;
  /** Página impressa quando o PDF a tem, senão a do arquivo; `null` fora de PDF. */
  pagina: string | null;
  /** Volta ao trecho no leitor: `/ler/<documento>/<capítulo>?bloco=<bloco>`. */
  link: string;
  criada_em: string;
  atualizada_em: string;
}

interface Linha {
  id: Id; especie: EspecieDeNota; funcao: string | null; modo_id: string | null; modo_revisao: number | null; origem: string | null;
  citacao: string; nota: string | null; nota_id: Id | null; comentario: string | null; versao_id: Id; bloco_id: Id;
  origens: OrigemBloco[]; documento_id: Id; titulo: string; autor: string | null;
  capitulo_id: Id | null; capitulo_titulo: string | null; criada_em: string; atualizada_em: string;
}

/** Por documento (título, em português) e, dentro dele, na ordem do texto: versão, bloco, posição no bloco. */
export async function listarNotas(cliente: Transacao, filtro: FiltroDeNotas = {}): Promise<ItemDeNota[]> {
  const { rows } = await cliente.query<Linha>(`WITH itens AS (
      SELECT 'grifo' AS especie, m.id, m.versao_id, m.bloco_id, m.inicio_utf16, m.citacao, m.funcao, m.modo_id, m.modo_revisao,
        m.origem, n.texto AS nota, n.id AS nota_id, nullif(m.comentario->>'texto', '') AS comentario,
        m.criada_em, greatest(m.atualizada_em, n.atualizada_em) AS atualizada_em
      FROM marca m
      LEFT JOIN LATERAL (
        SELECT a.id, a.texto, a.atualizada_em FROM anotacao a WHERE a.marca_id = m.id AND a.fundida_em IS NULL ORDER BY a.criada_em, a.id LIMIT 1
      ) n ON true
      WHERE (m.origem = 'manual' AND m.avaliacao <> 'rejeitada') OR n.id IS NOT NULL
      UNION ALL
      SELECT 'nota_antiga', a.id, a.versao_id, a.bloco_id, a.inicio_utf16, a.citacao, NULL, NULL, NULL,
        NULL, a.texto, a.id, NULL, a.criada_em, a.atualizada_em
      FROM anotacao a WHERE a.marca_id IS NULL AND a.fundida_em IS NULL
    )
    SELECT i.id, i.especie, i.funcao, i.modo_id, i.modo_revisao, i.origem, i.citacao, i.nota, i.nota_id, i.comentario,
      i.versao_id, i.bloco_id, b.origens, d.id AS documento_id, d.titulo, d.autor, cap.id AS capitulo_id, cap.titulo AS capitulo_titulo,
      ${DATA('i.criada_em')} AS criada_em, ${DATA('i.atualizada_em')} AS atualizada_em
    FROM itens i
    JOIN versao_texto v ON v.id = i.versao_id
    JOIN documento d ON d.id = v.documento_id
    JOIN bloco b ON b.versao_id = i.versao_id AND b.id = i.bloco_id
    LEFT JOIN LATERAL (
      SELECT s.id, s.titulo FROM secao s
      JOIN bloco bi ON bi.versao_id = s.versao_id AND bi.id = s.bloco_inicio
      JOIN bloco bf ON bf.versao_id = s.versao_id AND bf.id = s.bloco_fim
      WHERE s.versao_id = i.versao_id AND s.nivel = 1 AND b.ordem BETWEEN bi.ordem AND bf.ordem
      ORDER BY s.ordem LIMIT 1
    ) cap ON true
    WHERE ($1::text IS NULL OR d.id = $1)
      AND ($2::text IS NULL OR ($2 = 'com_nota' AND i.nota IS NOT NULL) OR ($2 = 'grifos' AND i.especie = 'grifo' AND i.nota IS NULL))
      AND ($3::text IS NULL OR i.funcao = $3) AND ($4::text IS NULL OR i.modo_id = $4)
      AND ($5::text IS NULL OR strpos(lower(i.citacao || ' ' || coalesce(i.nota, '') || ' ' || coalesce(i.comentario, '')), lower($5)) > 0)
    ORDER BY lower(d.titulo), d.id, v.numero, b.ordem, i.inicio_utf16, i.criada_em, i.id`,
  [filtro.documento_id ?? null, filtro.mostrar ?? null, filtro.funcao ?? null, filtro.modo ?? null, filtro.texto ?? null]);
  // Títulos em ordem alfabética do português ("Ética" antes de "Sobre"), qualquer que seja a collation do banco;
  // a ordenação é estável, e dentro do documento fica a ordem do texto.
  const titulo = new Intl.Collator('pt-BR', { sensitivity: 'base' });
  return rows.sort((a, b) => titulo.compare(a.titulo, b.titulo) || (a.documento_id < b.documento_id ? -1 : a.documento_id > b.documento_id ? 1 : 0)).map(item);
}

function item(linha: Linha): ItemDeNota {
  // Rótulo e cor sempre pelo modo do próprio grifo (grifos de modos diferentes convivem no documento).
  const modo = linha.modo_id !== null && linha.modo_revisao !== null ? modoOuNada({ id: linha.modo_id, revisao: linha.modo_revisao }) : undefined;
  const funcao = linha.funcao === null || linha.funcao === 'nenhuma' ? undefined : modo?.funcoes.find((candidata) => candidata.chave === linha.funcao);
  const capitulo = linha.capitulo_id === null ? null : { id: linha.capitulo_id, titulo: linha.capitulo_titulo ?? '' };
  const grifo = linha.especie === 'grifo';
  return {
    id: linha.id, especie: linha.especie, funcao: linha.funcao,
    modo: linha.modo_id === null || linha.modo_revisao === null ? null : { id: linha.modo_id, revisao: linha.modo_revisao, nome: modo?.nome ?? linha.modo_id },
    rotulo: !grifo ? 'Nota antiga' : linha.funcao === 'nenhuma' ? 'Grifo' : funcao?.rotulo ?? rotuloDaChave(linha.funcao ?? ''),
    cor: funcao ? { claro: funcao.cor.claro, escuro: funcao.cor.escuro } : null,
    autoria: !grifo || linha.origem === 'manual' ? 'leitor' : 'codex',
    citacao: linha.citacao, nota: linha.nota, nota_id: linha.nota_id, comentario_codex: linha.comentario,
    documento: { id: linha.documento_id, titulo: linha.titulo, autor: linha.autor },
    versao_id: linha.versao_id, bloco_id: linha.bloco_id, capitulo, pagina: paginaDoBloco(linha.origens),
    link: `/ler/${linha.documento_id}${capitulo ? `/${capitulo.id}` : ''}?bloco=${linha.bloco_id}`,
    criada_em: linha.criada_em, atualizada_em: linha.atualizada_em,
  };
}

function rotuloDaChave(chave: string): string {
  const texto = chave.replace(/_/g, ' ');
  return texto.charAt(0).toUpperCase() + texto.slice(1) || 'Grifo';
}

function paginaDoBloco(origens: readonly OrigemBloco[]): string | null {
  const pdf = origens.find((origem) => origem.tipo === 'pdf');
  return pdf?.tipo === 'pdf' ? pdf.impressa ?? String(pdf.pagina) : null;
}

// ------------------------------------------------------------------ exportação

/**
 * Colunas do CSV. `funcao` é o rótulo da função no modo do grifo ("Grifo" sem função, "Nota antiga"), `modo` o
 * nome do modo; `nota` é a do leitor e `comentario_codex` o do Codex. Desde o modelo D não há tipo de anotação.
 */
const COLUNAS = ['documento', 'autor', 'capitulo', 'pagina', 'especie', 'funcao', 'modo', 'citacao', 'nota', 'comentario_codex',
  'criada_em', 'atualizada_em', 'link', 'documento_id', 'bloco_id', 'id'] as const;

function celula(valor: string | null): string {
  const texto = valor ?? '';
  return /[",\r\n]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
}

/** CSV (RFC 4180) com BOM, para a planilha abrir em UTF-8. */
export function notasEmCsv(itens: readonly ItemDeNota[]): string {
  const linhas = itens.map((nota) => [
    nota.documento.titulo, nota.documento.autor, nota.capitulo?.titulo ?? null, nota.pagina, nota.especie, nota.rotulo,
    nota.modo?.nome ?? null, nota.citacao, nota.nota, nota.comentario_codex, nota.criada_em, nota.atualizada_em, nota.link,
    nota.documento.id, nota.bloco_id, nota.id,
  ].map(celula).join(','));
  return `\uFEFF${[COLUNAS.join(','), ...linhas].join('\r\n')}\r\n`;
}
