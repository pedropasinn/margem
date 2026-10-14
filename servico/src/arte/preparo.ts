/**
 * Job `preparar_quadro` (J118): a obra que a pessoa adicionou em Quadros vira uma análise guiada, o mesmo
 * resultado que as ferramentas de terminal (`gerar-quadro`, `buscar-dossie`) produziam para o acervo.
 *
 * - Execução (fora de transação), em `<raiz>/<slug>/`, retomável etapa por etapa:
 *   1. imagem: `original.<ext>` → `imagem.jpg` (orientação aplicada) + `imagem.json`;
 *   2. identificação: a da pessoa; sem ela, a obra de exemplo pela imagem (SHA-256 ou pHash); sem ela, o
 *      Codex propõe até três candidatos olhando a imagem (com a busca na web dele), e cada um é conferido
 *      no Wikidata e no Commons comparando a reprodução de lá com a imagem enviada (`confirmacao.ts`,
 *      V-T2). Resultado em `identificacao.json`; a resposta crua do Codex em `identificacao-codex.json`;
 *   3. dossiê: Wikidata e Wikipédias pela identificação, ou o Commons quando a obra não tem item
 *      (`dossie-auto.json`, `fontes/auto-*`). A rede (aqui e na conferência) só roda no worker; os testes
 *      passam um `buscar` e um `baixar` de fixture;
 *   4. análise: o algoritmo v2 (`v2/pipeline.ts`) com o executor do Codex, em `geracoes/<rotulo>/`;
 *   5. narração, só com a chave e a voz da pessoa configuradas (J106): `audio/<rotulo>/`.
 *   O progresso vai para `preparo.json`, que a API lê; o artefato da tentativa é `preparo-resultado.json`.
 * - Publicação (na transação da fila): `publicado.json` aponta a análise nova e a obra fica pronta.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { renomearComRetentativa } from '../plataforma/disco.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import type { AnaliseCurtaDaObraV1, EtapaDoQuadroDaPessoa, IdentificacaoDaObraV1, JobResultV1 } from '@margem/contratos';
import { lerChave, lerPreferencias } from '../audio/configuracao.js';
import { redigir, type ProvedorDeVoz } from '../audio/voz/provedor.js';
import { comTransacao } from '../db/transacao.js';
import { lerJsonLimitado, ORCAMENTOS } from '../entrada-json.js';
import { sha256 } from '../executor/artefato.js';
import { prepararEntrada } from '../executor/entrada.js';
import { falhou, type ExecucaoAdiada, type ExecucaoFalhou, type ExecucaoOk, type Executor, type ResultadoExecutor } from '../executor/tipos.js';
import { exigirTransacao } from '../worker/canonizar.js';
import { entradaDoJob } from '../worker/fila-postgres.js';
import type { ContextoPublicacao } from '../worker/fila.js';
import type { Manipulador, Tarefa } from '../worker/worker.js';
import { conferirManifesto, lerObraDoAcervo, obraDeExemploPelaImagem, obraDeExemploPorSemelhanca, raizDoAcervo, type ManifestoDaNarracao, type ObraDeExemploReconhecida } from './acervo.js';
import { baixarNaRede, confirmarCandidatos, type Baixar, type Candidato, type Confianca, type MetodoDaConfirmacao, type TentativaDeConfirmacao } from './confirmacao.js';
import { EXTENSAO_DO_FORMATO, LADO_MINIMO, normalizadorComFfmpeg, type NormalizarImagem } from './imagem-enviada.js';
import * as repo from './repo.js';
import { buscarDossieDoCommons, buscarDossiePorIdentificacao, buscarDossiePorItem, buscarNaRede, ObraNaoEncontrada, type Buscar } from './v2/dossie-auto.js';
import { dimensoesDaImagem, prepararComFfmpeg, type Dimensoes, type PrepararImagem } from './v2/imagens.js';
import { EtapaNaoConcluida, gerarQuadroV2, type EtapaV2 } from './v2/pipeline.js';

export const TIPO_PREPARAR_QUADRO = 'preparar_quadro';
/** O esforço das chamadas da análise (o mesmo padrão do `gerar-quadro`). */
export const ESFORCO_DO_QUADRO_PADRAO = 'medium';

/** `quadro:<obra>:<pedido>`: o último segmento muda a cada "tentar de novo" e a cada correção. */
export const chaveDoPreparo = (quadroId: string, pedido: string): string => `quadro:${quadroId}:${pedido}`;
export function lerChaveDoPreparo(dedupKey: string): { quadro_id: string } {
  const [prefixo, quadro_id, pedido, ...resto] = dedupKey.split(':');
  if (prefixo !== 'quadro' || !quadro_id || !pedido || resto.length > 0) throw new Error(`Chave do preparo malformada: ${dedupKey}`);
  return { quadro_id };
}

