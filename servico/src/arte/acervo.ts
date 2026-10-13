/**
 * O acervo de quadros em arquivos (`docs/arte/QUADROS-PLANO.md`): `<raiz>/<slug>/` com a imagem, a análise
 * de referência (`esperado.*`), as gerações do algoritmo (`geracoes/<rotulo>/`), a escolha publicada
 * (`publicado.json`) e as narrações (`audio/<rotulo>/`). Somente leitura: nada aqui escreve no acervo, a
 * não ser a miniatura em cache (`miniaturas.ts`).
 *
 * Cada arquivo é conferido ao ler (contrato + regras do núcleo + hash da imagem). Uma análise inválida
 * fica de fora com um aviso no log; uma obra sem nenhuma análise válida também. As fixtures do J94
 * (`fixtures/arte/`) entram quando o acervo não tem a obra de mesmo slug.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnaliseCurtaDaObraV1, ModeloDaObraV1 } from '@margem/contratos';
import { validarAnaliseCurtaDaObra, validarModeloDaObra } from '../../../contratos/src/validadores.js';
import { conferirAnaliseCurta, conferirModeloDaObra } from '../../../core/src/arte.js';
import { raizDeDados } from '../dados.js';

/** Raiz do acervo: `MARGEM_ARTE_DIR`, senão `<dados>/arte/obras` (`~/dados/margem/arte/obras`). */
export function raizDoAcervo(): string {
  const bruto = process.env.MARGEM_ARTE_DIR;
  return bruto !== undefined && bruto.trim() !== '' ? bruto : join(raizDeDados(), 'arte/obras');
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const ROTULO = /^[a-z0-9][a-z0-9._-]{0,79}$/;
export const ehSlug = (valor: string): boolean => SLUG.test(valor);
export const ehRotulo = (valor: string): boolean => ROTULO.test(valor);

/** `imagem.json`: de onde veio a reprodução e sob que licença. */
export interface InfoDaImagem {
  origem_url: string | null; arquivo_url: string | null; licenca: string | null; credito: string | null;
  sha256: string | null; largura: number | null; altura: number | null; baixado_em: string | null;
}

/** Narração de uma análise (`audio/<rotulo>/manifesto.json`). */
export interface PalavraNarrada { texto: string; inicio_s: number; fim_s: number }
export interface BatidaNarrada { indice: number; inicio_s: number; fim_s: number; texto: string; palavras: PalavraNarrada[] }
export interface ManifestoDaNarracao {
  versao: 1; analise: string; curta_sha256: string;
  voz: { perfil: string; modelo: string; seed: number };
  arquivo: string; duracao_s: number; batidas: BatidaNarrada[];
}

export interface AnaliseNoAcervo {
  /** `esperado` ou o nome da pasta em `geracoes/`. */
  rotulo: string;
  titulo: string;
  origem: 'esperado' | 'geracao';
  modelo: ModeloDaObraV1;
  curta: AnaliseCurtaDaObraV1;
  /** SHA-256 dos bytes do `curta.json` (o manifesto da narração aponta para ele). */
  curta_sha256: string;
  atualizada_em: string;
  /** Pasta `audio/<rotulo>/` com manifesto válido e coerente com a curta; `null` sem narração. */
  audio: string | null;
}

export interface ObraNoAcervo {
  slug: string;
  origem: 'acervo' | 'fixture';
  pasta: string | null;
  imagem: string;
  info: InfoDaImagem | null;
  analises: AnaliseNoAcervo[];
  /** O rótulo da análise que o app mostra por padrão. */
  publicada: string;
  adicionado_em: string;
}

type Aviso = (mensagem: string) => void;
const avisados = new Set<string>();
/** Cada aviso vai ao log uma vez por processo (a lista é relida a cada pedido). */
const avisoPadrao: Aviso = (mensagem) => {
  if (avisados.has(mensagem)) return;
  if (avisados.size > 2000) avisados.clear();
  avisados.add(mensagem);
  console.warn(`[arte] ${mensagem}`);
};

/**
 * Título legível de uma análise: `esperado` → "Referência"; `v2-20260930-a` → "Codex v2 · 30/09 · a";
 * `v1-j94` → "Codex v1 · J94"; outro rótulo → as palavras dele (`codex-v2` → "Codex v2").
 */
export function tituloDaAnalise(rotulo: string): string {
  if (rotulo === 'esperado') return 'Referência';
  const versao = /^v(\d+)(?:[-_.](.+))?$/.exec(rotulo);
  if (versao) {
    const resto = (versao[2] ?? '').split(/[-_.]+/).filter((p) => p !== '').map((p) => {
      const data = /^(\d{4})(\d{2})(\d{2})$/.exec(p);
      if (data) return `${data[3]!}/${data[2]!}`;
      return /^[a-z]+\d+$/.test(p) ? p.toLocaleUpperCase('pt-BR') : p;
    });
    return [`Codex v${versao[1]!}`, ...resto].join(' · ');
  }
  const partes = rotulo.split(/[-_.]+/).filter((p) => p !== '');
  return partes.map((p, i) => (i === 0 ? p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1) : p)).join(' ');
}

