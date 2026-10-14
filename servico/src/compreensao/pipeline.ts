import { modeloDoPrompt } from '../leitura/protocolos.js';
import { lerJsonLimitado, ORCAMENTOS } from '../entrada-json.js';
import { bloquearCapitulo, publicarModeloDoCapitulo } from './publicacao-modelo.js';
import { aoCapituloPronto } from './itens.js';
/**
 * Pipeline da compreensão do capítulo (J29/J30, `docs/desenho/10-MODELO-DO-CAPITULO.md` §5):
 *
 *   analisar_passagens (uma por parte) → r0 → sintetizar_capitulo → r1 → revisar_capitulo (por janela) → r2
 *   → projeção de marcas (na mesma transação) → planejar_leitura (por perfil do leitor)
 *
 * Cada publicação grava o que produziu e chama `avancar`, que enfileira a etapa seguinte na mesma
 * transação. `avancar` é idempotente (os `dedup_key` são únicos): preparar de novo um capítulo, ou
 * reenfileirar um job que falhou, retoma exatamente de onde parou.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { ulid } from 'ulid';
import type {
  Bloco, CanonicoV1, ExecucaoCompreensaoV1, Id, JobResultV1, LoteDoModeloV1, ModeloDoCapituloV1, ModoDeLeituraV1, OperacaoDoModeloV1,
  PlanoPedagogicoV1,
} from '@margem/contratos';
import {
  aliasesDeEntradas, aliasesParaAuditoria, aplicarOperacoes, elementosNosBlocos, novosAliases, type AliasesDoPrompt,
} from '@margem/core';
import { comTransacao, type Transacao } from '../db/transacao.js';
import { registrarNaAuditoria } from '../executor/auditoria.js';
import { prepararEntrada } from '../executor/entrada.js';
import type { ExecucaoOk, Executor, PedidoExecucao, ResultadoExecutor } from '../executor/tipos.js';
import { montarContinuidade } from '../leitura/continuidade.js';
import { registrarProveniencia } from '../leitura/manipuladores.js';
import { TIPOS_ELEGIVEIS_V2, planejarLeitura } from '../leitura/partes.js';
import { exigirModo } from '../modos.js';
import { obterVersao } from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import * as marcasRepo from '../repos/marcas.js';
import * as repo from '../repos/compreensao.js';
import { lerPrompt } from '../leitura/v2/prompt.js';
import { projetarMarcas, REGRA_DA_PROJECAO } from './projecao.js';
import {
  PROMPTS_DA_COMPREENSAO, cabeNoContexto, montarPromptDeAnalise, montarPromptDeRevisao, montarPromptDeSintese, montarPromptDoPlano,
  serializarModelo, type PromptDaCompreensao, type SaidaDaRevisao, type SaidaDaSintese, type SaidaDoPlano,
} from './prompts.js';
import {
  lerSaida, resolverAnalise, resolverEstrutura, resolverOperacoes, resolverPlano, tradutoresDoModelo, type DiagnosticoDaCompreensao,
} from './resolver.js';

export const TIPO_ANALISAR = 'analisar_passagens';
export const TIPO_SINTETIZAR = 'sintetizar_capitulo';
export const TIPO_REVISAR_CAPITULO = 'revisar_capitulo';
export const TIPO_PLANEJAR = 'planejar_leitura';
export const TIPOS_DA_COMPREENSAO = [TIPO_ANALISAR, TIPO_SINTETIZAR, TIPO_REVISAR_CAPITULO, TIPO_PLANEJAR] as const;

export interface ConfiguracaoDaCompreensao {
  banco: pg.Pool;
  executor: Executor;
  modelo: string;
  esforco: string;
  /** O plano pedagógico pede menos raciocínio (§11). */
  esforcoDoPlano?: string;
  /** Quantos capítulos adiante preparar em segundo plano (`MARGEM_PREFETCH`, padrão 1); ver `core/src/tempo.ts`. */
  profundidadeDoPrefetch?: number;
  tamanho_parte_tokens?: number;
  prazoMs?: number;
  novoId?: () => Id;
  agora?: () => Date;
}

type Diagnostico = JobResultV1['diagnosticos'][number];

function novoId(config: ConfiguracaoDaCompreensao): Id { return (config.novoId ?? ulid)(); }
function agora(config: ConfiguracaoDaCompreensao): Date { return (config.agora ?? (() => new Date()))(); }

async function registrarEvento(cliente: Transacao, jobId: Id, tipo: string, detalhe: unknown): Promise<void> {
  await cliente.query('INSERT INTO evento_job(job_id,tipo,detalhe) VALUES ($1,$2,$3)', [jobId, tipo, JSON.stringify(detalhe)]);
}

function paraDiagnostico(item: DiagnosticoDaCompreensao | { codigo: string; mensagem: string }): Diagnostico {
  const efeito = 'efeito' in item ? item.efeito : 'mantida';
  return { nivel: efeito === 'descartada' ? 'aviso' : 'info', codigo: item.codigo,
    mensagem: 'caminho' in item ? `${item.caminho}: ${item.mensagem}` : item.mensagem };
}

// ---------------------------------------------------------------- chaves dos jobs

export const chaves = {
  analisar: (execucao: Id, parte: Id) => `analisar:${execucao}:${parte}`,
  sintetizar: (execucao: Id, secao: Id) => `sintetizar:${execucao}:${secao}`,
  revisar: (execucao: Id, secao: Id, janela: number, total: number) => `revisar:${execucao}:${secao}:${String(janela)}:${String(total)}`,
  planejar: (execucao: Id, secao: Id, modelo: Id, perfil: string) => `planejar:${execucao}:${secao}:${modelo}:${perfil}`,
};

export interface ChaveDoJob { execucao_id: Id; secao_id: Id; janela?: number; total?: number; modelo_id?: Id; perfil_hash?: string }

