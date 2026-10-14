/**
 * Análise própria do vídeo (noite2/video-popups; J142). O job `conceitos_do_video` lê a transcrição
 * alinhada (MidiaV1 + blocos da versão) e pede ao Codex (`conceitos-do-video@3`) as **partes** do vídeo
 * por assunto e os **momentos** que aparecem sobre o vídeo no tempo certo (os popups: conceito, dado,
 * contexto ou pergunta, com o rótulo `curto` da pílula). Publica o que passou na conferência:
 *
 * - cada parte começa num parágrafo falado (o instante é o da primeira palavra dele); partes no mesmo
 *   parágrafo ou fora da transcrição caem com diagnóstico;
 * - o modelo devolve parágrafo (`P…`) + citação literal; o serviço exige que a citação apareça uma
 *   única vez no parágrafo e resolve a âncora e o instante (o tempo da primeira palavra citada);
 * - momentos repetidos, a menos de 45 s do anterior ou além do teto pela duração caem, com
 *   diagnóstico visível; um `curto` fora da regra (1–3 palavras, ≤ 20 caracteres) não é guardado, e a
 *   web o deriva do título.
 *
 * A chave `conceitos:<mídia>:<prompt>:<n>` torna o pedido idempotente; `n` só cresce depois de uma
 * falha, para "Preparar" de novo poder tentar outra vez. Conceitos prontos de um prompt anterior
 * podem ser pedidos de novo com o prompt atual (o derivado é imutável: entra outro, mais novo).
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { ulid } from 'ulid';
import type { AncoraV1, Bloco, ConceitoDoVideoV1, ConceitosDoVideoV1, Id, JobResultV1, MidiaV1, ParteDoVideoV1, TipoDoMomentoV1 } from '@margem/contratos';
import { formatarTempo } from '@margem/core';
import { idDoVideoDoYoutube } from '@margem/core/youtube';
import { comTransacao, type Transacao } from '../db/transacao.js';
import { sha256 } from '../executor/artefato.js';
import { registrarNaAuditoria } from '../executor/auditoria.js';
import { prepararEntrada } from '../executor/entrada.js';
import { falhou, type ExecucaoOk, type Executor, type ResultadoExecutor } from '../executor/tipos.js';
import { lerPrompt, corpoDoModelo, preencher, type SchemaJson } from '../leitura/v2/prompt.js';
import * as camadasRepo from '../repos/camadas.js';
import { obterVersao } from '../repos/documentos.js';
import * as marcasRepo from '../repos/marcas.js';
import * as jobsRepo from '../repos/jobs.js';
import { exigirTransacao } from '../worker/canonizar.js';
import { entradaDoJob } from '../worker/fila-postgres.js';
import type { ContextoPublicacao } from '../worker/fila.js';
import type { Manipulador, Tarefa } from '../worker/worker.js';
import { ancoraNoBloco } from './revisao.js';

export const TIPO_CONCEITOS_DO_VIDEO = 'conceitos_do_video';
export const PROMPT_DOS_CONCEITOS = 'conceitos-do-video@3';
/** Um vídeo de uma hora leva poucos minutos com `medium`. */
export const PRAZO_DOS_CONCEITOS_MS = 900_000;
/** Dois cartões não aparecem a menos disto um do outro. */
export const INTERVALO_MINIMO_S = 45;
/** Mais partes do que isto deixa de ser um índice. */
export const MAXIMO_DE_PARTES = 15;
export const TIPOS_DO_MOMENTO: readonly TipoDoMomentoV1[] = ['conceito', 'dado', 'contexto', 'pergunta'];

export interface ConfiguracaoDosConceitos {
  banco: pg.Pool;
  executor: Executor;
  modelo: string;
  esforco: string;
  prazoMs?: number;
  diretorioArtefatos?: string;
  novoId?: () => Id;
  agora?: () => Date;
}

// ---------------------------------------------------------------- chave, fila e estado

const prefixoDaChave = (midiaId: Id): string => `conceitos:${midiaId}:${PROMPT_DOS_CONCEITOS}:`;
export function lerChaveDosConceitos(dedupKey: string): Id {
  const [prefixo, midia] = dedupKey.split(':');
  if (prefixo !== 'conceitos' || !midia) throw new Error(`Chave de conceitos malformada: ${dedupKey}`);
  return midia;
}

