import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

export const FIXTURES = {
  noticia: { arquivo: 'noticia-agencia-brasil.html', url: 'https://agenciabrasil.ebc.com.br/politica/noticia/2026-09/eleicoes-2026-saiba-o-que-pode-e-o-que-nao-pode-no-dia-da-votacao' },
  blog: { arquivo: 'blog-go-roteamento.html', url: 'https://go.dev/blog/routing-enhancements' },
  wikipedia: { arquivo: 'wikipedia-dom-casmurro.html', url: 'https://pt.wikipedia.org/wiki/Dom_Casmurro' },
} as const;

/** Documento jsdom da fixture, com a URL original (para links relativos e `location`). */
export function documentoDaFixture(nome: keyof typeof FIXTURES): Document {
  const { arquivo, url } = FIXTURES[nome];
  const html = readFileSync(new URL(`./fixtures/${arquivo}`, import.meta.url), 'utf8');
  return new JSDOM(html, { url }).window.document;
}

export function documentoDeHtml(html: string, url = 'https://exemplo.com.br/artigo'): Document {
  return new JSDOM(html, { url }).window.document;
}