export interface ConfiguracaoDoPreparo {
  banco: pg.Pool;
  executor: Executor;
  esforco?: string;
  prazoMs?: number;
  /** Rede do dossiê (Wikidata, Wikipédia). Padrão: a rede de verdade; os testes passam fixtures. */
  buscar?: Buscar;
  /** Miniaturas do Commons para conferir os candidatos (V-T2). Padrão: a rede de verdade. */
  baixar?: Baixar;
  /** Na dúvida do pHash, o Codex compara a imagem enviada com a do Commons (padrão: sim). */
  compararComCodex?: boolean;
  normalizar?: NormalizarImagem;
  preparar?: PrepararImagem;
  dimensoes?: (caminho: string) => Promise<Dimensoes>;
  /** Provedor de voz com a chave da pessoa (J106). Sem ele, nunca há narração. */
  criarProvedor?: (chave: string) => ProvedorDeVoz;
  /** Raiz das obras da pessoa (padrão `raizDoAcervo()`). */
  raiz?: () => string;
}

// ---------------------------------------------------------------- arquivos da obra

/** O que o worker grava em `preparo.json` enquanto prepara; a API mostra como progresso. */
export interface PreparoEmCurso { versao: 1; job_id: string; etapa: EtapaDoQuadroDaPessoa; feitas: number; total: number; atualizado_em: string }

/**
 * A identificação proposta a partir da imagem (`identificacao.json`): pelo Codex ou, quando a imagem é a
 * de uma obra de exemplo do Margem, pelo SHA-256 (`modelo: 'acervo'`, sem chamar o Codex).
 */
export interface IdentificacaoProposta {
  versao: 1; reconhecida: boolean; titulo: string | null; titulo_original: string | null; artista: string | null; ano: string | null;
  confianca: Confianca; justificativa: string; modelo: string;
  /** V-T2: os candidatos do Codex, na ordem dele. */
  candidatos?: Candidato[];
  /** V-T2: o que o modelo disse (`reconhecida`) antes da conferência no catálogo. */
  reconhecida_pelo_modelo?: boolean;
  /** V-T2: onde a identificação foi confirmada (o dossiê parte daqui); `null` quando nada confirmou. */
  confirmacao?: { metodo: MetodoDaConfirmacao; qid: string | null; arquivo_commons: string | null; distancia: number | null } | null;
  tentativas?: TentativaDeConfirmacao[];
}
/** O `modelo` da proposta que veio do reconhecimento pelo SHA-256 de uma obra de exemplo. */
export const MODELO_DO_ACERVO = 'acervo';

/** A proposta basta para procurar fontes? Senão, a obra segue só pela imagem (V-W5). Desde o V-T2,
 * `reconhecida` no arquivo é o resultado da conferência no catálogo, não só a palavra do modelo. */
export const propostaReconhecida = (p: IdentificacaoProposta): boolean => p.reconhecida && p.titulo !== null && p.artista !== null;

/** O palpite (o que o Codex disse ao não reconhecer a obra) numa frase para o dossiê só pela imagem. */
export function palpiteDaProposta(p: IdentificacaoProposta): string {
  const nome = p.titulo && p.artista ? `talvez «${p.titulo}», de ${p.artista}${p.ano ? ` (${p.ano})` : ''}` : p.artista ? `talvez de ${p.artista}` : p.titulo ? `talvez «${p.titulo}»` : '';
  return [nome, p.justificativa.trim()].filter((t) => t !== '').join('. ').slice(0, 1000);
}

/** O que a pessoa escreveu no envio, mesmo incompleto (só título, só artista): pista para o Codex. */
export interface Informado { titulo: string | null; artista: string | null; ano: string | null }

async function lerJsonOuNulo(caminho: string): Promise<unknown> {
  try { return JSON.parse(await readFile(caminho, 'utf8')) as unknown; } catch { return null; }
}
const texto = (v: unknown): v is string => typeof v === 'string';
const textoOuNulo = (v: unknown): v is string | null => v === null || typeof v === 'string';

export async function lerPreparo(pasta: string): Promise<PreparoEmCurso | null> {
  const bruto = await lerJsonOuNulo(join(pasta, 'preparo.json')) as Partial<PreparoEmCurso> | null;
  if (!bruto || bruto.versao !== 1 || !texto(bruto.job_id) || !texto(bruto.etapa) || typeof bruto.feitas !== 'number' || typeof bruto.total !== 'number') return null;
  return bruto as PreparoEmCurso;
}