export class MidiaInexistente extends Error {
  constructor() { super('Mídia inexistente.'); this.name = 'MidiaInexistente'; }
}

/** Mídia que se assiste: arquivo de vídeo, ou o áudio de um vídeo do YouTube (que toca pelo player embutido). */
export function midiaDeVideo(midia: { tipo: string; url?: string | null }): boolean {
  return midia.tipo === 'video' || (typeof midia.url === 'string' && idDoVideoDoYoutube(midia.url) !== null);
}

export type EstadoDosConceitos = 'nao_preparado' | 'preparando' | 'pronto' | 'falhou';

export async function conceitosDaMidia(cliente: Transacao | pg.Pool, midiaId: Id): Promise<ConceitosDoVideoV1 | null> {
  const { rows: [linha] } = await cliente.query<{ conteudo: ConceitosDoVideoV1 }>(
    'SELECT conteudo FROM conceitos_video WHERE midia_id=$1 ORDER BY criado_em DESC, id DESC LIMIT 1', [midiaId]);
  return linha?.conteudo ?? null;
}

async function ultimoJob(cliente: Transacao, midiaId: Id): Promise<{ estado: string } | undefined> {
  const { rows: [job] } = await cliente.query<{ estado: string }>(
    'SELECT estado FROM job WHERE tipo=$1 AND dedup_key LIKE $2 ORDER BY criado_em DESC, id DESC LIMIT 1',
    [TIPO_CONCEITOS_DO_VIDEO, `${prefixoDaChave(midiaId)}%`]);
  return job;
}

export async function estadoDosConceitos(cliente: Transacao, midiaId: Id): Promise<{ estado: EstadoDosConceitos; conceitos: ConceitosDoVideoV1 | null }> {
  const conceitos = await conceitosDaMidia(cliente, midiaId);
  const job = await ultimoJob(cliente, midiaId);
  if (job && ['fila', 'reservado', 'adiado'].includes(job.estado)) return { estado: 'preparando', conceitos };
  if (conceitos) return { estado: 'pronto', conceitos };
  return { estado: job?.estado === 'falhou' || job?.estado === 'cancelado' ? 'falhou' : 'nao_preparado', conceitos: null };
}

/**
 * Enfileira a escolha dos conceitos. Preparando, ou pronto com o prompt atual: nada muda. Depois de
 * uma falha, ou pronto com um prompt anterior: outra tentativa, com o prompt atual.
 */
export async function pedirConceitos(cliente: Transacao, midiaId: Id, prioridade: number = jobsRepo.PRIORIDADE.artefato_pedido): Promise<void> {
  const { rows: [midia] } = await cliente.query<{ versao_id: Id; documento_id: Id; tipo: string }>('SELECT versao_id, documento_id, tipo FROM midia WHERE id=$1', [midiaId]);
  if (!midia) throw new MidiaInexistente();
  const { estado, conceitos } = await estadoDosConceitos(cliente, midiaId);
  if (estado === 'preparando' || (estado === 'pronto' && conceitos?.execucao.prompt === PROMPT_DOS_CONCEITOS)) return;
  const { rows: [{ n } = { n: 0 }] } = await cliente.query<{ n: number }>('SELECT count(*)::int AS n FROM job WHERE tipo=$1 AND dedup_key LIKE $2',
    [TIPO_CONCEITOS_DO_VIDEO, `${prefixoDaChave(midiaId)}%`]);
  const chave = `${prefixoDaChave(midiaId)}${String(n)}`;
  // O documento no job: a lista de execuções do Codex mostra de que vídeo é.
  await jobsRepo.enfileirar(cliente, { tipo: TIPO_CONCEITOS_DO_VIDEO, dedup_key: chave, input_snapshot_hash: sha256(chave), documento_id: midia.documento_id, versao_id: midia.versao_id, prioridade });
}

// ---------------------------------------------------------------- prompt (puro)

