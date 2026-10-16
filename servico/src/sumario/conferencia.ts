/**
 * Conferência do sumário (J164): a rede de segurança dos capítulos de EPUB e PDF novos.
 *
 * 1. Ao publicar a primeira versão de um EPUB ou PDF (`publicarCanonizacao`), as heurísticas locais
 *    (`heuristica.ts`) olham as seções. Nada suspeito: grava `ok` e o Codex não é chamado.
 * 2. Suspeito: o job `conferir_sumario` (`dedup_key = conferir_sumario:<versão>`, esforço `low`, como o
 *    tipo de texto) recebe a lista de seções (nível, título, tamanho, primeiras palavras) e o sumário
 *    que o próprio arquivo declara (`margem_motor.sumario_original`), e devolve
 *    `ConferenciaDoSumarioV1`. É um job do Codex como os outros: entra em pausa, espera a cota, pode
 *    ser cancelado. A proposta é conferida aqui, entrada por entrada; uma falha recusa a proposta
 *    inteira (os problemas ficam).
 * 3. A página do documento mostra "O sumário deste livro pode estar errado" com a sugestão. "Usar o
 *    sumário sugerido" não cria versão nem mexe no texto: a sugestão fica na tabela
 *    `conferencia_sumario` e só a apresentação do sumário (`GET /api/versoes/:id/secoes`) a usa. Os
 *    capítulos de verdade, as análises e os grifos continuam presos às seções do canônico.
 *
 * Por isso a proposta só pode renomear, deixar de fora uma seção e mudar o nível de subseções: um
 * capítulo com texto continua capítulo (é a página que o leitor abre), só um capítulo vazio pode
 * sumir e nenhuma subseção vira capítulo.
 *
 * Liga e desliga em Configurações ("Conferir o sumário com o ChatGPT ao importar", ligado por padrão).
 * Documentos que já estavam na biblioteca não são conferidos: só a versão 1, ao chegar.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import {
  validarConferenciaDoSumario, type Bloco, type CanonicoV1, type ConferenciaDoSumarioV1, type EntradaDoSumarioSugerido, type Id,
  type JobResultV1, type Secao,
} from '@margem/contratos';
import { originalDoDocumento, raizDoRepositorio } from '../dados.js';
import { comTransacao, type Transacao } from '../db/transacao.js';
import { lerJsonLimitado, ORCAMENTOS } from '../entrada-json.js';
import { ambienteSaneado } from '../executor/ambiente.js';
import { sha256 } from '../executor/artefato.js';
import { registrarNaAuditoria } from '../executor/auditoria.js';
import { prepararEntrada } from '../executor/entrada.js';
import type { ExecucaoOk, Executor, ResultadoExecutor } from '../executor/tipos.js';
import { cercar, corpoDoModelo, ehObjeto, lerPrompt, preencher } from '../leitura/v2/prompt.js';
import { comandoDoMotor } from '../plataforma/executaveis.js';
import { encerrarArvore, opcoesDeProcesso } from '../plataforma/processos.js';
import { obterVersao } from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import { exigirTransacao } from '../worker/canonizar.js';
import { entradaDoJob } from '../worker/fila-postgres.js';
import type { ContextoPublicacao } from '../worker/fila.js';
import type { Manipulador, Tarefa } from '../worker/worker.js';
import { comparavel, ordenadas, resumirSecoes, suspeitasDoSumario, type SecaoResumida, type Suspeita } from './heuristica.js';

export const TIPO_CONFERIR_SUMARIO = 'conferir_sumario';
export const VERSAO_PROMPT_SUMARIO = 'conferir-sumario@1';
/** O mais barato que o executor aceita nas Configurações → Modelos (`MARGEM_ESFORCO_SUMARIO` troca). */
export const ESFORCO_DO_SUMARIO_PADRAO = 'low';
/** Conferir uma lista de títulos leva segundos; três minutos sobram. */
export const PRAZO_DO_SUMARIO_MS = 180_000;
/** Mais seções que isto não vão para o Codex: a lista não caberia num pedido barato. */
export const MAXIMO_DE_SECOES = 600;
const FORMATOS_CONFERIDOS = new Set(['epub', 'pdf']);

