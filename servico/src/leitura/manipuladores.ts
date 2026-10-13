import { lerJsonLimitado, ORCAMENTOS } from '../entrada-json.js';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import type { AnySchema, ValidateFunction } from 'ajv';
import type pg from 'pg';
import { ulid } from 'ulid';
import type {
  CanonicoV1, ExecucaoLeituraV1, ExecucaoLeituraV2, Id, JobResultV1, LoteRevisaoV2, MarcaV1, OperacaoRevisao, ParteV1, ValorJson,
} from '@margem/contratos';
import { hashMarcas } from '@margem/contratos';
import { resolverSubfaixas, type BlocoDeVersao } from '@margem/core';
import { sha256 } from '../executor/artefato.js';
import { registrarNaAuditoria } from '../executor/auditoria.js';
import { prepararEntrada } from '../executor/entrada.js';
import type { ExecucaoOk, Executor, ResultadoExecutor } from '../executor/tipos.js';
import { comTransacao, type Transacao } from '../db/transacao.js';
import { obterVersao } from '../repos/documentos.js';
import * as execucoes from '../repos/execucoes.js';
import * as jobsRepo from '../repos/jobs.js';
import * as marcasRepo from '../repos/marcas.js';
import * as partesRepo from '../repos/partes.js';
import { montarContinuidade, type ResumoDeParte } from './continuidade.js';
import { escreverPacote, montarPacote, type EsbocoDeParte, type TextosDoPacote, type VersoesDoPacote } from './pacote.js';
import { planejarLeitura, type ModoDePlano } from './partes.js';
import { interpretarSaida, type ResultadoDaParte } from './resultado.js';
import { exigirModo } from '../modos.js';
import {
  REVISAO_V2_INDISPONIVEL, diagnosticosDaParteV2, interpretarParteV2, montarPedidoDaParteV2, opcoesDoPlanoV2,
  type PedidoDeLeituraV2, type ResultadoDaParteV2,
} from './leitura-v2.js';

export const TIPO_LER_PARTE = 'ler_parte';
export const TIPO_REVISAR = 'revisar_consistencia';
/**
 * Rede de segurança da revisão (J14). O disparo normal é o da última parte: ao publicá-la,
 * o worker libera a revisão na mesma transação (`liberarRevisaoSeUltima`). Enquanto isso,
 * a revisão nasce com `not_before` neste intervalo e, se for reservada antes da hora,
 * volta a esperar o mesmo intervalo — em vez de gastar uma reserva a cada cinco minutos.
 */
export const ADIAMENTO_DEPENDENCIA_MS = 30 * 60_000;

/** Adiamento por dependência: o executor do J05 só conhece `cota`, e isto não é cota. */
export interface AdiadoPorDependencia {
  estado: 'adiado';
  codigo: 'dependencia';
  not_before: Date;
  mensagem: string;
  duracao_ms: number;
}

export type ResultadoDeManipulador = ResultadoExecutor | AdiadoPorDependencia;

export interface TextosDaRevisao {
  metodo: string;
  prompt: string;
  /** Conteúdo de `prompts/revisao-consistencia@1.schema.json`. */
  schema: string;
  /** Caminho do mesmo schema, para o executor conferir a resposta. */
  caminhoSchema: string;
}

export interface ConfiguracaoDaLeitura {
  banco: pg.Pool;
  executor: Executor;
  versoes: VersoesDoPacote;
  textos: TextosDoPacote;
  /** Caminho de `prompts/leitor-de-parte@1.schema.json`, entregue ao executor. */
  caminhoSchemaLeitor: string;
  revisao: TextosDaRevisao;
  modelo: string;
  esforco: string;
  tamanho_parte_tokens?: number;
  concorrencia?: number;
  modo?: ModoDePlano;
  prazoMs?: number;
  /** Onde ficam recuperação, mapa da seção e o lote aplicado. */
  diretorioArtefatos?: string;
  novoId?: () => Id;
  agora?: () => Date;
}

export function diretorioArtefatosDaLeitura(config: ConfiguracaoDaLeitura): string {
  return config.diretorioArtefatos ?? join(homedir(), '.cache/margem/leitura');
}

function novoId(config: ConfiguracaoDaLeitura): Id {
  return (config.novoId ?? ulid)();
}

function agora(config: ConfiguracaoDaLeitura): Date {
  return (config.agora ?? (() => new Date()))();
}

/** Registro auditável fora das tabelas: a migração 0001 não tem onde guardar estes campos. */
async function registrarEvento(cliente: Transacao, jobId: Id, tipo: string, detalhe: ValorJson): Promise<void> {
  await cliente.query('INSERT INTO evento_job(job_id,tipo,detalhe) VALUES ($1,$2,$3)', [jobId, tipo, JSON.stringify(detalhe)]);
}

async function guardarJson(caminho: string, valor: unknown): Promise<void> {
  await mkdir(join(caminho, '..'), { recursive: true, mode: 0o700 });
  await writeFile(caminho, `${JSON.stringify(valor, null, 2)}\n`, { mode: 0o600 });
}

// ---------------------------------------------------------------- iniciar execução

export interface ExecucaoIniciada {
  execucao: ExecucaoLeituraV1;
  partes: ParteV1[];
  jobs: { id: Id; tipo: string; parte_id: Id | null }[];
}

export interface ExecucaoIniciadaV2 {
  execucao: ExecucaoLeituraV2;
  partes: ParteV1[];
  jobs: { id: Id; tipo: string; parte_id: Id | null }[];
  /** O que a execução não vai fazer e por quê (hoje: a revisão V1 não roda sobre V2). */
  diagnosticos: JobResultV1['diagnosticos'];
}

/**
 * Cria a execução, o plano de partes e um job por parte, mais o job dependente de
 * revisão de consistência. Tudo numa transação: não existe execução visível com
 * metade do plano criado.
 */
export async function iniciarExecucao(config: ConfiguracaoDaLeitura, versaoId: Id): Promise<ExecucaoIniciada> {
  const iniciada = await criarExecucao(config, versaoId, undefined);
  if (iniciada.execucao.schema_versao !== 1) throw new Error('Execução F1 esperada.');
  return { execucao: iniciada.execucao, partes: iniciada.partes, jobs: iniciada.jobs };
}

/**
 * Execução V2 (J19): o plano, as partes e os jobs de sempre, com o modo e o nível na
 * execução. Não há job de revisão: `LoteRevisaoV2` ainda não existe (ver `REVISAO_V2_INDISPONIVEL`).
 */
