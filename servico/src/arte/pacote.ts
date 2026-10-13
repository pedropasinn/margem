/**
 * Pacote distribuível do acervo de quadros (J110): uma instalação nova não tem acervo, e o da instalação de origem
 * vive em `~/dados/margem/arte/obras`. O empacotador lê esse acervo (só leitura), escolhe as obras que
 * podem ser redistribuídas e grava um `.tar.gz` com:
 *
 *   manifesto.json                 versão, obras, licenças, créditos e o SHA-256 de cada arquivo
 *   CREDITOS.md                    os mesmos créditos para gente
 *   obras/<slug>/imagem.jpg        a reprodução ORIGINAL, byte a byte (as regiões estão ancoradas ao hash)
 *   obras/<slug>/imagem.json       origem, licença e crédito
 *   obras/<slug>/publicado.json    a análise mostrada por padrão
 *   obras/<slug>/esperado.{modelo,curta}.json e geracoes/<rótulo>/{modelo,curta}.json   as análises válidas
 *   obras/<slug>/audio/<rótulo>/{manifesto.json,narracao.mp3}                         narrações, se houver
 *
 * Nada de `fontes/` (textos da Wikipédia), `dossie-auto.json`, `brutos/`, `imagens/` nem avaliações: as
 * rotas e a web não usam. A imagem não é redimensionada: o contrato liga regiões, modelo e curta ao
 * SHA-256 da reprodução (ART-MODULE: trocar a imagem exige reancorar, nunca migração silenciosa).
 *
 * O instalador faz o caminho inverso para `MARGEM_ARTE_DIR`: confere o manifesto, o hash de cada arquivo
 * e cada obra com o mesmo leitor das rotas antes de mover qualquer coisa, e é idempotente (rodar de novo
 * não muda nada; um pacote novo só substitui arquivos que vieram de pacote e não foram mexidos).
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { dirname, join, sep } from 'node:path';
import { Readable } from 'node:stream';
import type { ModeloDaObraV1 } from '@margem/contratos';
import { ehRotulo, ehSlug, lerObraDoAcervo, type AnaliseNoAcervo, type ObraNoAcervo } from './acervo.js';
import { escreverTarGz, lerTarGz, type EntradaParaEscrever } from './tar.js';

export const FORMATO_DO_PACOTE = 1;
export const NOME_DO_PACOTE = 'acervo-de-quadros';

// ------------------------------------------------------------------ licenças

export const TIPOS_DE_LICENCA = ['dominio-publico', 'cc0', 'cc-by-2.0', 'cc-by-3.0', 'cc-by-4.0', 'cc-by-sa-2.0', 'cc-by-sa-3.0', 'cc-by-sa-4.0'] as const;
export type TipoDeLicenca = (typeof TIPOS_DE_LICENCA)[number];

export interface LicencaConferida {
  tipo: TipoDeLicenca;
  /** Nome legível ("Domínio público", "CC BY-SA 3.0"). */
  nome: string;
  url: string;
  /** Autor da fotografia, exigido pelas licenças CC BY e CC BY-SA. */
  atribuicao: string | null;
  /** O texto de licença do acervo, como estava. */
  texto: string;
}

const URL_DA_LICENCA: Record<TipoDeLicenca, string> = {
  'dominio-publico': 'https://creativecommons.org/publicdomain/mark/1.0/',
  cc0: 'https://creativecommons.org/publicdomain/zero/1.0/',
  'cc-by-2.0': 'https://creativecommons.org/licenses/by/2.0/',
  'cc-by-3.0': 'https://creativecommons.org/licenses/by/3.0/',
  'cc-by-4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'cc-by-sa-2.0': 'https://creativecommons.org/licenses/by-sa/2.0/',
  'cc-by-sa-3.0': 'https://creativecommons.org/licenses/by-sa/3.0/',
  'cc-by-sa-4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
};

