/**
 * O Codex revisa uma nota do leitor (J37). O leitor pede, com ou sem instrução; o pedido fica pendente na
 * nota e vira o job `revisar_anotacao`. No padrão dos outros jobs: o `codex exec` roda fora de transação e a
 * publicação, dentro da transação, confere que o pedido ainda é este (publicação única) e troca o texto,
 * guardando o anterior e o motivo em `revisao`.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AnotacaoV1, Id, JobResultV1, MarcaV2 } from '@margem/contratos';
import { comTransacao, type Transacao } from '../db/transacao.js';
import { sha256 } from '../executor/artefato.js';
import { prepararEntrada } from '../executor/entrada.js';
import type { ExecucaoOk, Executor, ResultadoExecutor } from '../executor/tipos.js';
import { cercar, corpoDoModelo, ehObjeto, lerPrompt, preencher } from '../leitura/v2/prompt.js';
import * as anotacoesRepo from '../repos/anotacoes.js';
import { obterVersao } from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import { exigirTransacao } from '../worker/canonizar.js';
import { entradaDoJob } from '../worker/fila-postgres.js';
import type { ContextoPublicacao } from '../worker/fila.js';
import type { Manipulador, Tarefa } from '../worker/worker.js';

export const TIPO_REVISAR_ANOTACAO = 'revisar_anotacao';
export const VERSAO_PROMPT_REVISAR = 'revisar-anotacao@2';
const ROTULO_DO_TIPO: Record<AnotacaoV1['tipo'], string> = {
  impressao: 'impressão', observacao: 'observação', hipotese: 'hipótese', duvida: 'dúvida', fonte: 'fonte', nota: 'nota',
};

export interface ConfiguracaoDaRevisao {
  banco: import('pg').Pool;
  executor: Executor;
  modelo: string;
  esforco: string;
  prazoMs?: number;
}

export const chaveDaRevisao = (anotacao: Id, pedido: Id): string => `revisar_anotacao:${anotacao}:${pedido}`;
function lerChave(dedupKey: string): { anotacao: Id; pedido: Id } {
  const [tipo, anotacao, pedido, ...resto] = dedupKey.split(':');
  if (tipo !== 'revisar_anotacao' || !anotacao || !pedido || resto.length > 0) throw new Error(`Chave de revisão malformada: ${dedupKey}`);
  return { anotacao, pedido };
}

export async function enfileirarRevisao(cliente: Transacao, anotacao: AnotacaoV1, pedido: anotacoesRepo.PedidoDeRevisao): Promise<jobsRepo.Job> {
  return jobsRepo.enfileirar(cliente, {
    tipo: TIPO_REVISAR_ANOTACAO, dedup_key: chaveDaRevisao(anotacao.id, pedido.id),
    input_snapshot_hash: sha256(`${anotacao.id}:${pedido.id}:${anotacao.texto}:${pedido.instrucao ?? ''}`),
    versao_id: anotacao.versao_id, prioridade: jobsRepo.PRIORIDADE.capitulo_aberto,
  });
}

export interface PromptDaRevisao { prompt: string; schema: Record<string, unknown> }

/** O prompt da revisão: o trecho, o parágrafo, a marca (se a nota se liga a uma), a nota e o pedido, cercados. */
export function montarPromptDeRevisao(dados: {
  documento: string; paragrafo: string; anotacao: AnotacaoV1; marca: Pick<MarcaV2, 'funcao' | 'comentario'> | null; instrucao: string | null;
}): PromptDaRevisao {
  const schema: unknown = JSON.parse(lerPrompt(`${VERSAO_PROMPT_REVISAR}.schema.json`));
  if (!ehObjeto(schema)) throw new Error('Schema da revisão não é um objeto.');
  const marca = dados.marca === null ? '(a nota não se liga a uma marca)'
    : cercar(`Função: ${dados.marca.funcao}${dados.marca.comentario ? `\nNota da marca: ${dados.marca.comentario.texto}` : ''}`);
  return {
    prompt: preencher(corpoDoModelo(lerPrompt(`${VERSAO_PROMPT_REVISAR}.md`)), {
      documento: dados.documento,
      trecho: cercar(dados.anotacao.ancora.citacao),
      paragrafo: cercar(dados.paragrafo),
      marca,
      tipo: ROTULO_DO_TIPO[dados.anotacao.tipo],
      nota: cercar(dados.anotacao.texto),
      instrucao: dados.instrucao === null || dados.instrucao.trim() === '' ? '(nenhum pedido específico: revise para ficar clara e fiel ao trecho)' : cercar(dados.instrucao),
    }),
    schema,
  };
}