const shas = new Map<string, { chave: string; sha: string }>();
async function shaDoArquivo(caminho: string): Promise<string> {
  const info = await stat(caminho);
  const chave = `${String(info.mtimeMs)}:${String(info.size)}`;
  const guardado = shas.get(caminho);
  if (guardado?.chave === chave) return guardado.sha;
  const sha = createHash('sha256').update(await readFile(caminho)).digest('hex');
  shas.set(caminho, { chave, sha });
  return sha;
}

async function lerJson(caminho: string): Promise<unknown> {
  return JSON.parse(await readFile(caminho, 'utf8')) as unknown;
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const numero = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const objeto = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null);

/** O próprio texto quando é uma data legível; senão `null`. */
function dataValida(bruto: string | null | undefined): string | null {
  return bruto && !Number.isNaN(Date.parse(bruto)) ? bruto : null;
}

export function lerInfoDaImagem(bruto: unknown): InfoDaImagem | null {
  const o = objeto(bruto);
  if (!o) return null;
  return {
    origem_url: texto(o.origem_url), arquivo_url: texto(o.arquivo_url), licenca: texto(o.licenca), credito: texto(o.credito),
    sha256: texto(o.sha256), largura: numero(o.largura), altura: numero(o.altura), baixado_em: texto(o.baixado_em),
  };
}

/** Confere o manifesto da narração; devolve a lista de problemas (vazia quando vale). */
export function conferirManifesto(bruto: unknown, curta: AnaliseCurtaDaObraV1): { manifesto: ManifestoDaNarracao | null; erros: string[] } {
  const o = objeto(bruto);
  const erros: string[] = [];
  if (!o) return { manifesto: null, erros: ['manifesto_nao_e_objeto'] };
  const voz = objeto(o.voz);
  if (o.versao !== 1) erros.push('versao');
  if (!texto(o.analise)) erros.push('analise');
  if (typeof o.curta_sha256 !== 'string') erros.push('curta_sha256');
  if (!voz || !texto(voz.perfil) || !texto(voz.modelo) || numero(voz.seed) === null) erros.push('voz');
  const arquivo = texto(o.arquivo);
  if (!arquivo || arquivo.includes('/') || arquivo.includes('\\') || arquivo.startsWith('.') || !/\.(mp3|m4a|ogg|wav)$/i.test(arquivo)) erros.push('arquivo');
  const duracao = numero(o.duracao_s);
  if (duracao === null || duracao <= 0) erros.push('duracao_s');
  const batidas = Array.isArray(o.batidas) ? o.batidas : null;
  if (!batidas) erros.push('batidas');
  else {
    if (batidas.length !== curta.batidas.length) erros.push('batidas_diferentes_da_curta');
    let anterior = -1;
    batidas.forEach((b, i) => {
      const ob = objeto(b);
      const inicio = numero(ob?.inicio_s); const fim = numero(ob?.fim_s);
      if (!ob || ob.indice !== i || inicio === null || fim === null || fim < inicio || inicio < anterior - 1e-6 || typeof ob.texto !== 'string' || !Array.isArray(ob.palavras)) { erros.push(`batida_${String(i)}`); return; }
      anterior = fim;
      for (const p of ob.palavras as unknown[]) {
        const op = objeto(p);
        const pi = numero(op?.inicio_s); const pf = numero(op?.fim_s);
        if (!op || typeof op.texto !== 'string' || pi === null || pf === null || pf < pi) { erros.push(`palavra_da_batida_${String(i)}`); break; }
      }
    });
  }
  const permitidos = new Set(['versao', 'analise', 'curta_sha256', 'voz', 'arquivo', 'duracao_s', 'batidas']);
  for (const chave of Object.keys(o)) if (!permitidos.has(chave)) erros.push(`campo_desconhecido:${chave}`);
  return { manifesto: erros.length ? null : o as unknown as ManifestoDaNarracao, erros };
}

