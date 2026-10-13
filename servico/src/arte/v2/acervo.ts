/**
 * Leitura de uma obra do acervo de arquivos (`<raiz do acervo>/<slug>/`) e montagem do dossiê
 * de entrada do algoritmo v2. O dossiê deriva da referência (identidade, fontes e só as afirmações
 * curadas de tipo fato/interpretação documentada, como no v1) e do texto das fontes em `fontes/`.
 * Observações, regiões e inferências da referência nunca entram: são o que a geração tem de achar.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { FonteDaObra, ModeloDaObraV1 } from '@margem/contratos';
import { validarModeloDaObra } from '../../../../contratos/src/validadores.js';
import { conferirModeloDaObra } from '../../../../core/src/arte.js';
import { raizDoAcervo as raizDasRotas } from '../acervo.js';

/** A mesma raiz das rotas (`MARGEM_ARTE_DIR`, senão `<MARGEM_DADOS>/arte/obras`): na imagem Docker, `/dados/arte/obras`. */
export function raizDoAcervo(): string { return raizDasRotas(); }

export interface ObraDoAcervo {
  slug: string;
  pasta: string;
  imagem: string;
  sha256: string;
  /** Análise de referência (`esperado.modelo.json`); `null` numa obra nova, que só roda com o dossiê automático. */
  referencia: ModeloDaObraV1 | null;
  /** Texto de cada arquivo de `fontes/` (menos os `auto-*`, do dossiê automático), pelo nome do arquivo. */
  textos: Map<string, string>;
}

export async function lerObra(slug: string, raiz = raizDoAcervo()): Promise<ObraDoAcervo> {
  const pasta = join(raiz, slug);
  const imagem = join(pasta, 'imagem.jpg');
  if (!existsSync(imagem)) throw new Error(`obra_sem_imagem: ${slug}`);
  const sha256 = createHash('sha256').update(await readFile(imagem)).digest('hex');
  let referencia: ModeloDaObraV1 | null = null;
  if (existsSync(join(pasta, 'esperado.modelo.json'))) {
    const bruto: unknown = JSON.parse(await readFile(join(pasta, 'esperado.modelo.json'), 'utf8'));
    if (!validarModeloDaObra(bruto)) throw new Error(`referencia_fora_do_contrato: ${slug}`);
    const erros = conferirModeloDaObra(bruto);
    if (erros.length) throw new Error(`referencia_rejeitada: ${erros.join(',')}`);
    if (bruto.imagem.sha256 !== sha256) throw new Error('imagem_divergente');
    referencia = bruto;
  }
  const textos = new Map<string, string>();
  const pastaFontes = join(pasta, 'fontes');
  if (existsSync(pastaFontes)) {
    for (const nome of (await readdir(pastaFontes)).sort()) {
      if ((nome.endsWith('.txt') || nome.endsWith('.md')) && !nome.startsWith('auto-')) textos.set(nome, await readFile(join(pastaFontes, nome), 'utf8'));
    }
  }
  return { slug, pasta, imagem, sha256, referencia, textos };
}

/** Teto de caracteres por fonte e do conjunto, para o dossiê caber no prompt sem diluir a atenção. */
export const TETO_POR_FONTE = 14_000;
export const TETO_DO_DOSSIE = 60_000;

export interface FonteDoDossie extends Pick<FonteDaObra, 'id' | 'titulo' | 'url' | 'categoria'> {
  /** Texto da fonte (arquivo em `fontes/`), cortado no teto; null quando não há texto salvo. */
  texto: string | null;
  arquivo: string | null;
}

export interface DossieDaObra {
  identidade: { titulo: string; titulo_original: string; artista: string; data: string; tecnica: string; afirmacao: string; fontes: string[] };
  localizacao: { instituicao_proprietaria: string | null; localizacao_conhecida: string | null };
  fontes: FonteDoDossie[];
  /** Afirmações curadas fato/interpretação documentada (só texto, tipo, evidência e fontes). */
  pesquisa: { texto: string; tipo: string; evidencia: string; fontes: string[] }[];
  /** Textos de `fontes/` que não se ligam a nenhuma fonte: contexto, nunca citáveis. */
  apoio: { arquivo: string; texto: string }[];
}

function semBarra(url: string): string { try { return decodeURI(url).replace(/\/$/u, ''); } catch { return url.replace(/\/$/u, ''); } }

/**
 * Liga cada arquivo de `fontes/` a uma fonte: `<fonte_id>.txt`; ou o arquivo que cita a URL da fonte
 * (ou o Q-id do Wikidata) nas primeiras linhas; ou, por fim, o nome (wikipedia/wp + idioma, wikidata).
 */