const objeto = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null);
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
/** Entidades HTML que vêm nos créditos copiados do Commons (`Google Arts &amp; Culture`). */
const semEntidades = (s: string): string => s.replace(/&amp;/gu, '&').replace(/&quot;/gu, '"').replace(/&#0?39;/gu, "'").replace(/&nbsp;/gu, ' ');
const normalizar = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim();

export type ResultadoDaLicenca = { licenca: LicencaConferida; imagemJson: Record<string, unknown> } | { motivo: string };

/**
 * Confere a licença de UMA obra. Aceita domínio público, CC0 e CC BY / CC BY-SA com o autor da fotografia
 * identificado; recusa NC, ND, "todos os direitos", licença não reconhecida ou sem registro.
 *
 * O registro é o `imagem.json` da pasta. Sem ele, vale só a declaração explícita do próprio modelo (crédito
 * dizendo domínio público e a fonte da imagem numa página do Wikimedia Commons), caso das duas obras do J94.
 */
export function conferirLicenca(imagemJson: unknown, modelo: ModeloDaObraV1, shaDaImagem: string): ResultadoDaLicenca {
  const bruto = objeto(imagemJson);
  if (!bruto) {
    const fonte = modelo.fontes.find((f) => f.id === modelo.imagem.fonte_id);
    const declarado = /dom[ií]nio p[uú]blico/iu.test(modelo.imagem.credito) && fonte !== undefined && /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/u.test(fonte.url);
    if (!declarado) return { motivo: 'sem imagem.json e sem declaração de domínio público no modelo: licença não registrada' };
    const textoDaLicenca = `Domínio público (declarado no modelo da obra: "${modelo.imagem.credito}"; ${fonte.titulo})`;
    return {
      licenca: { tipo: 'dominio-publico', nome: 'Domínio público', url: URL_DA_LICENCA['dominio-publico'], atribuicao: null, texto: textoDaLicenca },
      imagemJson: {
        origem_url: fonte.url, arquivo_url: null, licenca: textoDaLicenca, credito: `${modelo.identidade.titulo} — ${modelo.identidade.artista}. ${modelo.imagem.credito}`,
        sha256: shaDaImagem, largura: modelo.imagem.largura, altura: modelo.imagem.altura, baixado_em: null,
      },
    };
  }
  if (texto(bruto.sha256) !== null && bruto.sha256 !== shaDaImagem) return { motivo: 'imagem.json descreve outra imagem (sha256 diferente)' };
  if (!texto(bruto.origem_url)) return { motivo: 'imagem.json sem origem_url: a procedência da reprodução não está registrada' };
  if (!texto(bruto.credito)) return { motivo: 'imagem.json sem crédito' };
  const declarado = texto(bruto.licenca);
  if (!declarado) return { motivo: 'imagem.json sem licença' };
  const tudo = `${texto(bruto.licenca_commons) ?? ''} ${declarado}`;
  if (/\bNC\b|\bND\b|n[aã]o[- ]comercial|sem deriva|all rights reserved|todos os direitos|fair use|uso justo/iu.test(tudo)) return { motivo: `licença restritiva: ${declarado}` };
  const cc = /CC[ -]BY(-SA)?[ -](\d\.\d)/iu.exec(tudo);
  if (cc) {
    const tipo = `cc-by${cc[1] ? '-sa' : ''}-${cc[2]!}`;
    if (!(TIPOS_DE_LICENCA as readonly string[]).includes(tipo)) return { motivo: `versão de licença não reconhecida: ${cc[0]}` };
    const atribuicao = /Atribui[cç][aã]o:\s*(.+?)\s*$/u.exec(declarado)?.[1] ?? null;
    if (!atribuicao) return { motivo: `${cc[0]} exige atribuição e o registro não traz o autor da fotografia` };
    if (normalizar(atribuicao) === normalizar(modelo.identidade.artista)) {
      return { motivo: `${cc[0]} exige atribuição ao autor da fotografia, mas o registro atribui ao próprio artista da obra (${atribuicao}); autoria da foto não confirmada` };
    }
    const t = tipo as TipoDeLicenca;
    return { licenca: { tipo: t, nome: `CC BY${cc[1] ? '-SA' : ''} ${cc[2]!}`, url: URL_DA_LICENCA[t], atribuicao, texto: declarado }, imagemJson: bruto };
  }
  if (/\bCC0\b/u.test(tudo)) return { licenca: { tipo: 'cc0', nome: 'CC0 1.0 (domínio público)', url: URL_DA_LICENCA.cc0, atribuicao: null, texto: declarado }, imagemJson: bruto };
  if (/dom[ií]nio p[uú]blico|public domain|\bPD-/iu.test(tudo)) return { licenca: { tipo: 'dominio-publico', nome: 'Domínio público', url: URL_DA_LICENCA['dominio-publico'], atribuicao: null, texto: declarado }, imagemJson: bruto };
  return { motivo: `licença não reconhecida: ${declarado}` };
}

// ------------------------------------------------------------------ manifesto

export interface ArquivoDoPacote { caminho: string; sha256: string; bytes: number }

export interface ObraDoPacote {
  slug: string;
  titulo: string;
  artista: string;
  data: string;
  licenca: LicencaConferida;
  credito: string;
  origem_url: string;
  imagem: { sha256: string; largura: number; altura: number; bytes: number };
  /** Rótulos das análises incluídas (`esperado` ou o nome da geração) e a publicada. */
  analises: string[];
  publicada: string;
  arquivos: ArquivoDoPacote[];
}

export interface ManifestoDoPacote {
  formato: typeof FORMATO_DO_PACOTE;
  nome: typeof NOME_DO_PACOTE;
  versao: string;
  criado_em: string;
  obras: ObraDoPacote[];
  excluidas: { slug: string; motivo: string }[];
  documentos: ArquivoDoPacote[];
  totais: { obras: number; arquivos: number; bytes: number };
}

/** Caminhos que um pacote pode trazer (relativos a `obras/<slug>/`). */
const ARQUIVO_DA_OBRA = /^(imagem\.jpg|imagem\.json|publicado\.json|esperado\.modelo\.json|esperado\.curta\.json|geracoes\/([a-z0-9][a-z0-9._-]{0,79})\/(modelo|curta)\.json|audio\/([a-z0-9][a-z0-9._-]{0,79})\/(manifesto\.json|[a-z0-9][a-z0-9._-]{0,79}\.(mp3|m4a|ogg)))$/u;
const SHA = /^[0-9a-f]{64}$/u;
const VERSAO = /^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/u;

/** Teto do manifesto (o resto do pacote é conferido contra ele, entrada por entrada). */
const TETO_DO_MANIFESTO = 8 * 1024 * 1024;

function exigirChaves(o: Record<string, unknown>, permitidas: string[], onde: string): void {
  for (const chave of Object.keys(o)) if (!permitidas.includes(chave)) throw new Error(`manifesto_invalido: campo desconhecido ${onde}.${chave}`);
  for (const chave of permitidas) if (!(chave in o)) throw new Error(`manifesto_invalido: falta ${onde}.${chave}`);
}

function conferirArquivo(bruto: unknown, onde: string): ArquivoDoPacote {
  const o = objeto(bruto);
  if (!o) throw new Error(`manifesto_invalido: ${onde}`);
  exigirChaves(o, ['caminho', 'sha256', 'bytes'], onde);
  if (typeof o.caminho !== 'string' || typeof o.sha256 !== 'string' || !SHA.test(o.sha256) || typeof o.bytes !== 'number' || !Number.isSafeInteger(o.bytes) || o.bytes < 0) throw new Error(`manifesto_invalido: ${onde}`);
  return { caminho: o.caminho, sha256: o.sha256, bytes: o.bytes };
}

/** Confere a forma do manifesto (campos, caminhos, hashes, licenças). Lança `manifesto_invalido: …`. */
export function conferirManifestoDoPacote(bruto: unknown): ManifestoDoPacote {
  const m = objeto(bruto);
  if (!m) throw new Error('manifesto_invalido: não é objeto');
  exigirChaves(m, ['formato', 'nome', 'versao', 'criado_em', 'obras', 'excluidas', 'documentos', 'totais'], 'manifesto');
  if (m.formato !== FORMATO_DO_PACOTE) throw new Error(`manifesto_invalido: formato ${String(m.formato)} (este app lê o ${String(FORMATO_DO_PACOTE)})`);
  if (m.nome !== NOME_DO_PACOTE) throw new Error('manifesto_invalido: não é um pacote de quadros');
  if (typeof m.versao !== 'string' || !VERSAO.test(m.versao)) throw new Error('manifesto_invalido: versão');
  if (typeof m.criado_em !== 'string' || Number.isNaN(Date.parse(m.criado_em))) throw new Error('manifesto_invalido: criado_em');
  if (!Array.isArray(m.obras) || !Array.isArray(m.excluidas) || !Array.isArray(m.documentos)) throw new Error('manifesto_invalido: listas');
  const caminhos = new Set<string>();
  const documentos = m.documentos.map((d, i) => conferirArquivo(d, `documentos[${String(i)}]`));
  for (const d of documentos) {
    if (d.caminho !== 'CREDITOS.md' || caminhos.has(d.caminho)) throw new Error(`manifesto_invalido: documento ${d.caminho}`);
    caminhos.add(d.caminho);
  }
  const slugs = new Set<string>();
  let bytes = 0; let arquivos = 0;
  const obras = m.obras.map((bo, i): ObraDoPacote => {
    const onde = `obras[${String(i)}]`;
    const o = objeto(bo);
    if (!o) throw new Error(`manifesto_invalido: ${onde}`);
    exigirChaves(o, ['slug', 'titulo', 'artista', 'data', 'licenca', 'credito', 'origem_url', 'imagem', 'analises', 'publicada', 'arquivos'], onde);
    if (typeof o.slug !== 'string' || !ehSlug(o.slug) || slugs.has(o.slug)) throw new Error(`manifesto_invalido: ${onde}.slug`);
    slugs.add(o.slug);
    for (const campo of ['titulo', 'artista', 'data', 'credito', 'origem_url', 'publicada'] as const) if (typeof o[campo] !== 'string') throw new Error(`manifesto_invalido: ${onde}.${campo}`);
    const licenca = objeto(o.licenca);
    if (!licenca) throw new Error(`manifesto_invalido: ${onde}.licenca`);
    exigirChaves(licenca, ['tipo', 'nome', 'url', 'atribuicao', 'texto'], `${onde}.licenca`);
    if (!(TIPOS_DE_LICENCA as readonly unknown[]).includes(licenca.tipo)) throw new Error(`manifesto_invalido: ${onde}.licenca.tipo ${String(licenca.tipo)} não é redistribuível`);
    if (String(licenca.tipo).startsWith('cc-by') && !texto(licenca.atribuicao)) throw new Error(`manifesto_invalido: ${onde}.licenca sem atribuição`);
    const imagem = objeto(o.imagem);
    if (!imagem) throw new Error(`manifesto_invalido: ${onde}.imagem`);
    exigirChaves(imagem, ['sha256', 'largura', 'altura', 'bytes'], `${onde}.imagem`);
    if (typeof imagem.sha256 !== 'string' || !SHA.test(imagem.sha256)) throw new Error(`manifesto_invalido: ${onde}.imagem.sha256`);
    if (!Array.isArray(o.analises) || !o.analises.length || !o.analises.every((a) => typeof a === 'string' && ehRotulo(a))) throw new Error(`manifesto_invalido: ${onde}.analises`);
    if (!o.analises.includes(o.publicada)) throw new Error(`manifesto_invalido: ${onde}.publicada`);
    if (!Array.isArray(o.arquivos)) throw new Error(`manifesto_invalido: ${onde}.arquivos`);
    const lista = o.arquivos.map((a, j) => conferirArquivo(a, `${onde}.arquivos[${String(j)}]`));
    const prefixo = `obras/${o.slug}/`;
    for (const a of lista) {
      const resto = a.caminho.startsWith(prefixo) ? a.caminho.slice(prefixo.length) : '';
      if (!ARQUIVO_DA_OBRA.test(resto) || caminhos.has(a.caminho)) throw new Error(`manifesto_invalido: caminho ${a.caminho}`);
      caminhos.add(a.caminho);
      bytes += a.bytes; arquivos += 1;
    }
    const daImagem = lista.find((a) => a.caminho === `${prefixo}imagem.jpg`);
    if (!daImagem || daImagem.sha256 !== imagem.sha256) throw new Error(`manifesto_invalido: ${onde} sem a imagem do hash declarado`);
    for (const obrigatorio of ['imagem.json', 'publicado.json']) if (!lista.some((a) => a.caminho === prefixo + obrigatorio)) throw new Error(`manifesto_invalido: ${onde} sem ${obrigatorio}`);
    return o as unknown as ObraDoPacote;
  });
  const totais = objeto(m.totais);
  if (!totais) throw new Error('manifesto_invalido: totais');
  exigirChaves(totais, ['obras', 'arquivos', 'bytes'], 'totais');
  if (totais.obras !== obras.length || totais.arquivos !== arquivos || totais.bytes !== bytes) throw new Error('manifesto_invalido: totais não batem com a lista');
  for (const [i, e] of m.excluidas.entries()) {
    const o = objeto(e);
    if (!o || typeof o.slug !== 'string' || typeof o.motivo !== 'string') throw new Error(`manifesto_invalido: excluidas[${String(i)}]`);
    exigirChaves(o, ['slug', 'motivo'], `excluidas[${String(i)}]`);
  }
  return m as unknown as ManifestoDoPacote;
}

// ------------------------------------------------------------------ empacotar

async function sha256DoArquivo(caminho: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const pedaco of createReadStream(caminho)) hash.update(pedaco as Buffer);
  return hash.digest('hex');
}
const sha256DosBytes = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