/** Lê e confere `audio/<rotulo>/manifesto.json`; `null` (com aviso) se faltar algo. */
export async function lerManifesto(obra: ObraNoAcervo, analise: AnaliseNoAcervo, aviso: Aviso = avisoPadrao): Promise<ManifestoDaNarracao | null> {
  if (!obra.pasta) return null;
  const pasta = join(obra.pasta, 'audio', analise.rotulo);
  const caminho = join(pasta, 'manifesto.json');
  if (!existsSync(caminho)) return null;
  try {
    const { manifesto, erros } = conferirManifesto(await lerJson(caminho), analise.curta);
    if (!manifesto) { aviso(`${obra.slug}/audio/${analise.rotulo}: manifesto recusado (${erros.join(', ')})`); return null; }
    if (!existsSync(join(pasta, manifesto.arquivo))) { aviso(`${obra.slug}/audio/${analise.rotulo}: ${manifesto.arquivo} ausente`); return null; }
    if (manifesto.curta_sha256 !== analise.curta_sha256) aviso(`${obra.slug}/audio/${analise.rotulo}: curta_sha256 não confere com o curta.json atual (a narração pode estar desatualizada)`);
    return manifesto;
  } catch (erro) {
    aviso(`${obra.slug}/audio/${analise.rotulo}: ${erro instanceof Error ? erro.message : String(erro)}`);
    return null;
  }
}

async function lerAnalise(slug: string, rotulo: string, origem: AnaliseNoAcervo['origem'], caminhos: { modelo: string; curta: string }, shaDaImagem: string, aviso: Aviso): Promise<Omit<AnaliseNoAcervo, 'audio'> | null> {
  const nome = `${slug}/${origem === 'esperado' ? 'esperado' : `geracoes/${rotulo}`}`;
  try {
    if (!existsSync(caminhos.modelo) || !existsSync(caminhos.curta)) { aviso(`${nome}: modelo ou curta ausente`); return null; }
    const modelo = await lerJson(caminhos.modelo);
    if (!validarModeloDaObra(modelo)) { aviso(`${nome}: modelo fora do contrato ${JSON.stringify(validarModeloDaObra.errors?.slice(0, 2))}`); return null; }
    const bytesDaCurta = await readFile(caminhos.curta);
    const curta: unknown = JSON.parse(bytesDaCurta.toString('utf8'));
    if (!validarAnaliseCurtaDaObra(curta)) { aviso(`${nome}: curta fora do contrato ${JSON.stringify(validarAnaliseCurtaDaObra.errors?.slice(0, 2))}`); return null; }
    if (modelo.imagem.sha256 !== shaDaImagem) { aviso(`${nome}: imagem.sha256 do modelo não é a da imagem do acervo`); return null; }
    const erros = [...conferirModeloDaObra(modelo), ...conferirAnaliseCurta(curta, modelo)];
    if (erros.length) { aviso(`${nome}: regras recusadas (${erros.join(', ')})`); return null; }
    const quando = (await stat(caminhos.curta)).mtime.toISOString();
    return { rotulo, titulo: tituloDaAnalise(rotulo), origem, modelo, curta, curta_sha256: createHash('sha256').update(bytesDaCurta).digest('hex'), atualizada_em: quando };
  } catch (erro) {
    aviso(`${nome}: ${erro instanceof Error ? erro.message : String(erro)}`);
    return null;
  }
}