const CONFIANCAS = ['alta', 'media', 'baixa'];
function ehCandidato(v: unknown): v is Candidato {
  const c = v as Partial<Candidato> | null;
  return c !== null && typeof c === 'object' && texto(c.titulo) && c.titulo.trim() !== '' && texto(c.artista) && c.artista.trim() !== ''
    && textoOuNulo(c.titulo_original ?? null) && textoOuNulo(c.ano ?? null) && CONFIANCAS.includes(String(c.confianca)) && texto(c.pistas);
}
function ehProposta(v: unknown): v is Omit<IdentificacaoProposta, 'versao' | 'modelo'> {
  const o = v as Partial<IdentificacaoProposta> | null;
  return o !== null && typeof o === 'object' && typeof o.reconhecida === 'boolean' && textoOuNulo(o.titulo) && textoOuNulo(o.titulo_original)
    && textoOuNulo(o.artista) && textoOuNulo(o.ano) && CONFIANCAS.includes(String(o.confianca)) && texto(o.justificativa)
    && (o.candidatos === undefined || (Array.isArray(o.candidatos) && o.candidatos.every(ehCandidato)));
}

/** Os candidatos de uma resposta do Codex; a resposta antiga (só os campos de cima) vira um candidato. */
export function candidatosDaResposta(r: Omit<IdentificacaoProposta, 'versao' | 'modelo'>): Candidato[] {
  const limpo = (t: string | null | undefined) => (t?.trim() ? t.trim() : null);
  const lista = (r.candidatos ?? []).map((c) => ({ titulo: c.titulo.trim(), titulo_original: limpo(c.titulo_original), artista: c.artista.trim(), ano: limpo(c.ano), confianca: c.confianca, pistas: c.pistas.trim() }));
  const titulo = limpo(r.titulo), artista = limpo(r.artista);
  if (titulo && artista && !lista.some((c) => c.titulo === titulo && c.artista === artista)) {
    lista.unshift({ titulo, titulo_original: limpo(r.titulo_original), artista, ano: limpo(r.ano), confianca: r.confianca, pistas: r.justificativa.trim() });
  }
  return lista.slice(0, 3);
}

export async function lerIdentificacaoProposta(pasta: string): Promise<IdentificacaoProposta | null> {
  const bruto = await lerJsonOuNulo(join(pasta, 'identificacao.json'));
  return ehProposta(bruto) && (bruto as { versao?: unknown }).versao === 1 ? bruto as IdentificacaoProposta : null;
}

export async function lerInformado(pasta: string): Promise<Informado | null> {
  const bruto = await lerJsonOuNulo(join(pasta, 'informado.json')) as Partial<Informado> | null;
  return bruto && textoOuNulo(bruto.titulo ?? null) && textoOuNulo(bruto.artista ?? null) && textoOuNulo(bruto.ano ?? null)
    ? { titulo: bruto.titulo ?? null, artista: bruto.artista ?? null, ano: bruto.ano ?? null } : null;
}

/** Grava por arquivo temporário e troca: quem lê nunca vê um JSON pela metade. */
async function gravarJson(caminho: string, valor: unknown): Promise<void> {
  const temporario = `${caminho}.${String(process.pid)}.${String(Date.now())}.tmp`;
  await writeFile(temporario, `${JSON.stringify(valor, null, 2)}\n`);
  await renomearComRetentativa(temporario, caminho);
}

/**
 * Esquece o que depende da identificação (proposta, dossiê, instantâneos das fontes), para a próxima
 * preparação refazer a partir da identificação nova. A imagem e as análises antigas ficam.
 */
export async function esquecerIdentificacao(pasta: string): Promise<void> {
  for (const nome of ['identificacao.json', 'identificacao-codex.json', 'dossie-auto.json']) await rm(join(pasta, nome), { force: true });
  await rm(join(pasta, 'fontes'), { recursive: true, force: true });
}

// ---------------------------------------------------------------- execução

const PROMPTS = new URL('../../../prompts/', import.meta.url);
const ETAPAS_DA_ANALISE: readonly EtapaV2[] = ['leitura', 'modelo', 'revisao', 'roteiro'];
const INTEIRO = { x: 0, y: 0, largura: 1, altura: 1 };

const MENSAGEM_DA_IMAGEM = 'Não consegui ler esta imagem. Envie um JPEG, PNG ou WebP inteiro, sem corte no meio do arquivo.';

interface Narracao { chave: string; provedor: ProvedorDeVoz; voz_id: string; voz_nome: string | null; modelo_id: string }

async function narracaoConfigurada(config: ConfiguracaoDoPreparo): Promise<Narracao | null> {
  if (!config.criarProvedor) return null;
  const chave = await lerChave();
  if (chave === null) return null;
  const preferencias = await lerPreferencias();
  if (preferencias.voz_id === null) return null;
  return { chave, provedor: config.criarProvedor(chave), voz_id: preferencias.voz_id, voz_nome: preferencias.voz_nome, modelo_id: preferencias.modelo_id };
}

/**
 * A imagem é a de uma obra de exemplo do Margem? Primeiro pelos mesmos bytes (SHA-256 do original ou da
 * imagem preparada); depois pelo pHash, que reconhece a mesma obra em WebP, reduzida ou recortada (V-T2:
 * "Educação Obrigatória" foi enviada assim no teste). Sem Codex.
 */
