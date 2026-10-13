/**
 * Extração de uma página: Readability para achar o artigo, metadados (autor, site, data) das
 * marcações que os sites usam (meta, Open Graph, JSON-LD) e conversão para Markdown.
 *
 * Roda dentro da página (script injetado sob demanda) e nos testes com jsdom. Não lê nada fora
 * do `document` recebido e não faz rede.
 */
import { Readability } from '@mozilla/readability';
import type { CapturaDeTexto } from '../tipos';
import { contarPalavras, htmlParaMarkdown, type EstiloDeLinks } from './markdown';

const LIMITE_DE_LINHA = 500;
const TAMANHO_DA_PREVIA = 420;

function linha(texto: string | null | undefined): string | undefined {
  if (texto === null || texto === undefined) return undefined;
  const limpo = texto.replace(/\s+/g, ' ').trim();
  if (limpo === '') return undefined;
  return limpo.length > LIMITE_DE_LINHA ? `${limpo.slice(0, LIMITE_DE_LINHA - 1)}…` : limpo;
}

function meta(documento: Document, ...seletores: string[]): string | undefined {
  for (const seletor of seletores) {
    const valor = linha(documento.querySelector(seletor)?.getAttribute('content'));
    if (valor !== undefined) return valor;
  }
  return undefined;
}

type Json = null | boolean | number | string | Json[] | { [chave: string]: Json };

/** Objetos dos blocos JSON-LD, achatando `@graph` e listas. */
function objetosJsonLd(documento: Document): Record<string, Json>[] {
  const saida: Record<string, Json>[] = [];
  const visitar = (valor: Json): void => {
    if (Array.isArray(valor)) { valor.forEach(visitar); return; }
    if (valor === null || typeof valor !== 'object') return;
    saida.push(valor);
    const grafo = valor['@graph'];
    if (grafo !== undefined) visitar(grafo);
  };
  for (const script of Array.from(documento.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      visitar(JSON.parse(script.textContent ?? '') as Json);
    } catch {
      // JSON-LD quebrado é comum; a página continua valendo.
    }
  }
  return saida;
}

function textoDoJson(valor: Json | undefined): string | undefined {
  if (typeof valor === 'string') return linha(valor);
  if (Array.isArray(valor)) {
    const nomes = valor.map(textoDoJson).filter((nome): nome is string => nome !== undefined);
    return nomes.length > 0 ? linha(nomes.join(', ')) : undefined;
  }
  if (valor !== null && typeof valor === 'object') return textoDoJson(valor.name);
  return undefined;
}

const TIPOS_DE_ARTIGO = /Article|Posting|Report|NewsArticle|BlogPosting|WebPage/;

function doJsonLd(documento: Document, campo: 'author' | 'datePublished' | 'publisher'): string | undefined {
  const objetos = objetosJsonLd(documento);
  const artigos = objetos.filter((objeto) => {
    const tipo = objeto['@type'];
    return (typeof tipo === 'string' && TIPOS_DE_ARTIGO.test(tipo))
      || (Array.isArray(tipo) && tipo.some((item) => typeof item === 'string' && TIPOS_DE_ARTIGO.test(item)));
  });
  for (const objeto of [...artigos, ...objetos]) {
    const valor = textoDoJson(objeto[campo]);
    if (valor !== undefined) return valor;
  }
  return undefined;
}

/**
 * Data no formato que o contrato aceita: só a data (AAAA-MM-DD) quando a página só tem a data;
 * senão o instante em UTC. O que não for data reconhecível é descartado.
 */
export function normalizarData(bruto: string | undefined): string | undefined {
  if (bruto === undefined) return undefined;
  const texto = bruto.trim();
  const soData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (soData) return Number.isNaN(Date.parse(`${texto}T00:00:00Z`)) ? undefined : texto;
  const instante = Date.parse(texto);
  if (Number.isNaN(instante)) return undefined;
  const ano = new Date(instante).getUTCFullYear();
  return ano < 1000 || ano > 9999 ? undefined : new Date(instante).toISOString();
}

/** "Por Fulana - Repórter da Agência" → "Fulana - Repórter da Agência"; endereço não é autor. */
export function limparAutor(bruto: string | undefined): string | undefined {
  const texto = linha(bruto?.replace(/^\s*(por|by|de)\s+/i, ''));
  if (texto === undefined || /^https?:\/\//i.test(texto)) return undefined;
  return texto;
}

function siteDaUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || undefined;
  } catch {
    return undefined;
  }
}

/** Pixel de rastreamento: imagem de 1–2 px declarada no atributo ou no estilo. */
function ehPixel(imagem: Element): boolean {
  const medidas = [imagem.getAttribute('width'), imagem.getAttribute('height')]
    .concat(Array.from((imagem.getAttribute('style') ?? '').matchAll(/(?:^|;)\s*(?:width|height)\s*:\s*([\d.]+)px/gi), (achado) => achado[1] ?? null));
  return medidas.some((medida) => medida !== null && Number.parseFloat(medida) <= 2);
}

/**
 * Ajustes no clone antes do Readability, para ele não jogar fora o que é do artigo:
 * - o "[editar]" ao lado dos títulos (Wikipédia) fazia o bloco do título parecer só links;
 * - o título embrulhado num `div` só dele (`div.mw-heading`) sai do embrulho;
 * - pixels de rastreamento somem (o Readability apaga o estilo que os denunciava).
 */