export function lerChave(dedupKey: string): ChaveDoJob {
  const [tipo, execucao, secao, a, b] = dedupKey.split(':');
  if (!execucao || !secao) throw new Error(`Chave de job da compreensão malformada: ${dedupKey}`);
  if (tipo === 'revisar') {
    const janela = Number(a);
    const total = Number(b);
    if (!Number.isInteger(janela) || !Number.isInteger(total) || janela < 0 || total < 1 || janela >= total) throw new Error(`Janela malformada: ${dedupKey}`);
    return { execucao_id: execucao, secao_id: secao, janela, total };
  }
  if (tipo === 'planejar') {
    if (!a || !b) throw new Error(`Chave de plano malformada: ${dedupKey}`);
    return { execucao_id: execucao, secao_id: secao, modelo_id: a, perfil_hash: b };
  }
  return { execucao_id: execucao, secao_id: secao };
}

// ---------------------------------------------------------------- capítulo

export interface Capitulo { secao_id: Id; titulo: string; blocos: Bloco[] }

/** Blocos do capítulo (seção de nível 1), na ordem do canônico. */
export function capituloDe(canonico: CanonicoV1, secaoId: Id): Capitulo {
  const secao = canonico.secoes.find((item) => item.id === secaoId);
  if (!secao) throw new Error('Seção inexistente nesta versão.');
  const posicao = new Map(canonico.blocos.map((bloco, indice) => [bloco.id, indice]));
  const inicio = posicao.get(secao.bloco_inicio);
  const fim = posicao.get(secao.bloco_fim);
  if (inicio === undefined || fim === undefined) throw new Error('Seção com blocos fora do canônico.');
  return { secao_id: secaoId, titulo: secao.titulo, blocos: canonico.blocos.slice(inicio, fim + 1) };
}

// ---------------------------------------------------------------- iniciar e preparar

export class SemCapitulos extends Error {
  constructor() { super('O documento não tem capítulos (seções de nível 1): a compreensão trabalha por capítulo.'); this.name = 'SemCapitulos'; }
}

/** Execução de compreensão do documento: o plano de partes inteiro, sem nenhum job ainda. */
export async function iniciarCompreensao(config: ConfiguracaoDaCompreensao, versaoId: Id, modo: ModoDeLeituraV1): Promise<ExecucaoCompreensaoV1> {
  return comTransacao(config.banco, (cliente) => iniciarCompreensaoNa(config, cliente, versaoId, modo));
}

/** O mesmo que `iniciarCompreensao`, dentro de uma transação já aberta (a preparação do documento). */
export async function iniciarCompreensaoNa(
  config: ConfiguracaoDaCompreensao, cliente: Transacao, versaoId: Id, modo: ModoDeLeituraV1,
): Promise<ExecucaoCompreensaoV1> {
  const versao = await obterVersao(cliente, versaoId);
  if (!versao.canonico.secoes.some((secao) => secao.nivel === 1)) throw new SemCapitulos();
  const execucaoId = novoId(config);
  const plano = planejarLeitura(versao.canonico, {
    execucao_id: execucaoId,
    versoes: { metodo_versao: repo.METODO_DA_COMPREENSAO, prompt_versao: PROMPTS_DA_COMPREENSAO.analise, schema_versao: 3 },
    textos: {
      metodo: JSON.stringify({ modo }),
      prompt: modeloDoPrompt(PROMPTS_DA_COMPREENSAO.analise, modo),
      schema: lerPrompt(`${PROMPTS_DA_COMPREENSAO.analise}.schema.json`),
    },
    tiposElegiveis: TIPOS_ELEGIVEIS_V2,
    ...(config.tamanho_parte_tokens === undefined ? {} : { tamanho_parte_tokens: config.tamanho_parte_tokens }),
    ...(config.novoId === undefined ? {} : { novoId: config.novoId }),
  });
  const execucao: ExecucaoCompreensaoV1 = {
    id: execucaoId, versao_id: versaoId, schema_versao: 3, modo: { id: modo.id, revisao: modo.revisao },
    prompts: { ...PROMPTS_DA_COMPREENSAO }, executor: { modelo: config.modelo, esforco: config.esforco },
    tamanho_parte_tokens: config.tamanho_parte_tokens ?? 45_000, plano_partes: plano.partes.map((parte) => parte.id),
    criada_em: agora(config).toISOString(),
  };
  await repo.criarExecucao(cliente, execucao, plano.partes.map((parte) => ({ ...parte, secao_id: plano.capituloDaParte.get(parte.ordem) ?? null })));
  return execucao;
}

async function exigirExecucao(cliente: Transacao, execucaoId: Id): Promise<ExecucaoCompreensaoV1> {
  const execucao = await repo.obterExecucao(cliente, execucaoId);
  if (!execucao) throw new Error('Execução de compreensão inexistente.');
  return execucao;
}

/** Capítulos com partes na execução, na ordem do texto. */
export async function capitulosDaExecucao(cliente: Transacao, execucaoId: Id): Promise<Id[]> {
  const partes = await repo.listarPartes(cliente, execucaoId);
  const vistos: Id[] = [];
  for (const parte of partes) if (parte.secao_id !== null && !vistos.includes(parte.secao_id)) vistos.push(parte.secao_id);
  return vistos;
}

export interface PedidoDePreparacao {
  prioridade?: number;
  prefetch?: boolean;
  /** "Tentar de novo": devolve à fila os jobs do capítulo que falharam ou foram cancelados antes de avançar. */
  tentarDeNovo?: boolean;
}

/**
 * Pede a preparação do capítulo (e, com `prefetch`, a do seguinte em prioridade menor) e enfileira o
 * que falta. Chamado de novo, sobe a prioridade. Falhas e cancelamentos só voltam à fila com
 * `tentarDeNovo` (o botão "Tentar de novo"); sem ele, um job que falhou continua falho.
 */
export async function prepararCapitulo(
  config: ConfiguracaoDaCompreensao, execucaoId: Id, secaoId: Id, pedido: PedidoDePreparacao = {},
): Promise<{ enfileirados: Id[]; seguinte: Id | null }> {
  return comTransacao(config.banco, (cliente) => prepararCapituloNa(config, cliente, execucaoId, secaoId, pedido));
}