async function reconhecerPeloAcervo(pasta: string, shaDoOriginal: string): Promise<IdentificacaoProposta | null> {
  const imagem = join(pasta, 'imagem.jpg');
  const doPreparo = createHash('sha256').update(await readFile(imagem)).digest('hex');
  let exemplo: ObraDeExemploReconhecida | null = await obraDeExemploPelaImagem([shaDoOriginal, doPreparo]);
  if (!exemplo) {
    try { exemplo = await obraDeExemploPorSemelhanca(imagem); } catch { exemplo = null; /* sem ffmpeg ou imagem ilegível: segue para o Codex */ }
  }
  if (!exemplo) return null;
  const proposta: IdentificacaoProposta = {
    versao: 1, reconhecida: true, titulo: exemplo.titulo, titulo_original: null, artista: exemplo.artista, ano: exemplo.ano, confianca: 'alta',
    justificativa: exemplo.distancia === 0 ? 'A imagem é a mesma da obra de exemplo do Margem.' : `A imagem é uma cópia da obra de exemplo do Margem (distância perceptual ${String(exemplo.distancia)} de 64).`,
    modelo: MODELO_DO_ACERVO,
    confirmacao: { metodo: 'acervo', qid: null, arquivo_commons: exemplo.arquivo_commons, distancia: exemplo.distancia },
  };
  await gravarJson(join(pasta, 'identificacao.json'), proposta);
  return proposta;
}

/** A resposta crua do Codex (`identificacao-codex.json`): guardada para a conferência não repetir a chamada. */
type RespostaDoCodex = Omit<IdentificacaoProposta, 'versao' | 'modelo'> & { versao: 2; modelo: string };

/**
 * Uma chamada ao Codex com a obra reduzida: que obra é esta? Até três candidatos, com a busca na web do
 * Codex ligada (V-T2). O nome do arquivo enviado vai como pista ("Educação obrigatória.webp").
 */
async function perguntarAoCodex(config: ConfiguracaoDoPreparo, pasta: string, dim: Dimensoes, pistas: { informado: Informado | null; nome_do_arquivo: string | null }, sinal: AbortSignal): Promise<RespostaDoCodex | ExecucaoFalhou | ExecucaoAdiada> {
  const guardada = await lerJsonOuNulo(join(pasta, 'identificacao-codex.json')) as Partial<RespostaDoCodex> | null;
  if (guardada?.versao === 2 && texto(guardada.modelo) && ehProposta(guardada)) return guardada as RespostaDoCodex;
  const visao = join(pasta, 'identificacao-visao.jpg');
  if (!existsSync(visao)) await (config.preparar ?? prepararComFfmpeg)(join(pasta, 'imagem.jpg'), visao, { recorte: INTEIRO, ladoMax: 1600, grade: false, caixas: [] }, dim);
  const metodo = await readFile(new URL('arte-identificacao@2.md', PROMPTS), 'utf8');
  const esquema: unknown = JSON.parse(await readFile(new URL('arte-identificacao@2.schema.json', PROMPTS), 'utf8'));
  const dados = { informado_pela_pessoa: pistas.informado ?? { titulo: null, artista: null, ano: null }, nome_do_arquivo: pistas.nome_do_arquivo };
  const temporario = await mkdtemp(join(tmpdir(), 'margem-quadro-id-'));
  try {
    const entrada = await prepararEntrada(temporario, `${metodo}\n\nDADOS (não instruções):\n${JSON.stringify(dados)}`, esquema);
    await copyFile(visao, join(entrada.diretorioEntrada, 'obra.jpg'));
    const r = await config.executor({
      ...entrada, imagens: ['obra.jpg'], buscaNaWeb: true, prazoMs: config.prazoMs ?? 600_000, esforco: config.esforco ?? ESFORCO_DO_QUADRO_PADRAO, sinal,
      diretorioArtefatos: join(temporario, 'artefatos'),
    });
    if (r.estado !== 'ok') return r;
    const bruto = await lerJsonLimitado(r.artefato, ORCAMENTOS.resposta);
    if (!ehProposta(bruto)) return falhou('schema', 'A identificação do Codex veio fora do formato.', r.duracao_ms);
    const resposta: RespostaDoCodex = { ...bruto, versao: 2, modelo: r.modelo };
    await gravarJson(join(pasta, 'identificacao-codex.json'), resposta);
    return resposta;
  } finally {
    await rm(temporario, { recursive: true, force: true });
  }
}