interface ArquivoAEmpacotar extends ArquivoDoPacote { origem: { arquivo: string } | { bytes: Buffer }; mtime: number }

export interface OpcoesDoEmpacotador {
  /** Pasta do acervo (`<slug>/imagem.jpg`, …). Só leitura. */
  origem: string;
  /** Arquivo .tar.gz de saída (a pasta precisa existir; nunca dentro do repositório). */
  destino: string;
  versao: string;
  /** Incluir narrações já publicadas (`audio/<rótulo>/`). Padrão: sim. */
  comAudio?: boolean;
  /** Só estes slugs (testes, pacotes parciais). */
  slugs?: string[];
  agora?: () => Date;
  nivelGzip?: number;
}

export interface RelatorioDoEmpacotador {
  arquivo: string;
  sha256: string;
  bytes: number;
  manifesto: ManifestoDoPacote;
}

const caminhoDaAnalise = (a: AnaliseNoAcervo): string => (a.origem === 'esperado' ? 'esperado' : `geracoes/${a.rotulo}`);

async function arquivosDaObra(obra: ObraNoAcervo, imagemJson: Buffer, comAudio: boolean, mtimePadrao: number): Promise<ArquivoAEmpacotar[]> {
  const pasta = obra.pasta!;
  const prefixo = `obras/${obra.slug}/`;
  const doDisco = async (relativo: string): Promise<ArquivoAEmpacotar> => {
    const caminho = join(pasta, ...relativo.split('/'));
    const info = await stat(caminho);
    return { caminho: prefixo + relativo, sha256: await sha256DoArquivo(caminho), bytes: info.size, origem: { arquivo: caminho }, mtime: Math.floor(info.mtimeMs / 1000) };
  };
  const emMemoria = (relativo: string, bytes: Buffer, mtime = mtimePadrao): ArquivoAEmpacotar => ({ caminho: prefixo + relativo, sha256: sha256DosBytes(bytes), bytes: bytes.length, origem: { bytes }, mtime });
  const lista: ArquivoAEmpacotar[] = [await doDisco('imagem.jpg')];
  const mtimeDoJson = existsSync(join(pasta, 'imagem.json')) ? Math.floor((await stat(join(pasta, 'imagem.json'))).mtimeMs / 1000) : mtimePadrao;
  lista.push(emMemoria('imagem.json', imagemJson, mtimeDoJson));
  const publicada = obra.analises.find((a) => a.rotulo === obra.publicada)!;
  lista.push(emMemoria('publicado.json', Buffer.from(`${JSON.stringify({ analise: caminhoDaAnalise(publicada) })}\n`)));
  for (const a of obra.analises) {
    if (a.origem === 'esperado') lista.push(await doDisco('esperado.modelo.json'), await doDisco('esperado.curta.json'));
    else lista.push(await doDisco(`geracoes/${a.rotulo}/modelo.json`), await doDisco(`geracoes/${a.rotulo}/curta.json`));
    if (comAudio && a.audio) {
      const manifesto = objeto(JSON.parse(await readFile(join(a.audio, 'manifesto.json'), 'utf8')));
      const arquivo = texto(manifesto?.arquivo);
      if (arquivo && /^[a-z0-9][a-z0-9._-]{0,79}\.(mp3|m4a|ogg)$/u.test(arquivo)) lista.push(await doDisco(`audio/${a.rotulo}/manifesto.json`), await doDisco(`audio/${a.rotulo}/${arquivo}`));
    }
  }
  return lista;
}