export interface ParagrafoFalado { alias: string; bloco: Pick<Bloco, 'id' | 'texto'>; inicio_s: number }
/** Um momento proposto. `curto` só vem desde a @2 e `tipo` desde a @3; artefatos anteriores não os têm. */
export interface MomentoProposto { paragrafo: string; citacao: string; tipo?: string; titulo: string; curto?: string; explicacao: string }
export interface PartePropostaDoVideo { paragrafo: string; titulo: string; resumo: string }
/** A @3 devolve `momentos` e `partes`; a @1 e a @2, só `conceitos`. */
export interface SaidaDosConceitos { conceitos?: MomentoProposto[]; momentos?: MomentoProposto[]; partes?: PartePropostaDoVideo[] }
const momentosDaSaida = (saida: SaidaDosConceitos): MomentoProposto[] => saida.momentos ?? saida.conceitos ?? [];

/** Os parágrafos que a fala cobre, na ordem do texto, com o instante em que começam. */
export function paragrafosFalados(blocos: readonly Pick<Bloco, 'id' | 'texto'>[], midia: Pick<MidiaV1, 'palavras'>): ParagrafoFalado[] {
  const inicio = new Map<Id, number>();
  for (const p of midia.palavras) if (!inicio.has(p.bloco_id)) inicio.set(p.bloco_id, p.inicio_s);
  return blocos.filter((b) => inicio.has(b.id)).map((bloco, i) => ({ alias: `P${String(i + 1)}`, bloco, inicio_s: inicio.get(bloco.id)! }));
}

/** Quantos momentos: um a cada 2,5–4 minutos, pelo menos um. */
export function faixaDeQuantidade(duracao_s: number): { minimo: number; maximo: number } {
  const maximo = Math.max(1, Math.round(duracao_s / 150));
  return { minimo: Math.max(1, Math.min(maximo, Math.floor(duracao_s / 240))), maximo };
}

/** Quantas partes no máximo: uma a cada 2 minutos, de 2 a 15. */
export function maximoDePartes(duracao_s: number): number {
  return Math.max(2, Math.min(MAXIMO_DE_PARTES, Math.round(duracao_s / 120)));
}

/** Um grifo do texto, como o prompt o mostra: a função e o trecho exato. */
export interface GrifoDoTexto { funcao: string; ancora: Pick<AncoraV1, 'bloco_id' | 'citacao'> }
/** Mais do que isto não ajuda o modelo a escolher e só alonga o prompt. */
const MAXIMO_DE_GRIFOS = 120;

/** Os grifos dos parágrafos falados, na ordem do texto: `- P12 · hipotese · "trecho"`. */
export function listaDosGrifos(grifos: readonly GrifoDoTexto[], paragrafos: readonly ParagrafoFalado[]): string {
  const ordem = new Map(paragrafos.map((p, i) => [p.bloco.id, i]));
  const linhas = grifos.filter((g) => ordem.has(g.ancora.bloco_id))
    .sort((a, b) => ordem.get(a.ancora.bloco_id)! - ordem.get(b.ancora.bloco_id)!)
    .slice(0, MAXIMO_DE_GRIFOS)
    .map((g) => `- ${paragrafos[ordem.get(g.ancora.bloco_id)!]!.alias} · ${g.funcao} · "${g.ancora.citacao.replace(/\s+/gu, ' ').trim()}"`);
  return linhas.length === 0 ? '(nenhum grifo neste vídeo)' : linhas.join('\n');
}