export function esforcoDoSumario(ambiente: NodeJS.ProcessEnv = process.env): string {
  const valor = ambiente.MARGEM_ESFORCO_SUMARIO?.trim();
  return valor === undefined || valor === '' ? ESFORCO_DO_SUMARIO_PADRAO : valor;
}

export const chaveDaConferencia = (versaoId: Id): string => `${TIPO_CONFERIR_SUMARIO}:${versaoId}`;
function versaoDaChave(dedupKey: string): Id {
  const [tipo, versao, ...resto] = dedupKey.split(':');
  if (tipo !== TIPO_CONFERIR_SUMARIO || !versao || resto.length > 0) throw new Error(`Chave da conferência malformada: ${dedupKey}`);
  return versao;
}

// ---------------------------------------------------------------- configuração

const CHAVE_DA_PREFERENCIA = 'conferir_sumario';
export interface PreferenciaDoSumario { conferir_ao_importar: boolean }

export async function lerPreferenciaDoSumario(cliente: Transacao): Promise<PreferenciaDoSumario> {
  const valor = (await cliente.query<{ valor: { conferir_ao_importar?: unknown } }>('SELECT valor FROM preferencia_geral WHERE chave=$1', [CHAVE_DA_PREFERENCIA])).rows[0]?.valor;
  return { conferir_ao_importar: valor?.conferir_ao_importar !== false };
}

export async function gravarPreferenciaDoSumario(cliente: Transacao, preferencia: PreferenciaDoSumario): Promise<PreferenciaDoSumario> {
  await cliente.query(`INSERT INTO preferencia_geral (chave, valor) VALUES ($1, $2)
    ON CONFLICT (chave) DO UPDATE SET valor=excluded.valor, atualizada_em=clock_timestamp()`, [CHAVE_DA_PREFERENCIA, JSON.stringify(preferencia)]);
  return preferencia;
}

// ---------------------------------------------------------------- ao publicar a versão

export type EstadoDaConferencia = 'conferindo' | 'ok' | 'suspeito' | 'aplicada' | 'mantida';

/**
 * Depois da canonização: só a primeira versão de um EPUB ou PDF, com a conferência ligada. Sem suspeita,
 * grava `ok`; com, enfileira o job leve. Devolve o job (ou `null`).
 */
export async function aoPublicarVersaoDoSumario(
  cliente: Transacao, documentoId: Id, versao: { id: Id; numero: number | string }, canonico: Pick<CanonicoV1, 'blocos' | 'secoes' | 'documento'>,
): Promise<jobsRepo.Job | null> {
  if (Number(versao.numero) !== 1 || !FORMATOS_CONFERIDOS.has(canonico.documento.formato)) return null;
  if (!(await lerPreferenciaDoSumario(cliente)).conferir_ao_importar) return null;
  const secoes = resumirSecoes(canonico);
  const suspeitas = suspeitasDoSumario(secoes, palavrasDoTexto(canonico.blocos));
  const vaiAoCodex = suspeitas.length > 0 && secoes.length > 0 && secoes.length <= MAXIMO_DE_SECOES;
  await cliente.query(`INSERT INTO conferencia_sumario (versao_id, documento_id, estado, suspeitas) VALUES ($1,$2,$3,$4)
    ON CONFLICT (versao_id) DO NOTHING`, [versao.id, documentoId, suspeitas.length === 0 ? 'ok' : vaiAoCodex ? 'conferindo' : 'suspeito', JSON.stringify(suspeitas)]);
  if (!vaiAoCodex) return null;
  return jobsRepo.enfileirar(cliente, {
    tipo: TIPO_CONFERIR_SUMARIO, dedup_key: chaveDaConferencia(versao.id), input_snapshot_hash: sha256(`${VERSAO_PROMPT_SUMARIO}:${versao.id}`),
    versao_id: versao.id, prioridade: jobsRepo.PRIORIDADE.padrao,
  });
}

