/**
 * Página web capturada pela extensão do navegador (ImportacaoWebV1).
 *
 * É o corpo de `POST /api/importacoes/web`. O Markdown chega sem frontmatter: quem escreve o
 * frontmatter do original (url, site, datas) é o serviço, a partir dos campos validados.
 */
export interface ImportacaoWebV1 {
  markdown: string;
  titulo: string;
  autor?: string;
  site?: string;
  /** Endereço http(s) da página capturada. */
  url_origem: string;
  /** Data de publicação declarada pela página: RFC 3339 com fuso, ou só a data (AAAA-MM-DD). */
  publicado_em?: string;
  /** Instante da captura no navegador; sem ele, o serviço usa o relógio dele. */
  capturado_em?: string;
  /** Verdadeiro quando o conteúdo é só a seleção do leitor, não a página inteira. */
  trecho?: boolean;
}

/** Primeira linha `---`: o motor a leria como abertura de frontmatter. */
const ABRE_FRONTMATTER = /^﻿?---[ \t]*(?:\r\n|\r|\n|$)/;

/** Invariantes além do schema: corpo com conteúdo e sem frontmatter próprio. */
export function regrasImportacaoWeb(valor: ImportacaoWebV1): boolean {
  if (!/\S/.test(valor.markdown)) return false;
  return !ABRE_FRONTMATTER.test(valor.markdown);
}
