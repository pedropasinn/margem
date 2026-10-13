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

export async function buscarDossieAutomatico(pasta: string, buscar: Buscar = buscarNaRede, hoje = new Date().toISOString().slice(0, 10)): Promise<DossieAutomatico> {
  const imagem = obj(JSON.parse(await readFile(join(pasta, 'imagem.json'), 'utf8')));
  const origem = texto(imagem.origem_url);
  const titulo = decodeURIComponent(/\/wiki\/(File:.+)$/u.exec(origem)?.[1] ?? '');
  if (!titulo) throw new Error('imagem_json_sem_pagina_do_commons');
  const fontes: FonteAutomatica[] = [];
  const textos = new Map<string, string>();
  const registrar = (f: Omit<FonteAutomatica, 'id' | 'consultado_em'>, corpo: string): string => {
    const id = idDeFonte(f.url);
    fontes.push({ ...f, id, consultado_em: hoje });
    textos.set(f.arquivo, `# ${f.titulo}\n# ${f.url}\n# consultado em ${hoje} (dossiê automático)\n\n${corpo.trim()}\n`);
    return id;
  };

  // Commons: metadados do arquivo e item do Wikidata.
  const api = 'https://commons.wikimedia.org/w/api.php?format=json&formatversion=2';
  const pagina = obj(lista(obj(obj(await buscar(`${api}&action=query&prop=imageinfo&iiprop=extmetadata&titles=${encodeURIComponent(titulo)}`)).query).pages)[0]);
  const meta = obj(obj(lista(pagina.imageinfo)[0]).extmetadata);
  const campo = (k: string) => semHtml(texto(obj(meta[k]).value));
  const commons = ['ObjectName', 'Artist', 'DateTimeOriginal', 'ImageDescription', 'Credit', 'LicenseShortName'].map((k) => `${k}: ${campo(k)}`).filter((l) => !l.endsWith(': ')).join('\n');
  const idCommons = registrar({ titulo: `Wikimedia Commons — ${titulo}`, url: origem, categoria: 'secundaria', arquivo: 'auto-commons.txt' }, commons);
  let qid: string | null = null;
  if (typeof pagina.pageid === 'number') {
    const estruturado = obj(obj(obj(await buscar(`${api}&action=wbgetentities&ids=M${String(pagina.pageid)}`)).entities)[`M${String(pagina.pageid)}`]);
    qid = valoresQ(obj(estruturado.statements), 'P6243')[0] ?? null;
  }
  qid ??= /wikidata\.org\/wiki\/(Q\d+)/u.exec(JSON.stringify(meta))?.[1] ?? null;
  // Último recurso: o item do Wikidata anotado na curadoria (`imagem.json` → `wikidata`).
  qid ??= /^Q\d+$/u.test(texto(imagem.wikidata)) ? texto(imagem.wikidata) : null;

  let identidade: DossieAutomatico['identidade'] = { titulo: campo('ObjectName') || titulo, titulo_original: campo('ObjectName') || titulo, artista: campo('Artist'), data: campo('DateTimeOriginal'), tecnica: '', fontes: [idCommons] };
  let localizacao: DossieAutomatico['localizacao'] = { instituicao_proprietaria: null, fontes: [] };
  if (qid) {
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
    const idWd = registrar({ titulo: `Wikidata — ${qid}, ${rotuloDe(e)}`, url, categoria: 'catalogo', arquivo: 'auto-wikidata.txt' }, linhas.join('\n'));
    identidade = { titulo: rotuloDe(e) || identidade.titulo, titulo_original: tituloOriginal(claims) || rotuloDe(e, ['de', 'fr', 'nl', 'es', 'it', 'ja', 'en']) || identidade.titulo_original, artista: nomes('P170').join(', ') || identidade.artista, data: dataDe(claims) || identidade.data, tecnica: nomes('P186').join(', '), fontes: [idWd] };
    localizacao = { instituicao_proprietaria: nomes('P195')[0] ?? null, fontes: nomes('P195').length ? [idWd] : [] };
    const sitelinks = obj(e.sitelinks);
    for (const lingua of ['pt', 'en']) {
      const artigo = texto(obj(sitelinks[`${lingua}wiki`]).title);
      if (!artigo) continue;
      const q = obj(obj(await buscar(`https://${lingua}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(artigo)}`)).query);
      const corpo = texto(obj(lista(q.pages)[0]).extract);
      if (corpo) registrar({ titulo: `Wikipédia (${lingua}) — ${artigo}`, url: `https://${lingua}.wikipedia.org/wiki/${encodeURIComponent(artigo.replace(/ /gu, '_'))}`, categoria: 'secundaria', arquivo: `auto-wp-${lingua}.txt` }, corpo);
    }
  }
  const dossie: DossieAutomatico = { versao: 1, gerado_em: hoje, qid, identidade, localizacao, fontes };
  await mkdir(join(pasta, 'fontes'), { recursive: true });
  for (const [arquivo, corpo] of textos) await writeFile(join(pasta, 'fontes', arquivo), corpo);
  await writeFile(join(pasta, 'dossie-auto.json'), `${JSON.stringify(dossie, null, 2)}\n`);
  return dossie;
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
  const commons = auto.fontes.find((f) => f.arquivo === 'auto-commons.txt')!;
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