function linhaDeCredito(o: ObraDoPacote): string {
  const atribuicao = o.licenca.atribuicao ? ` Fotografia: ${o.licenca.atribuicao}.` : '';
  return `- **${o.titulo}**, ${o.artista} (${o.data}). Reprodução: ${o.credito}${atribuicao} Licença: [${o.licenca.nome}](${o.licenca.url}). Origem: <${o.origem_url}>`;
}

export function creditosEmMarkdown(m: ManifestoDoPacote): string {
  const livres = m.obras.filter((o) => o.licenca.tipo.startsWith('cc-by'));
  return [
    `# Acervo de quadros · créditos (versão ${m.versao})`,
    '',
    `${String(m.obras.length)} obras. Cada reprodução vem do Wikimedia Commons e está em domínio público ou sob licença livre que permite redistribuição; a licença e a origem de cada uma estão abaixo e no \`manifesto.json\`. As reproduções não foram alteradas (mesmos bytes do arquivo baixado).`,
    '',
    'As análises (regiões, afirmações e roteiros) foram geradas para o app e acompanham as obras no pacote; as fontes citadas em cada análise estão no próprio modelo da obra.',
    ...(livres.length ? ['', `**Licenças com atribuição.** ${livres.map((o) => `"${o.titulo}" (${o.licenca.nome}, fotografia de ${o.licenca.atribuicao ?? '—'})`).join('; ')}: redistribuídas sem alteração; quem modificar a imagem deve manter a mesma licença e o crédito.`] : []),
    '',
    '## Obras',
    '',
    ...m.obras.map(linhaDeCredito),
    ...(m.excluidas.length ? ['', '## Fora deste pacote', '', ...m.excluidas.map((e) => `- \`${e.slug}\`: ${e.motivo}`)] : []),
    '',
  ].join('\n');
}