export function montarPromptDosConceitos(midia: Pick<MidiaV1, 'titulo' | 'duracao_s' | 'fonte' | 'palavras'> & Partial<Pick<MidiaV1, 'capitulos'>>, blocos: readonly Pick<Bloco, 'id' | 'texto'>[], grifos: readonly GrifoDoTexto[] = []): { prompt: string; schema: SchemaJson; paragrafos: ParagrafoFalado[] } {
  const paragrafos = paragrafosFalados(blocos, midia);
  if (paragrafos.length === 0) throw new Error('A mídia não tem palavras alinhadas ao texto.');
  const { minimo, maximo } = faixaDeQuantidade(midia.duracao_s);
  const prompt = preencher(corpoDoModelo(lerPrompt(`${PROMPT_DOS_CONCEITOS}.md`)), {
    titulo: midia.titulo.replace(/\s+/gu, ' ').trim(),
    canal: midia.fonte?.canal ?? 'desconhecido',
    duracao: formatarTempo(midia.duracao_s),
    transcricao: paragrafos.map((p) => `[${p.alias} · ${formatarTempo(p.inicio_s)}] ${p.bloco.texto.replace(/\s+/gu, ' ').trim()}`).join('\n\n'),
    minimo: String(minimo), maximo: String(maximo), maximo_de_partes: String(maximoDePartes(midia.duracao_s)),
    capitulos: (midia.capitulos ?? []).length === 0 ? '(nenhum)' : (midia.capitulos ?? []).map((c) => `- ${formatarTempo(c.inicio_s)} ${c.titulo.replace(/\s+/gu, ' ').trim()}`).join('\n'),
    grifos: listaDosGrifos(grifos, paragrafos),
  });
  const schema = JSON.parse(lerPrompt(`${PROMPT_DOS_CONCEITOS}.schema.json`)) as SchemaJson;
  return { prompt, schema, paragrafos };
}

// ---------------------------------------------------------------- resolução (pura)

/** O rótulo da pílula: 1 a 3 palavras, até 20 caracteres, sem pergunta. Fora disso, `null`. */
export const MAXIMO_DO_CURTO = 20;
export function curtoValido(bruto: string | undefined): string | null {
  const curto = (bruto ?? '').replace(/\s+/gu, ' ').trim();
  if (curto === '' || curto.length > MAXIMO_DO_CURTO || curto.split(' ').length > 3 || /[?!]/u.test(curto)) return null;
  return curto;
}

export interface ResolucaoDosConceitos { conceitos: ConceitoDoVideoV1[]; partes: ParteDoVideoV1[]; diagnosticos: ConceitosDoVideoV1['diagnosticos'] }

const tipoDoMomento = (bruto: string | undefined): TipoDoMomentoV1 | null =>
  bruto === undefined ? null : (TIPOS_DO_MOMENTO as readonly string[]).includes(bruto) ? bruto as TipoDoMomentoV1 : null;

/**
 * As partes por assunto: cada uma começa no primeiro instante do seu parágrafo. Fora da transcrição ou no
 * mesmo parágrafo de outra: cai com diagnóstico. Acima do teto, ficam as primeiras.
 */
export function resolverPartes(propostas: readonly PartePropostaDoVideo[], contexto: {
  versaoId: Id; paragrafos: readonly ParagrafoFalado[]; duracao_s: number; novoId?: () => Id;
}): { partes: ParteDoVideoV1[]; diagnosticos: ConceitosDoVideoV1['diagnosticos'] } {
  const diagnosticos: ConceitosDoVideoV1['diagnosticos'] = [];
  const porAlias = new Map(contexto.paragrafos.map((p) => [p.alias, p]));
  const usados = new Set<string>();
  const partes: ParteDoVideoV1[] = [];
  for (const proposta of propostas) {
    const rotulo = `parte “${proposta.titulo}” (${proposta.paragrafo})`;
    const paragrafo = porAlias.get(proposta.paragrafo);
    if (!paragrafo) { diagnosticos.push({ codigo: 'parte_fora', mensagem: `${rotulo}: parágrafo fora da transcrição.` }); continue; }
    if (usados.has(paragrafo.alias)) { diagnosticos.push({ codigo: 'parte_repetida', mensagem: `${rotulo}: outra parte já começa nesse parágrafo.` }); continue; }
    usados.add(paragrafo.alias);
    partes.push({ id: (contexto.novoId ?? ulid)(), instante_s: paragrafo.inicio_s, titulo: proposta.titulo.replace(/\s+/gu, ' ').trim(),
      resumo: proposta.resumo.replace(/\s+/gu, ' ').trim(), ancora: ancoraNoBloco(contexto.versaoId, paragrafo.bloco, '') });
  }
  partes.sort((a, b) => a.instante_s - b.instante_s);
  const teto = maximoDePartes(contexto.duracao_s);
  if (partes.length > teto) {
    diagnosticos.push({ codigo: 'partes_demais', mensagem: `${String(partes.length)} partes passam do teto de ${String(teto)} para a duração; ficam as primeiras.` });
    partes.splice(teto);
  }
  return { partes, diagnosticos };
}