const CAMPOS_DE_TITULO = new Set<Bloco['tipo']>(['capitulo', 'secao']);
function palavrasDoTexto(blocos: readonly Bloco[]): number {
  return blocos.reduce((soma, bloco) => soma + (CAMPOS_DE_TITULO.has(bloco.tipo) ? 0 : bloco.texto.match(/\S+/gu)?.length ?? 0), 0);
}

// ---------------------------------------------------------------- prompt

export interface SecaoDoPrompt extends SecaoResumida { bloco_inicio: Id; inicio: string }

/** As seções com o `bloco_inicio` e as primeiras palavras do texto próprio (até doze). */
export function secoesDoPrompt(canonico: Pick<CanonicoV1, 'blocos' | 'secoes'>): SecaoDoPrompt[] {
  const resumidas = resumirSecoes(canonico);
  const secoes = ordenadas(canonico.secoes);
  const posicao = new Map(canonico.blocos.map((bloco, indice) => [bloco.id, indice]));
  return secoes.map((secao, i) => {
    const comeco = posicao.get(secao.bloco_inicio) ?? 0;
    const seguinte = secoes[i + 1];
    const fim = Math.min((posicao.get(secao.bloco_fim) ?? comeco) + 1, seguinte === undefined ? Infinity : posicao.get(seguinte.bloco_inicio) ?? Infinity);
    const bloco = canonico.blocos.slice(comeco, fim).find((candidato) => !CAMPOS_DE_TITULO.has(candidato.tipo) && candidato.texto.trim() !== '');
    const palavras = bloco?.texto.match(/\S+/gu) ?? [];
    const inicio = palavras.slice(0, 12).join(' ') + (palavras.length > 12 ? '…' : '');
    return { ...(resumidas[i] ?? { nivel: secao.nivel, titulo: secao.titulo, palavras: 0, proprias: 0 }), bloco_inicio: secao.bloco_inicio, inicio };
  });
}

export interface DadosDoPromptDoSumario {
  titulo: string;
  formato: string;
  canonico: Pick<CanonicoV1, 'blocos' | 'secoes'>;
  suspeitas: readonly Suspeita[];
  /** O sumário do próprio arquivo; `null` quando não há (ou não deu para ler). */
  original: readonly EntradaOriginal[] | null;
}
export interface EntradaOriginal { nivel: number; titulo: string }

const linhaDoTitulo = (texto: string) => texto.replace(/\s+/gu, ' ').trim();

export function montarPromptDoSumario(dados: DadosDoPromptDoSumario): { prompt: string; schema: Record<string, unknown> } {
  const schema: unknown = JSON.parse(lerPrompt(`${VERSAO_PROMPT_SUMARIO}.schema.json`));
  if (!ehObjeto(schema)) throw new Error('Schema da conferência do sumário não é um objeto.');
  const secoes = secoesDoPrompt(dados.canonico);
  // O enum dos `bloco_inicio`: o Codex só consegue apontar seções que existem.
  const item = ((schema.properties as Record<string, Record<string, unknown>>).proposta?.items as { properties: Record<string, Record<string, unknown>> } | undefined);
  if (!item?.properties.bloco_inicio) throw new Error('Schema da conferência sem bloco_inicio.');
  item.properties.bloco_inicio = { type: 'string', enum: secoes.map((secao) => secao.bloco_inicio) };
  const lista = secoes.map((secao) => `[${secao.bloco_inicio}] ${String(secao.nivel)} · ${linhaDoTitulo(secao.titulo)} · ${String(secao.palavras)} (${String(secao.proprias)}) · ${secao.inicio === '' ? '—' : linhaDoTitulo(secao.inicio)}`).join('\n');
  const original = dados.original === null || dados.original.length === 0 ? '(o arquivo não declara sumário)'
    : cercar(dados.original.map((entrada) => `${'  '.repeat(Math.max(0, entrada.nivel - 1))}- ${linhaDoTitulo(entrada.titulo)}`).join('\n'));
  const palavras = palavrasDoTexto(dados.canonico.blocos);
  return {
    prompt: preencher(corpoDoModelo(lerPrompt(`${VERSAO_PROMPT_SUMARIO}.md`)), {
      titulo: cercar(dados.titulo), formato: dados.formato, palavras: String(palavras),
      suspeitas: dados.suspeitas.map((suspeita) => `- ${suspeita.mensagem}`).join('\n') || '(nenhuma)',
      sumario_original: original, secoes: cercar(lista),
    }),
    schema,
  };
}