/** Lê o acervo (sem escrever nele) e grava o pacote. */
export async function empacotarAcervo(opcoes: OpcoesDoEmpacotador): Promise<RelatorioDoEmpacotador> {
  if (!VERSAO.test(opcoes.versao)) throw new Error(`versão inválida: ${opcoes.versao} (use AAAA.MM.DD)`);
  const agora = (opcoes.agora ?? (() => new Date()))();
  const mtimePadrao = Math.floor(agora.getTime() / 1000);
  const comAudio = opcoes.comAudio ?? true;
  const todos = (await readdir(opcoes.origem, { withFileTypes: true })).filter((d) => d.isDirectory() && ehSlug(d.name)).map((d) => d.name).sort();
  const slugs = opcoes.slugs ? todos.filter((s) => opcoes.slugs!.includes(s)) : todos;
  const obras: ObraDoPacote[] = [];
  const excluidas: { slug: string; motivo: string }[] = [];
  const conteudo: ArquivoAEmpacotar[] = [];
  for (const slug of slugs) {
    const avisos: string[] = [];
    const obra = await lerObraDoAcervo(opcoes.origem, slug, (m) => { avisos.push(m); }).catch((erro: unknown) => { avisos.push(erro instanceof Error ? erro.message : String(erro)); return null; });
    if (!obra) { excluidas.push({ slug, motivo: `nenhuma análise válida (${avisos.join('; ') || 'sem detalhe'})` }); continue; }
    const publicada = obra.analises.find((a) => a.rotulo === obra.publicada)!;
    const modelo = publicada.modelo;
    let imagemJsonBruto: unknown = null;
    if (existsSync(join(obra.pasta!, 'imagem.json'))) {
      try { imagemJsonBruto = JSON.parse(await readFile(join(obra.pasta!, 'imagem.json'), 'utf8')); } catch { excluidas.push({ slug, motivo: 'imagem.json ilegível' }); continue; }
    }
    const conferida = conferirLicenca(imagemJsonBruto, modelo, modelo.imagem.sha256);
    if ('motivo' in conferida) { excluidas.push({ slug, motivo: conferida.motivo }); continue; }
    const imagemJson = Buffer.from(`${JSON.stringify(conferida.imagemJson, null, 2)}\n`);
    const arquivos = await arquivosDaObra(obra, imagemJson, comAudio, mtimePadrao);
    const daImagem = arquivos[0]!;
    if (daImagem.sha256 !== modelo.imagem.sha256) { excluidas.push({ slug, motivo: 'a imagem mudou durante o empacotamento' }); continue; }
    obras.push({
      slug, titulo: modelo.identidade.titulo, artista: modelo.identidade.artista, data: modelo.identidade.data,
      licenca: conferida.licenca, credito: semEntidades(String(conferida.imagemJson.credito)), origem_url: String(conferida.imagemJson.origem_url),
      imagem: { sha256: daImagem.sha256, largura: modelo.imagem.largura, altura: modelo.imagem.altura, bytes: daImagem.bytes },
      analises: obra.analises.map((a) => a.rotulo), publicada: obra.publicada,
      arquivos: arquivos.map(({ caminho, sha256, bytes }) => ({ caminho, sha256, bytes })),
    });
    conteudo.push(...arquivos);
  }
  if (!obras.length) throw new Error('nenhuma obra pode entrar no pacote');
  const semCreditos: ManifestoDoPacote = {
    formato: FORMATO_DO_PACOTE, nome: NOME_DO_PACOTE, versao: opcoes.versao, criado_em: agora.toISOString(), obras, excluidas, documentos: [],
    totais: { obras: obras.length, arquivos: conteudo.length, bytes: conteudo.reduce((s, a) => s + a.bytes, 0) },
  };
  const creditos = Buffer.from(creditosEmMarkdown(semCreditos));
  const manifesto: ManifestoDoPacote = { ...semCreditos, documentos: [{ caminho: 'CREDITOS.md', sha256: sha256DosBytes(creditos), bytes: creditos.length }] };
  conferirManifestoDoPacote(manifesto);
  const bytesDoManifesto = Buffer.from(`${JSON.stringify(manifesto, null, 2)}\n`);
  const entradas: EntradaParaEscrever[] = [
    { caminho: 'manifesto.json', origem: { bytes: bytesDoManifesto }, bytes: bytesDoManifesto.length, mtime: mtimePadrao },
    { caminho: 'CREDITOS.md', origem: { bytes: creditos }, bytes: creditos.length, mtime: mtimePadrao },
    ...conteudo.map((a) => ({ caminho: a.caminho, origem: a.origem, bytes: a.bytes, mtime: a.mtime })),
  ];
  await escreverTarGz(opcoes.destino, entradas, opcoes.nivelGzip ?? 6);
  const sha256 = await sha256DoArquivo(opcoes.destino);
  await writeFile(`${opcoes.destino}.sha256`, `${sha256}  ${opcoes.destino.split(/[\\/]/u).pop()!}\n`);
  return { arquivo: opcoes.destino, sha256, bytes: (await stat(opcoes.destino)).size, manifesto };
}