function ocorrencias(texto: string, trecho: string): number {
  let n = 0;
  for (let i = texto.indexOf(trecho); i >= 0; i = texto.indexOf(trecho, i + 1)) n++;
  return n;
}

/**
 * Confere cada proposta e resolve âncora e instante. Nada de escolha silenciosa: citação ausente ou
 * repetida no parágrafo cai com diagnóstico; o instante é o da primeira palavra alinhada da citação.
 */
export function resolverConceitos(saida: SaidaDosConceitos, contexto: {
  versaoId: Id; paragrafos: readonly ParagrafoFalado[]; midia: Pick<MidiaV1, 'palavras' | 'duracao_s'>; novoId?: () => Id;
}): ResolucaoDosConceitos {
  const diagnosticos: ConceitosDoVideoV1['diagnosticos'] = [];
  const porAlias = new Map(contexto.paragrafos.map((p) => [p.alias, p]));
  const candidatos: ConceitoDoVideoV1[] = [];
  for (const proposta of momentosDaSaida(saida)) {
    const rotulo = `“${proposta.titulo}” (${proposta.paragrafo})`;
    const paragrafo = porAlias.get(proposta.paragrafo);
    if (!paragrafo) { diagnosticos.push({ codigo: 'paragrafo_inexistente', mensagem: `${rotulo}: parágrafo fora da transcrição.` }); continue; }
    const citacao = proposta.citacao.trim();
    const vezes = citacao === '' ? 0 : ocorrencias(paragrafo.bloco.texto, citacao);
    if (vezes !== 1) {
      diagnosticos.push({ codigo: vezes === 0 ? 'citacao_ausente' : 'citacao_ambigua', mensagem: `${rotulo}: a citação ${vezes === 0 ? 'não está' : 'aparece mais de uma vez'} no parágrafo.` });
      continue;
    }
    const ancora = ancoraNoBloco(contexto.versaoId, paragrafo.bloco, citacao);
    const palavra = contexto.midia.palavras.find((p) => p.bloco_id === paragrafo.bloco.id && p.fim_utf16 > ancora.inicio_utf16);
    if (!palavra || palavra.inicio_utf16 >= ancora.fim_utf16) { diagnosticos.push({ codigo: 'sem_tempo', mensagem: `${rotulo}: a citação não tem palavra com tempo.` }); continue; }
    const tipo = tipoDoMomento(proposta.tipo);
    if (proposta.tipo !== undefined && tipo === null) diagnosticos.push({ codigo: 'tipo_invalido', mensagem: `${rotulo}: tipo “${proposta.tipo}” desconhecido; fica como conceito.` });
    const curto = curtoValido(proposta.curto);
    if (proposta.curto !== undefined && curto === null) diagnosticos.push({ codigo: 'curto_invalido', mensagem: `${rotulo}: o rótulo curto “${proposta.curto}” foge da regra (1–3 palavras, até ${String(MAXIMO_DO_CURTO)} caracteres); fica o derivado do título.` });
    candidatos.push({ id: (contexto.novoId ?? ulid)(), instante_s: palavra.inicio_s, ...(tipo === null ? {} : { tipo }), titulo: proposta.titulo.trim(), ...(curto === null ? {} : { curto }), explicacao: proposta.explicacao.trim(), ancora });
  }
  candidatos.sort((a, b) => a.instante_s - b.instante_s);
  const { maximo } = faixaDeQuantidade(contexto.midia.duracao_s);
  const conceitos: ConceitoDoVideoV1[] = [];
  const titulos = new Set<string>();
  for (const c of candidatos) {
    const chave = c.titulo.toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const anterior = conceitos.at(-1);
    if (titulos.has(chave)) diagnosticos.push({ codigo: 'repetido', mensagem: `“${c.titulo}” já tinha aparecido.` });
    else if (anterior && c.instante_s - anterior.instante_s < INTERVALO_MINIMO_S) diagnosticos.push({ codigo: 'perto_demais', mensagem: `“${c.titulo}” ficaria a menos de ${String(INTERVALO_MINIMO_S)} s de “${anterior.titulo}”.` });
    else if (conceitos.length >= maximo) diagnosticos.push({ codigo: 'excesso', mensagem: `“${c.titulo}” passaria do teto de ${String(maximo)} cartões para a duração.` });
    else { conceitos.push(c); titulos.add(chave); }
  }
  const partes = resolverPartes(saida.partes ?? [], {
    versaoId: contexto.versaoId, paragrafos: contexto.paragrafos, duracao_s: contexto.midia.duracao_s, ...(contexto.novoId ? { novoId: contexto.novoId } : {}),
  });
  return { conceitos, partes: partes.partes, diagnosticos: [...diagnosticos, ...partes.diagnosticos] };
}