export async function iniciarExecucaoV2(config: ConfiguracaoDaLeitura, versaoId: Id, pedido: PedidoDeLeituraV2): Promise<ExecucaoIniciadaV2> {
  const iniciada = await criarExecucao(config, versaoId, pedido);
  if (iniciada.execucao.schema_versao !== 2) throw new Error('Execução V2 esperada.');
  return { execucao: iniciada.execucao, partes: iniciada.partes, jobs: iniciada.jobs, diagnosticos: [REVISAO_V2_INDISPONIVEL] };
}

async function criarExecucao(
  config: ConfiguracaoDaLeitura, versaoId: Id, pedido: PedidoDeLeituraV2 | undefined,
): Promise<{ execucao: ExecucaoLeituraV1 | ExecucaoLeituraV2; partes: ParteV1[]; jobs: { id: Id; tipo: string; parte_id: Id | null }[] }> {
  return comTransacao(config.banco, async (cliente) => {
    const versao = await obterVersao(cliente, versaoId);
    const execucaoId = novoId(config);
    const opcoesV2 = pedido === undefined ? undefined : opcoesDoPlanoV2(pedido);
    const plano = planejarLeitura(versao.canonico, {
      execucao_id: execucaoId,
      versoes: opcoesV2?.versoes ?? config.versoes,
      textos: opcoesV2?.textos ?? config.textos,
      ...(opcoesV2 === undefined ? {} : { tiposElegiveis: opcoesV2.tiposElegiveis }),
      ...(config.tamanho_parte_tokens === undefined ? {} : { tamanho_parte_tokens: config.tamanho_parte_tokens }),
      ...(config.modo === undefined ? {} : { modo: config.modo }),
      ...(config.novoId === undefined ? {} : { novoId: config.novoId }),
    });
    const comum = {
      id: execucaoId,
      versao_id: versaoId,
      tamanho_parte_tokens: config.tamanho_parte_tokens ?? 45_000,
      concorrencia: config.concorrencia ?? 4,
      plano_partes: plano.partes.map((parte) => parte.id),
      criada_em: agora(config).toISOString(),
    };
    let execucao: ExecucaoLeituraV1 | ExecucaoLeituraV2;
    if (pedido === undefined || opcoesV2 === undefined) {
      const v1: ExecucaoLeituraV1 = {
        ...comum,
        metodo_versao: config.versoes.metodo_versao,
        prompt_versao: config.versoes.prompt_versao,
        schema_versao: 1,
        modelo: config.modelo,
        esforco: config.esforco,
      };
      await execucoes.criar(cliente, v1);
      execucao = v1;
    } else {
      const v2: ExecucaoLeituraV2 = {
        ...comum,
        metodo_versao: opcoesV2.versoes.metodo_versao,
        prompt_versao: opcoesV2.versoes.prompt_versao,
        schema_versao: 2,
        modo: { id: pedido.modo.id, revisao: pedido.modo.revisao },
        nivel_de_atencao_alvo: pedido.nivel,
        // O pedido de quem enfileira; o worker troca pelo que o executor declarar (J14).
        executor: { modelo: config.modelo, esforco: config.esforco },
      };
      await execucoes.criarV2(cliente, v2);
      execucao = v2;
    }
    await partesRepo.criar(cliente, execucaoId, plano.partes);
    const jobs: { id: Id; tipo: string; parte_id: Id | null }[] = [];
    for (const parte of plano.partes) {
      const job = await jobsRepo.enfileirar(cliente, {
        tipo: TIPO_LER_PARTE,
        // A chave inclui a execução: reler um documento é uma tentativa nova, não a mesma parte.
        // (Descoberto na 2ª leitura real: a parte da 1ª execução já estava `ok`, a nova nunca rodava
        // e a revisão ficava adiada para sempre.)
        dedup_key: `parte:${execucaoId}:${parte.hash_entrada}`,
        input_snapshot_hash: parte.hash_entrada,
        parte_id: parte.id,
      });
      jobs.push({ id: job.id, tipo: job.tipo, parte_id: job.parte_id });
    }
    if (pedido === undefined) {
      const revisao = await jobsRepo.enfileirar(cliente, {
        tipo: TIPO_REVISAR,
        dedup_key: `revisao:${execucaoId}`,
        input_snapshot_hash: sha256(execucaoId),
        versao_id: versaoId,
        not_before: new Date(agora(config).getTime() + ADIAMENTO_DEPENDENCIA_MS),
      });
      jobs.push({ id: revisao.id, tipo: revisao.tipo, parte_id: revisao.parte_id });
    }
    return { execucao, partes: plano.partes, jobs };
  });
}

// ---------------------------------------------------------------- ler parte

export interface EntradaDaParte {
  execucao: execucoes.ExecucaoParaPlanejamento;
  /** O esforço pedido pela execução, ou o padrão do worker quando ela não pediu nenhum. */
  esforco: string;
  parte: ParteV1;
  canonico: CanonicoV1;
  continuidade?: string;
  /** Presente quando a execução é V2 (J19): o modo e o nível dela. */
  v2?: PedidoDeLeituraV2;
}

/** Modo e nível de uma execução V2, ou `undefined` para F1. */
async function pedidoDaExecucao(cliente: Transacao, execucaoId: Id): Promise<PedidoDeLeituraV2 | undefined> {
  const v2 = await execucoes.obterV2(cliente, execucaoId);
  return v2 === null ? undefined : { modo: exigirModo(v2.modo), nivel: v2.nivel_de_atencao_alvo, prompt_versao: v2.prompt_versao };
}

function caminhoDaParte(config: ConfiguracaoDaLeitura, execucaoId: Id, ordem: number): string {
  return join(diretorioArtefatosDaLeitura(config), `execucao-${execucaoId}`, `parte-${String(ordem).padStart(3, '0')}.json`);
}

/**
 * Resumos já publicados. Desde a migração 0002 eles moram em `parte.resumo_da_parte`;
 * o JSON do diretório de artefatos continua sendo escrito, mas só como cópia auditável.
 */
async function resumosAnteriores(cliente: Transacao, partes: readonly ParteV1[]): Promise<ResumoDeParte[]> {
  const resumos: ResumoDeParte[] = [];
  for (const parte of partes) {
    const linha = (await cliente.query<{ resumo_da_parte: string | null }>(
      'SELECT resumo_da_parte FROM parte WHERE id=$1', [parte.id])).rows[0];
    if (typeof linha?.resumo_da_parte === 'string') {
      resumos.push({ parte_id: parte.id, ordem: parte.ordem, resumo: linha.resumo_da_parte });
    }
  }
  return resumos;
}