/** O mesmo que `prepararCapitulo`, dentro de uma transação já aberta. */
export async function prepararCapituloNa(
  config: ConfiguracaoDaCompreensao, cliente: Transacao, execucaoId: Id, secaoId: Id, pedido: PedidoDePreparacao = {},
): Promise<{ enfileirados: Id[]; seguinte: Id | null }> {
  const capitulos = await capitulosDaExecucao(cliente, execucaoId);
  if (!capitulos.includes(secaoId)) throw new Error('O capítulo não tem partes nesta execução.');
  if (pedido.tentarDeNovo) await reenfileirarFalhas(cliente, execucaoId, secaoId);
  const enfileirados = await pedirEAvancar(config, cliente, execucaoId, secaoId, pedido.prioridade ?? jobsRepo.PRIORIDADE.capitulo_aberto);
  let seguinte: Id | null = null;
  if (pedido.prefetch) {
    // Os seguintes, cada um um pouco abaixo do anterior: o mais próximo sai primeiro.
    const profundidade = config.profundidadeDoPrefetch ?? 1;
    const aberto = capitulos.indexOf(secaoId);
    for (let distancia = 1; distancia <= profundidade; distancia++) {
      const proximo = capitulos[aberto + distancia];
      if (proximo === undefined) break;
      seguinte ??= proximo;
      enfileirados.push(...await pedirEAvancar(config, cliente, execucaoId, proximo, Math.max(0, jobsRepo.PRIORIDADE.proximo_provavel - (distancia - 1) * 5)));
    }
  }
  return { enfileirados, seguinte };
}

/** Devolve à fila os jobs do capítulo que falharam ou foram cancelados (tentativa nova, como `POST /api/jobs/:id/reenfileirar`). */
export async function reenfileirarFalhas(cliente: Transacao, execucaoId: Id, secaoId: Id): Promise<Id[]> {
  await bloquearCapitulo(cliente, execucaoId, secaoId);
  const { jobs } = await estadoDoCapitulo(cliente, execucaoId, secaoId);
  const devolvidos: Id[] = [];
  for (const job of jobs) {
    if (!jobsRepo.REENFILEIRAVEIS.includes(job.estado as jobsRepo.EstadoJob)) continue;
    if (await jobsRepo.reenfileirarNa(cliente, job.id)) devolvidos.push(job.id);
  }
  return devolvidos;
}

export async function pedirEAvancar(config: ConfiguracaoDaCompreensao, cliente: Transacao, execucaoId: Id, secaoId: Id, prioridade: number): Promise<Id[]> {
  await bloquearCapitulo(cliente, execucaoId, secaoId);
  const vigente = await repo.pedirPreparacao(cliente, execucaoId, secaoId, prioridade);
  return avancar(config, cliente, execucaoId, secaoId, vigente);
}

/**
 * Enfileira a etapa que falta ao capítulo, com a prioridade vigente dele. Idempotente.
 * Devolve os ids dos jobs enfileirados (ou cuja prioridade subiu).
 */
export async function avancar(config: ConfiguracaoDaCompreensao, cliente: Transacao, execucaoId: Id, secaoId: Id, prioridade?: number): Promise<Id[]> {
  await bloquearCapitulo(cliente, execucaoId, secaoId);
  const execucao = await exigirExecucao(cliente, execucaoId);
  const vigente = prioridade ?? await repo.prioridadeDoCapitulo(cliente, execucaoId, secaoId) ?? jobsRepo.PRIORIDADE.padrao;
  const comum = { versao_id: execucao.versao_id, prioridade: vigente };
  const partes = await repo.listarPartes(cliente, execucaoId, secaoId);
  const analisadas = new Set((await repo.analisesDoCapitulo(cliente, execucaoId, secaoId)).map((item) => item.parte.id));
  const faltam = partes.filter((parte) => !analisadas.has(parte.id));
  if (faltam.length > 0) {
    const ids: Id[] = [];
    for (const parte of faltam) {
      const job = await jobsRepo.enfileirar(cliente, {
        tipo: TIPO_ANALISAR, dedup_key: chaves.analisar(execucaoId, parte.id), input_snapshot_hash: parte.hash_entrada,
        parte_id: parte.id, prioridade: vigente,
      });
      ids.push(job.id);
    }
    return ids;
  }
  const revisoes = await repo.revisoesDoCapitulo(cliente, execucaoId, secaoId);
  const r0 = revisoes.find((item) => item.revisao === 0);
  if (!r0) {
    await publicarR0(config, cliente, execucao, secaoId);
    return avancar(config, cliente, execucaoId, secaoId, vigente);
  }
  const r1 = revisoes.find((item) => item.revisao === 1);
  if (!r1) {
    const job = await jobsRepo.enfileirar(cliente, {
      tipo: TIPO_SINTETIZAR, dedup_key: chaves.sintetizar(execucaoId, secaoId), input_snapshot_hash: sha(r0.id), ...comum,
    });
    return [job.id];
  }
  const r2 = revisoes.find((item) => item.revisao === 2);
  if (!r2) {
    const janelas = await janelasDaRevisao(cliente, execucao, secaoId, r1);
    const ids: Id[] = [];
    for (let janela = 0; janela < janelas.length; janela += 1) {
      const job = await jobsRepo.enfileirar(cliente, {
        tipo: TIPO_REVISAR_CAPITULO, dedup_key: chaves.revisar(execucaoId, secaoId, janela, janelas.length),
        input_snapshot_hash: sha(`${r1.id}:${String(janela)}`), ...comum,
      });
      ids.push(job.id);
    }
    return ids;
  }
  const perfil = await repo.perfilAtual(cliente);
  const hash = repo.hashDoPerfil(perfil);
  if (await repo.planoDoCapitulo(cliente, execucaoId, secaoId, hash)) return [];
  const job = await jobsRepo.enfileirar(cliente, {
    tipo: TIPO_PLANEJAR, dedup_key: chaves.planejar(execucaoId, secaoId, r2.id, hash), input_snapshot_hash: sha(`${r2.id}:${hash}`), ...comum,
  });
  return [job.id];
}

