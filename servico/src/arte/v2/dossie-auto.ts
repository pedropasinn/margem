/**
 * Dossiê automático de uma obra a partir do Wikimedia Commons, do Wikidata e da Wikipédia (pt e en),
 * para quando não há curadoria. É a única etapa do algoritmo com rede: busca, guarda o texto de cada
 * fonte em `fontes/auto-*.txt` (instantâneo auditável) e escreve `dossie-auto.json`. As etapas com o
 * Codex leem só esses arquivos.
 *
 * Caminho: página do arquivo no Commons (de `imagem.json`) → item do Wikidata (P6243 "representação
 * digital de" nos dados estruturados do arquivo, ou um link Q-id na descrição) → afirmações e
 * sitelinks → extratos em texto puro das Wikipédias.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FonteDaObra, ModeloDaObraV1 } from '@margem/contratos';
import { TETO_POR_FONTE } from './acervo.js';
import type { DossieDaObra, ObraDoAcervo } from './acervo.js';

export type Buscar = (url: string) => Promise<unknown>;

export const AGENTE = 'MargemQuadros/0.1 (leitor pessoal; github.com/pedropasinn/margem)';

/** GET com JSON; 429/503 esperam (Retry-After ou 2, 4, 8 s) e tentam de novo, até quatro vezes. */
export const buscarNaRede: Buscar = async (url) => {
  for (let tentativa = 0; ; tentativa += 1) {
    const r = await fetch(url, { headers: { 'User-Agent': AGENTE, Accept: 'application/json' } });
    if (r.ok) return r.json();
    if ((r.status !== 429 && r.status !== 503) || tentativa >= 3) throw new Error(`rede_${String(r.status)}: ${url}`);
    const espera = Number(r.headers.get('retry-after')) || 2 ** (tentativa + 1);
    await new Promise((resolver) => setTimeout(resolver, Math.min(espera, 30) * 1000));
  }
};

export interface FonteAutomatica extends FonteDaObra { arquivo: string }
export interface DossieAutomatico {
  versao: 1;
  gerado_em: string;
  qid: string | null;
  identidade: { titulo: string; titulo_original: string; artista: string; data: string; tecnica: string; fontes: string[] };
  localizacao: { instituicao_proprietaria: string | null; fontes: string[] };
  fontes: FonteAutomatica[];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null ? v as Json : {});
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const texto = (v: unknown): string => (typeof v === 'string' ? v : '');
const semHtml = (s: string): string => s.replace(/<[^>]+>/gu, ' ').replace(/&nbsp;/gu, ' ').replace(/&amp;/gu, '&').replace(/\s+/gu, ' ').trim();

/** ID estável de fonte automática (ULID válido, derivado da URL), para que buscar de novo não mude os ids. */
export function idDeFonte(url: string): string {
  const C = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const h = createHash('sha256').update(url).digest();
  let s = '01AUT0'; for (let i = 0; i < 20; i += 1) s += C[h[i]! % 32]!;
  return s;
}

function rotuloDe(entidade: Json, linguas = ['pt', 'pt-br', 'en']): string {
  const labels = obj(entidade.labels);
  for (const l of linguas) { const v = texto(obj(labels[l]).value); if (v) return v; }
  const qualquer = Object.values(labels)[0];
  return texto(obj(qualquer).value);
}

function valoresQ(claims: Json, prop: string): string[] {
  return lista(claims[prop]).flatMap((c) => { const id = texto(obj(obj(obj(obj(c).mainsnak).datavalue).value).id); return id ? [id] : []; });
}

/** Título na língua da obra (P1476, texto monolíngue), quando o Wikidata o tem. */
function tituloOriginal(claims: Json): string {
  return texto(obj(obj(obj(obj(lista(claims.P1476)[0]).mainsnak).datavalue).value).text);
}

function dataDe(claims: Json): string {
  const t = texto(obj(obj(obj(obj(lista(claims.P571)[0]).mainsnak).datavalue).value).time);
  const ano = /^[+-]0*(\d{1,4})-/u.exec(t)?.[1];
  return ano ?? '';
}