export function ligarTextosAsFontes(fontes: FonteDaObra[], textos: Map<string, string>): Map<string, string> {
  const ligacao = new Map<string, string>();
  const livres = new Set(textos.keys());
  const tomar = (fonte: string, arquivo: string) => { ligacao.set(fonte, arquivo); livres.delete(arquivo); };
  for (const f of fontes) for (const ext of ['.txt', '.md']) if (livres.has(f.id + ext)) tomar(f.id, f.id + ext);
  for (const f of fontes) {
    if (ligacao.has(f.id)) continue;
    const alvo = semBarra(f.url);
    const qid = /wikidata\.org\/wiki\/(Q\d+)/u.exec(f.url)?.[1];
    const arquivo = [...livres].find((nome) => {
      const cabeca = semBarra((textos.get(nome) ?? '').slice(0, 800));
      return cabeca.includes(alvo) || (qid !== undefined && /wikidata/iu.test(nome) && cabeca.includes(qid));
    });
    if (arquivo) tomar(f.id, arquivo);
  }
  for (const f of fontes) {
    if (ligacao.has(f.id)) continue;
    const wiki = /^https:\/\/([a-z]{2})\.wikipedia\.org\//u.exec(f.url)?.[1];
    const wikidata = /wikidata\.org/u.test(f.url);
    const arquivo = [...livres].find((nome) => {
      const n = nome.toLowerCase();
      if (wikidata) return n.includes('wikidata');
      if (!wiki || !/(wiki|wp)/u.test(n) || n.includes('wikidata')) return false;
      const artigoDoArtista = /artista|autor|pintor/u.test(n);
      const tituloDoArtista = /artista|pintor|autor|biograf/iu.test(f.titulo);
      return new RegExp(`(^|[^a-z])${wiki}([^a-z]|$)`, 'u').test(n) && artigoDoArtista === tituloDoArtista;
    });
    if (arquivo) tomar(f.id, arquivo);
  }
  return ligacao;
}

export function montarDossie(obra: ObraDoAcervo): DossieDaObra {
  const r = obra.referencia;
  if (!r) throw new Error(`obra_sem_referencia: ${obra.slug} (use o dossiê automático)`);
  const ligacao = ligarTextosAsFontes(r.fontes, obra.textos);
  let restante = TETO_DO_DOSSIE;
  const cortar = (texto: string): string => {
    const t = texto.trim().slice(0, Math.min(TETO_POR_FONTE, Math.max(0, restante)));
    restante -= t.length; return t;
  };
  const fontes: FonteDoDossie[] = r.fontes.map((f) => {
    const arquivo = ligacao.get(f.id) ?? null;
    const texto = arquivo ? cortar(obra.textos.get(arquivo) ?? '') : null;
    return { id: f.id, titulo: f.titulo, url: f.url, categoria: f.categoria, texto: texto || null, arquivo };
  });
  const ligados = new Set(ligacao.values());
  const apoio = [...obra.textos].filter(([nome]) => !ligados.has(nome)).map(([arquivo, texto]) => ({ arquivo, texto: cortar(texto) })).filter((a) => a.texto);
  const identidade = r.afirmacoes.find((a) => r.identidade.afirmacoes.includes(a.id));
  return {
    identidade: { titulo: r.identidade.titulo, titulo_original: r.identidade.titulo_original, artista: r.identidade.artista, data: r.identidade.data, tecnica: r.identidade.tecnica, afirmacao: identidade?.texto ?? '', fontes: identidade?.fontes ?? [] },
    localizacao: { instituicao_proprietaria: r.localizacao.instituicao_proprietaria, localizacao_conhecida: r.localizacao.localizacao_conhecida },
    fontes,
    pesquisa: r.afirmacoes.filter((a) => (a.tipo === 'fato' || a.tipo === 'interpretacao_documentada') && !r.identidade.afirmacoes.includes(a.id))
      .map((a) => ({ texto: a.texto, tipo: a.tipo, evidencia: a.evidencia, fontes: a.fontes })),
    apoio,
  };
}

/** O que uma citação de cada fonte pode reproduzir: o texto salvo e o que a pesquisa curada diz dela. */
export function corpusPorFonte(dossie: DossieDaObra): Map<string, string> {
  const corpus = new Map<string, string>();
  for (const f of dossie.fontes) corpus.set(f.id, f.texto ?? '');
  for (const p of dossie.pesquisa) for (const id of p.fontes) corpus.set(id, `${corpus.get(id) ?? ''}\n${p.texto}\n${p.evidencia}`);
  for (const id of dossie.identidade.fontes) corpus.set(id, `${corpus.get(id) ?? ''}\n${dossie.identidade.afirmacao}`);
  return corpus;
}