function sha(texto: string): string { return createHash('sha256').update(texto, 'utf8').digest('hex'); }

/** r0: a união das análises locais, na ordem das partes. Determinística; gravada uma vez. */
async function publicarR0(config: ConfiguracaoDaCompreensao, cliente: Transacao, execucao: ExecucaoCompreensaoV1, secaoId: Id): Promise<ModeloDoCapituloV1> {
  const analises = await repo.analisesDoCapitulo(cliente, execucao.id, secaoId);
  const r0: ModeloDoCapituloV1 = {
    versao: 1, id: novoId(config), execucao_id: execucao.id, versao_id: execucao.versao_id, secao_id: secaoId, modo: { ...execucao.modo },
    revisao: 0, estagio: 'analise_local', base_id: null, lote_id: null, movimento: null, unidades: [],
    elementos: analises.flatMap((item) => item.analise.elementos),
    relacoes: analises.flatMap((item) => item.analise.relacoes),
    dificuldades: analises.flatMap((item) => item.analise.dificuldades),
    criada_em: agora(config).toISOString(),
  };
  await publicarModeloDoCapitulo(cliente, r0);
  return r0;
}

/** Janelas da revisão: o capítulo inteiro quando cabe com r1; senão os blocos responsáveis de cada parte. */
async function janelasDaRevisao(cliente: Transacao, execucao: ExecucaoCompreensaoV1, secaoId: Id, r1: ModeloDoCapituloV1): Promise<Id[][]> {
  const versao = await obterVersao(cliente, execucao.versao_id);
  const capitulo = capituloDe(versao.canonico, secaoId);
  if (cabeNoContexto(capitulo.blocos, serializarModelo(r1, novosAliases()))) return [capitulo.blocos.map((bloco) => bloco.id)];
  const partes = await repo.listarPartes(cliente, execucao.id, secaoId);
  return partes.map((parte) => parte.blocos_responsaveis);
}

// ---------------------------------------------------------------- estado

export type EstadoInterno = 'nao_preparado' | 'na_fila' | 'analisando' | 'sintetizando' | 'revisando' | 'projetando' | 'pronto' | 'parcial' | 'falhou';
export type EstadoVisivel = 'nao_preparado' | 'preparando' | 'pronto' | 'falhou';

export function estadoVisivel(estado: EstadoInterno): EstadoVisivel {
  switch (estado) {
    case 'nao_preparado': return 'nao_preparado';
    case 'pronto': case 'parcial': return 'pronto';
    case 'falhou': return 'falhou';
    default: return 'preparando';
  }
}

export interface EstadoDoCapitulo {
  secao_id: Id;
  estado: EstadoInterno;
  visivel: EstadoVisivel;
  revisao: number | null;
  plano_id: Id | null;
  jobs: { id: Id; tipo: string; estado: string }[];
}

/** Derivado dos jobs e do que foi publicado: não há tabela de estado que possa divergir. */
export async function estadoDoCapitulo(cliente: Transacao, execucaoId: Id, secaoId: Id): Promise<EstadoDoCapitulo> {
  const pedidos = await repo.capitulosPedidos(cliente, execucaoId);
  const partes = await repo.listarPartes(cliente, execucaoId, secaoId);
  const jobs = (await cliente.query<{ id: Id; tipo: string; estado: string }>(`SELECT id, tipo, estado FROM job
    WHERE parte_id = ANY($1::text[]) OR dedup_key LIKE $2 OR dedup_key LIKE $3 OR dedup_key LIKE $4 ORDER BY criado_em, id`,
  [partes.map((parte) => parte.id), `sintetizar:${execucaoId}:${secaoId}`, `revisar:${execucaoId}:${secaoId}:%`, `planejar:${execucaoId}:${secaoId}:%`])).rows;
  const revisao = (await cliente.query<{ revisao: number }>('SELECT max(revisao) AS revisao FROM modelo_capitulo WHERE execucao_id=$1 AND secao_id=$2',
    [execucaoId, secaoId])).rows[0]?.revisao ?? null;
  const plano = await repo.planoDoCapitulo(cliente, execucaoId, secaoId);
  const base = { secao_id: secaoId, revisao, plano_id: plano?.id ?? null, jobs };
  let estado: EstadoInterno;
  if (jobs.some((job) => job.estado === 'falhou' || job.estado === 'cancelado')) estado = 'falhou';
  else if (!pedidos.has(secaoId) && jobs.length === 0 && revisao === null) estado = 'nao_preparado';
  else if (revisao !== null && revisao >= 2 && plano !== null) {
    const incompleta = (await cliente.query<{ n: number }>(`SELECT count(*)::int AS n FROM parte WHERE execucao_id=$1 AND secao_id=$2
      AND leitura_integral IS FALSE`, [execucaoId, secaoId])).rows[0]?.n ?? 0;
    estado = incompleta > 0 ? 'parcial' : 'pronto';
  } else if (revisao !== null && revisao >= 2) estado = 'projetando';
  else if (revisao === 1) estado = 'revisando';
  else if (revisao === 0) estado = 'sintetizando';
  else if (jobs.some((job) => job.estado === 'reservado' || job.estado === 'ok')) estado = 'analisando';
  else estado = 'na_fila';
  return { ...base, estado, visivel: estadoVisivel(estado) };
}

// ---------------------------------------------------------------- execução comum das etapas

/** Onde o executar deixa os aliases para o publicar (ao lado do artefato conferido). */
function caminhoDosAliases(artefato: string): string { return `${artefato}.aliases.json`; }

/**
 * Prazo de uma chamada proporcional à entrada (J76). Na bancada-50, cinco etapas pequenas (≈24 KB de prompt)
 * travaram até o teto fixo de 30 min, e todas passaram na segunda tentativa. Agora: 10 min até ~30 mil
 * tokens (≈90 mil caracteres, a 3 caracteres por token, estimativa folgada para o português), mais 10 min a
 * cada 30 mil tokens, nunca acima do teto (`prazoMs` da configuração, padrão 30 min). Partes grandes continuam
 * com o teto de antes; só as pequenas deixam de prender um slot por meia hora.
 */