/** Registro das fontes de um dossiê em montagem: cada uma com id estável e o texto do instantâneo. */
interface Registro {
  fontes: FonteAutomatica[];
  textos: Map<string, string>;
  registrar: (f: Omit<FonteAutomatica, 'id' | 'consultado_em'>, corpo: string) => string;
}
function novoRegistro(hoje: string): Registro {
  const fontes: FonteAutomatica[] = [];
  const textos = new Map<string, string>();
  return {
    fontes, textos,
    registrar: (f, corpo) => {
      const id = idDeFonte(f.url);
      fontes.push({ ...f, id, consultado_em: hoje });
      textos.set(f.arquivo, `# ${f.titulo}\n# ${f.url}\n# consultado em ${hoje} (dossiê automático)\n\n${corpo.trim()}\n`);
      return id;
    },
  };
}

/** Item do Wikidata → afirmações com rótulos, e os extratos das Wikipédias pt e en (sitelinks). */
async function dossieDoItem(qid: string, registro: Registro, buscar: Buscar, reserva: DossieAutomatico['identidade']): Promise<Pick<DossieAutomatico, 'identidade' | 'localizacao'>> {
  const url = `https://www.wikidata.org/wiki/${qid}`;
  const e = obj(obj(obj(await buscar(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`)).entities)[qid]);
  const claims = obj(e.claims);
  const props: [string, string][] = [['P170', 'criador'], ['P186', 'material'], ['P195', 'coleção'], ['P276', 'localização'], ['P135', 'movimento'], ['P180', 'retrata'], ['P136', 'gênero']];
  const ids = [...new Set(props.flatMap(([p]) => valoresQ(claims, p)))];
  const rotulos = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 40) {
    const r = obj(obj(await buscar(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=pt|pt-br|en&ids=${ids.slice(i, i + 40).join('|')}`)).entities);
    for (const [id, ent] of Object.entries(r)) rotulos.set(id, rotuloDe(obj(ent)));
  }
  const nomes = (p: string) => valoresQ(claims, p).map((id) => rotulos.get(id) ?? id);
  const linhas = [`rótulo: ${rotuloDe(e)}`, `rótulo original: ${tituloOriginal(claims) || rotuloDe(e, ['de', 'fr', 'nl', 'es', 'it', 'ja', 'en'])}`, `data de criação: ${dataDe(claims)}`, ...props.map(([p, n]) => `${n} (${p}): ${nomes(p).join('; ')}`)];
  const idWd = registro.registrar({ titulo: `Wikidata — ${qid}, ${rotuloDe(e)}`, url, categoria: 'catalogo', arquivo: 'auto-wikidata.txt' }, linhas.join('\n'));
  const identidade = { titulo: rotuloDe(e) || reserva.titulo, titulo_original: tituloOriginal(claims) || rotuloDe(e, ['de', 'fr', 'nl', 'es', 'it', 'ja', 'en']) || reserva.titulo_original, artista: nomes('P170').join(', ') || reserva.artista, data: dataDe(claims) || reserva.data, tecnica: nomes('P186').join(', '), fontes: [idWd] };
  const localizacao = { instituicao_proprietaria: nomes('P195')[0] ?? null, fontes: nomes('P195').length ? [idWd] : [] };
  const sitelinks = obj(e.sitelinks);
  for (const lingua of ['pt', 'en']) {
    const artigo = texto(obj(sitelinks[`${lingua}wiki`]).title);
    if (!artigo) continue;
    const q = obj(obj(await buscar(`https://${lingua}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(artigo)}`)).query);
    const corpo = texto(obj(lista(q.pages)[0]).extract);
    if (corpo) registro.registrar({ titulo: `Wikipédia (${lingua}) — ${artigo}`, url: `https://${lingua}.wikipedia.org/wiki/${encodeURIComponent(artigo.replace(/ /gu, '_'))}`, categoria: 'secundaria', arquivo: `auto-wp-${lingua}.txt` }, corpo);
  }
  return { identidade, localizacao };
}

async function gravarDossie(pasta: string, dossie: DossieAutomatico, textos: Map<string, string>): Promise<void> {
  await mkdir(join(pasta, 'fontes'), { recursive: true });
  for (const [arquivo, corpo] of textos) await writeFile(join(pasta, 'fontes', arquivo), corpo);
  await writeFile(join(pasta, 'dossie-auto.json'), `${JSON.stringify(dossie, null, 2)}\n`);
}