// ---------------------------------------------------------------- o sumário do próprio arquivo

const PRAZO_DO_SUMARIO_ORIGINAL_MS = 60_000;
const TETO_DA_SAIDA = 1_000_000;

/** `margem_motor.sumario_original` pelo motor (venv ou congelado). Qualquer falha vira `null`: a conferência segue sem ele. */
export function lerSumarioOriginal(entrada: string, formato: string, sinal?: AbortSignal): Promise<EntradaOriginal[] | null> {
  return new Promise((resolver) => {
    const comando = comandoDoMotor('sumario', ['--entrada', entrada, '--formato', formato], { raiz: raizDoRepositorio() });
    let processo;
    try {
      processo = spawn(comando.programa, comando.argumentos, { cwd: comando.cwd, env: ambienteSaneado(), stdio: ['ignore', 'pipe', 'ignore'], ...opcoesDeProcesso() });
    } catch { resolver(null); return; }
    let saida = '';
    let estourou = false;
    processo.stdout.setEncoding('utf8');
    processo.stdout.on('data', (pedaco: string) => {
      saida += pedaco;
      if (saida.length > TETO_DA_SAIDA) { estourou = true; void encerrarArvore(processo, 'forcado'); }
    });
    const parar = () => { void encerrarArvore(processo, 'forcado'); };
    const prazo = setTimeout(parar, PRAZO_DO_SUMARIO_ORIGINAL_MS);
    prazo.unref?.();
    sinal?.addEventListener('abort', parar, { once: true });
    const fim = (valor: EntradaOriginal[] | null) => { clearTimeout(prazo); sinal?.removeEventListener('abort', parar); resolver(valor); };
    processo.on('error', () => fim(null));
    processo.on('close', (codigo) => {
      if (codigo !== 0 || estourou) { fim(null); return; }
      try { fim(entradasOriginais(JSON.parse(saida))); } catch { fim(null); }
    });
  });
}

export function entradasOriginais(bruto: unknown): EntradaOriginal[] | null {
  if (!ehObjeto(bruto) || !Array.isArray(bruto.entradas)) return null;
  return bruto.entradas.flatMap((entrada: unknown): EntradaOriginal[] => {
    if (!ehObjeto(entrada) || typeof entrada.titulo !== 'string' || !Number.isInteger(entrada.nivel)) return [];
    const titulo = linhaDoTitulo(entrada.titulo).slice(0, 200);
    return titulo === '' ? [] : [{ nivel: Math.min(6, Math.max(1, entrada.nivel as number)), titulo }];
  }).slice(0, 1000);
}

// ---------------------------------------------------------------- a resposta e a proposta

export class PropostaRecusada extends Error {
  constructor(motivo: string) { super(motivo); this.name = 'PropostaRecusada'; }
}

const palavrasComparaveis = (texto: string): string[] => comparavel(texto).split(' ').filter((palavra) => palavra !== '');

/**
 * Confere a proposta contra as seções; lança `PropostaRecusada` com o motivo. Regras: cada entrada abre
 * uma seção existente, em ordem e sem repetir; o nível sobe de um em um; capítulo com texto continua
 * capítulo; só capítulo vazio fica de fora; subseção não vira capítulo; e o título só usa palavras dos
 * títulos vizinhos (a seção, as deixadas de fora em volta dela) ou do sumário do arquivo.
 */