export const PRAZO_MINIMO_MS = 10 * 60_000;
export const PRAZO_TETO_PADRAO_MS = 30 * 60_000;
const TOKENS_POR_DEGRAU = 30_000;
const CARACTERES_POR_TOKEN = 3;
export function prazoDaChamada(caracteresDoPrompt: number, teto = PRAZO_TETO_PADRAO_MS): number {
  const tokens = Math.ceil(caracteresDoPrompt / CARACTERES_POR_TOKEN);
  return Math.min(teto, PRAZO_MINIMO_MS + Math.floor(tokens / TOKENS_POR_DEGRAU) * PRAZO_MINIMO_MS);
}

/** Síntese e revisão ganham uma nova tentativa automática quando estouram o prazo (J76). */
export const NOVAS_TENTATIVAS_NO_TIMEOUT = 1;

/**
 * Executa o pedido e, se ele estourar o prazo, tenta de novo até `novasTentativas` vezes (nunca depois de
 * um cancelamento). Cada estouro é registrado na auditoria da tentativa do job.
 */
export async function executarComNovaTentativa(executor: Executor, pedido: PedidoExecucao, novasTentativas: number): Promise<ResultadoExecutor> {
  for (let tentativa = 0; ; tentativa += 1) {
    const resultado = await executor(pedido);
    const repetir = resultado.estado === 'falhou' && resultado.codigo === 'timeout' && tentativa < novasTentativas && pedido.sinal?.aborted !== true;
    if (!repetir) return resultado;
    // A auditoria da chamada seguinte sobrescreve a desta; o estouro fica registrado à parte.
    await registrarNaAuditoria(`timeout-${String(tentativa + 1)}.json`, { prazo_ms: pedido.prazoMs, duracao_ms: resultado.duracao_ms, nova_tentativa: true });
  }
}