// ---------------------------------------------------------------- execução e publicação

interface Contexto { midia: MidiaV1; blocos: Bloco[]; grifos: GrifoDoTexto[] }

/** Os grifos que o leitor mostra: os da camada padrão e os do leitor, visíveis. */
async function grifosVisiveis(cliente: Transacao, versaoId: Id): Promise<GrifoDoTexto[]> {
  const padrao = await camadasRepo.camadaPadrao(cliente, versaoId);
  const daCamada = padrao === null ? [] : await marcasRepo.listarV2PorVersao(cliente, versaoId, { camada_id: padrao });
  const doLeitor = await marcasRepo.listarDoLeitor(cliente, versaoId);
  return [...daCamada, ...doLeitor].filter((m) => m.visivel);
}

async function montarContexto(cliente: Transacao, midiaId: Id): Promise<Contexto> {
  const { rows: [linha] } = await cliente.query<{ conteudo: MidiaV1 }>('SELECT conteudo FROM midia WHERE id=$1', [midiaId]);
  if (!linha) throw new MidiaInexistente();
  const versao = await obterVersao(cliente, linha.conteudo.versao_id);
  return { midia: linha.conteudo, blocos: versao.canonico.blocos, grifos: await grifosVisiveis(cliente, linha.conteudo.versao_id) };
}

interface ArtefatoDosConceitos { midia_id: Id; saida: SaidaDosConceitos; modelo: string; esforco: string }

function ehMomento(c: unknown): boolean {
  return typeof c === 'object' && c !== null && ['paragrafo', 'citacao', 'titulo', 'explicacao'].every((campo) => typeof (c as Record<string, unknown>)[campo] === 'string')
    && ['curto', 'tipo'].every((campo) => ['string', 'undefined'].includes(typeof (c as Record<string, unknown>)[campo]));
}
function ehParte(p: unknown): boolean {
  return typeof p === 'object' && p !== null && ['paragrafo', 'titulo', 'resumo'].every((campo) => typeof (p as Record<string, unknown>)[campo] === 'string');
}
function ehSaida(valor: unknown): valor is SaidaDosConceitos {
  const v = valor as Record<string, unknown> | null;
  if (v === null || typeof v !== 'object') return false;
  const momentos = v.momentos ?? v.conceitos;
  return Array.isArray(momentos) && momentos.every(ehMomento) && (v.partes === undefined || (Array.isArray(v.partes) && v.partes.every(ehParte)));
}