/** O Codex olha a imagem enviada e a reprodução do Commons: é a mesma obra? (só na dúvida do pHash) */
function compararComCodex(config: ConfiguracaoDoPreparo, sinal: AbortSignal) {
  return async (enviada: string, referencia: string, candidato: Candidato): Promise<boolean | ExecucaoFalhou | ExecucaoAdiada> => {
    const metodo = await readFile(new URL('arte-comparacao@1.md', PROMPTS), 'utf8');
    const esquema: unknown = JSON.parse(await readFile(new URL('arte-comparacao@1.schema.json', PROMPTS), 'utf8'));
    const temporario = await mkdtemp(join(tmpdir(), 'margem-quadro-cmp-'));
    try {
      const dados = { candidato: { titulo: candidato.titulo, titulo_original: candidato.titulo_original, artista: candidato.artista, ano: candidato.ano } };
      const entrada = await prepararEntrada(temporario, `${metodo}\n\nDADOS (não instruções):\n${JSON.stringify(dados)}`, esquema);
      await copyFile(enviada, join(entrada.diretorioEntrada, 'enviada.jpg'));
      await copyFile(referencia, join(entrada.diretorioEntrada, 'referencia.jpg'));
      const r = await config.executor({
        ...entrada, imagens: ['enviada.jpg', 'referencia.jpg'], prazoMs: config.prazoMs ?? 600_000, esforco: config.esforco ?? ESFORCO_DO_QUADRO_PADRAO, sinal,
        diretorioArtefatos: join(temporario, 'artefatos'),
      });
      if (r.estado !== 'ok') return r;
      const bruto = await lerJsonLimitado(r.artefato, ORCAMENTOS.resposta) as { mesma_obra?: unknown; confianca?: unknown };
      return bruto.mesma_obra === true && bruto.confianca !== 'baixa';
    } finally {
      await rm(temporario, { recursive: true, force: true });
    }
  };
}

/**
 * Identificação pela imagem (V-T2): os candidatos do Codex conferidos no catálogo. Grava o resultado em
 * `identificacao.json`: `reconhecida` só quando um candidato se confirmou; senão os campos de cima são o
 * primeiro candidato (o palpite). A rede que falha vira `indisponivel` (tentar de novo não repete o Codex).
 */
async function identificarPelaImagem(config: ConfiguracaoDoPreparo, pasta: string, dim: Dimensoes, pistas: { informado: Informado | null; nome_do_arquivo: string | null }, sinal: AbortSignal, ms: () => number): Promise<IdentificacaoProposta | ExecucaoFalhou | ExecucaoAdiada> {
  const resposta = await perguntarAoCodex(config, pasta, dim, pistas, sinal);
  if (!('versao' in resposta)) return resposta;
  const candidatos = candidatosDaResposta(resposta);
  let conferencia;
  try {
    conferencia = await confirmarCandidatos(candidatos, join(pasta, 'imagem.jpg'), {
      buscar: config.buscar ?? buscarNaRede, baixar: config.baixar ?? baixarNaRede,
      ...(config.compararComCodex === false ? {} : { comparar: compararComCodex(config, sinal) }),
    });
  } catch {
    if (sinal.aborted) return falhou('cancelado', 'Preparo cancelado.', ms());
    return falhou('indisponivel', 'Não consegui conferir a obra no Wikidata e no Wikimedia Commons agora. Confira a conexão e tente de novo.', ms());
  }
  if ('estado' in conferencia) return conferencia;
  const { confirmada, tentativas } = conferencia;
  const escolhido = confirmada?.candidato ?? candidatos[0] ?? null;
  const proposta: IdentificacaoProposta = {
    versao: 1, reconhecida: confirmada !== null,
    titulo: escolhido?.titulo ?? null, titulo_original: escolhido?.titulo_original ?? null, artista: escolhido?.artista ?? null, ano: escolhido?.ano ?? null,
    confianca: confirmada && confirmada.metodo !== 'catalogo' ? 'alta' : escolhido?.confianca ?? resposta.confianca,
    justificativa: resposta.justificativa, modelo: resposta.modelo, candidatos, reconhecida_pelo_modelo: resposta.reconhecida,
    confirmacao: confirmada ? { metodo: confirmada.metodo, qid: confirmada.qid, arquivo_commons: confirmada.arquivo_commons, distancia: confirmada.distancia } : null,
    tentativas,
  };
  await gravarJson(join(pasta, 'identificacao.json'), proposta);
  return proposta;
}