export function conferirProposta(secoes: readonly SecaoDoPrompt[], proposta: readonly EntradaDoSumarioSugerido[], original: readonly EntradaOriginal[] | null): void {
  const indice = new Map(secoes.map((secao, i) => [secao.bloco_inicio, i]));
  const mantidas: number[] = [];
  let nivelAnterior = 0;
  for (const entrada of proposta) {
    const i = indice.get(entrada.bloco_inicio);
    if (i === undefined) throw new PropostaRecusada(`A entrada "${entrada.titulo}" não começa numa seção existente.`);
    if (i <= (mantidas.at(-1) ?? -1)) throw new PropostaRecusada(`A entrada "${entrada.titulo}" está fora de ordem ou repetida.`);
    if (entrada.nivel > nivelAnterior + 1) throw new PropostaRecusada(`A entrada "${entrada.titulo}" pula um nível.`);
    const real = secoes[i]?.nivel ?? 1;
    if (real === 1 && entrada.nivel !== 1) throw new PropostaRecusada(`O capítulo "${secoes[i]?.titulo ?? ''}" deixaria de ser capítulo.`);
    if (real > 1 && entrada.nivel === 1) throw new PropostaRecusada(`A subseção "${secoes[i]?.titulo ?? ''}" viraria capítulo.`);
    mantidas.push(i);
    nivelAnterior = entrada.nivel;
  }
  secoes.forEach((secao, i) => {
    if (secao.nivel === 1 && secao.palavras > 0 && !mantidas.includes(i)) throw new PropostaRecusada(`O capítulo "${secao.titulo}" tem texto e ficaria de fora.`);
  });
  const doArquivo = new Set((original ?? []).flatMap((entrada) => palavrasComparaveis(entrada.titulo)));
  proposta.forEach((entrada, k) => {
    const de = (mantidas[k - 1] ?? -1) + 1;
    const ate = (mantidas[k + 1] ?? secoes.length) - 1;
    const vizinhas = new Set(secoes.slice(de, ate + 1).flatMap((secao) => palavrasComparaveis(secao.titulo)));
    const inventada = palavrasComparaveis(entrada.titulo).find((palavra) => !vizinhas.has(palavra) && !doArquivo.has(palavra));
    if (inventada !== undefined) throw new PropostaRecusada(`O título "${entrada.titulo}" traz uma palavra que não está no livro: "${inventada}".`);
  });
}

/** A resposta do Codex: forma pelo contrato; a proposta (quando há e o sumário não está `ok`) contra as seções. */
export function lerSaidaDoSumario(bruto: unknown, secoes: readonly SecaoDoPrompt[], original: readonly EntradaOriginal[] | null): { resposta: ConferenciaDoSumarioV1; recusa: string | null } {
  if (!ehObjeto(bruto)) throw new Error('Resposta da conferência do sumário não é um objeto.');
  const { proposta, ...resto } = bruto as Record<string, unknown>;
  const valor = Array.isArray(proposta) && proposta.length > 0 ? { ...resto, proposta } : resto;
  if (!validarConferenciaDoSumario(valor)) throw new Error('Resposta da conferência do sumário fora do contrato.');
  const resposta: ConferenciaDoSumarioV1 = { ok: valor.ok, problemas: valor.problemas.map(linhaDoTitulo) };
  if (valor.ok || valor.proposta === undefined) return { resposta, recusa: null };
  try {
    conferirProposta(secoes, valor.proposta, original);
  } catch (erro) {
    if (erro instanceof PropostaRecusada) return { resposta, recusa: erro.message };
    throw erro;
  }
  return { resposta: { ...resposta, proposta: valor.proposta.map((entrada) => ({ ...entrada, titulo: linhaDoTitulo(entrada.titulo) })) }, recusa: null };
}

// ---------------------------------------------------------------- execução e publicação

export interface ConfiguracaoDoSumario {
  banco: pg.Pool;
  executor: Executor;
  modelo: string;
  esforco: string;
  prazoMs?: number;
  /** O sumário do próprio arquivo; nos testes, um falso. */
  lerOriginal?: (entrada: string, formato: string, sinal?: AbortSignal) => Promise<EntradaOriginal[] | null>;
}