export async function executarConceitos(config: ConfiguracaoDosConceitos, tarefa: Tarefa): Promise<ResultadoExecutor> {
  const inicio = Date.now();
  const midiaId = lerChaveDosConceitos(entradaDoJob(tarefa.job.entrada).dedup_key);
  const contexto = await comTransacao(config.banco, (cliente) => montarContexto(cliente, midiaId));
  if (tarefa.sinal.aborted) return falhou('cancelado', 'Job cancelado.', Date.now() - inicio);
  const montado = montarPromptDosConceitos(contexto.midia, contexto.blocos, contexto.grifos);
  const raiz = await mkdtemp(join(tmpdir(), 'margem-conceitos-'));
  let resultado: ResultadoExecutor;
  try {
    const preparada = await prepararEntrada(raiz, montado.prompt, montado.schema);
    resultado = await config.executor({
      diretorioEntrada: preparada.diretorioEntrada, prompt: preparada.prompt, schema: preparada.schema,
      prazoMs: config.prazoMs ?? PRAZO_DOS_CONCEITOS_MS, modelo: config.modelo, esforco: config.esforco, sinal: tarefa.sinal,
      ...(config.diretorioArtefatos === undefined ? {} : { diretorioArtefatos: join(config.diretorioArtefatos, 'saidas') }),
    });
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
  if (resultado.estado !== 'ok') return resultado;
  const bruto: unknown = JSON.parse(await readFile(resultado.artefato, 'utf8'));
  if (!ehSaida(bruto)) return falhou('schema', 'Resposta fora do schema dos conceitos.', Date.now() - inicio);
  const artefato: ArtefatoDosConceitos = { midia_id: midiaId, saida: bruto, modelo: resultado.modelo, esforco: resultado.esforco ?? config.esforco };
  const texto = `${JSON.stringify(artefato, null, 2)}\n`;
  const pasta = join(config.diretorioArtefatos ?? join(homedir(), '.cache/margem/conceitos'), `conceitos-${midiaId}`);
  await mkdir(pasta, { recursive: true, mode: 0o700 });
  const caminho = join(pasta, `tentativa-${String(tarefa.job.attempt)}-${ulid()}.json`);
  await writeFile(caminho, texto, { mode: 0o600 });
  return { estado: 'ok', artefato: caminho, sha256: sha256(texto), duracao_ms: Date.now() - inicio, modelo: artefato.modelo, esforco: artefato.esforco };
}

export async function publicarConceitos(config: ConfiguracaoDosConceitos, cliente: Transacao, jobId: Id, execucao: ExecucaoOk): Promise<ConceitosDoVideoV1> {
  // Publicação repetida do mesmo job: fica a primeira.
  const { rows: [existente] } = await cliente.query<{ conteudo: ConceitosDoVideoV1 }>('SELECT conteudo FROM conceitos_video WHERE job_id=$1', [jobId]);
  if (existente) return existente.conteudo;
  const artefato = JSON.parse(await readFile(execucao.artefato, 'utf8')) as ArtefatoDosConceitos;
  const { midia, blocos } = await montarContexto(cliente, artefato.midia_id);
  const resolvido = resolverConceitos(artefato.saida, {
    versaoId: midia.versao_id, paragrafos: paragrafosFalados(blocos, midia), midia, ...(config.novoId ? { novoId: config.novoId } : {}),
  });
  const conteudo: ConceitosDoVideoV1 = {
    versao: 1, id: (config.novoId ?? ulid)(), midia_id: midia.id, versao_id: midia.versao_id,
    conceitos: resolvido.conceitos, partes: resolvido.partes, diagnosticos: resolvido.diagnosticos,
    execucao: { modelo: artefato.modelo, esforco: artefato.esforco, prompt: PROMPT_DOS_CONCEITOS },
    job_id: jobId, criado_em: (config.agora ?? (() => new Date()))().toISOString(),
  };
  await cliente.query('INSERT INTO conceitos_video(id,midia_id,versao_id,job_id,conteudo) VALUES ($1,$2,$3,$4,$5)',
    [conteudo.id, conteudo.midia_id, conteudo.versao_id, jobId, JSON.stringify(conteudo)]);
  await registrarNaAuditoria('resposta.validada.json', conteudo);
  return conteudo;
}

export function manipuladoresDosConceitos(config: ConfiguracaoDosConceitos): Record<string, Manipulador> {
  return {
    [TIPO_CONCEITOS_DO_VIDEO]: {
      executar: (tarefa) => executarConceitos(config, tarefa),
      publicar: async (_tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao): Promise<JobResultV1> => {
        const conceitos = await publicarConceitos(config, exigirTransacao(contexto), contexto.job.id, execucao);
        return {
          job_id: contexto.job.id, attempt: contexto.job.attempt, lease_token: contexto.lease_token, duracao_ms: execucao.duracao_ms,
          estado: 'ok', modelo: execucao.modelo, artefato: { caminho: execucao.artefato, sha256: execucao.sha256 },
          // Registro da curadoria (citação que não conferiu, momento perto demais…): não é aviso para quem assiste.
          diagnosticos: conceitos.diagnosticos.map((d) => ({ nivel: 'info' as const, codigo: d.codigo, mensagem: d.mensagem })),
        };
      },
    },
  };
}