export async function buscarDossieAutomatico(pasta: string, buscar: Buscar = buscarNaRede, hoje = new Date().toISOString().slice(0, 10)): Promise<DossieAutomatico> {
  const imagem = obj(JSON.parse(await readFile(join(pasta, 'imagem.json'), 'utf8')));
  const origem = texto(imagem.origem_url);
  const titulo = decodeURIComponent(/\/wiki\/(File:.+)$/u.exec(origem)?.[1] ?? '');
  if (!titulo) throw new Error('imagem_json_sem_pagina_do_commons');
  // Último recurso: o item do Wikidata anotado na curadoria (`imagem.json` → `wikidata`).
  const anotado = /^Q\d+$/u.test(texto(imagem.wikidata)) ? texto(imagem.wikidata) : null;
  return dossieDoArquivoDoCommons(pasta, titulo, origem, buscar, hoje, { qidAnotado: anotado });
}

const API_DO_COMMONS = 'https://commons.wikimedia.org/w/api.php?format=json&formatversion=2';

/** Link de uma Wikipédia no HTML do campo "Artist" do Commons (`…wikipedia.org/wiki/en:Nome`), como (língua, artigo). */
export function artigoDoArtistaNoCommons(html: string): { lingua: string; artigo: string } | null {
  const m = /https?:\/\/([a-z]{2,3})\.wikipedia\.org\/wiki\/(?:([a-z]{2,3}):)?([^"'?#\s]+)/u.exec(html);
  if (!m) return null;
  try { return { lingua: m[2] ?? m[1]!, artigo: decodeURIComponent(m[3]!).replaceAll('_', ' ') }; } catch { return null; }
}

/**
 * Dossiê a partir de uma página de arquivo do Commons: metadados do arquivo, o item do Wikidata (dados
 * estruturados P6243 ou um Q-id na descrição) e, sem item, o artigo da Wikipédia sobre o artista que o
 * próprio Commons liga (V-T2: "Educação Obrigatória", de Briton Rivière, não tem item no Wikidata).
 */
async function dossieDoArquivoDoCommons(pasta: string, titulo: string, origem: string, buscar: Buscar, hoje: string, opcoes: { qidAnotado?: string | null; reserva?: IdentificacaoParaBusca } = {}): Promise<DossieAutomatico> {
  const registro = novoRegistro(hoje);
  const pagina = obj(lista(obj(obj(await buscar(`${API_DO_COMMONS}&action=query&prop=imageinfo&iiprop=extmetadata&titles=${encodeURIComponent(titulo)}`)).query).pages)[0]);
  const meta = obj(obj(lista(pagina.imageinfo)[0]).extmetadata);
  const campo = (k: string) => semHtml(texto(obj(meta[k]).value));
  const commons = ['ObjectName', 'Artist', 'DateTimeOriginal', 'ImageDescription', 'Credit', 'LicenseShortName'].map((k) => `${k}: ${campo(k)}`).filter((l) => !l.endsWith(': ')).join('\n');
  const idCommons = registro.registrar({ titulo: `Wikimedia Commons — ${titulo}`, url: origem, categoria: 'secundaria', arquivo: 'auto-commons.txt' }, commons);
  let qid: string | null = null;
  if (typeof pagina.pageid === 'number') {
    const estruturado = obj(obj(obj(await buscar(`${API_DO_COMMONS}&action=wbgetentities&ids=M${String(pagina.pageid)}`)).entities)[`M${String(pagina.pageid)}`]);
    qid = valoresQ(obj(estruturado.statements), 'P6243')[0] ?? null;
  }
  qid ??= /wikidata\.org\/wiki\/(Q\d+)/u.exec(JSON.stringify(meta))?.[1] ?? null;
  qid ??= opcoes.qidAnotado ?? null;

  const ano = /\d{3,4}/u.exec(campo('DateTimeOriginal'))?.[0] ?? '';
  const r = opcoes.reserva;
  let identidade: DossieAutomatico['identidade'] = {
    // O título da identificação (em português, quando há um consagrado) vem antes do nome no Commons, que
    // costuma estar na língua original; este fica como título original.
    titulo: r?.titulo || campo('ObjectName') || titulo, titulo_original: campo('ObjectName') || r?.titulo || titulo,
    artista: campo('Artist') || r?.artista || '', data: ano || campo('DateTimeOriginal') || r?.ano || '', tecnica: '', fontes: [idCommons],
  };
  let localizacao: DossieAutomatico['localizacao'] = { instituicao_proprietaria: null, fontes: [] };
  if (qid) ({ identidade, localizacao } = await dossieDoItem(qid, registro, buscar, identidade));
  else {
    // Sem item da obra: o artigo sobre o artista, pelo link que o Commons traz no campo "Artist".
    const artigo = artigoDoArtistaNoCommons(texto(obj(meta.Artist).value));
    if (artigo) {
      const q = obj(obj(await buscar(`https://${artigo.lingua}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(artigo.artigo)}`)).query);
      const corpo = texto(obj(lista(q.pages)[0]).extract);
      if (corpo) registro.registrar({ titulo: `Wikipédia (${artigo.lingua}) — ${artigo.artigo}`, url: `https://${artigo.lingua}.wikipedia.org/wiki/${encodeURIComponent(artigo.artigo.replace(/ /gu, '_'))}`, categoria: 'secundaria', arquivo: `auto-wp-artista-${artigo.lingua}.txt` }, corpo);
    }
  }
  const dossie: DossieAutomatico = { versao: 1, gerado_em: hoje, qid, identidade, localizacao, fontes: registro.fontes };
  await gravarDossie(pasta, dossie, registro.textos);
  return dossie;
}

// ---------------------------------------------------------------- obra enviada pela pessoa (J118)

/** O que a pessoa (ou o Codex, olhando a imagem) disse da obra. */
export interface IdentificacaoParaBusca { titulo: string; artista: string; ano?: string | null }

/** A identificação não achou nenhum item do Wikidata que seja obra desse artista com esse título. */
export class ObraNaoEncontrada extends Error {
  constructor(readonly identificacao: IdentificacaoParaBusca) {
    super(`Não achei «${identificacao.titulo}», de ${identificacao.artista}, no Wikidata.`);
    this.name = 'ObraNaoEncontrada';
  }
}

/** Minúsculas, sem acento nem pontuação, em palavras. */
export function palavras(valor: string): string[] {
  return valor.normalize('NFD').replace(/\p{M}+/gu, '').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter((p) => p !== '');
}
const VAZIAS = new Set(['a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'the', 'of', 'and', 'la', 'le', 'les', 'el', 'der', 'die', 'das', 'van', 'von', 'em', 'no', 'na', 'in']);
const significativas = (valor: string): string[] => palavras(valor).filter((p) => !VAZIAS.has(p));

/** Quanto do título procurado aparece num rótulo (0 a 1): as palavras significativas em comum. */
export function semelhancaDeTitulo(procurado: string, rotulo: string): number {
  const a = new Set(significativas(procurado)), b = new Set(significativas(rotulo));
  if (!a.size || !b.size) return palavras(procurado).join(' ') === palavras(rotulo).join(' ') ? 1 : 0;
  let comuns = 0; for (const p of a) if (b.has(p)) comuns += 1;
  return comuns / Math.max(a.size, Math.min(b.size, a.size + 2));
}

/** O artista informado é este criador? O sobrenome (última palavra significativa) tem de aparecer no nome. */
export function mesmoArtista(informado: string, criador: string): boolean {
  const a = significativas(informado), b = new Set(significativas(criador));
  if (!a.length || !b.size) return false;
  return b.has(a.at(-1)!) || a.every((p) => b.has(p));
}

/**
 * Procura o item da obra no Wikidata: busca textual por "título artista" e por rótulo (pt e en); fica com
 * o candidato cujo criador (P170) é o artista informado e cujo título mais se parece com o procurado; o
 * ano (P571) só desempata. Sem candidato com o mesmo artista e algum título em comum, `null`.
 */
export async function acharItemDaObra(id: IdentificacaoParaBusca, buscar: Buscar = buscarNaRede): Promise<string | null> {
  return (await acharItemDaObraComImagem(id, buscar))?.qid ?? null;
}

/** Como `acharItemDaObra`, e com a imagem do item (P18, o nome do arquivo no Commons), quando há. */
export async function acharItemDaObraComImagem(id: IdentificacaoParaBusca, buscar: Buscar = buscarNaRede): Promise<{ qid: string; arquivo_commons: string | null } | null> {
  const wd = 'https://www.wikidata.org/w/api.php?format=json';
  const candidatos: string[] = [];
  const juntar = (qids: unknown[]) => { for (const q of qids) if (typeof q === 'string' && /^Q\d+$/u.test(q) && !candidatos.includes(q)) candidatos.push(q); };
  const texto1 = obj(await buscar(`${wd}&formatversion=2&action=query&list=search&srnamespace=0&srlimit=10&srsearch=${encodeURIComponent(`${id.titulo} ${id.artista}`)}`));
  juntar(lista(obj(texto1.query).search).map((r) => obj(r).title));
  for (const lingua of ['pt', 'en']) {
    const porRotulo = obj(await buscar(`${wd}&action=wbsearchentities&type=item&limit=10&language=${lingua}&uselang=${lingua}&search=${encodeURIComponent(id.titulo)}`));
    juntar(lista(porRotulo.search).map((r) => obj(r).id));
  }
  if (!candidatos.length) return null;
  const entidades = obj(obj(await buscar(`${wd}&action=wbgetentities&props=labels|aliases|claims&ids=${candidatos.slice(0, 40).join('|')}`)).entities);
  const criadores = [...new Set(Object.values(entidades).flatMap((e) => valoresQ(obj(obj(e).claims), 'P170')))];
  const nomes = new Map<string, string[]>();
  for (let i = 0; i < criadores.length; i += 40) {
    const r = obj(obj(await buscar(`${wd}&action=wbgetentities&props=labels|aliases&ids=${criadores.slice(i, i + 40).join('|')}`)).entities);
    for (const [q, ent] of Object.entries(r)) nomes.set(q, rotulosEApelidos(obj(ent)));
  }
  const ano = /\d{3,4}/u.exec(id.ano ?? '')?.[0];
  let melhor: { qid: string; nota: number } | null = null;
  for (const qid of candidatos) {
    const e = obj(entidades[qid]);
    const claims = obj(e.claims);
    const doArtista = valoresQ(claims, 'P170').some((c) => (nomes.get(c) ?? []).some((n) => mesmoArtista(id.artista, n)));
    if (!doArtista) continue;
    const titulo = Math.max(0, ...rotulosEApelidos(e).map((r) => semelhancaDeTitulo(id.titulo, r)));
    if (titulo < 0.34) continue;
    const anoDoItem = Number(dataDe(claims));
    const nota = titulo + (ano && anoDoItem && Math.abs(anoDoItem - Number(ano)) <= 2 ? 0.25 : 0);
    if (!melhor || nota > melhor.nota) melhor = { qid, nota };
  }
  if (!melhor) return null;
  const p18 = texto(obj(obj(obj(lista(obj(obj(entidades[melhor.qid]).claims).P18)[0]).mainsnak).datavalue).value);
  return { qid: melhor.qid, arquivo_commons: p18 ? `File:${p18}` : null };
}

function rotulosEApelidos(e: Json): string[] {
  const labels = Object.values(obj(e.labels)).map((l) => texto(obj(l).value));
  const aliases = Object.values(obj(e.aliases)).flatMap((l) => lista(l).map((a) => texto(obj(a).value)));
  return [...new Set([...labels, ...aliases].filter((t) => t !== ''))];
}

/**
 * Dossiê de uma obra enviada pela pessoa (J118): não há página do Commons; a identificação acha o item
 * do Wikidata e dali seguem as afirmações e as Wikipédias, como no dossiê do Commons. Sem item,
 * `ObraNaoEncontrada` (a pessoa corrige o título ou o artista e tenta de novo).
 */
export async function buscarDossiePorIdentificacao(pasta: string, id: IdentificacaoParaBusca, buscar: Buscar = buscarNaRede, hoje = new Date().toISOString().slice(0, 10)): Promise<DossieAutomatico> {
  const qid = await acharItemDaObra(id, buscar);
  if (qid) return buscarDossiePorItem(pasta, qid, id, buscar, hoje);
  // V-T2: muita obra conhecida não tem item no Wikidata, mas tem a reprodução no Commons.
  const arquivo = await acharArquivoNoCommons(id, buscar);
  if (arquivo) return buscarDossieDoCommons(pasta, arquivo.arquivo, id, buscar, hoje);
  throw new ObraNaoEncontrada(id);
}

/** Dossiê de um item do Wikidata já achado (a identificação confirmada traz o Q-id). */
export async function buscarDossiePorItem(pasta: string, qid: string, id: IdentificacaoParaBusca, buscar: Buscar = buscarNaRede, hoje = new Date().toISOString().slice(0, 10)): Promise<DossieAutomatico> {
  const registro = novoRegistro(hoje);
  const reserva = { titulo: id.titulo, titulo_original: id.titulo, artista: id.artista, data: id.ano ?? '', tecnica: '', fontes: [] };
  const { identidade, localizacao } = await dossieDoItem(qid, registro, buscar, reserva);
  const dossie: DossieAutomatico = { versao: 1, gerado_em: hoje, qid, identidade, localizacao, fontes: registro.fontes };
  await gravarDossie(pasta, dossie, registro.textos);
  return dossie;
}

/** Dossiê a partir de uma página de arquivo do Commons (`File:…`) achada pela identificação. */
export function buscarDossieDoCommons(pasta: string, arquivo: string, id: IdentificacaoParaBusca, buscar: Buscar = buscarNaRede, hoje = new Date().toISOString().slice(0, 10)): Promise<DossieAutomatico> {
  const url = `https://commons.wikimedia.org/wiki/${encodeURIComponent(arquivo.replace(/ /gu, '_')).replace('%3A', ':')}`;
  return dossieDoArquivoDoCommons(pasta, arquivo, url, buscar, hoje, { reserva: id });
}

/** Um arquivo do Commons que reproduz a obra, com a miniatura para comparar com a imagem enviada. */
export interface ArquivoDoCommons { arquivo: string; miniatura: string | null; artista: string; titulo: string }

const IMAGEM_DO_COMMONS = /\.(jpe?g|png|tiff?|webp)$/iu;

/**
 * Procura no Commons (espaço de arquivos) por "título artista": fica com o arquivo de imagem cujo
 * autor (campo Artist) é o artista e cujo título (ObjectName, ou o nome do arquivo) mais se parece com o
 * procurado. Sem nenhum assim, `null`.
 */
export async function acharArquivoNoCommons(id: IdentificacaoParaBusca, buscar: Buscar = buscarNaRede): Promise<ArquivoDoCommons | null> {
  const r = obj(await buscar(`${API_DO_COMMONS}&action=query&list=search&srnamespace=6&srlimit=10&srsearch=${encodeURIComponent(`${id.titulo} ${id.artista}`)}`));
  const titulos = lista(obj(r.query).search).map((x) => texto(obj(x).title)).filter((t) => t.startsWith('File:') && IMAGEM_DO_COMMONS.test(t));
  if (!titulos.length) return null;
  const info = obj(await buscar(`${API_DO_COMMONS}&action=query&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=640&titles=${titulos.map(encodeURIComponent).join('|')}`));
  let melhor: (ArquivoDoCommons & { nota: number }) | null = null;
  for (const pagina of lista(obj(info.query).pages).map(obj)) {
    const arquivo = texto(pagina.title);
    const ii = obj(lista(pagina.imageinfo)[0]);
    const meta = obj(ii.extmetadata);
    const artista = semHtml(texto(obj(meta.Artist).value));
    const nomeDoArquivo = arquivo.replace(/^File:/u, '').replace(IMAGEM_DO_COMMONS, '');
    if (!mesmoArtista(id.artista, artista || nomeDoArquivo)) continue;
    const objeto = semHtml(texto(obj(meta.ObjectName).value));
    const nota = Math.max(semelhancaDeTitulo(id.titulo, objeto), semelhancaDeTitulo(id.titulo, nomeDoArquivo));
    if (nota < 0.5) continue;
    if (!melhor || nota > melhor.nota) melhor = { arquivo, miniatura: texto(ii.thumburl) || texto(ii.url) || null, artista, titulo: objeto || nomeDoArquivo, nota };
  }
  return melhor ? { arquivo: melhor.arquivo, miniatura: melhor.miniatura, artista: melhor.artista, titulo: melhor.titulo } : null;
}

/** A miniatura (640 px) de um arquivo do Commons, para comparar com a imagem enviada. */
export async function miniaturaDoCommons(arquivo: string, buscar: Buscar = buscarNaRede): Promise<string | null> {
  const info = obj(await buscar(`${API_DO_COMMONS}&action=query&prop=imageinfo&iiprop=url&iiurlwidth=640&titles=${encodeURIComponent(arquivo)}`));
  const ii = obj(lista(obj(lista(obj(info.query).pages)[0]).imageinfo)[0]);
  return texto(ii.thumburl) || texto(ii.url) || null;
}

/** Campos da imagem: da referência, quando há; senão de `imagem.json` (obra nova, sem curadoria). */
function imagemBase(obra: ObraDoAcervo, imagem: Json): { url: string; largura: number; altura: number } {
  if (obra.referencia) return obra.referencia.imagem;
  const largura = imagem.largura, altura = imagem.altura;
  if (typeof largura !== 'number' || typeof altura !== 'number') throw new Error(`imagem_json_sem_dimensoes: ${obra.slug}`);
  return { url: `/arte/${obra.slug}.jpg`, largura, altura };
}

/**
 * A partir do dossiê automático já buscado: o dossiê que vai ao Codex e o modelo-base (identidade,
 * imagem, localização, fontes) que a montagem completa. Não lê nada da referência curada.
 */
export async function dossieEBaseAutomaticos(obra: ObraDoAcervo): Promise<{ dossie: DossieDaObra; base: ModeloDaObraV1 }> {
  const auto = JSON.parse(await readFile(join(obra.pasta, 'dossie-auto.json'), 'utf8')) as DossieAutomatico;
  const imagem = obj(JSON.parse(await readFile(join(obra.pasta, 'imagem.json'), 'utf8')));
  const i = auto.identidade;
  const nada = (v: string) => v || 'não informado';
  const afirmacaoIdentidade = `${nada(i.titulo)} é uma obra de ${nada(i.artista)}${i.data ? `, de ${i.data}` : ''}${i.tecnica ? `, em ${i.tecnica}` : ''}.`;
  const idIdentidade = idDeFonte(`identidade/${obra.slug}`);
  const fontes: DossieDaObra['fontes'] = [];
  for (const f of auto.fontes) fontes.push({ id: f.id, titulo: f.titulo, url: f.url, categoria: f.categoria, texto: (await readFile(join(obra.pasta, 'fontes', f.arquivo), 'utf8')).slice(0, TETO_POR_FONTE), arquivo: f.arquivo });
  // A reprodução vem do Commons; numa obra enviada pela pessoa (J118) não há Commons, e a imagem se
  // apoia no item do catálogo que identificou a obra.
  const commons = auto.fontes.find((f) => f.arquivo === 'auto-commons.txt') ?? auto.fontes.find((f) => f.arquivo === 'auto-wikidata.txt') ?? auto.fontes[0];
  if (!commons) throw new Error(`dossie_sem_fontes: ${obra.slug}`);
  const base: ModeloDaObraV1 = {
    versao: 1, id: idDeFonte(`base/${obra.slug}`), revisao: 1,
    identidade: { titulo: nada(i.titulo), titulo_original: nada(i.titulo_original), artista: nada(i.artista), data: nada(i.data), tecnica: nada(i.tecnica), afirmacoes: [idIdentidade] },
    imagem: { ...imagemBase(obra, imagem), sha256: obra.sha256, credito: texto(imagem.credito) || obra.referencia?.imagem.credito || commons.titulo, fonte_id: commons.id },
    localizacao: { instituicao_proprietaria: auto.localizacao.instituicao_proprietaria, localizacao_conhecida: null, atualmente_exposto: null, sala: null, verificado_em: auto.gerado_em, fontes: auto.localizacao.fontes },
    fontes: auto.fontes.map((f) => ({ id: f.id, titulo: f.titulo, url: f.url, categoria: f.categoria, consultado_em: f.consultado_em })),
    regioes: [], afirmacoes: [{ id: idIdentidade, texto: afirmacaoIdentidade, tipo: 'fato', confianca: 'media', evidencia: 'Dados do Wikidata e do Commons, sem conferência humana.', fontes: i.fontes, regioes: [], apoios: [], proveniencia: { autor: 'ia', metodo: 'dossie-automatico/1' } }],
    estudo: [], limites: ['Dossiê automático (Wikidata, Wikipédia, Commons), sem curadoria humana.'],
  };
  const dossie: DossieDaObra = {
    identidade: { titulo: base.identidade.titulo, titulo_original: base.identidade.titulo_original, artista: base.identidade.artista, data: base.identidade.data, tecnica: base.identidade.tecnica, afirmacao: afirmacaoIdentidade, fontes: i.fontes },
    localizacao: { instituicao_proprietaria: auto.localizacao.instituicao_proprietaria, localizacao_conhecida: null },
    fontes, pesquisa: [], apoio: [],
  };
  return { dossie, base };
}