export async function montarEntradaDaParte(config: ConfiguracaoDaLeitura, parteId: Id): Promise<EntradaDaParte> {
  return comTransacao(config.banco, async (cliente) => {
    const linha = (await cliente.query<{ execucao_id: Id }>('SELECT execucao_id FROM parte WHERE id=$1', [parteId])).rows[0];
    if (!linha) throw new Error('Parte inexistente.');
    const execucao = await execucoes.obter(cliente, linha.execucao_id);
  if (execucao.schema_versao === 3) throw new Error('Execução de compreensão fora do pipeline de leitura.');
    const todas = await partesRepo.listar(cliente, execucao.id);
    const parte = todas.find((item) => item.id === parteId);
    if (!parte) throw new Error('Parte fora do plano da execução.');
    const versao = await obterVersao(cliente, execucao.versao_id);
    const v2 = await pedidoDaExecucao(cliente, execucao.id);
    // O replanejamento só serve à continuidade; em V2 os tipos elegíveis mudam as ordens.
    const opcoesV2 = v2 === undefined ? undefined : opcoesDoPlanoV2(v2);
    const plano = planejarLeitura(versao.canonico, {
      execucao_id: execucao.id,
      versoes: opcoesV2?.versoes ?? config.versoes,
      textos: opcoesV2?.textos ?? config.textos,
      ...(opcoesV2 === undefined ? {} : { tiposElegiveis: opcoesV2.tiposElegiveis }),
      tamanho_parte_tokens: execucao.tamanho_parte_tokens,
      ...(config.modo === undefined ? {} : { modo: config.modo }),
    });
    const anteriores = await resumosAnteriores(cliente, todas.filter((item) => item.ordem < parte.ordem));
    const continuidade = montarContinuidade({
      ordem: parte.ordem,
      anteriores,
      continuacoes: plano.continuacoes,
      capituloDaParte: plano.capituloDaParte,
      ...(config.modo === undefined ? {} : { modo: config.modo }),
    });
    return {
      execucao, parte, canonico: versao.canonico, esforco: (await execucoes.esforcoPedido(cliente, execucao.id)) ?? config.esforco,
      ...(continuidade === undefined ? {} : { continuidade }),
      ...(v2 === undefined ? {} : { v2 }),
    };
  });
}

export async function executarLerParte(
  config: ConfiguracaoDaLeitura, parteId: Id, sinal?: AbortSignal,
): Promise<ResultadoDeManipulador> {
  const entrada = await montarEntradaDaParte(config, parteId);
  if (entrada.v2 !== undefined) return executarLerParteV2(config, entrada, entrada.v2, sinal);
  const esboco: EsbocoDeParte = {
    ordem: entrada.parte.ordem,
    blocos_responsaveis: entrada.parte.blocos_responsaveis,
    blocos_contexto: entrada.parte.blocos_contexto,
    ...(entrada.continuidade === undefined ? {} : { continuidade_anterior: entrada.continuidade }),
  };
  const pacote = montarPacote(entrada.canonico, esboco, config.versoes, config.textos);
  // Sufixo aleatório: dois processos (ou duas suítes) lendo a mesma parte não dividem a pasta.
  const diretorio = await mkdtemp(join(tmpdir(), `margem-pacote-${entrada.parte.id}-`));
  try {
    await escreverPacote(diretorio, pacote);
    return await config.executor({
      diretorioEntrada: diretorio,
      prompt: pacote.prompt,
      schema: config.caminhoSchemaLeitor,
      prazoMs: config.prazoMs ?? 1_800_000,
      modelo: config.modelo,
      esforco: entrada.esforco,
      ...(sinal === undefined ? {} : { sinal }),
    });
  } finally {
    await rm(diretorio, { recursive: true, force: true });
  }
}

/**
 * Parte V2: o prompt `leitor-de-parte@2` leva o texto dentro (ou em `prompt.md`, se for
 * grande demais para um argumento) e o schema especializado pelo modo, pelo nível e pelos
 * blocos da parte vai para o `--output-schema`.
 */