// ------------------------------------------------------------------ instalar

export interface OpcoesDoInstalador {
  /** Caminho do .tar.gz, ou URL http(s) (baixada para uma pasta temporária dentro da raiz). */
  pacote: string;
  /** `MARGEM_ARTE_DIR` (criada se faltar). */
  raiz: string;
  /** SHA-256 esperado do arquivo do pacote (o `.sha256` publicado ao lado). */
  sha256?: string;
  avisar?: (mensagem: string) => void;
  /** Para testes: o `fetch` usado no download. */
  buscar?: typeof fetch;
}

export interface ResultadoDaInstalacao {
  versao: string;
  /** Nada mudou: o pacote já estava instalado. */
  ja_instalado: boolean;
  instaladas: string[];
  atualizadas: string[];
  iguais: string[];
  /** Obras que não foram tocadas porque a pasta tem arquivos que não vieram de pacote. */
  conflitos: { slug: string; motivo: string }[];
}

interface RegistroDaInstalacao { versao: string; instalado_em: string; arquivos: Record<string, string> }

const PASTA_DO_REGISTRO = '.pacote';

async function lerRegistro(raiz: string): Promise<RegistroDaInstalacao> {
  try {
    const bruto = objeto(JSON.parse(await readFile(join(raiz, PASTA_DO_REGISTRO, 'instalado.json'), 'utf8')));
    const arquivos = objeto(bruto?.arquivos) ?? {};
    return { versao: texto(bruto?.versao) ?? '', instalado_em: texto(bruto?.instalado_em) ?? '', arquivos: Object.fromEntries(Object.entries(arquivos).filter((p): p is [string, string] => typeof p[1] === 'string')) };
  } catch { return { versao: '', instalado_em: '', arquivos: {} }; }
}