/** Distribui as palavras da fala dentro do tempo da batida, pelo tamanho de cada uma. */
function palavrasNaFala(fala: string, inicio: number, fim: number): ManifestoDaNarracao['batidas'][number]['palavras'] {
  const palavras = fala.split(/\s+/u).filter((p) => p !== '');
  const total = palavras.reduce((soma, p) => soma + p.length + 1, 0) || 1;
  let cursor = inicio;
  return palavras.map((p) => {
    const duracao = ((p.length + 1) / total) * (fim - inicio);
    const palavra = { texto: p.replace(/[.,;:!?…»”"]+$/u, ''), inicio_s: Math.round(cursor * 1000) / 1000, fim_s: Math.round((cursor + duracao * 0.9) * 1000) / 1000 };
    cursor += duracao;
    return palavra;
  });
}

/** Narra a análise curta (uma cena por batida) e grava `audio/<rotulo>/` no formato do acervo. */
async function narrarAnalise(pasta: string, rotulo: string, narracao: Narracao, sinal: AbortSignal): Promise<void> {
  const base = join(pasta, 'geracoes', rotulo);
  const bytesDaCurta = await readFile(join(base, 'curta.json'));
  const curta = JSON.parse(bytesDaCurta.toString('utf8')) as AnaliseCurtaDaObraV1;
  const cenas = curta.batidas.map((b, i) => ({ cena: `b${String(i + 1).padStart(3, '0')}`, texto: b.narracao, novoBloco: i > 0 }));
  const gerada = await narracao.provedor.narrar({ cenas, voz_id: narracao.voz_id, modelo_id: narracao.modelo_id, sinal });
  const tempos = new Map(gerada.cenas.map((c) => [c.cena, c]));
  const batidas = cenas.map((c, indice) => {
    const t = tempos.get(c.cena);
    if (!t) throw new Error(`A narração voltou sem a batida ${String(indice + 1)}.`);
    return { indice, inicio_s: t.inicio_s, fim_s: t.fim_s, texto: curta.batidas[indice]!.narracao, palavras: palavrasNaFala(curta.batidas[indice]!.narracao, t.inicio_s, t.fim_s) };
  });
  const manifesto: ManifestoDaNarracao = {
    versao: 1, analise: rotulo, curta_sha256: createHash('sha256').update(bytesDaCurta).digest('hex'),
    voz: { perfil: narracao.voz_nome ?? narracao.voz_id, modelo: narracao.modelo_id, seed: 0 }, arquivo: 'narracao.mp3', duracao_s: gerada.total_s, batidas,
  };
  const { erros } = conferirManifesto(manifesto, curta);
  if (erros.length) throw new Error(`Narração recusada (${erros.join(', ')}).`);
  const pastaDoAudio = join(pasta, 'audio', rotulo);
  await mkdir(pastaDoAudio, { recursive: true });
  await writeFile(join(pastaDoAudio, 'narracao.mp3'), gerada.mp3);
  await gravarJson(join(pastaDoAudio, 'manifesto.json'), manifesto);
}

interface ResultadoDoPreparo {
  versao: 1; quadro_id: string; slug: string; rotulo: string;
  /** `null`: obra não identificada, analisada só pela imagem (V-W5). */
  identificacao: (IdentificacaoDaObraV1 & { origem: 'pessoa' | 'codex' | 'acervo' }) | null;
  narracao: boolean; avisos: string[];
}

export async function executarPreparo(config: ConfiguracaoDoPreparo, tarefa: Tarefa): Promise<ResultadoExecutor> {
  const inicio = Date.now();
  const ms = () => Date.now() - inicio;
  const { quadro_id } = lerChaveDoPreparo(entradaDoJob(tarefa.job.entrada).dedup_key);
  const linha = await comTransacao(config.banco, (cliente) => repo.obter(cliente, quadro_id));
  if (!linha || linha.job_id !== tarefa.job.id) return falhou('cancelado', 'A obra foi removida ou ganhou um pedido mais novo.', ms());
  const raiz = config.raiz?.() ?? raizDoAcervo();
  const pasta = join(raiz, linha.slug);
  if (!existsSync(pasta)) return falhou('imagem_invalida', 'A pasta da obra sumiu do disco. Remova a obra e envie a imagem de novo.', ms());
  const sinal = tarefa.sinal;
  const narracao = await narracaoConfigurada(config);
  const etapas: EtapaDoQuadroDaPessoa[] = ['imagem', ...(linha.identificacao ? [] : ['identificacao' as const]), 'dossie', 'analise', 'analise', 'analise', 'analise', ...(narracao ? ['narracao' as const] : [])];
  let feitas = 0;
  const progresso = async (etapa: EtapaDoQuadroDaPessoa): Promise<void> => {
    const valor: PreparoEmCurso = { versao: 1, job_id: tarefa.job.id, etapa, feitas: Math.min(feitas, etapas.length), total: etapas.length, atualizado_em: new Date().toISOString() };
    try { await gravarJson(join(pasta, 'preparo.json'), valor); } catch { /* o progresso é só informativo */ }
  };
  const dimensoes = config.dimensoes ?? dimensoesDaImagem;
  try {
    // 1. imagem
    await progresso('imagem');
    const imagem = join(pasta, 'imagem.jpg');
    if (!existsSync(imagem) || !existsSync(join(pasta, 'imagem.json'))) {
      const original = join(pasta, `original.${EXTENSAO_DO_FORMATO[linha.formato]}`);
      const temporario = join(pasta, 'imagem.tmp.jpg');
      let normalizada;
      try { normalizada = await (config.normalizar ?? normalizadorComFfmpeg(dimensoes))(original, temporario, linha.formato); }
      catch { await rm(temporario, { force: true }); return falhou('imagem_invalida', MENSAGEM_DA_IMAGEM, ms()); }
      if (Math.min(normalizada.largura, normalizada.altura) < LADO_MINIMO) {
        await rm(temporario, { force: true });
        return falhou('imagem_invalida', `A imagem é pequena demais (${String(normalizada.largura)} × ${String(normalizada.altura)} px). Envie uma com pelo menos ${String(LADO_MINIMO)} px no menor lado.`, ms());
      }
      await renomearComRetentativa(temporario, imagem);
      await gravarJson(join(pasta, 'imagem.json'), {
        origem_url: null, arquivo_url: null, licenca: null, credito: 'Imagem enviada por você',
        sha256: createHash('sha256').update(await readFile(imagem)).digest('hex'), largura: normalizada.largura, altura: normalizada.altura,
        baixado_em: linha.criado_em.toISOString(),
      });
    }
    const info = await lerJsonOuNulo(join(pasta, 'imagem.json')) as { largura?: number; altura?: number } | null;
    const dim: Dimensoes = typeof info?.largura === 'number' && typeof info.altura === 'number' ? { largura: info.largura, altura: info.altura } : await dimensoes(imagem);
    feitas += 1;

    // 2. identificação: a da pessoa; senão a obra de exemplo pelo SHA-256; senão o Codex pela imagem. Sem
    // reconhecimento, a obra segue só pela imagem (V-W5): nada de recusar por falta de título e artista.
    let identificacao: ResultadoDoPreparo['identificacao'];
    let palpite: string | null = null;
    if (linha.identificacao) identificacao = { titulo: linha.identificacao.titulo, artista: linha.identificacao.artista, ano: linha.identificacao.ano ?? null, origem: 'pessoa' };
    else {
      await progresso('identificacao');
      let proposta = await lerIdentificacaoProposta(pasta) ?? await reconhecerPeloAcervo(pasta, linha.sha256_original);
      if (!proposta) {
        const r = await identificarPelaImagem(config, pasta, dim, { informado: await lerInformado(pasta), nome_do_arquivo: linha.nome_do_arquivo }, sinal, ms);
        if ('estado' in r) return r;
        proposta = r;
      }
      if (propostaReconhecida(proposta)) identificacao = { titulo: proposta.titulo!, artista: proposta.artista!, ano: proposta.ano, origem: proposta.modelo === MODELO_DO_ACERVO ? 'acervo' : 'codex' };
      else { identificacao = null; palpite = palpiteDaProposta(proposta); }
      feitas += 1;
    }

    // 3. dossiê (rede, só aqui). Obra que o Codex (ou o acervo) propôs e o Wikidata não conhece também segue só
    // pela imagem, com o nome proposto como palpite; o que a pessoa informou e não se acha continua pedindo correção.
    await progresso(identificacao === null ? 'analise' : 'dossie');
    if (identificacao !== null && !existsSync(join(pasta, 'dossie-auto.json'))) {
      const buscar = config.buscar ?? buscarNaRede;
      // A identificação confirmada já diz onde está a obra: o item do Wikidata ou o arquivo do Commons (V-T2).
      const confirmacao = identificacao.origem === 'pessoa' ? null : (await lerIdentificacaoProposta(pasta))?.confirmacao ?? null;
      try {
        if (confirmacao?.qid) await buscarDossiePorItem(pasta, confirmacao.qid, identificacao, buscar);
        else if (confirmacao?.arquivo_commons) await buscarDossieDoCommons(pasta, confirmacao.arquivo_commons, identificacao, buscar);
        else await buscarDossiePorIdentificacao(pasta, identificacao, buscar);
      }
      catch (erro) {
        if (erro instanceof ObraNaoEncontrada && identificacao.origem !== 'pessoa') {
          const proposta = await lerIdentificacaoProposta(pasta);
          palpite = proposta ? palpiteDaProposta(proposta) : `talvez «${identificacao.titulo}», de ${identificacao.artista}`;
          identificacao = null;
        } else if (erro instanceof ObraNaoEncontrada) return falhou('obra_nao_encontrada', `${erro.message} Confira o título e o artista e tente de novo.`, ms());
        else return falhou('indisponivel', 'Não consegui consultar o Wikidata e a Wikipédia agora. Confira a conexão e tente de novo.', ms());
      }
    }
    feitas += 1;

    // 4. análise (quatro chamadas ao Codex, mais um reparo do roteiro se preciso; retoma o que já foi feito)
    await progresso('analise');
    const antesDaAnalise = feitas;
    let resultado;
    try {
      resultado = await gerarQuadroV2(linha.slug, {
        executor: config.executor, rotulo: linha.rotulo, raiz, esforco: config.esforco ?? ESFORCO_DO_QUADRO_PADRAO, reparo: true, sinal,
        ...(identificacao === null ? { dossie: 'imagem' as const, palpite } : { dossie: 'auto' as const }),
        ...(config.prazoMs === undefined ? {} : { prazoMs: config.prazoMs }),
        ...(config.preparar ? { preparar: config.preparar } : {}), dimensoes: () => Promise.resolve(dim),
        aoChamar: (etapa) => {
          const indice = ETAPAS_DA_ANALISE.indexOf(etapa);
          feitas = antesDaAnalise + (indice < 0 ? ETAPAS_DA_ANALISE.length - 1 : indice);
          void progresso('analise');
        },
      });
    } catch (erro) {
      if (erro instanceof EtapaNaoConcluida) return { ...erro.resultado, duracao_ms: ms() };
      throw erro;
    }
    const lida = await lerObraDoAcervo(raiz, linha.slug, () => undefined);
    if (!lida?.analises.some((a) => a.rotulo === linha.rotulo)) {
      const motivos = [...resultado.registro.diagnosticos.modelo, ...resultado.registro.diagnosticos.curta];
      return falhou('analise_recusada', `A análise gerada não passou nas conferências${motivos.length ? ` (${motivos.slice(0, 4).join(', ')})` : ''}. Tente de novo.`, ms());
    }
    feitas = antesDaAnalise + ETAPAS_DA_ANALISE.length;

    // 5. narração (opcional; uma falha aqui não impede a obra de ficar pronta)
    const avisos: string[] = [];
    let narrada = false;
    if (narracao) {
      await progresso('narracao');
      try { await narrarAnalise(pasta, linha.rotulo, narracao, sinal); narrada = true; }
      catch (erro) { avisos.push(redigir(`Sem narração: ${erro instanceof Error ? erro.message : String(erro)}`, narracao.chave).slice(0, 500)); }
      feitas += 1;
    }

    const conteudo: ResultadoDoPreparo = { versao: 1, quadro_id, slug: linha.slug, rotulo: linha.rotulo, identificacao, narracao: narrada, avisos };
    const corpo = `${JSON.stringify(conteudo, null, 2)}\n`;
    const artefato = join(pasta, 'geracoes', linha.rotulo, 'preparo-resultado.json');
    await writeFile(artefato, corpo);
    const ultima = resultado.registro.etapas.at(-1);
    return {
      estado: 'ok', artefato, sha256: sha256(corpo), duracao_ms: ms(), modelo: ultima?.modelo ?? 'codex',
      esforco: ultima?.esforco ?? config.esforco ?? ESFORCO_DO_QUADRO_PADRAO,
    };
  } catch (erro) {
    if (sinal.aborted) return falhou('cancelado', 'Preparo cancelado.', ms());
    return falhou('desconhecido', erro instanceof Error ? erro.message.slice(0, 500) : 'Falha desconhecida no preparo da obra.', ms());
  }
}

// ---------------------------------------------------------------- publicação

export async function publicarPreparo(tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao, raiz: string): Promise<JobResultV1> {
  const cliente = exigirTransacao(contexto);
  const { quadro_id } = lerChaveDoPreparo(entradaDoJob(tarefa.job.entrada).dedup_key);
  const linha = await repo.obter(cliente, quadro_id, { travar: true });
  if (!linha) throw new Error('A obra foi removida antes de ficar pronta.');
  if (linha.job_id !== tarefa.job.id) throw new Error('A obra ganhou um pedido mais novo; esta preparação não publica.');
  const resultado = await lerJsonLimitado(execucao.artefato, ORCAMENTOS.resposta) as ResultadoDoPreparo;
  if (resultado.quadro_id !== quadro_id || resultado.rotulo !== linha.rotulo) throw new Error('O resultado do preparo não é desta obra.');
  // O arquivo é idempotente: publicar duas vezes aponta para a mesma análise.
  await gravarJson(join(raiz, linha.slug, 'publicado.json'), { analise: `geracoes/${linha.rotulo}` });
  await repo.marcarPronto(cliente, quadro_id);
  return {
    job_id: contexto.job.id, attempt: contexto.job.attempt, lease_token: contexto.lease_token, duracao_ms: execucao.duracao_ms,
    estado: 'ok', modelo: execucao.modelo, artefato: { caminho: execucao.artefato, sha256: execucao.sha256 },
    diagnosticos: resultado.avisos.map((mensagem) => ({ nivel: 'aviso' as const, codigo: 'narracao', mensagem })),
  };
}

export function manipuladoresDosQuadros(config: ConfiguracaoDoPreparo): Record<string, Manipulador> {
  return {
    [TIPO_PREPARAR_QUADRO]: {
      executar: (tarefa) => executarPreparo(config, tarefa),
      publicar: (tarefa, execucao, contexto) => publicarPreparo(tarefa, execucao, contexto, config.raiz?.() ?? raizDoAcervo()),
    },
  };
}