interface DadosDaConferencia extends DadosDoPromptDoSumario { documento_id: Id; caminho: string }

async function dadosDaConferencia(cliente: Transacao, versaoId: Id): Promise<Omit<DadosDaConferencia, 'original'>> {
  const versao = await obterVersao(cliente, versaoId);
  const documento = (await cliente.query<{ id: Id; titulo: string; origem_caminho: string }>('SELECT id, titulo, origem_caminho FROM documento WHERE id=$1', [versao.documento_id])).rows[0];
  if (!documento) throw new Error('Documento inexistente.');
  const suspeitas = (await cliente.query<{ suspeitas: Suspeita[] }>('SELECT suspeitas FROM conferencia_sumario WHERE versao_id=$1', [versaoId])).rows[0]?.suspeitas ?? [];
  return {
    documento_id: documento.id, titulo: documento.titulo, formato: versao.canonico.documento.formato, canonico: versao.canonico,
    suspeitas, caminho: originalDoDocumento(documento),
  };
}

export async function executarConferencia(config: ConfiguracaoDoSumario, tarefa: Tarefa): Promise<ResultadoExecutor> {
  const chave = entradaDoJob(tarefa.job.entrada).dedup_key;
  const dados = await comTransacao(config.banco, (cliente) => dadosDaConferencia(cliente, versaoDaChave(chave)));
  const original = await (config.lerOriginal ?? lerSumarioOriginal)(dados.caminho, dados.formato, tarefa.sinal);
  // Guardado na conferência: a publicação confere as palavras dos títulos sem rodar o motor de novo.
  await config.banco.query('UPDATE conferencia_sumario SET sumario_original=$2 WHERE versao_id=$1', [versaoDaChave(chave), JSON.stringify(original)]);
  const raiz = await mkdtemp(join(tmpdir(), 'margem-sumario-'));
  try {
    const montado = montarPromptDoSumario({ ...dados, original });
    const preparada = await prepararEntrada(raiz, montado.prompt, montado.schema);
    return await config.executor({
      diretorioEntrada: preparada.diretorioEntrada, prompt: preparada.prompt, schema: preparada.schema,
      prazoMs: config.prazoMs ?? PRAZO_DO_SUMARIO_MS, modelo: config.modelo, esforco: config.esforco, sinal: tarefa.sinal,
    });
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
}

export async function publicarConferencia(
  cliente: Transacao, dedupKey: string, jobId: Id, execucao: ExecucaoOk,
): Promise<JobResultV1['diagnosticos']> {
  const versaoId = versaoDaChave(dedupKey);
  const linha = (await cliente.query<{ estado: EstadoDaConferencia; sumario_original: EntradaOriginal[] | null }>(
    'SELECT estado, sumario_original FROM conferencia_sumario WHERE versao_id=$1 FOR UPDATE', [versaoId])).rows[0];
  const versao = await obterVersao(cliente, versaoId);
  const secoes = secoesDoPrompt(versao.canonico);
  const original = entradasOriginais({ entradas: linha?.sumario_original ?? [] });
  const { resposta, recusa } = lerSaidaDoSumario(await lerJsonLimitado(execucao.artefato, ORCAMENTOS.resposta), secoes, original);
  await registrarNaAuditoria('resposta.validada.json', { resposta, recusa });
  const diagnosticos: JobResultV1['diagnosticos'] = [{
    nivel: 'info', codigo: resposta.ok ? 'sumario_confere' : 'sumario_suspeito',
    mensagem: resposta.ok ? 'O sumário confere.' : `${String(resposta.problemas.length)} problemas; ${resposta.proposta ? `sugestão com ${String(resposta.proposta.length)} entradas` : 'sem sugestão'}.`,
  }];
  if (recusa !== null) diagnosticos.push({ nivel: 'aviso', codigo: 'sugestao_recusada', mensagem: recusa });
  // A pessoa já decidiu (outra tentativa publicou antes): a decisão dela fica.
  if (linha && (linha.estado === 'aplicada' || linha.estado === 'mantida')) return diagnosticos;
  await cliente.query(`INSERT INTO conferencia_sumario (versao_id, documento_id, estado, suspeitas, resposta, job_id) VALUES ($1,$2,$3,'[]',$4,$5)
    ON CONFLICT (versao_id) DO UPDATE SET estado=excluded.estado, resposta=excluded.resposta, job_id=excluded.job_id, atualizada_em=clock_timestamp()`,
  [versaoId, versao.documento_id, resposta.ok ? 'ok' : 'suspeito', JSON.stringify(resposta), jobId]);
  return diagnosticos;
}

function chaveDo(contexto: ContextoPublicacao | Tarefa): string { return entradaDoJob(contexto.job.entrada).dedup_key; }

export function manipuladoresDoSumario(config: ConfiguracaoDoSumario): Record<string, Manipulador> {
  return {
    [TIPO_CONFERIR_SUMARIO]: {
      executar: (tarefa) => executarConferencia(config, tarefa),
      publicar: async (_tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao): Promise<JobResultV1> => ({
        job_id: contexto.job.id, attempt: contexto.job.attempt, lease_token: contexto.lease_token, duracao_ms: execucao.duracao_ms,
        estado: 'ok', modelo: execucao.modelo, artefato: { caminho: execucao.artefato, sha256: execucao.sha256 },
        diagnosticos: await publicarConferencia(exigirTransacao(contexto), chaveDo(contexto), contexto.job.id, execucao),
      }),
    },
  };
}

// ---------------------------------------------------------------- apresentação e decisão

/** As seções como o sumário as mostra: as do canônico, ou as da sugestão aceita (mesmos ids, outro título e nível). */
export function secoesApresentadas(secoes: readonly Secao[], proposta: readonly EntradaDoSumarioSugerido[] | null): Secao[] {
  const todas = ordenadas(secoes);
  if (proposta === null) return todas;
  const porInicio = new Map(todas.map((secao) => [secao.bloco_inicio, secao]));
  const saida: Secao[] = [];
  for (const entrada of proposta) {
    const secao = porInicio.get(entrada.bloco_inicio);
    // Uma proposta conferida sempre acha a seção; se não achar (versão trocada), o canônico vale.
    if (!secao) return todas;
    saida.push({ ...secao, titulo: entrada.titulo, nivel: entrada.nivel });
  }
  return saida;
}

/** O capítulo apresentado que corresponde a um capítulo do canônico: ele mesmo, ou o seguinte visível (o vazio que saiu). */
export function capituloApresentado(apresentadas: readonly Secao[], todas: readonly Secao[], capituloId: Id | null): Id | null {
  if (capituloId === null) return null;
  const capitulos = apresentadas.filter((secao) => secao.nivel === 1);
  if (capitulos.some((secao) => secao.id === capituloId)) return capituloId;
  const ordem = todas.find((secao) => secao.id === capituloId)?.ordem;
  return ordem === undefined ? null : capitulos.find((secao) => secao.ordem > ordem)?.id ?? capitulos.at(-1)?.id ?? null;
}

/**
 * R3-2: anterior e próximo pela lista de capítulos apresentada (a da sugestão em uso), e não pela do canônico.
 * Vale também para um capítulo que saiu do sumário e foi aberto por uma âncora: os vizinhos são os visíveis em volta.
 */
export function vizinhosApresentados(apresentadas: readonly Secao[], secao: Pick<Secao, 'id' | 'ordem'>): { anterior: Id | null; proxima: Id | null } {
  const capitulos = apresentadas.filter((candidata) => candidata.nivel === 1 && candidata.id !== secao.id);
  return {
    anterior: capitulos.filter((candidata) => candidata.ordem < secao.ordem).at(-1)?.id ?? null,
    proxima: capitulos.find((candidata) => candidata.ordem > secao.ordem)?.id ?? null,
  };
}

/** A sugestão em uso numa versão (`aplicada`), ou `null`. */
export async function sugestaoEmUso(cliente: Transacao, versaoId: Id): Promise<EntradaDoSumarioSugerido[] | null> {
  const linha = (await cliente.query<{ resposta: ConferenciaDoSumarioV1 | null }>(
    `SELECT resposta FROM conferencia_sumario WHERE versao_id=$1 AND estado='aplicada'`, [versaoId])).rows[0];
  return linha?.resposta?.proposta ?? null;
}

/**
 * R3-8: as seções do canônico (mesma estrutura, para as âncoras e os capítulos) com os títulos que o
 * sumário mostra, por id, quando a sugestão está em uso. Para as exportações (Obsidian).
 */
export async function secoesComTitulosApresentados(cliente: Transacao, versaoId: Id, secoes: readonly Secao[]): Promise<Secao[]> {
  const sugestao = await sugestaoEmUso(cliente, versaoId);
  if (sugestao === null) return [...secoes];
  const titulos = new Map(secoesApresentadas(secoes, sugestao).map((secao) => [secao.id, secao.titulo]));
  return secoes.map((secao) => ({ ...secao, titulo: titulos.get(secao.id) ?? secao.titulo }));
}

export interface EntradaDoSumario { titulo: string; nivel: number }
export interface SituacaoDoSumario {
  versao_id: Id;
  estado: EstadoDaConferencia;
  problemas: string[];
  antes: EntradaDoSumario[];
  /** A sugestão; `null` sem sugestão aproveitável. */
  depois: EntradaDoSumario[] | null;
}

/** O que a página do documento mostra, para a versão mais recente; `null` quando não há o que mostrar. */
export async function situacaoDoSumario(cliente: Transacao, documentoId: Id): Promise<SituacaoDoSumario | null> {
  const linha = (await cliente.query<{ versao_id: Id; estado: EstadoDaConferencia; resposta: ConferenciaDoSumarioV1 | null; suspeitas: Suspeita[] }>(
    `SELECT c.versao_id, c.estado, c.resposta, c.suspeitas FROM conferencia_sumario c
      WHERE c.versao_id = (SELECT id FROM versao_texto WHERE documento_id=$1 ORDER BY numero DESC LIMIT 1)`, [documentoId])).rows[0];
  if (!linha) return null;
  const versao = await obterVersao(cliente, linha.versao_id);
  const antes = ordenadas(versao.canonico.secoes).map((secao) => ({ titulo: secao.titulo, nivel: secao.nivel }));
  const proposta = linha.resposta?.proposta ?? null;
  return {
    versao_id: linha.versao_id, estado: linha.estado,
    problemas: linha.resposta?.problemas ?? linha.suspeitas.map((suspeita) => suspeita.mensagem),
    antes, depois: proposta === null ? null : secoesApresentadas(versao.canonico.secoes, proposta).map((secao) => ({ titulo: secao.titulo, nivel: secao.nivel })),
  };
}

export class DecisaoInvalida extends Error {
  constructor(mensagem: string) { super(mensagem); this.name = 'DecisaoInvalida'; }
}

/** "Usar o sumário sugerido" (`usar`) ou "Manter" / "Voltar ao original" (`manter`). Nada muda no texto. */
export async function decidirSumario(cliente: Transacao, documentoId: Id, decisao: 'usar' | 'manter'): Promise<SituacaoDoSumario | null> {
  const atual = await situacaoDoSumario(cliente, documentoId);
  if (atual === null) throw new DecisaoInvalida('Este documento não tem sumário conferido.');
  if (decisao === 'usar') {
    if (atual.depois === null || !['suspeito', 'mantida'].includes(atual.estado)) throw new DecisaoInvalida('Não há sugestão para usar.');
  } else if (!['suspeito', 'aplicada', 'mantida'].includes(atual.estado)) {
    throw new DecisaoInvalida('Não há aviso sobre o sumário.');
  }
  await cliente.query('UPDATE conferencia_sumario SET estado=$2, atualizada_em=clock_timestamp() WHERE versao_id=$1',
    [atual.versao_id, decisao === 'usar' ? 'aplicada' : 'mantida']);
  return situacaoDoSumario(cliente, documentoId);
}
