/**
 * Auditoria por chamada (J26, `docs/desenho/10-MODELO-DO-CAPITULO.md` §8).
 *
 * O `Worker` abre um contexto por tentativa (`comAuditoria`) com o job, o tipo, a tentativa
 * e o diretório. O executor embrulhado por `executorAuditado` grava, dentro dele, o prompt
 * exato, os outros arquivos da entrada, o schema, a resposta conferida e os metadados; a
 * publicação acrescenta o que sobrou depois do resolvedor (`registrarNaAuditoria`). Nada
 * disso muda a assinatura dos manipuladores.
 *
 * O que nunca entra: stderr da CLI (pode conter credencial) e o ambiente. O prompt só tem
 * instruções e texto do documento.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from './artefato.js';
import { ARQUIVO_PROMPT, PONTEIRO_DO_PROMPT } from './entrada.js';
import type { Executor, PedidoExecucao, ResultadoExecutor } from './tipos.js';

export interface ContextoDeAuditoria {
  job_id: string;
  tipo: string;
  attempt: number;
  /** Raiz da auditoria; a tentativa grava em `<raiz>/jobs/<job>/tentativa-<n>/`. */
  raiz: string;
}

const armazenamento = new AsyncLocalStorage<ContextoDeAuditoria>();

/** Roda `acao` com o contexto de auditoria da tentativa. */
export function comAuditoria<T>(contexto: ContextoDeAuditoria, acao: () => Promise<T>): Promise<T> {
  return armazenamento.run(contexto, acao);
}

export function contextoDeAuditoria(): ContextoDeAuditoria | undefined {
  return armazenamento.getStore();
}

export function raizDaAuditoria(ambiente: NodeJS.ProcessEnv = process.env): string {
  const base = ambiente.MARGEM_ARTEFATOS;
  return join(base === undefined || base.trim() === '' ? join(homedir(), '.cache/margem') : base, 'auditoria');
}

export function diretorioDaTentativa(raiz: string, jobId: string, attempt: number): string {
  return join(raiz, 'jobs', jobId, `tentativa-${String(attempt)}`);
}

function diretorioAtual(): string | undefined {
  const contexto = contextoDeAuditoria();
  return contexto === undefined ? undefined : diretorioDaTentativa(contexto.raiz, contexto.job_id, contexto.attempt);
}

async function gravar(diretorio: string, nome: string, conteudo: string): Promise<void> {
  await mkdir(diretorio, { recursive: true, mode: 0o700 });
  await writeFile(join(diretorio, nome), conteudo, { mode: 0o600 });
}

function json(valor: unknown): string {
  return `${JSON.stringify(valor, null, 2)}\n`;
}

/**
 * Grava um arquivo no diretório da tentativa em curso. Fora de uma tentativa (testes de
 * unidade, rotas HTTP) não faz nada. Falha de disco não derruba a publicação: a auditoria
 * é registro, não parte do resultado.
 */
export async function registrarNaAuditoria(nome: string, valor: unknown): Promise<void> {
  const diretorio = diretorioAtual();
  if (diretorio === undefined) return;
  try {
    await gravar(diretorio, nome, typeof valor === 'string' ? valor : json(valor));
  } catch {
    // Registro perdido; o job continua.
  }
}

let commitEmCache: string | undefined;
/** Commit do repositório em que o worker roda, lido uma vez. */
export function commitAtual(): string {
  if (commitEmCache !== undefined) return commitEmCache;
  try {
    commitEmCache = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    commitEmCache = 'desconhecido';
  }
  return commitEmCache;
}

/** O prompt de verdade: se foi para `prompt.md`, o argumento é só o ponteiro. */
async function promptReal(pedido: PedidoExecucao): Promise<string> {
  if (pedido.prompt !== PONTEIRO_DO_PROMPT) return pedido.prompt;
  try {
    return await readFile(join(pedido.diretorioEntrada, ARQUIVO_PROMPT), 'utf8');
  } catch {
    return pedido.prompt;
  }
}

async function copiarEntrada(origem: string, destino: string): Promise<string[]> {
  let nomes: string[];
  try {
    nomes = await readdir(origem);
  } catch {
    return [];
  }
  const copiados: string[] = [];
  for (const nome of nomes) {
    if (nome === ARQUIVO_PROMPT) continue;
    const caminho = join(origem, nome);
    if (!(await stat(caminho)).isFile()) continue;
    await mkdir(destino, { recursive: true, mode: 0o700 });
    await copyFile(caminho, join(destino, nome));
    copiados.push(nome);
  }
  return copiados;
}

export interface OpcoesDaAuditoria {
  /** Fonte do commit; injetável nos testes. */
  commit?: () => string;
  agora?: () => Date;
}

/**
 * Embrulha um executor: antes da chamada grava prompt, entrada, schema e metadados; depois,
 * o resultado e a resposta conferida. Sem contexto de auditoria, só repassa.
 */
export function executorAuditado(executor: Executor, opcoes: OpcoesDaAuditoria = {}): Executor {
  const commit = opcoes.commit ?? commitAtual;
  const agora = opcoes.agora ?? (() => new Date());
  return async (pedido) => {
    const contexto = contextoDeAuditoria();
    if (contexto === undefined) return executor(pedido);
    const diretorio = diretorioDaTentativa(contexto.raiz, contexto.job_id, contexto.attempt);
    const inicio = agora();
    try {
      const prompt = await promptReal(pedido);
      await gravar(diretorio, 'prompt.txt', prompt);
      const entrada = await copiarEntrada(pedido.diretorioEntrada, join(diretorio, 'entrada'));
      await copyFile(pedido.schema, join(diretorio, 'schema.json')).catch(() => undefined);
      await gravar(diretorio, 'metadados.json', json({
        job_id: contexto.job_id, tipo: contexto.tipo, attempt: contexto.attempt,
        modelo_pedido: pedido.modelo ?? null, esforco_pedido: pedido.esforco ?? null, prazo_ms: pedido.prazoMs,
        sha256_prompt: sha256(prompt), tamanho_prompt: prompt.length, prompt_em_arquivo: pedido.prompt !== prompt,
        entrada, commit: commit(), inicio: inicio.toISOString(),
      }));
    } catch {
      // Sem auditoria desta vez; a chamada acontece mesmo assim.
    }
    const resultado: ResultadoExecutor = await executor(pedido);
    try {
      await gravar(diretorio, 'resultado.json', json(resumoDoResultado(resultado)));
      if (resultado.estado === 'ok') await copyFile(resultado.artefato, join(diretorio, 'resposta.bruta.json'));
    } catch {
      // Idem.
    }
    return resultado;
  };
}

function resumoDoResultado(resultado: ResultadoExecutor): Record<string, unknown> {
  switch (resultado.estado) {
    case 'ok':
      return {
        estado: 'ok', modelo: resultado.modelo, esforco: resultado.esforco ?? null,
        duracao_ms: resultado.duracao_ms, sha256_resposta: resultado.sha256,
      };
    case 'adiado':
      return { estado: 'adiado', codigo: resultado.codigo, not_before: resultado.not_before.toISOString(), duracao_ms: resultado.duracao_ms };
    default:
      return { estado: 'falhou', codigo: resultado.codigo, mensagem: resultado.mensagem, duracao_ms: resultado.duracao_ms };
  }
}