async function executarLerParteV2(
  config: ConfiguracaoDaLeitura, entrada: EntradaDaParte, pedido: PedidoDeLeituraV2, sinal?: AbortSignal,
): Promise<ResultadoDeManipulador> {
  const montado = montarPedidoDaParteV2(entrada.canonico, entrada.parte, pedido, entrada.continuidade);
  const raiz = await mkdtemp(join(tmpdir(), `margem-pacote-v2-${entrada.parte.id}-`));
  try {
    const preparada = await prepararEntrada(raiz, montado.prompt, montado.schema);
    return await config.executor({
      diretorioEntrada: preparada.diretorioEntrada,
      prompt: preparada.prompt,
      schema: preparada.schema,
      prazoMs: config.prazoMs ?? 1_800_000,
      modelo: config.modelo,
      esforco: entrada.esforco,
      ...(sinal === undefined ? {} : { sinal }),
    });
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
}

type Diagnostico = JobResultV1['diagnosticos'][number];

/** Uma parte (ou a revisão) que declarou modelo ou esforço diferentes dos da execução. */
export interface DivergenciaDeProveniencia {
  papel: 'parte' | 'revisao';
  job_id: Id;
  parte_id: Id | null;
  modelo: string;
  esforco: string;
  esperado: { modelo: string; esforco: string };
}

/**
 * Proveniência gravada por quem executa (J14). A primeira publicação da execução troca
 * `modelo`/`esforco` (até então os pedidos pela configuração de quem enfileirou) pelos que
 * o executor declarou; as seguintes só conferem. Divergência vira registro em
 * `execucao_leitura.divergencias` e um diagnóstico no job, ambos visíveis no detalhe.
 * Trava a linha da execução: publicações concorrentes da mesma execução se enfileiram aqui.
 */
export async function registrarProveniencia(
  cliente: Transacao, execucaoId: Id, origem: { papel: 'parte' | 'revisao'; job_id: Id; parte_id: Id | null },
  execucaoOk: ExecucaoOk, esforcoPadrao: string,
): Promise<Diagnostico | null> {
  const linha = (await cliente.query<{ modelo: string; esforco: string; esforco_pedido: string | null; proveniencia: 'configuracao' | 'executor' }>(
    'SELECT modelo, esforco, esforco_pedido, proveniencia FROM execucao_leitura WHERE id=$1 FOR UPDATE', [execucaoId])).rows[0];
  if (!linha) throw new Error('Execução inexistente.');
  const modelo = execucaoOk.modelo;
  // O efetivo: o que o executor declarou; sem declaração, o que a execução pediu (é com ele que o worker chama).
  const esforco = execucaoOk.esforco ?? linha.esforco_pedido ?? esforcoPadrao;
  // Na primeira publicação, a referência é o pedido: rodar com outro esforço também é divergência.
  const esperado = linha.proveniencia === 'configuracao'
    ? { modelo, esforco: linha.esforco_pedido ?? esforco }
    : { modelo: linha.modelo, esforco: linha.esforco };
  if (linha.proveniencia === 'configuracao') {
    await cliente.query(`UPDATE execucao_leitura SET modelo=$2, esforco=$3, proveniencia='executor' WHERE id=$1`,
      [execucaoId, modelo, esforco]);
  }
  if (esperado.modelo === modelo && esperado.esforco === esforco) return null;
  const divergencia: DivergenciaDeProveniencia = { ...origem, modelo, esforco, esperado };
  await cliente.query('UPDATE execucao_leitura SET divergencias = divergencias || $2::jsonb WHERE id=$1',
    [execucaoId, JSON.stringify([divergencia])]);
  return {
    nivel: 'aviso', codigo: 'proveniencia_divergente',
    mensagem: `A execução registra ${esperado.modelo} (${esperado.esforco}); esta ${origem.papel === 'parte' ? 'parte' : 'revisão'} rodou com ${modelo} (${esforco}).`,
  };
}

/**
 * Disparo da revisão pela última parte (J14): se, contando a parte que está sendo
 * publicada, todas as partes da execução estão prontas, a revisão perde o `not_before`
 * e fica elegível já. Roda na transação da publicação, depois de `registrarProveniencia`
 * ter travado a execução. Devolve se liberou.
 */
export async function liberarRevisaoSeUltima(cliente: Transacao, execucaoId: Id, jobAtual: Id): Promise<boolean> {
  const faltam = (await cliente.query<{ faltam: number }>(
    `SELECT count(*)::int AS faltam FROM parte p
       LEFT JOIN job j ON j.parte_id=p.id AND j.tipo=$2
      WHERE p.execucao_id=$1 AND (j.id IS NULL OR (j.estado<>'ok' AND j.id<>$3))`,
    [execucaoId, TIPO_LER_PARTE, jobAtual])).rows[0]?.faltam ?? 0;
  if (faltam > 0) return false;
  const liberada = (await cliente.query<{ id: Id }>(
    `UPDATE job SET not_before=NULL, atualizado_em=clock_timestamp()
      WHERE dedup_key=$1 AND tipo=$2 AND estado IN ('fila','adiado') RETURNING id`,
    [`revisao:${execucaoId}`, TIPO_REVISAR])).rows[0];
  if (!liberada) return false;
  await registrarEvento(cliente, liberada.id, 'revisao_liberada', { execucao_id: execucaoId, pela_parte: jobAtual });
  return true;
}

export interface PublicacaoDaParte {
  resultado: ResultadoDaParte;
  caminho_artefato: string;
  /** Diagnóstico de proveniência divergente, quando houver (J14). */
  proveniencia: Diagnostico | null;
  /** A publicação desta parte liberou a revisão de consistência. */
  revisao_liberada: boolean;
}

/**
 * Grava marcas, recuperação e mapa da seção. Chamada dentro de `jobs.publicar`, ou seja,
 * na mesma transação que fecha a tentativa e com a concessão conferida antes e depois.
 */
export async function publicarLerParte(
  config: ConfiguracaoDaLeitura, cliente: Transacao, parteId: Id, jobId: Id, execucaoOk: ExecucaoOk,
): Promise<PublicacaoDaParte> {
  const linha = (await cliente.query<{ execucao_id: Id }>('SELECT execucao_id FROM parte WHERE id=$1', [parteId])).rows[0];
  if (!linha) throw new Error('Parte inexistente.');
  const execucao = await execucoes.obter(cliente, linha.execucao_id);
  if (execucao.schema_versao === 3) throw new Error('Execução de compreensão fora do pipeline de leitura.');
  const partes = await partesRepo.listar(cliente, execucao.id);
  const parte = partes.find((item) => item.id === parteId);
  if (!parte) throw new Error('Parte fora do plano da execução.');
  const versao = await obterVersao(cliente, execucao.versao_id);
  const bruto: unknown = await lerJsonLimitado(execucaoOk.artefato, ORCAMENTOS.resposta);
  const resultado = interpretarSaida(versao.canonico, parte, bruto, {
    versao_id: execucao.versao_id,
    execucao_id: execucao.id,
    job_id: jobId,
    ...(config.novoId === undefined ? {} : { novoId: config.novoId }),
    ...(config.agora === undefined ? {} : { agora: config.agora }),
  });
  await marcasRepo.publicarMarcas(cliente, execucao.versao_id, resultado.marcas);
  await registrarNaAuditoria('resposta.validada.json', { marcas: resultado.marcas, resumo_da_parte: resultado.resumo_da_parte });
  await registrarNaAuditoria('diagnosticos.json', { rejeitadas: resultado.rejeitadas, avisos: resultado.avisos });
  const caminho = caminhoDaParte(config, execucao.id, parte.ordem);
  await guardarJson(caminho, {
    execucao_id: execucao.id, parte_id: parte.id, ordem: parte.ordem, job_id: jobId,
    artefato: execucaoOk.artefato, sha256: execucaoOk.sha256,
    resumo_da_parte: resultado.resumo_da_parte,
    recuperacao: resultado.recuperacao,
    mapa_da_secao: resultado.mapa_da_secao,
    limites: resultado.limites,
    leitura_integral: resultado.leitura_integral,
    rejeitadas: resultado.rejeitadas,
    avisos: resultado.avisos,
    marcas_publicadas: resultado.marcas.map((marca) => marca.id),
  });
  // Migração 0002: recuperação, mapa da seção, limites, resumo e cobertura passam a ter coluna.
  await cliente.query(`UPDATE parte SET estado='ok', resumo_da_parte=$2, recuperacao=$3,
    mapa_da_secao=$4, limites=$5, leitura_integral=$6 WHERE id=$1`,
  [parteId, resultado.resumo_da_parte, JSON.stringify(resultado.recuperacao),
    JSON.stringify(resultado.mapa_da_secao), JSON.stringify(resultado.limites), resultado.leitura_integral]);
  const proveniencia = await registrarProveniencia(cliente, execucao.id,
    { papel: 'parte', job_id: jobId, parte_id: parte.id }, execucaoOk, config.esforco);
  const revisaoLiberada = await liberarRevisaoSeUltima(cliente, execucao.id, jobId);
  await registrarEvento(cliente, jobId, 'leitura_publicada', {
    parte_id: parte.id, ordem: parte.ordem, caminho_recuperacao: caminho,
    marcas: resultado.marcas.length, rejeitadas: resultado.rejeitadas.length,
    leitura_integral: resultado.leitura_integral,
  });
  return { resultado, caminho_artefato: caminho, proveniencia, revisao_liberada: revisaoLiberada };
}

export interface PublicacaoDaParteV2 {
  resultado: ResultadoDaParteV2;
  caminho_artefato: string;
  proveniencia: Diagnostico | null;
  /** Esta era a última parte pendente da execução. */
  ultima: boolean;
}

/** Marcas V2 na camada da execução, parte `ok`, proveniência; tudo na transação da publicação. */
export async function publicarLerParteV2(
  config: ConfiguracaoDaLeitura, cliente: Transacao, parteId: Id, jobId: Id, execucaoOk: ExecucaoOk,
): Promise<PublicacaoDaParteV2> {
  const linha = (await cliente.query<{ execucao_id: Id }>('SELECT execucao_id FROM parte WHERE id=$1', [parteId])).rows[0];
  if (!linha) throw new Error('Parte inexistente.');
  const execucao = await execucoes.obter(cliente, linha.execucao_id);
  if (execucao.schema_versao === 3) throw new Error('Execução de compreensão fora do pipeline de leitura.');
  const pedido = await pedidoDaExecucao(cliente, execucao.id);
  if (!pedido) throw new Error('Execução de F1 no caminho V2.');
  const partes = await partesRepo.listar(cliente, execucao.id);
  const parte = partes.find((item) => item.id === parteId);
  if (!parte) throw new Error('Parte fora do plano da execução.');
  const versao = await obterVersao(cliente, execucao.versao_id);
  const bruto: unknown = await lerJsonLimitado(execucaoOk.artefato, ORCAMENTOS.resposta);
  const resultado = interpretarParteV2(versao.canonico, parte, pedido, bruto, {
    versao_id: execucao.versao_id, execucao_id: execucao.id, job_id: jobId,
    ...(config.novoId === undefined ? {} : { novoId: config.novoId }),
    ...(config.agora === undefined ? {} : { agora: config.agora }),
  });
  await marcasRepo.publicarMarcasV2(cliente, execucao.versao_id, resultado.marcas);
  await registrarNaAuditoria('resposta.validada.json', { marcas: resultado.marcas, resumo_da_parte: resultado.resumo_da_parte,
    limites: resultado.limites, leitura_integral: resultado.leitura_integral });
  await registrarNaAuditoria('diagnosticos.json', resultado.diagnosticos);
  const caminho = caminhoDaParte(config, execucao.id, parte.ordem);
  await guardarJson(caminho, {
    execucao_id: execucao.id, parte_id: parte.id, ordem: parte.ordem, job_id: jobId,
    modo: pedido.modo.id, modo_revisao: pedido.modo.revisao, nivel_de_atencao_alvo: pedido.nivel,
    artefato: execucaoOk.artefato, sha256: execucaoOk.sha256,
    resumo_da_parte: resultado.resumo_da_parte, limites: resultado.limites, leitura_integral: resultado.leitura_integral,
    diagnosticos: resultado.diagnosticos, marcas_publicadas: resultado.marcas.map((marca) => marca.id),
  });
  // `leitor-de-parte@2` não devolve recuperação nem mapa da seção (J17, divergência 4).
  await cliente.query(`UPDATE parte SET estado='ok', resumo_da_parte=$2, recuperacao='[]',
    mapa_da_secao='[]', limites=$3, leitura_integral=$4 WHERE id=$1`,
  [parteId, resultado.resumo_da_parte, JSON.stringify(resultado.limites), resultado.leitura_integral]);
  const proveniencia = await registrarProveniencia(cliente, execucao.id,
    { papel: 'parte', job_id: jobId, parte_id: parte.id }, execucaoOk, config.esforco);
  const faltam = (await cliente.query<{ faltam: number }>(
    `SELECT count(*)::int AS faltam FROM parte WHERE execucao_id=$1 AND estado<>'ok'`, [execucao.id])).rows[0]?.faltam ?? 0;
  await registrarEvento(cliente, jobId, 'leitura_publicada', {
    parte_id: parte.id, ordem: parte.ordem, caminho_recuperacao: caminho, schema_versao: 2,
    modo: pedido.modo.id, marcas: resultado.marcas.length,
    rejeitadas: resultado.diagnosticos.filter((item) => item.efeito === 'descartada').length,
    leitura_integral: resultado.leitura_integral,
  });
  return { resultado, caminho_artefato: caminho, proveniencia, ultima: faltam === 0 };
}

// ---------------------------------------------------------------- revisão de consistência

export interface AlteracaoDaRevisao {
  marca_id: Id;
  op: 'mudar_funcao' | 'reescrever_comentario' | 'remover_comentario' | 'editar_subfaixas' | 'mudar_visibilidade' | 'remover';
  depois: Record<string, unknown>;
  motivo: string;
}

export interface SaidaDaRevisao {
  alteracoes: AlteracaoDaRevisao[];
  consistencia_das_cores: string;
  observacoes: string[];
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
let validadorRevisao: ValidateFunction | undefined;

export function validadorDaRevisao(schema: string): ValidateFunction {
  validadorRevisao ??= ajv.compile(JSON.parse(schema) as AnySchema);
  return validadorRevisao;
}

/** Digest compacto: id da marca, seção, função, citação, sublinhados e comentário. */
export function montarDigest(canonico: CanonicoV1, marcas: readonly MarcaV1[]): string {
  const ordemDoBloco = new Map(canonico.blocos.map((bloco, indice) => [bloco.id, indice]));
  const secaoDoBloco = new Map<Id, string>();
  for (const secao of canonico.secoes) {
    const inicio = ordemDoBloco.get(secao.bloco_inicio);
    const fim = ordemDoBloco.get(secao.bloco_fim);
    if (inicio === undefined || fim === undefined) continue;
    for (const bloco of canonico.blocos.slice(inicio, fim + 1)) secaoDoBloco.set(bloco.id, secao.titulo);
  }
  const textoDoBloco = new Map(canonico.blocos.map((bloco) => [bloco.id, bloco.texto]));
  const linhas = [`# Digest das marcas · ${canonico.documento.titulo}`, ''];
  const ordenadas = [...marcas].sort((a, b) =>
    (ordemDoBloco.get(a.ancora.bloco_id) ?? 0) - (ordemDoBloco.get(b.ancora.bloco_id) ?? 0)
    || a.ancora.inicio_utf16 - b.ancora.inicio_utf16);
  let secaoAtual: string | undefined;
  for (const marca of ordenadas) {
    const secao = secaoDoBloco.get(marca.ancora.bloco_id);
    if (secao !== secaoAtual) {
      secaoAtual = secao;
      linhas.push('', `## ${secao ?? 'Sem seção declarada'}`, '');
    }
    const citacao = marca.ancora.citacao.length <= 320
      ? marca.ancora.citacao
      : `${marca.ancora.citacao.slice(0, 300)} […] ${marca.ancora.citacao.slice(-16)}`;
    const texto = textoDoBloco.get(marca.ancora.bloco_id) ?? '';
    const sublinhados = marca.subfaixas
      .map((faixa) => texto.slice(faixa.inicio_utf16, faixa.fim_utf16))
      .filter((termo) => termo !== '');
    linhas.push(`- **${marca.id}** · **${marca.funcao}** · “${citacao}”`
      + (sublinhados.length > 0 ? ` · sublinhar: ${JSON.stringify(sublinhados)}` : '')
      + (marca.visivel ? '' : ' · oculta'));
    if (marca.comentario) {
      linhas.push(`  - comentário [${marca.comentario.tipo}] ${marca.comentario.rotulo}: ${marca.comentario.texto}`);
    }
  }
  linhas.push('');
  return linhas.join('\n');
}

export interface DependenciaDaRevisao {
  pendentes: number;
  total: number;
}

/** A revisão só é elegível quando todo job `ler_parte` da execução terminou em `ok`. */
export async function conferirDependencia(cliente: Transacao, execucaoId: Id): Promise<DependenciaDaRevisao> {
  const linha = (await cliente.query<{ total: number; prontos: number }>(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE j.estado='ok')::int AS prontos
     FROM parte p LEFT JOIN job j ON j.parte_id=p.id AND j.tipo=$2 WHERE p.execucao_id=$1`,
    [execucaoId, TIPO_LER_PARTE])).rows[0];
  const total = linha?.total ?? 0;
  return { total, pendentes: total - (linha?.prontos ?? 0) };
}

export async function executarRevisarConsistencia(
  config: ConfiguracaoDaLeitura, execucaoId: Id, sinal?: AbortSignal,
): Promise<ResultadoDeManipulador> {
  const inicio = Date.now();
  const preparo = await comTransacao(config.banco, async (cliente) => {
    const dependencia = await conferirDependencia(cliente, execucaoId);
    if (dependencia.pendentes > 0) return { dependencia };
    const execucao = await execucoes.obter(cliente, execucaoId);
  if (execucao.schema_versao === 3) throw new Error('Execução de compreensão fora do pipeline de leitura.');
    const versao = await obterVersao(cliente, execucao.versao_id);
    const todas = await marcasRepo.listarPorVersao(cliente, execucao.versao_id);
    return {
      dependencia, canonico: versao.canonico, marcas: todas.filter((marca) => marca.execucao_id === execucaoId),
      esforco: (await execucoes.esforcoPedido(cliente, execucaoId)) ?? config.esforco,
    };
  });
  if (preparo.dependencia.pendentes > 0 || !preparo.canonico || !preparo.marcas || preparo.esforco === undefined) {
    return {
      estado: 'adiado', codigo: 'dependencia',
      not_before: new Date(agora(config).getTime() + ADIAMENTO_DEPENDENCIA_MS),
      mensagem: `Faltam ${String(preparo.dependencia.pendentes)} de ${String(preparo.dependencia.total)} partes.`,
      duracao_ms: Date.now() - inicio,
    };
  }
  const diretorio = await mkdtemp(join(tmpdir(), `margem-revisao-${execucaoId}-`));
  try {
    await mkdir(diretorio, { recursive: true, mode: 0o700 });
    await writeFile(join(diretorio, 'metodo.md'), config.revisao.metodo, { mode: 0o600 });
    await writeFile(join(diretorio, 'schema.json'), config.revisao.schema, { mode: 0o600 });
    await writeFile(join(diretorio, 'digest.md'), montarDigest(preparo.canonico, preparo.marcas), { mode: 0o600 });
    return await config.executor({
      diretorioEntrada: diretorio,
      prompt: config.revisao.prompt,
      schema: config.revisao.caminhoSchema,
      prazoMs: config.prazoMs ?? 1_800_000,
      modelo: config.modelo,
      esforco: preparo.esforco,
      ...(sinal === undefined ? {} : { sinal }),
    });
  } finally {
    await rm(diretorio, { recursive: true, force: true });
  }
}

export interface LoteMontado {
  lote?: LoteRevisaoV2;
  ignoradas: { marca_id: Id; motivo: string }[];
  consistencia_das_cores: string;
  observacoes: string[];
}

/**
 * Converte a saída do revisor em `LoteRevisaoV2`. O `antes` de cada operação é preenchido
 * pelo serviço a partir do estado atual — o modelo nunca o recebe nem o inventa — e
 * `editar_subfaixas` chega como texto literal (`sublinhar`), resolvido aqui pelo core.
 */
export function montarLote(
  saida: SaidaDaRevisao, canonico: CanonicoV1, marcas: readonly MarcaV1[], execucaoId: Id, loteId: Id,
): LoteMontado {
  const porId = new Map(marcas.map((marca) => [marca.id, marca]));
  const textoDoBloco = new Map(canonico.blocos.map((bloco) => [bloco.id, bloco.texto]));
  const operacoes: OperacaoRevisao[] = [];
  const ignoradas: { marca_id: Id; motivo: string }[] = [];
  const vistas = new Set<Id>();
  for (const alteracao of saida.alteracoes) {
    const marca = porId.get(alteracao.marca_id);
    if (!marca) { ignoradas.push({ marca_id: alteracao.marca_id, motivo: 'marca_inexistente' }); continue; }
    if (vistas.has(marca.id)) { ignoradas.push({ marca_id: marca.id, motivo: 'marca_repetida_no_lote' }); continue; }
    const base = { ordem: operacoes.length, marca_id: marca.id, motivo: alteracao.motivo };
    switch (alteracao.op) {
      case 'mudar_funcao': {
        const funcao = alteracao.depois.funcao as MarcaV1['funcao'];
        if (funcao === marca.funcao) { ignoradas.push({ marca_id: marca.id, motivo: 'sem_efeito' }); continue; }
        operacoes.push({ ...base, op: 'mudar_funcao', antes: { funcao: marca.funcao }, depois: { funcao } });
        break;
      }
      case 'reescrever_comentario': {
        const comentario = alteracao.depois.comentario as MarcaV1['comentario'];
        if (comentario === null) { ignoradas.push({ marca_id: marca.id, motivo: 'comentario_nulo' }); continue; }
        operacoes.push({ ...base, op: 'reescrever_comentario', antes: { comentario: marca.comentario }, depois: { comentario } });
        break;
      }
      case 'remover_comentario': {
        if (marca.comentario === null) { ignoradas.push({ marca_id: marca.id, motivo: 'sem_efeito' }); continue; }
        operacoes.push({ ...base, op: 'remover_comentario', antes: { comentario: marca.comentario }, depois: { comentario: null } });
        break;
      }
      case 'editar_subfaixas': {
        const sublinhar = Array.isArray(alteracao.depois.sublinhar) ? alteracao.depois.sublinhar as string[] : [];
        const bloco: BlocoDeVersao = {
          id: marca.ancora.bloco_id, texto: textoDoBloco.get(marca.ancora.bloco_id) ?? '', versao_id: marca.ancora.versao_id,
        };
        const { subfaixas, nao_resolvidas } = resolverSubfaixas(bloco, marca.ancora, sublinhar);
        if (nao_resolvidas.length > 0) {
          ignoradas.push({ marca_id: marca.id, motivo: `sublinhar_nao_resolvido:${nao_resolvidas.map((item) => item.motivo).join(',')}` });
          continue;
        }
        operacoes.push({ ...base, op: 'editar_subfaixas', antes: { subfaixas: marca.subfaixas }, depois: { subfaixas } });
        break;
      }
      case 'mudar_visibilidade': {
        const visivel = alteracao.depois.visivel === true;
        if (visivel === marca.visivel) { ignoradas.push({ marca_id: marca.id, motivo: 'sem_efeito' }); continue; }
        operacoes.push({ ...base, op: 'mudar_visibilidade', antes: { visivel: marca.visivel }, depois: { visivel } });
        break;
      }
      case 'remover': {
        operacoes.push({ ...base, op: 'remover', antes: marca, depois: {} });
        break;
      }
    }
    vistas.add(marca.id);
  }
  const comum = {
    ignoradas, consistencia_das_cores: saida.consistencia_das_cores, observacoes: saida.observacoes,
  };
  if (operacoes.length === 0) return comum;
  return {
    ...comum,
    lote: {
      id: loteId, execucao_id: execucaoId, snapshot_base: hashMarcas(marcas), autor: 'codex',
      motivo_do_lote: saida.consistencia_das_cores.slice(0, 500), operacoes,
    },
  };
}

export interface PublicacaoDaRevisao {
  estado: 'aplicado' | 'ja_aplicado' | 'recusado' | 'sem_alteracoes';
  motivo?: string;
  proveniencia: Diagnostico | null;
  operacoes: number;
  ignoradas: { marca_id: Id; motivo: string }[];
  caminho_artefato: string;
}

export async function publicarRevisarConsistencia(
  config: ConfiguracaoDaLeitura, cliente: Transacao, execucaoId: Id, jobId: Id, execucaoOk: ExecucaoOk,
): Promise<PublicacaoDaRevisao> {
  const bruto: unknown = await lerJsonLimitado(execucaoOk.artefato, ORCAMENTOS.resposta);
  const validar = validadorDaRevisao(config.revisao.schema);
  if (!validar(bruto)) {
    throw new Error(`Saída da revisão fora do schema: ${(validar.errors ?? []).slice(0, 5)
      .map((erro) => `${erro.instancePath || '/'} ${erro.message ?? 'inválido'}`).join('; ')}`);
  }
  const saida = bruto as SaidaDaRevisao;
  const execucao = await execucoes.obter(cliente, execucaoId);
  if (execucao.schema_versao === 3) throw new Error('Execução de compreensão fora do pipeline de leitura.');
  const versao = await obterVersao(cliente, execucao.versao_id);
  // O snapshot é de todas as marcas da versão: é isso que `aplicarLote` compara.
  const todas = await marcasRepo.listarPorVersao(cliente, execucao.versao_id);
  const montado = montarLote(saida, versao.canonico, todas, execucaoId, novoId(config));
  await registrarNaAuditoria('resposta.validada.json', montado.lote ?? null);
  await registrarNaAuditoria('diagnosticos.json', montado.ignoradas);
  const caminho = join(diretorioArtefatosDaLeitura(config), `execucao-${execucaoId}`, 'revisao-consistencia.json');
  let estado: PublicacaoDaRevisao['estado'] = 'sem_alteracoes';
  let motivo: string | undefined;
  if (montado.lote) {
    const aplicado = await marcasRepo.aplicarLote(cliente, montado.lote);
    estado = aplicado.estado;
    if (aplicado.estado === 'recusado') motivo = aplicado.motivo;
    if (aplicado.estado === 'aplicado') {
      // Migração 0002: o veredito do revisor deixa de morar só no arquivo de artefatos.
      await cliente.query(`UPDATE lote_revisao SET consistencia_das_cores=$2, observacoes=$3, ignoradas=$4
        WHERE id=$1`, [montado.lote.id, montado.consistencia_das_cores,
        JSON.stringify(montado.observacoes), JSON.stringify(montado.ignoradas)]);
    }
  }
  await guardarJson(caminho, {
    execucao_id: execucaoId, job_id: jobId, artefato: execucaoOk.artefato, sha256: execucaoOk.sha256,
    estado, motivo: motivo ?? null,
    consistencia_das_cores: montado.consistencia_das_cores,
    observacoes: montado.observacoes,
    ignoradas: montado.ignoradas,
    lote: montado.lote ?? null,
  });
  const proveniencia = await registrarProveniencia(cliente, execucaoId,
    { papel: 'revisao', job_id: jobId, parte_id: null }, execucaoOk, config.esforco);
  await registrarEvento(cliente, jobId, 'revisao_consistencia', {
    execucao_id: execucaoId, estado, motivo: motivo ?? null,
    operacoes: montado.lote?.operacoes.length ?? 0,
    ignoradas: montado.ignoradas.length, caminho_revisao: caminho,
  });
  return {
    estado, ...(motivo === undefined ? {} : { motivo }), proveniencia,
    operacoes: montado.lote?.operacoes.length ?? 0, ignoradas: montado.ignoradas, caminho_artefato: caminho,
  };
}

// ---------------------------------------------------------------- laço de uma tentativa

/** O `dedup_key` do job de revisão carrega a execução: `revisao:<ULID>`. */
export function execucaoDoDedup(dedupKey: string): Id {
  const execucaoId = dedupKey.startsWith('revisao:') ? dedupKey.slice('revisao:'.length) : '';
  if (!execucaoId) throw new Error(`Job de revisão sem execução na chave de deduplicação: ${dedupKey}`);
  return execucaoId;
}

function resultadoBase(job: { id: Id; attempt: number }, token: Id, duracao_ms: number) {
  return { job_id: job.id, attempt: job.attempt, lease_token: token, duracao_ms };
}

/**
 * Executa uma tentativa reservada: parte demorada fora de transação, escrita final
 * dentro de `jobs.publicar`. `adiado` e `falhou` também produzem `JobResultV1`.
 */
export async function processarJob(config: ConfiguracaoDaLeitura, job: jobsRepo.Job, token: Id, sinal?: AbortSignal): Promise<JobResultV1> {
  const execucaoDoJob = job.tipo === TIPO_REVISAR ? execucaoDoDedup(job.dedup_key) : undefined;
  const resultado = job.tipo === TIPO_LER_PARTE
    ? await executarLerParte(config, job.parte_id ?? '', sinal)
    : await executarRevisarConsistencia(config, execucaoDoJob ?? '', sinal);

  if (resultado.estado === 'adiado') {
    const saida: JobResultV1 = {
      ...resultadoBase(job, token, resultado.duracao_ms), estado: 'adiado',
      not_before: resultado.not_before.toISOString(),
      diagnosticos: [{ nivel: 'aviso', codigo: resultado.codigo, mensagem: resultado.mensagem }],
    };
    await jobsRepo.falhar(config.banco, job.id, token, resultado.codigo, saida.diagnosticos, resultado.not_before);
    return saida;
  }
  if (resultado.estado === 'falhou') {
    const saida: JobResultV1 = {
      ...resultadoBase(job, token, resultado.duracao_ms), estado: 'falhou',
      diagnosticos: [{ nivel: 'erro', codigo: resultado.codigo, mensagem: resultado.mensagem }],
    };
    await jobsRepo.falhar(config.banco, job.id, token, resultado.codigo, saida.diagnosticos);
    return saida;
  }
  return jobsRepo.publicar(config.banco, job.id, token,
    (cliente) => publicarNaTransacao(config, cliente, {
      id: job.id, tipo: job.tipo, attempt: job.attempt, parte_id: job.parte_id, dedup_key: job.dedup_key,
    }, token, resultado), resultado.sha256, (publicado) => publicado.diagnosticos);
}

async function parteEhV2(cliente: Transacao, parteId: Id): Promise<boolean> {
  const linha = (await cliente.query<{ schema_versao: number }>(`SELECT e.schema_versao FROM parte p
    JOIN execucao_leitura e ON e.id=p.execucao_id WHERE p.id=$1`, [parteId])).rows[0];
  return Number(linha?.schema_versao) === 2;
}

/** Identidade mínima do job, comum ao `processarJob` do J06 e ao `Worker` do J05. */
export interface JobEmPublicacao {
  id: Id;
  tipo: string;
  attempt: number;
  parte_id: Id | null;
  dedup_key: string;
}

/**
 * Escrita final de uma tentativa bem-sucedida, já dentro da transação de publicação.
 * É o corpo compartilhado entre `processarJob` (J06) e os manipuladores do `Worker` (J07).
 */
export async function publicarNaTransacao(
  config: ConfiguracaoDaLeitura, cliente: Transacao, job: JobEmPublicacao, token: Id, resultado: ExecucaoOk,
): Promise<JobResultV1> {
  const execucaoDoJob = job.tipo === TIPO_REVISAR ? execucaoDoDedup(job.dedup_key) : undefined;
  {
    const diagnosticos: JobResultV1['diagnosticos'] = [];
    const v2 = job.tipo === TIPO_LER_PARTE
      ? await parteEhV2(cliente, job.parte_id ?? '') : false;
    if (v2) {
      const publicacao = await publicarLerParteV2(config, cliente, job.parte_id ?? '', job.id, resultado);
      diagnosticos.push(...diagnosticosDaParteV2(publicacao.resultado));
      if (publicacao.proveniencia) diagnosticos.push(publicacao.proveniencia);
      if (publicacao.ultima) diagnosticos.push(REVISAO_V2_INDISPONIVEL);
    } else if (job.tipo === TIPO_LER_PARTE) {
      const publicacao = await publicarLerParte(config, cliente, job.parte_id ?? '', job.id, resultado);
      for (const rejeitada of publicacao.resultado.rejeitadas) {
        diagnosticos.push({
          nivel: 'aviso', codigo: rejeitada.motivo,
          mensagem: `Marca ${String(rejeitada.indice)} no bloco ${rejeitada.bloco_id}: “${rejeitada.citacao.slice(0, 80)}”${rejeitada.detalhe ? ` (${rejeitada.detalhe})` : ''}`,
        });
      }
      for (const aviso of publicacao.resultado.avisos) {
        diagnosticos.push({ nivel: 'info', codigo: aviso.motivo, mensagem: `Marca ${String(aviso.indice)}: ${aviso.termos.join(' | ')}` });
      }
      if (!publicacao.resultado.leitura_integral) {
        diagnosticos.push({ nivel: 'aviso', codigo: 'leitura_parcial', mensagem: publicacao.resultado.limites.join(' | ') || 'O leitor declarou cobertura parcial.' });
      }
      if (publicacao.proveniencia) diagnosticos.push(publicacao.proveniencia);
    } else {
      const publicacao = await publicarRevisarConsistencia(config, cliente, execucaoDoJob ?? '', job.id, resultado);
      diagnosticos.push({
        nivel: publicacao.estado === 'recusado' ? 'aviso' : 'info', codigo: `lote_${publicacao.estado}`,
        mensagem: publicacao.motivo ?? `${String(publicacao.operacoes)} operação(ões); ${String(publicacao.ignoradas.length)} ignorada(s).`,
      });
      if (publicacao.proveniencia) diagnosticos.push(publicacao.proveniencia);
    }
    return {
      ...resultadoBase(job, token, resultado.duracao_ms), estado: 'ok', modelo: resultado.modelo,
      artefato: { caminho: resultado.artefato, sha256: resultado.sha256 }, diagnosticos,
    };
  }
}
