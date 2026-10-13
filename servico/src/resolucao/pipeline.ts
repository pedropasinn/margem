import { lerJsonLimitado, ORCAMENTOS } from '../entrada-json.js';
/**
 * Resolução de exercícios (J34): o leitor recorta um exercício de uma página (ou seleciona um trecho) e o
 * Codex, numa sessão só daquele exercício, devolve a resolução passo a passo; depois, cada pergunta sobre
 * ela vira um job de explicação. Dois jobs, no padrão dos outros: o `codex exec` roda fora de transação;
 * a escrita, dentro da transação da publicação, com a sessão travada (publicação única).
 */
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ulid } from 'ulid';
import { validarResolucaoGerada, type Id, type JobResultV1, type PassoDaResolucaoV1, type ResolucaoV2 } from '@margem/contratos';
import { pastaDoDocumento } from '../dados.js';
import { comTransacao, type Transacao } from '../db/transacao.js';
import { sha256 } from '../executor/artefato.js';
import { prepararEntrada } from '../executor/entrada.js';
import type { ExecucaoOk, Executor, ResultadoExecutor } from '../executor/tipos.js';
import { obterVersao } from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import * as repo from '../repos/resolucoes.js';
import { exigirTransacao } from '../worker/canonizar.js';
import { entradaDoJob } from '../worker/fila-postgres.js';
import type { ContextoPublicacao } from '../worker/fila.js';
import type { Manipulador, Tarefa } from '../worker/worker.js';
import { montarPromptDeExplicacao, montarPromptDeResolucao, type PromptDaResolucao } from './prompts.js';

export const TIPO_RESOLVER = 'resolver_exercicio';
export const TIPO_EXPLICAR = 'explicar_resolucao';
const ARQUIVO_DA_IMAGEM = 'recorte.png';

export interface ConfiguracaoDaResolucao {
  banco: import('pg').Pool;
  executor: Executor;
  modelo: string;
  /** Resolver pede raciocínio (contas certas); explicar, menos. */
  esforco: string;
  esforcoDaExplicacao?: string;
  prazoMs?: number;
}

export const chaves = {
  resolver: (sessao: Id) => `resolver:${sessao}`,
  explicar: (sessao: Id, pergunta: Id) => `explicar:${sessao}:${pergunta}`,
};
function lerChave(dedupKey: string): { sessao: Id; pergunta: Id | null } {
  const [tipo, sessao, pergunta, ...resto] = dedupKey.split(':');
  if (!sessao || resto.length > 0 || (tipo === 'resolver' ? pergunta !== undefined : tipo !== 'explicar' || !pergunta)) {
    throw new Error(`Chave de job da resolução malformada: ${dedupKey}`);
  }
  return { sessao, pergunta: pergunta ?? null };
}

/** Onde mora a imagem de um recorte: na pasta do documento, pelo hash dos bytes. */
export function caminhoDaImagem(documentoId: Id, sha: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error('Hash de imagem inválido.');
  return join(pastaDoDocumento(documentoId), 'resolucoes', `${sha}.png`);
}

/** O pedido do leitor vai na frente; o lote de um livro (`dispararPendentes`) vai com a prioridade padrão. */
export async function enfileirarResolucao(cliente: Transacao, sessao: ResolucaoV2, prioridade: number = jobsRepo.PRIORIDADE.artefato_pedido): Promise<jobsRepo.Job> {
  return jobsRepo.enfileirar(cliente, {
    tipo: TIPO_RESOLVER, dedup_key: chaves.resolver(sessao.id), input_snapshot_hash: sha256(`${sessao.id}:${sessao.texto_extraido}`),
    versao_id: sessao.versao_id, prioridade,
  });
}
export async function enfileirarExplicacao(cliente: Transacao, sessao: ResolucaoV2, perguntaId: Id): Promise<jobsRepo.Job> {
  return jobsRepo.enfileirar(cliente, {
    tipo: TIPO_EXPLICAR, dedup_key: chaves.explicar(sessao.id, perguntaId), input_snapshot_hash: sha256(`${sessao.id}:${perguntaId}`),
    versao_id: sessao.versao_id, prioridade: jobsRepo.PRIORIDADE.capitulo_aberto,
  });
}