async function chamarModelo(
  config: ConfiguracaoDaCompreensao, montado: PromptDaCompreensao, esforco: string, sinal: AbortSignal | undefined, novasTentativasNoTimeout = 0,
): Promise<ResultadoExecutor> {
  const raiz = await mkdtemp(join(tmpdir(), 'margem-compreensao-'));
  try {
    const preparada = await prepararEntrada(raiz, montado.prompt, montado.schema);
    const tabela = aliasesParaAuditoria(montado.aliases);
    await registrarNaAuditoria('aliases.json', tabela);
    const resultado = await executarComNovaTentativa(config.executor, {
      diretorioEntrada: preparada.diretorioEntrada, prompt: preparada.prompt, schema: preparada.schema,
      prazoMs: prazoDaChamada(montado.prompt.length, config.prazoMs ?? PRAZO_TETO_PADRAO_MS), modelo: config.modelo, esforco,
      ...(sinal === undefined ? {} : { sinal }),
    }, novasTentativasNoTimeout);
    if (resultado.estado === 'ok') await writeFile(caminhoDosAliases(resultado.artefato), JSON.stringify(tabela), { mode: 0o600 });
    return resultado;
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
}

async function lerArtefato(execucao: ExecucaoOk): Promise<{ bruto: unknown; aliases: AliasesDoPrompt }> {
  const bruto: unknown = await lerJsonLimitado(execucao.artefato, ORCAMENTOS.resposta);
  const aliases = aliasesDeEntradas(await lerJsonLimitado(caminhoDosAliases(execucao.artefato), ORCAMENTOS.canonico) as Parameters<typeof aliasesDeEntradas>[0]);
  return { bruto, aliases };
}

function modoDa(execucao: ExecucaoCompreensaoV1): ModoDeLeituraV1 { return exigirModo(execucao.modo); }

// ---------------------------------------------------------------- analisar_passagens

export async function executarAnalise(config: ConfiguracaoDaCompreensao, parteId: Id, sinal?: AbortSignal): Promise<ResultadoExecutor> {
  const montado = await comTransacao(config.banco, async (cliente) => {
    const parte = await repo.obterParte(cliente, parteId);
    if (!parte) throw new Error('Parte inexistente.');
    const execucao = await exigirExecucao(cliente, parte.execucao_id);
    const versao = await obterVersao(cliente, execucao.versao_id);
    const porId = new Map(versao.canonico.blocos.map((bloco) => [bloco.id, bloco]));
    const blocos = [...parte.blocos_responsaveis, ...parte.blocos_contexto].map((id) => {
      const bloco = porId.get(id);
      if (!bloco) throw new Error(`Bloco ${id} fora da versão.`);
      return bloco;
    });
    const anteriores = await repo.resumosAnteriores(cliente, execucao.id, parte.secao_id, parte.ordem);
    const continuidade = montarContinuidade({
      ordem: parte.ordem, continuacoes: new Set([parte.ordem]),
      anteriores: anteriores.map((item) => ({ parte_id: '', ordem: item.ordem, resumo: item.resumo })),
    });
    return montarPromptDeAnalise({
      prompt_versao: execucao.prompts.analise, modo: modoDa(execucao), blocos, responsaveis: parte.blocos_responsaveis, ...(continuidade === undefined ? {} : { continuidade }),
    });
  });
  return chamarModelo(config, montado, config.esforco, sinal);
}

export async function publicarAnalise(
  config: ConfiguracaoDaCompreensao, cliente: Transacao, parteId: Id, jobId: Id, execucaoOk: ExecucaoOk,
): Promise<Diagnostico[]> {
  const parte = await repo.obterParte(cliente, parteId);
  if (!parte || parte.secao_id === null) throw new Error('Parte inexistente ou fora de capítulo.');
  await bloquearCapitulo(cliente, parte.execucao_id, parte.secao_id);
  const execucao = await exigirExecucao(cliente, parte.execucao_id);
  const versao = await obterVersao(cliente, execucao.versao_id);
  const { bruto, aliases } = await lerArtefato(execucaoOk);
  const responsaveis = new Set(parte.blocos_responsaveis);
  const resolvida = resolverAnalise(bruto, {
    versao_id: execucao.versao_id, job_id: jobId, modo: modoDa(execucao), aliases,
    responsaveis: versao.canonico.blocos.filter((bloco) => responsaveis.has(bloco.id)), blocosDoCapitulo: versao.canonico.blocos,
    ...(config.novoId === undefined ? {} : { novoId: config.novoId }),
  });
  const { diagnosticos, ...conteudo } = resolvida;
  await repo.gravarAnalise(cliente, parte.id, jobId, conteudo);
  await registrarNaAuditoria('resposta.validada.json', conteudo);
  await registrarNaAuditoria('diagnosticos.json', diagnosticos);
  const proveniencia = await registrarProveniencia(cliente, execucao.id, { papel: 'parte', job_id: jobId, parte_id: parte.id }, execucaoOk, config.esforco);
  await registrarEvento(cliente, jobId, 'analise_publicada', {
    parte_id: parte.id, secao_id: parte.secao_id, elementos: conteudo.elementos.length, relacoes: conteudo.relacoes.length,
    dificuldades: conteudo.dificuldades.length, descartes: diagnosticos.filter((item) => item.efeito === 'descartada').length,
  });
  await avancar(config, cliente, execucao.id, parte.secao_id);
  const saida = diagnosticos.map(paraDiagnostico);
  if (!conteudo.leitura_integral) saida.push({ nivel: 'aviso', codigo: 'leitura_parcial', mensagem: conteudo.limites.join(' | ') || 'Leitura parcial.' });
  if (proveniencia) saida.push(proveniencia);
  return saida;
}

// ---------------------------------------------------------------- sintetizar_capitulo

async function contextoDoCapitulo(cliente: Transacao, chave: ChaveDoJob): Promise<{ execucao: ExecucaoCompreensaoV1; capitulo: Capitulo; modo: ModoDeLeituraV1 }> {
  const execucao = await exigirExecucao(cliente, chave.execucao_id);
  const versao = await obterVersao(cliente, execucao.versao_id);
  return { execucao, capitulo: capituloDe(versao.canonico, chave.secao_id), modo: modoDa(execucao) };
}

export async function executarSintese(config: ConfiguracaoDaCompreensao, dedupKey: string, sinal?: AbortSignal): Promise<ResultadoExecutor> {
  const chave = lerChave(dedupKey);
  const montado = await comTransacao(config.banco, async (cliente) => {
    const { execucao, capitulo, modo } = await contextoDoCapitulo(cliente, chave);
    const r0 = await repo.revisaoDoCapitulo(cliente, chave.execucao_id, chave.secao_id, 0);
    if (!r0) throw new Error('A síntese precisa da revisão r0.');
    return montarPromptDeSintese({ prompt_versao: execucao.prompts.sintese, modo, blocos: capitulo.blocos, modelo: r0 });
  });
  return chamarModelo(config, montado, config.esforco, sinal, NOVAS_TENTATIVAS_NO_TIMEOUT);
}

function numerar(operacoes: readonly OperacaoDoModeloV1[]): OperacaoDoModeloV1[] {
  return operacoes.map((operacao, ordem) => ({ ...operacao, ordem }));
}

export async function publicarSintese(
  config: ConfiguracaoDaCompreensao, cliente: Transacao, dedupKey: string, jobId: Id, execucaoOk: ExecucaoOk,
): Promise<Diagnostico[]> {
  const chave = lerChave(dedupKey);
  await bloquearCapitulo(cliente, chave.execucao_id, chave.secao_id);
  const { execucao, capitulo, modo } = await contextoDoCapitulo(cliente, chave);
  const r0 = await repo.revisaoDoCapitulo(cliente, chave.execucao_id, chave.secao_id, 0);
  if (!r0) throw new Error('A síntese precisa da revisão r0.');
  if (await repo.revisaoDoCapitulo(cliente, chave.execucao_id, chave.secao_id, 1)) throw new Error('A síntese deste capítulo já foi publicada.');
  const { bruto, aliases } = await lerArtefato(execucaoOk);
  const saida = lerSaida<SaidaDaSintese>('sintese', bruto);
  const ordem = capitulo.blocos.map((bloco) => bloco.id);
  const estrutura = resolverEstrutura(saida, ordem, aliases, config.novoId ?? ulid, tradutoresDoModelo(r0, aliases, capitulo.blocos));
  const resolvidas = resolverOperacoes(saida.operacoes, {
    versao_id: execucao.versao_id, job_id: jobId, modo, aliases, estagio: 'sintese', base: r0, blocos: capitulo.blocos,
    ...(config.novoId === undefined ? {} : { novoId: config.novoId }),
  });
  const operacoes = numerar([
    { ordem: 0, op: 'definir_unidades', antes: r0.unidades, depois: estrutura.unidades, motivo: 'Unidades de leitura da síntese.', evidencia: [] },
    { ordem: 0, op: 'definir_movimento', antes: r0.movimento, depois: estrutura.movimento, motivo: 'Movimento do capítulo.', evidencia: [] },
    ...resolvidas.operacoes,
  ]);
  const diagnosticos = [...estrutura.diagnosticos, ...resolvidas.diagnosticos];
  await publicarRevisao(config, cliente, { execucao, secao_id: chave.secao_id, base: r0, estagio: 'sintese', job_ids: [jobId], operacoes });
  await registrarNaAuditoria('diagnosticos.json', diagnosticos);
  const proveniencia = await registrarProveniencia(cliente, execucao.id, { papel: 'revisao', job_id: jobId, parte_id: null }, execucaoOk, config.esforco);
  await avancar(config, cliente, execucao.id, chave.secao_id);
  return [...diagnosticos.map(paraDiagnostico), ...(proveniencia ? [proveniencia] : [])];
}

interface NovaRevisao {
  execucao: ExecucaoCompreensaoV1;
  secao_id: Id;
  base: ModeloDoCapituloV1;
  estagio: 'sintese' | 'revisao';
  job_ids: Id[];
  operacoes: OperacaoDoModeloV1[];
}

/** Aplica o lote à base e grava a revisão nova e o lote, nessa ordem. */
async function publicarRevisao(config: ConfiguracaoDaCompreensao, cliente: Transacao, nova: NovaRevisao): Promise<ModeloDoCapituloV1> {
  const criadaEm = agora(config).toISOString();
  const loteId = novoId(config);
  const revisao = aplicarOperacoes(nova.base, nova.operacoes, { id: novoId(config), estagio: nova.estagio, lote_id: loteId, criada_em: criadaEm });
  const lote: LoteDoModeloV1 = {
    versao: 1, id: loteId, execucao_id: nova.execucao.id, secao_id: nova.secao_id, estagio: nova.estagio, job_ids: nova.job_ids,
    base_id: nova.base.id, resultado_id: revisao.id, operacoes: nova.operacoes, criado_em: criadaEm,
  };
  await publicarModeloDoCapitulo(cliente, revisao, lote);
  await registrarNaAuditoria('resposta.validada.json', { lote, revisao: { id: revisao.id, revisao: revisao.revisao } });
  for (const jobId of nova.job_ids) {
    await registrarEvento(cliente, jobId, 'modelo_publicado', {
      secao_id: nova.secao_id, revisao: revisao.revisao, modelo_id: revisao.id, lote_id: lote.id, operacoes: lote.operacoes.length,
      elementos: revisao.elementos.length, relacoes: revisao.relacoes.length,
    });
  }
  return revisao;
}

// ---------------------------------------------------------------- revisar_capitulo

async function janelaDoJob(cliente: Transacao, chave: ChaveDoJob, execucao: ExecucaoCompreensaoV1, capitulo: Capitulo, r1: ModeloDoCapituloV1): Promise<Bloco[]> {
  const janelas = await janelasDaRevisao(cliente, execucao, chave.secao_id, r1);
  if (janelas.length !== chave.total) throw new Error('O número de janelas da revisão mudou desde o enfileiramento.');
  const ids = new Set(janelas[chave.janela ?? 0] ?? []);
  return capitulo.blocos.filter((bloco) => ids.has(bloco.id));
}

export async function executarRevisaoDoCapitulo(config: ConfiguracaoDaCompreensao, dedupKey: string, sinal?: AbortSignal): Promise<ResultadoExecutor> {
  const chave = lerChave(dedupKey);
  const montado = await comTransacao(config.banco, async (cliente) => {
    const { execucao, capitulo, modo } = await contextoDoCapitulo(cliente, chave);
    const r1 = await repo.revisaoDoCapitulo(cliente, chave.execucao_id, chave.secao_id, 1);
    if (!r1) throw new Error('A revisão precisa da síntese (r1).');
    const janela = await janelaDoJob(cliente, chave, execucao, capitulo, r1);
    const naJanela = elementosNosBlocos(r1, new Set(janela.map((bloco) => bloco.id))).map((item) => item.id);
    return montarPromptDeRevisao({
      prompt_versao: execucao.prompts.revisao, modo, blocosDoCapitulo: capitulo.blocos, janela, modelo: r1, elementosDaJanela: naJanela, inteira: chave.total === 1,
    });
  });
  return chamarModelo(config, montado, config.esforco, sinal, NOVAS_TENTATIVAS_NO_TIMEOUT);
}

export async function publicarRevisaoDoCapitulo(
  config: ConfiguracaoDaCompreensao, cliente: Transacao, dedupKey: string, jobId: Id, execucaoOk: ExecucaoOk,
): Promise<Diagnostico[]> {
  const chave = lerChave(dedupKey);
  await bloquearCapitulo(cliente, chave.execucao_id, chave.secao_id);
  const { execucao, capitulo, modo } = await contextoDoCapitulo(cliente, chave);
  const r1 = await repo.revisaoDoCapitulo(cliente, chave.execucao_id, chave.secao_id, 1);
  if (!r1) throw new Error('A revisão precisa da síntese (r1).');
  if (await repo.revisaoDoCapitulo(cliente, chave.execucao_id, chave.secao_id, 2)) throw new Error('A revisão deste capítulo já foi publicada.');
  const { bruto, aliases } = await lerArtefato(execucaoOk);
  const saida = lerSaida<SaidaDaRevisao>('revisao', bruto);
  await repo.gravarJanela(cliente, {
    execucao_id: execucao.id, secao_id: chave.secao_id, janela: chave.janela ?? 0, job_id: jobId, base_id: r1.id,
    saida: { saida, aliases: aliasesParaAuditoria(aliases) },
  });
  const proveniencia = await registrarProveniencia(cliente, execucao.id, { papel: 'revisao', job_id: jobId, parte_id: null }, execucaoOk, config.esforco);
  const gravadas = await repo.janelasDoCapitulo(cliente, execucao.id, chave.secao_id);
  if (gravadas.length < (chave.total ?? 1)) {
    await registrarEvento(cliente, jobId, 'janela_publicada', { secao_id: chave.secao_id, janela: chave.janela, faltam: (chave.total ?? 1) - gravadas.length });
    return proveniencia ? [proveniencia] : [];
  }
  // Última janela: junta as operações de todas, em ordem, cada janela restrita aos seus elementos.
  const janelas = await janelasDaRevisao(cliente, execucao, chave.secao_id, r1);
  let atual = r1;
  const operacoes: OperacaoDoModeloV1[] = [];
  const diagnosticos: DiagnosticoDaCompreensao[] = [];
  for (const gravada of gravadas) {
    const conteudo = gravada.saida as { saida: SaidaDaRevisao; aliases: Parameters<typeof aliasesDeEntradas>[0] };
    const blocosDaJanela = new Set(janelas[gravada.janela] ?? []);
    const resolvidas = resolverOperacoes(conteudo.saida.operacoes, {
      versao_id: execucao.versao_id, job_id: gravada.job_id, modo, aliases: aliasesDeEntradas(conteudo.aliases), estagio: 'revisao',
      base: atual, blocos: capitulo.blocos.filter((bloco) => blocosDaJanela.has(bloco.id)), blocosDoCapitulo: capitulo.blocos,
      elementosPermitidos: new Set(elementosNosBlocos(r1, blocosDaJanela).map((item) => item.id)),
      ...(config.novoId === undefined ? {} : { novoId: config.novoId }),
    });
    operacoes.push(...resolvidas.operacoes);
    diagnosticos.push(...resolvidas.diagnosticos.map((item) => ({ ...item, caminho: `janela ${String(gravada.janela)}${item.caminho}` })));
    atual = resolvidas.resultado;
  }
  const r2 = await publicarRevisao(config, cliente, {
    execucao, secao_id: chave.secao_id, base: r1, estagio: 'revisao', job_ids: gravadas.map((item) => item.job_id), operacoes: numerar(operacoes),
  });
  const projecao = await publicarProjecao(config, cliente, execucao, capitulo, modo, r2, jobId);
  await registrarNaAuditoria('diagnosticos.json', { revisao: diagnosticos, projecao: projecao.diagnosticos, cobertura: projecao.cobertura });
  await avancar(config, cliente, execucao.id, chave.secao_id);
  return [
    ...diagnosticos.map(paraDiagnostico),
    ...projecao.diagnosticos.map((item) => paraDiagnostico({ codigo: item.codigo, mensagem: `${item.elemento_id}: ${item.mensagem}` })),
    { nivel: 'info', codigo: 'cobertura_da_projecao', mensagem: projecao.cobertura
      .map((item) => `nível ${String(item.nivel)}: ${(item.fracao * 100).toFixed(1)}% (alvo ${(item.alvo * 100).toFixed(0)}%)`).join('; ') },
    ...(proveniencia ? [proveniencia] : []),
  ];
}

/** Marcas projetadas de r2 na camada da execução, com a origem de cada uma. */
async function publicarProjecao(
  config: ConfiguracaoDaCompreensao, cliente: Transacao, execucao: ExecucaoCompreensaoV1, capitulo: Capitulo, modo: ModoDeLeituraV1,
  modelo: ModeloDoCapituloV1, jobId: Id,
): Promise<ReturnType<typeof projetarMarcas>> {
  const projecao = projetarMarcas(modelo, { modo, camada_id: execucao.id, job_id: jobId, blocos: capitulo.blocos });
  const criadaEm = agora(config).toISOString();
  const marcas = projecao.marcas.map((item) => ({ ...item, marca: { ...item.marca, id: novoId(config), criada_em: criadaEm } }));
  await marcasRepo.publicarMarcasV2(cliente, execucao.versao_id, marcas.map((item) => item.marca));
  for (const item of marcas) await repo.gravarMarcaElemento(cliente, item.marca.id, item.elemento_id, modelo.id, REGRA_DA_PROJECAO);
  await registrarEvento(cliente, jobId, 'marcas_projetadas', { secao_id: capitulo.secao_id, modelo_id: modelo.id, marcas: marcas.length, cobertura: projecao.cobertura });
  return projecao;
}

// ---------------------------------------------------------------- planejar_leitura

export async function executarPlano(config: ConfiguracaoDaCompreensao, dedupKey: string, sinal?: AbortSignal): Promise<ResultadoExecutor> {
  const chave = lerChave(dedupKey);
  const montado = await comTransacao(config.banco, async (cliente) => {
    const { execucao, capitulo, modo } = await contextoDoCapitulo(cliente, chave);
    const modelo = await repo.obterModelo(cliente, chave.modelo_id ?? '');
    if (!modelo) throw new Error('Revisão do modelo do plano inexistente.');
    return montarPromptDoPlano({ prompt_versao: execucao.prompts.plano, modo, blocos: capitulo.blocos, modelo, perfil: await repo.perfilPeloHash(cliente, chave.perfil_hash ?? '') });
  });
  return chamarModelo(config, montado, config.esforcoDoPlano ?? config.esforco, sinal);
}

export async function publicarPlano(
  config: ConfiguracaoDaCompreensao, cliente: Transacao, dedupKey: string, jobId: Id, execucaoOk: ExecucaoOk,
): Promise<Diagnostico[]> {
  const chave = lerChave(dedupKey);
  const { execucao, capitulo } = await contextoDoCapitulo(cliente, chave);
  const modelo = await repo.obterModelo(cliente, chave.modelo_id ?? '');
  if (!modelo) throw new Error('Revisão do modelo do plano inexistente.');
  const { bruto, aliases } = await lerArtefato(execucaoOk);
  const saida = lerSaida<SaidaDoPlano>('plano', bruto);
  const resolvido = resolverPlano(saida, capitulo.blocos.map((bloco) => bloco.id), modelo, aliases, capitulo.blocos);
  if (resolvido.passos.length === 0) throw new Error('O plano não tem nenhum passo válido.');
  const plano: PlanoPedagogicoV1 = {
    versao: 1, id: novoId(config), execucao_id: execucao.id, secao_id: chave.secao_id, modelo_id: modelo.id,
    perfil_hash: chave.perfil_hash ?? '', passos: resolvido.passos, apoios: resolvido.apoios, job_id: jobId,
    criado_em: agora(config).toISOString(),
  };
  const persistido = await repo.gravarPlano(cliente, plano);
  await registrarNaAuditoria('resposta.validada.json', persistido);
  await registrarNaAuditoria('diagnosticos.json', resolvido.diagnosticos);
  await registrarEvento(cliente, jobId, 'plano_publicado', { secao_id: chave.secao_id, plano_id: persistido.id, passos: persistido.passos.length });
  const proveniencia = await registrarProveniencia(cliente, execucao.id, { papel: 'revisao', job_id: jobId, parte_id: null }, execucaoOk,
    config.esforcoDoPlano ?? config.esforco);
  // Capítulo pronto: os itens marcados em "Preparar leitura" (flashcards, mapa, fluxograma) saem agora.
  await aoCapituloPronto(cliente, execucao, chave.secao_id);
  return [...resolvido.diagnosticos.map(paraDiagnostico), ...(proveniencia ? [proveniencia] : [])];
}