export function prepararParaLeitura(documento: Document): Document {
  for (const ruido of Array.from(documento.querySelectorAll('.mw-editsection'))) ruido.remove();
  for (const imagem of Array.from(documento.querySelectorAll('img'))) if (ehPixel(imagem)) imagem.remove();
  for (const titulo of Array.from(documento.querySelectorAll('h1, h2, h3, h4, h5, h6'))) {
    const pai = titulo.parentElement;
    if (pai !== null && pai.tagName === 'DIV' && pai.children.length === 1 && (pai.textContent ?? '').trim() === (titulo.textContent ?? '').trim()) {
      pai.replaceWith(titulo);
    }
  }
  return documento;
}

export interface OpcoesDeExtracao {
  links?: EstiloDeLinks;
}

function previa(texto: string): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length > TAMANHO_DA_PREVIA ? `${limpo.slice(0, TAMANHO_DA_PREVIA - 1)}…` : limpo;
}

/** Os campos opcionais podem vir `undefined`; saem do objeto (o contrato recusa `null`/vazio). */
type ComIndefinidos<T> = { [K in keyof T]-?: T[K] | undefined };
function semVazios<T extends object>(objeto: ComIndefinidos<T>): T {
  return Object.fromEntries(Object.entries(objeto).filter(([, valor]) => valor !== undefined)) as T;
}

/** A página inteira, pelo artigo que o Readability encontrar (ou o corpo, se ele não achar). */
export function extrairPagina(documento: Document, opcoes: OpcoesDeExtracao = {}): CapturaDeTexto {
  const url = documento.location?.href ?? documento.URL;
  const artigo = new Readability(prepararParaLeitura(documento.cloneNode(true) as Document), { keepClasses: true }).parse();
  let markdown: string;
  if (artigo?.content) {
    // Documento inerte (DOMParser): nada carrega nem executa; serve só para a conversão.
    const Analisador = documento.defaultView?.DOMParser ?? DOMParser;
    const recipiente = new Analisador().parseFromString(artigo.content, 'text/html').body;
    markdown = htmlParaMarkdown(recipiente, { base: url, ...(opcoes.links ? { links: opcoes.links } : {}) });
  } else {
    const corpo = prepararParaLeitura(documento.cloneNode(true) as Document).body;
    for (const ruido of Array.from(corpo.querySelectorAll('nav, header, footer, aside, script, style, noscript'))) ruido.remove();
    markdown = htmlParaMarkdown(corpo, { base: url, ...(opcoes.links ? { links: opcoes.links } : {}) });
  }
  const titulo = linha(artigo?.title) ?? linha(documento.title) ?? siteDaUrl(url) ?? 'Página sem título';
  const textoPuro = artigo?.textContent ?? documento.body.textContent ?? '';
  return semVazios<CapturaDeTexto>({
    tipo: 'pagina',
    titulo,
    autor: limparAutor(artigo?.byline ?? undefined) ?? limparAutor(meta(documento, 'meta[name="author"]', 'meta[property="article:author"]'))
      ?? limparAutor(doJsonLd(documento, 'author')),
    site: linha(artigo?.siteName) ?? meta(documento, 'meta[property="og:site_name"]', 'meta[name="application-name"]')
      ?? doJsonLd(documento, 'publisher') ?? siteDaUrl(url),
    url,
    publicado_em: normalizarData(artigo?.publishedTime ?? undefined)
      ?? normalizarData(meta(documento, 'meta[property="article:published_time"]', 'meta[name="date"]', 'meta[itemprop="datePublished"]', 'meta[name="dcterms.date"]'))
      ?? normalizarData(doJsonLd(documento, 'datePublished'))
      ?? normalizarData(documento.querySelector('time[datetime]')?.getAttribute('datetime') ?? undefined),
    markdown,
    palavras: contarPalavras(textoPuro),
    previa: previa(artigo?.excerpt && artigo.excerpt.length > 80 ? artigo.excerpt : textoPuro),
  });
}

/** Só a seleção do leitor; `null` quando não há nada selecionado. */
export function extrairSelecao(documento: Document, opcoes: OpcoesDeExtracao = {}): CapturaDeTexto | null {
  const selecao = documento.getSelection();
  if (selecao === null || selecao.isCollapsed || selecao.rangeCount === 0) return null;
  const recipiente = documento.createElement('div');
  for (let indice = 0; indice < selecao.rangeCount; indice += 1) {
    recipiente.appendChild(selecao.getRangeAt(indice).cloneContents());
  }
  const url = documento.location?.href ?? documento.URL;
  const markdown = htmlParaMarkdown(recipiente, { base: url, ...(opcoes.links ? { links: opcoes.links } : {}) });
  const texto = recipiente.textContent ?? '';
  if (markdown.trim() === '') return null;
  const tituloDaPagina = linha(documento.title) ?? siteDaUrl(url) ?? 'Página';
  return semVazios<CapturaDeTexto>({
    tipo: 'selecao',
    titulo: linha(`${tituloDaPagina} (trecho)`) ?? 'Trecho',
    autor: limparAutor(meta(documento, 'meta[name="author"]', 'meta[property="article:author"]')) ?? limparAutor(doJsonLd(documento, 'author')),
    site: meta(documento, 'meta[property="og:site_name"]') ?? siteDaUrl(url),
    url,
    publicado_em: normalizarData(meta(documento, 'meta[property="article:published_time"]')) ?? normalizarData(doJsonLd(documento, 'datePublished')),
    markdown,
    palavras: contarPalavras(texto),
    previa: previa(texto),
  });
}