async function chamar(config: ConfiguracaoDaResolucao, sessao: ResolucaoV2, montar: (comImagem: boolean) => PromptDaResolucao, esforco: string, sinal?: AbortSignal): Promise<ResultadoExecutor> {
  const raiz = await mkdtemp(join(tmpdir(), 'margem-resolucao-'));
  try {
    const comImagem = sessao.origem.tipo === 'recorte';
    const montado = montar(comImagem);
    const preparada = await prepararEntrada(raiz, montado.prompt, montado.schema);
    if (sessao.origem.tipo === 'recorte') {
      await copyFile(caminhoDaImagem(sessao.documento_id, sessao.origem.imagem_sha256), join(preparada.diretorioEntrada, ARQUIVO_DA_IMAGEM));
    }
    return await config.executor({
      diretorioEntrada: preparada.diretorioEntrada, prompt: preparada.prompt, schema: preparada.schema,
      prazoMs: config.prazoMs ?? 1_800_000, modelo: config.modelo, esforco,
      ...(comImagem ? { imagens: [ARQUIVO_DA_IMAGEM] } : {}),
      ...(sinal === undefined ? {} : { sinal }),
    });
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
}

export async function executarResolucao(config: ConfiguracaoDaResolucao, dedupKey: string, sinal?: AbortSignal): Promise<ResultadoExecutor> {
  const { sessao: id } = lerChave(dedupKey);
  const { sessao, documento } = await comTransacao(config.banco, async (cliente) => {
    const atual = await repo.obter(cliente, id);
    if (!atual) throw new Error('Sessão de resolução inexistente.');
    return { sessao: atual, documento: (await obterVersao(cliente, atual.versao_id)).canonico.documento.titulo };
  });
  return chamar(config, sessao, (comImagem) => montarPromptDeResolucao(sessao, documento, comImagem), config.esforco, sinal);
}

export async function executarExplicacao(config: ConfiguracaoDaResolucao, dedupKey: string, sinal?: AbortSignal): Promise<ResultadoExecutor> {
  const { sessao: id, pergunta } = lerChave(dedupKey);
  const sessao = await comTransacao(config.banco, (cliente) => repo.obter(cliente, id));
  if (!sessao || pergunta === null) throw new Error('Sessão ou pergunta inexistente.');
  return chamar(config, sessao, (comImagem) => montarPromptDeExplicacao(sessao, pergunta, comImagem), config.esforcoDaExplicacao ?? config.esforco, sinal);
}

type Diagnosticos = JobResultV1['diagnosticos'];

export async function publicarResolucao(cliente: Transacao, dedupKey: string, execucao: ExecucaoOk): Promise<Diagnosticos> {
  const { sessao: id } = lerChave(dedupKey);
  const bruto: unknown = await lerJsonLimitado(execucao.artefato, ORCAMENTOS.resposta);
  if (!validarResolucaoGerada(bruto)) throw new Error(`Resolução fora do contrato: ${JSON.stringify(validarResolucaoGerada.errors)}`);
  const sessao = await repo.obter(cliente, id, { travar: true });
  if (!sessao) throw new Error('Sessão de resolução inexistente.');
  if (sessao.resolucao !== null) throw new Error('A sessão já tem resolução publicada.');
  await repo.gravar(cliente, { ...sessao, resolucao: bruto, execucao: { modelo: execucao.modelo, esforco: execucao.esforco ?? 'desconhecido' } });
  return bruto.legibilidade === 'boa' ? [] : [{ nivel: 'aviso', codigo: 'recorte_pouco_legivel', mensagem: `Legibilidade ${bruto.legibilidade}.` }];
}

function explicacaoValida(valor: unknown): valor is { texto: string; passos: PassoDaResolucaoV1[] } {
  if (typeof valor !== 'object' || valor === null) return false;
  const { texto, passos } = valor as { texto?: unknown; passos?: unknown };
  return typeof texto === 'string' && texto.trim() !== '' && Array.isArray(passos)
    && passos.every((passo: unknown) => typeof passo === 'object' && passo !== null
      && typeof (passo as { texto?: unknown }).texto === 'string' && ['string', 'object'].includes(typeof (passo as { calculo?: unknown }).calculo));
}

export async function publicarExplicacao(cliente: Transacao, dedupKey: string, execucao: ExecucaoOk, agora: () => Date = () => new Date()): Promise<Diagnosticos> {
  const { sessao: id, pergunta } = lerChave(dedupKey);
  const bruto: unknown = await lerJsonLimitado(execucao.artefato, ORCAMENTOS.resposta);
  if (!explicacaoValida(bruto)) throw new Error('Explicação fora do schema.');
  const sessao = await repo.obter(cliente, id, { travar: true });
  if (!sessao) throw new Error('Sessão de resolução inexistente.');
  const ultima = sessao.mensagens.at(-1);
  if (ultima?.id !== pergunta || ultima.autor !== 'leitor') throw new Error('A pergunta já tem resposta ou não é a última da sessão.');
  const instante = agora().toISOString();
  const criadaEm = Date.parse(instante) >= Date.parse(ultima.criada_em) ? instante : ultima.criada_em;
  await repo.gravar(cliente, { ...sessao, mensagens: [...sessao.mensagens, {
    id: ulid(), autor: 'ia', texto: bruto.texto.trim(), passos: bruto.passos,
    execucao: { modelo: execucao.modelo, esforco: execucao.esforco ?? 'desconhecido' }, criada_em: criadaEm,
  }] });
  return [];
}

function chaveDo(contexto: ContextoPublicacao | Tarefa): string { return entradaDoJob(contexto.job.entrada).dedup_key; }
function publicar(publicador: (cliente: Transacao, chave: string, execucao: ExecucaoOk) => Promise<Diagnosticos>) {
  return async (_tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao): Promise<JobResultV1> => ({
    job_id: contexto.job.id, attempt: contexto.job.attempt, lease_token: contexto.lease_token, duracao_ms: execucao.duracao_ms,
    estado: 'ok', modelo: execucao.modelo, artefato: { caminho: execucao.artefato, sha256: execucao.sha256 },
    diagnosticos: await publicador(exigirTransacao(contexto), chaveDo(contexto), execucao),
  });
}

export function manipuladoresDaResolucao(config: ConfiguracaoDaResolucao): Record<string, Manipulador> {
  return {
    [TIPO_RESOLVER]: { executar: (tarefa) => executarResolucao(config, chaveDo(tarefa), tarefa.sinal), publicar: publicar(publicarResolucao) },
    [TIPO_EXPLICAR]: { executar: (tarefa) => executarExplicacao(config, chaveDo(tarefa), tarefa.sinal), publicar: publicar((cliente, chave, execucao) => publicarExplicacao(cliente, chave, execucao)) },
  };
}
