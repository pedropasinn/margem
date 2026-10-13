/**
 * Notas do leitor fora do capítulo aberto: as anotações e os grifos/marcas manuais de um documento ou da
 * biblioteca inteira, com o trecho citado, o capítulo, o bloco, a página (quando o bloco veio de um PDF) e a
 * data. É a mesma lista que a tela "Notas" mostra e que a exportação CSV/JSON grava.
 */
import type { FonteAnotacao, Id, OrigemBloco } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import { DATA } from '../repos/anotacoes.js';
import { modoOuNada } from '../modos.js';

export interface FiltroDeNotas {
  documento_id?: Id;
  /** `anotacao` ou `grifo`. */
  especie?: EspecieDeNota;
  /** Tipo da anotação (`duvida`, `fonte`…) ou chave da função do grifo (`tese`…): a "cor". */
  tipo?: string;
  /** Procura no trecho e na nota, sem diferença de maiúsculas. */
  texto?: string;
}

export type EspecieDeNota = 'anotacao' | 'grifo';

export interface ItemDeNota {
  id: Id;
  especie: EspecieDeNota;
  tipo: string;
  rotulo: string;
  /** Cor da função do grifo, no tema claro e no escuro; `null` nas anotações. */
  cor: { claro: string; escuro: string } | null;
  citacao: string;
  nota: string | null;
  fonte: FonteAnotacao | null;
  marca_id: Id | null;
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

const TIPOS_DE_ANOTACAO: Record<string, string> = {
  impressao: 'Impressão', observacao: 'Observação', hipotese: 'Hipótese', duvida: 'Dúvida', fonte: 'Fonte', nota: 'Nota',
};

interface Linha {
  id: Id; especie: EspecieDeNota; tipo: string; citacao: string; nota: string | null; fonte: FonteAnotacao | null;
  marca_id: Id | null; modo_id: string | null; modo_revisao: number | null; versao_id: Id; bloco_id: Id;
  origens: OrigemBloco[]; documento_id: Id; titulo: string; autor: string | null;
  capitulo_id: Id | null; capitulo_titulo: string | null; criada_em: string; atualizada_em: string;
}

/** Por documento (título, em português) e, dentro dele, na ordem do texto: versão, bloco, posição no bloco. */
export async function listarNotas(cliente: Transacao, filtro: FiltroDeNotas = {}): Promise<ItemDeNota[]> {
  const { rows } = await cliente.query<Linha>(`WITH itens AS (
      SELECT 'anotacao' AS especie, a.id, a.versao_id, a.bloco_id, a.inicio_utf16, a.citacao, a.tipo, a.texto AS nota,
        a.fonte, a.marca_id, NULL::text AS modo_id, NULL::integer AS modo_revisao, a.criada_em, a.atualizada_em
      FROM anotacao a
      UNION ALL
      SELECT 'grifo', m.id, m.versao_id, m.bloco_id, m.inicio_utf16, m.citacao, m.funcao, m.comentario->>'texto',
        NULL, NULL, m.modo_id, m.modo_revisao, m.criada_em, m.atualizada_em
      FROM marca m WHERE m.origem = 'manual' AND m.avaliacao <> 'rejeitada'
    )
    SELECT i.id, i.especie, i.tipo, i.citacao, i.nota, i.fonte, i.marca_id, i.modo_id, i.modo_revisao, i.versao_id, i.bloco_id,
      b.origens, d.id AS documento_id, d.titulo, d.autor, cap.id AS capitulo_id, cap.titulo AS capitulo_titulo,
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
    WHERE ($1::text IS NULL OR d.id = $1) AND ($2::text IS NULL OR i.especie = $2) AND ($3::text IS NULL OR i.tipo = $3)
      AND ($4::text IS NULL OR strpos(lower(i.citacao || ' ' || coalesce(i.nota, '')), lower($4)) > 0)
    ORDER BY lower(d.titulo), d.id, v.numero, b.ordem, i.inicio_utf16, i.criada_em, i.id`,
  [filtro.documento_id ?? null, filtro.especie ?? null, filtro.tipo ?? null, filtro.texto ?? null]);
  // Títulos em ordem alfabética do português ("Ética" antes de "Sobre"), qualquer que seja a collation do banco;
  // a ordenação é estável, e dentro do documento fica a ordem do texto.
  const titulo = new Intl.Collator('pt-BR', { sensitivity: 'base' });
  return rows.sort((a, b) => titulo.compare(a.titulo, b.titulo) || (a.documento_id < b.documento_id ? -1 : a.documento_id > b.documento_id ? 1 : 0)).map(item);
}

function item(linha: Linha): ItemDeNota {
  const funcao = linha.especie === 'grifo' && linha.modo_id !== null && linha.modo_revisao !== null
    ? modoOuNada({ id: linha.modo_id, revisao: linha.modo_revisao })?.funcoes.find((candidata) => candidata.chave === linha.tipo)
    : undefined;
  const capitulo = linha.capitulo_id === null ? null : { id: linha.capitulo_id, titulo: linha.capitulo_titulo ?? '' };
  return {
    id: linha.id, especie: linha.especie, tipo: linha.tipo,
    rotulo: linha.especie === 'anotacao' ? TIPOS_DE_ANOTACAO[linha.tipo] ?? linha.tipo : funcao?.rotulo ?? linha.tipo,
    cor: funcao ? { claro: funcao.cor.claro, escuro: funcao.cor.escuro } : null,
    citacao: linha.citacao, nota: linha.nota, fonte: linha.fonte, marca_id: linha.marca_id,
    documento: { id: linha.documento_id, titulo: linha.titulo, autor: linha.autor },
    versao_id: linha.versao_id, bloco_id: linha.bloco_id, capitulo, pagina: paginaDoBloco(linha.origens),
    link: `/ler/${linha.documento_id}${capitulo ? `/${capitulo.id}` : ''}?bloco=${linha.bloco_id}`,
    criada_em: linha.criada_em, atualizada_em: linha.atualizada_em,
  };
}

function paginaDoBloco(origens: readonly OrigemBloco[]): string | null {
  const pdf = origens.find((origem) => origem.tipo === 'pdf');
  return pdf?.tipo === 'pdf' ? pdf.impressa ?? String(pdf.pagina) : null;
}

// ------------------------------------------------------------------ exportação

const COLUNAS = ['documento', 'autor', 'capitulo', 'pagina', 'especie', 'tipo', 'citacao', 'nota', 'criada_em', 'atualizada_em',
  'link', 'documento_id', 'bloco_id', 'id'] as const;

function celula(valor: string | null): string {
  const texto = valor ?? '';
  return /[",\r\n]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
}

/** CSV (RFC 4180) com BOM, para a planilha abrir em UTF-8. */
export function notasEmCsv(itens: readonly ItemDeNota[]): string {
  const linhas = itens.map((nota) => [
    nota.documento.titulo, nota.documento.autor, nota.capitulo?.titulo ?? null, nota.pagina, nota.especie, nota.rotulo,
    nota.citacao, nota.nota, nota.criada_em, nota.atualizada_em, nota.link, nota.documento.id, nota.bloco_id, nota.id,
  ].map(celula).join(','));
  return `\uFEFF${[COLUNAS.join(','), ...linhas].join('\r\n')}\r\n`;
}