async function escreverAtomico(caminho: string, bytes: Buffer | string): Promise<void> {
  await mkdir(dirname(caminho), { recursive: true });
  const temporario = `${caminho}.${String(process.pid)}.tmp`;
  await writeFile(temporario, bytes);
  await rename(temporario, caminho);
}

async function baixar(url: string, destino: string, buscar: typeof fetch, avisar: (m: string) => void): Promise<void> {
  avisar(`baixando ${url}`);
  const resposta = await buscar(url, { redirect: 'follow' });
  if (!resposta.ok || !resposta.body) throw new Error(`download_falhou: HTTP ${String(resposta.status)} em ${url}`);
  const saida = createWriteStream(destino);
  const fim = once(saida, 'close');
  for await (const pedaco of Readable.fromWeb(resposta.body as import('node:stream/web').ReadableStream<Uint8Array>)) {
    if (!saida.write(pedaco as Buffer)) await once(saida, 'drain');
  }
  saida.end();
  await fim;
}

/** Caminho seguro dentro de `base` (o manifesto já restringe os nomes; aqui é a segunda trava). */
function dentroDe(base: string, relativo: string): string {
  if (relativo.includes('\\') || relativo.split('/').some((p) => p === '' || p === '.' || p === '..')) throw new Error(`caminho_recusado: ${relativo}`);
  const caminho = join(base, ...relativo.split('/'));
  if (!caminho.startsWith(base + sep)) throw new Error(`caminho_recusado: ${relativo}`);
  return caminho;
}