export async function executarRevisao(config: ConfiguracaoDaRevisao, dedupKey: string, sinal?: AbortSignal): Promise<ResultadoExecutor> {
  const { anotacao: id, pedido } = lerChave(dedupKey);
  const dados = await comTransacao(config.banco, async (cliente) => {
    const anotacao = await anotacoesRepo.obter(cliente, id);
    const pendente = await anotacoesRepo.pedidoDeRevisao(cliente, id);
    if (!anotacao || pendente?.id !== pedido) throw new Error('Nota inexistente ou pedido de revisão já atendido.');
    const versao = await obterVersao(cliente, anotacao.versao_id);
    const bloco = versao.canonico.blocos.find((item) => item.id === anotacao.ancora.bloco_id);
    const marca = anotacao.marca_id === undefined ? null
      : (await cliente.query<{ funcao: string; comentario: MarcaV2['comentario'] }>('SELECT funcao, comentario FROM marca WHERE id=$1', [anotacao.marca_id])).rows[0] ?? null;
    return { documento: versao.canonico.documento.titulo, paragrafo: bloco?.texto ?? anotacao.ancora.citacao, anotacao, marca, instrucao: pendente.instrucao };
  });
  const raiz = await mkdtemp(join(tmpdir(), 'margem-revisao-'));
  try {
    const montado = montarPromptDeRevisao(dados);
    const preparada = await prepararEntrada(raiz, montado.prompt, montado.schema);
    return await config.executor({
      diretorioEntrada: preparada.diretorioEntrada, prompt: preparada.prompt, schema: preparada.schema,
      prazoMs: config.prazoMs ?? 600_000, modelo: config.modelo, esforco: config.esforco,
      ...(sinal === undefined ? {} : { sinal }),
    });
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
}

function revisaoValida(valor: unknown): valor is { texto: string; motivo: string } {
  if (!ehObjeto(valor)) return false;
  const { texto, motivo } = valor as { texto?: unknown; motivo?: unknown };
  return Object.keys(valor).length === 2 && typeof texto === 'string' && texto.trim() !== '' && texto.length <= 8000
    && typeof motivo === 'string' && motivo.trim() !== '' && motivo.length <= 600;
}

export async function publicarRevisao(cliente: Transacao, dedupKey: string, execucao: ExecucaoOk, agora: () => Date = () => new Date()): Promise<JobResultV1['diagnosticos']> {
  const { anotacao, pedido } = lerChave(dedupKey);
  const bruto: unknown = JSON.parse(await readFile(execucao.artefato, 'utf8'));
  if (!revisaoValida(bruto)) throw new Error('Revisão fora do schema.');
  const antes = await anotacoesRepo.obter(cliente, anotacao);
  await anotacoesRepo.aplicarRevisao(cliente, anotacao, pedido, bruto.texto.trim(), bruto.motivo.trim(), agora().toISOString());
  return antes?.texto === bruto.texto.trim() ? [{ nivel: 'aviso', codigo: 'nota_sem_mudanca', mensagem: 'O Codex devolveu a nota como estava.' }] : [];
}

function chaveDo(contexto: ContextoPublicacao | Tarefa): string { return entradaDoJob(contexto.job.entrada).dedup_key; }

export function manipuladoresDaRevisao(config: ConfiguracaoDaRevisao): Record<string, Manipulador> {
  return {
    [TIPO_REVISAR_ANOTACAO]: {
      executar: (tarefa) => executarRevisao(config, chaveDo(tarefa), tarefa.sinal),
      publicar: async (_tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao): Promise<JobResultV1> => ({
        job_id: contexto.job.id, attempt: contexto.job.attempt, lease_token: contexto.lease_token, duracao_ms: execucao.duracao_ms,
        estado: 'ok', modelo: execucao.modelo, artefato: { caminho: execucao.artefato, sha256: execucao.sha256 },
        diagnosticos: await publicarRevisao(exigirTransacao(contexto), chaveDo(contexto), execucao),
      }),
    },
  };
}