/** Uma obra do acervo, ou `null` (com aviso) se não houver imagem ou nenhuma análise válida. */
export async function lerObraDoAcervo(raiz: string, slug: string, aviso: Aviso = avisoPadrao): Promise<ObraNoAcervo | null> {
  if (!ehSlug(slug)) return null;
  const pasta = join(raiz, slug);
  const imagem = join(pasta, 'imagem.jpg');
  if (!existsSync(imagem)) { aviso(`${slug}: imagem.jpg ausente`); return null; }
  const sha = await shaDoArquivo(imagem);
  let info: InfoDaImagem | null = null;
  if (existsSync(join(pasta, 'imagem.json'))) {
    try { info = lerInfoDaImagem(await lerJson(join(pasta, 'imagem.json'))); } catch { aviso(`${slug}: imagem.json ilegível`); }
    if (info?.sha256 && info.sha256 !== sha) aviso(`${slug}: imagem.json traz outro sha256`);
  }
  const candidatas: Promise<Omit<AnaliseNoAcervo, 'audio'> | null>[] = [];
  if (existsSync(join(pasta, 'esperado.modelo.json'))) {
    candidatas.push(lerAnalise(slug, 'esperado', 'esperado', { modelo: join(pasta, 'esperado.modelo.json'), curta: join(pasta, 'esperado.curta.json') }, sha, aviso));
  }
  const geracoes = existsSync(join(pasta, 'geracoes')) ? (await readdir(join(pasta, 'geracoes'), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];
  for (const rotulo of geracoes) {
    if (!ehRotulo(rotulo) || rotulo === 'esperado') { aviso(`${slug}/geracoes/${rotulo}: rótulo inválido`); continue; }
    const base = join(pasta, 'geracoes', rotulo);
    if (!existsSync(join(base, 'modelo.json'))) continue; // geração em curso
    candidatas.push(lerAnalise(slug, rotulo, 'geracao', { modelo: join(base, 'modelo.json'), curta: join(base, 'curta.json') }, sha, aviso));
  }
  const analises = (await Promise.all(candidatas)).filter((a): a is Omit<AnaliseNoAcervo, 'audio'> => a !== null).map((a) => ({ ...a, audio: null as string | null }));
  if (!analises.length) { aviso(`${slug}: nenhuma análise válida; a obra fica fora da lista`); return null; }
  const obra: ObraNoAcervo = {
    slug, origem: 'acervo', pasta, imagem, info, analises, publicada: '',
    // `baixado_em` vem de um arquivo escrito à mão ou por script: só vale se for uma data de verdade
    // (a web faz `new Date(...).toISOString()` e uma data inválida derruba a lista inteira).
    adicionado_em: dataValida(info?.baixado_em) ?? (await stat(imagem)).mtime.toISOString(),
  };
  for (const analise of analises) {
    const manifesto = await lerManifesto(obra, analise, aviso);
    if (manifesto) analise.audio = join(pasta, 'audio', analise.rotulo);
  }
  obra.publicada = await escolherPublicada(obra, aviso);
  return obra;
}

/** `publicado.json`; sem ele, a geração mais recente; sem geração, a referência. */
async function escolherPublicada(obra: ObraNoAcervo, aviso: Aviso): Promise<string> {
  const caminho = obra.pasta ? join(obra.pasta, 'publicado.json') : null;
  if (caminho && existsSync(caminho)) {
    try {
      const bruto = objeto(await lerJson(caminho));
      const alvo = texto(bruto?.analise);
      const rotulo = alvo === 'esperado' ? 'esperado' : alvo?.startsWith('geracoes/') ? alvo.slice('geracoes/'.length) : null;
      if (rotulo && obra.analises.some((a) => a.rotulo === rotulo)) return rotulo;
      aviso(`${obra.slug}: publicado.json aponta para uma análise ausente ou inválida (${String(alvo)})`);
    } catch { aviso(`${obra.slug}: publicado.json ilegível`); }
  }
  const geracoes = obra.analises.filter((a) => a.origem === 'geracao').sort((a, b) => b.atualizada_em.localeCompare(a.atualizada_em));
  return geracoes[0]?.rotulo ?? obra.analises[0]!.rotulo;
}

const FIXTURES = ['educacao', 'tolo'];
async function lerFixture(nome: string, aviso: Aviso): Promise<ObraNoAcervo | null> {
  const caminho = (relativo: string): string => fileURLToPath(new URL(`../../../${relativo}`, import.meta.url));
  const imagem = caminho(`web/public/arte/${nome}.jpg`);
  if (!existsSync(imagem)) return null;
  const sha = await shaDoArquivo(imagem);
  const analise = await lerAnalise(nome, 'esperado', 'esperado', { modelo: caminho(`fixtures/arte/${nome}.modelo.json`), curta: caminho(`fixtures/arte/${nome}.curta.json`) }, sha, aviso);
  if (!analise) return null;
  return { slug: nome, origem: 'fixture', pasta: null, imagem, info: null, analises: [{ ...analise, audio: null }], publicada: 'esperado', adicionado_em: (await stat(imagem)).mtime.toISOString() };
}

export interface OpcoesDoAcervo { raiz?: string; fixtures?: boolean; aviso?: Aviso }

/** Todas as obras: as do acervo e, onde o acervo não tem o slug, as fixtures do J94. Ordem por título. */
export async function lerAcervo(opcoes: OpcoesDoAcervo = {}): Promise<ObraNoAcervo[]> {
  const raiz = opcoes.raiz ?? raizDoAcervo();
  const aviso = opcoes.aviso ?? avisoPadrao;
  const slugs = existsSync(raiz) ? (await readdir(raiz, { withFileTypes: true })).filter((d) => d.isDirectory() && ehSlug(d.name)).map((d) => d.name) : [];
  // Uma obra com erro de disco (imagem ilegível, `geracoes` que é arquivo) fica de fora com aviso; não derruba a lista.
  const doAcervo = (await Promise.all(slugs.map((slug) => lerObraDoAcervo(raiz, slug, aviso).catch((erro: unknown) => {
    aviso(`${slug}: ${erro instanceof Error ? erro.message : String(erro)}`);
    return null;
  })))).filter((o): o is ObraNoAcervo => o !== null);
  const presentes = new Set(slugs);
  const fixtures = opcoes.fixtures === false ? [] : (await Promise.all(FIXTURES.filter((n) => !presentes.has(n)).map((n) => lerFixture(n, aviso)))).filter((o): o is ObraNoAcervo => o !== null);
  return [...doAcervo, ...fixtures].sort((a, b) => (a.analises[0]!.modelo.identidade.titulo).localeCompare(b.analises[0]!.modelo.identidade.titulo, 'pt-BR'));
}

/** Uma obra pelo slug (acervo primeiro, depois a fixture). */
export async function lerObra(slug: string, opcoes: OpcoesDoAcervo = {}): Promise<ObraNoAcervo | null> {
  if (!ehSlug(slug)) return null;
  const raiz = opcoes.raiz ?? raizDoAcervo();
  const aviso = opcoes.aviso ?? avisoPadrao;
  if (existsSync(join(raiz, slug))) return lerObraDoAcervo(raiz, slug, aviso);
  if (opcoes.fixtures === false || !FIXTURES.includes(slug)) return null;
  return lerFixture(slug, aviso);
}