/** Extrai, confere e instala um pacote. Lança com mensagem clara se algo não conferir; nada é movido antes de tudo conferir. */
export async function instalarPacote(opcoes: OpcoesDoInstalador): Promise<ResultadoDaInstalacao> {
  const avisar = opcoes.avisar ?? (() => undefined);
  await mkdir(opcoes.raiz, { recursive: true });
  const preparo = await mkdtemp(join(opcoes.raiz, '.instalando-'));
  try {
    let arquivo = opcoes.pacote;
    if (/^https?:\/\//iu.test(arquivo)) {
      arquivo = join(preparo, 'pacote.tar.gz');
      await baixar(opcoes.pacote, arquivo, opcoes.buscar ?? fetch, avisar);
    }
    if (!existsSync(arquivo)) throw new Error(`pacote_inexistente: ${opcoes.pacote}`);
    if (opcoes.sha256) {
      const sha = await sha256DoArquivo(arquivo);
      if (sha !== opcoes.sha256.trim().toLowerCase()) throw new Error(`pacote_corrompido: o SHA-256 do arquivo (${sha}) não é o publicado`);
    }
    const extraido = join(preparo, 'extraido');
    let manifesto: ManifestoDoPacote | null = null;
    let esperados = new Map<string, ArquivoDoPacote>();
    const mtimes = new Map<string, number>();
    const vistos = new Set<string>();
    avisar('conferindo o pacote');
    await lerTarGz(arquivo, async (entrada) => {
      if (!manifesto) {
        if (entrada.caminho !== 'manifesto.json') throw new Error('pacote_invalido: a primeira entrada não é manifesto.json');
        if (entrada.bytes > TETO_DO_MANIFESTO) throw new Error('pacote_invalido: manifesto grande demais');
        const partes: Buffer[] = [];
        return {
          pedaco: (b) => { partes.push(Buffer.from(b)); return Promise.resolve(); },
          fim: () => {
            let bruto: unknown;
            try { bruto = JSON.parse(Buffer.concat(partes).toString('utf8')); } catch { throw new Error('manifesto_invalido: JSON ilegível'); }
            manifesto = conferirManifestoDoPacote(bruto);
            esperados = new Map([...manifesto.documentos, ...manifesto.obras.flatMap((o) => o.arquivos)].map((a) => [a.caminho, a]));
            return Promise.resolve();
          },
        };
      }
      const esperado = esperados.get(entrada.caminho);
      if (!esperado) throw new Error(`pacote_invalido: arquivo fora do manifesto (${entrada.caminho})`);
      if (vistos.has(entrada.caminho)) throw new Error(`pacote_invalido: arquivo repetido (${entrada.caminho})`);
      if (entrada.bytes !== esperado.bytes) throw new Error(`pacote_invalido: tamanho de ${entrada.caminho} não é o do manifesto`);
      vistos.add(entrada.caminho);
      mtimes.set(entrada.caminho, entrada.mtime);
      const destino = dentroDe(extraido, entrada.caminho);
      await mkdir(dirname(destino), { recursive: true });
      const saida = createWriteStream(destino, { mode: 0o644 });
      const fechado = once(saida, 'close');
      return {
        pedaco: async (b) => { if (!saida.write(b)) await once(saida, 'drain'); },
        fim: async (sha) => {
          saida.end(); await fechado;
          if (sha !== esperado.sha256) throw new Error(`hash_invalido: ${entrada.caminho} não confere com o manifesto`);
        },
      };
    });
    const m = manifesto as ManifestoDoPacote | null;
    if (!m) throw new Error('pacote_invalido: vazio');
    for (const caminho of esperados.keys()) if (!vistos.has(caminho)) throw new Error(`pacote_invalido: falta ${caminho}`);
    for (const [caminho, mtime] of mtimes) {
      const quando = new Date(mtime * 1000);
      await utimes(dentroDe(extraido, caminho), quando, quando);
    }
    // Cada obra passa pelo mesmo leitor das rotas: contrato, regras do núcleo e hash da imagem.
    for (const obra of m.obras) {
      const avisos: string[] = [];
      const lida = await lerObraDoAcervo(join(extraido, 'obras'), obra.slug, (a) => { avisos.push(a); });
      if (!lida) throw new Error(`obra_invalida: ${obra.slug} (${avisos.join('; ')})`);
      const aceitas = new Set(lida.analises.map((a) => a.rotulo));
      const faltam = obra.analises.filter((r) => !aceitas.has(r));
      if (faltam.length) throw new Error(`obra_invalida: ${obra.slug}: análises recusadas (${faltam.join(', ')}; ${avisos.join('; ')})`);
      if (lida.analises.some((a) => a.modelo.imagem.sha256 !== obra.imagem.sha256)) throw new Error(`obra_invalida: ${obra.slug}: modelo ancorado a outra imagem`);
    }
    // Conferido. Agora decide obra a obra o que muda na raiz.
    const registro = await lerRegistro(opcoes.raiz);
    const resultado: ResultadoDaInstalacao = { versao: m.versao, ja_instalado: false, instaladas: [], atualizadas: [], iguais: [], conflitos: [] };
    const novosNoRegistro: Record<string, string> = {};
    for (const obra of m.obras) {
      const pasta = join(opcoes.raiz, obra.slug);
      const existia = existsSync(pasta);
      const mover: ArquivoDoPacote[] = [];
      let conflito: string | null = null;
      for (const a of obra.arquivos) {
        const relativo = a.caminho.slice('obras/'.length);
        const destino = dentroDe(opcoes.raiz, relativo);
        if (!existsSync(destino)) { mover.push(a); continue; }
        const atual = await sha256DoArquivo(destino);
        if (atual === a.sha256) continue;
        if (registro.arquivos[relativo] === atual) { mover.push(a); continue; }
        conflito = `${relativo} existe e não veio de um pacote (não foi substituído)`;
        break;
      }
      if (conflito) { resultado.conflitos.push({ slug: obra.slug, motivo: conflito }); continue; }
      for (const a of mover) {
        const relativo = a.caminho.slice('obras/'.length);
        const destino = dentroDe(opcoes.raiz, relativo);
        await mkdir(dirname(destino), { recursive: true });
        await rename(dentroDe(extraido, a.caminho), destino);
      }
      for (const a of obra.arquivos) novosNoRegistro[a.caminho.slice('obras/'.length)] = a.sha256;
      if (!mover.length) resultado.iguais.push(obra.slug);
      else if (existia) resultado.atualizadas.push(obra.slug);
      else resultado.instaladas.push(obra.slug);
    }
    resultado.ja_instalado = resultado.instaladas.length === 0 && resultado.atualizadas.length === 0 && registro.versao === m.versao;
    if (!resultado.ja_instalado) {
      const pastaDoRegistro = join(opcoes.raiz, PASTA_DO_REGISTRO);
      await escreverAtomico(join(pastaDoRegistro, 'manifesto.json'), `${JSON.stringify(m, null, 2)}\n`);
      await escreverAtomico(join(pastaDoRegistro, 'CREDITOS.md'), await readFile(dentroDe(extraido, 'CREDITOS.md')));
      const novo: RegistroDaInstalacao = { versao: m.versao, instalado_em: new Date().toISOString(), arquivos: { ...registro.arquivos, ...novosNoRegistro } };
      await escreverAtomico(join(pastaDoRegistro, 'instalado.json'), `${JSON.stringify(novo, null, 2)}\n`);
    }
    return resultado;
  } finally {
    await rm(preparo, { recursive: true, force: true });
  }
}

/** O que está instalado (para a API dizer se há acervo e de que versão). */
export async function pacoteInstalado(raiz: string): Promise<{ versao: string; instalado_em: string } | null> {
  const r = await lerRegistro(raiz);
  return r.versao ? { versao: r.versao, instalado_em: r.instalado_em } : null;
}
