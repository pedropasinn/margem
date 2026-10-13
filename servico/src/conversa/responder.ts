import { lerJsonLimitado, ORCAMENTOS } from '../entrada-json.js';
/**
 * Job `responder` (J16): a pergunta do leitor numa conversa vira um job na fila durável;
 * o worker monta o contexto, chama a porta `Responder` fora de transação e publica a
 * resposta — a mensagem `ia` com citações, contexto e execução, e as sugestões como
 * conexões `sugerida` — numa transação só, com a concessão conferida (publicação única).
 *
 * A porta é injetada. Aqui mora a implementação falsa e determinística (testes e
 * `MARGEM_RESPONDER=falso`); a real (prompt + Codex + resolução das citações) está em
 * `responder-codex.ts` (J19).
 */
import { registrarNaAuditoria } from '../executor/auditoria.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { ulid } from 'ulid';
import {
  MODO_F1, conferirAncora, hashEstrutural, validarAncora, validarConexaoV2,
  type AncoraV1, type Bloco, type CanonicoV1, type ConexaoV2, type ConversaV2, type Id, type JobResultV1,
  type MensagemIaV1, type ModoDeLeituraV1,
} from '@margem/contratos';
import { sha256 } from '../executor/artefato.js';
import { FalhaDoResponder } from './responder-codex.js';
import type { ExecucaoOk, ResultadoExecutor } from '../executor/tipos.js';
import { comTransacao, type Transacao } from '../db/transacao.js';
import { estimarTokens } from '../leitura/partes.js';
import { modoOuNada } from '../modos.js';
import { DadoRecusado } from '../repos/anotacoes.js';
import * as camadasRepo from '../repos/camadas.js';
import * as conexoesRepo from '../repos/conexoes.js';
import * as conversasRepo from '../repos/conversas.js';
import { obterVersao } from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import { exigirTransacao } from '../worker/canonizar.js';
import { entradaDoJob } from '../worker/fila-postgres.js';
import type { ContextoPublicacao } from '../worker/fila.js';
import type { Manipulador, Tarefa } from '../worker/worker.js';

export const TIPO_RESPONDER = 'responder';
/** Orçamento do contexto do capítulo mandado ao modelo, em tokens estimados. */
export const ORCAMENTO_CONTEXTO_TOKENS = 30_000;

/**
 * Sugestão de conexão como a porta devolve. O J17 (`resolverResposta`) entrega a
 * `ConexaoV2` sem `id` nem `criada_em`; uma `ConexaoV2` inteira também é aceita. O serviço
 * sempre sobrescreve `id`, `autor` (ia), `estado` (sugerida), `conversa_id` e `criada_em`.
 */
export type SugestaoDaResposta = Pick<ConexaoV2, 'origem' | 'destino' | 'relacao' | 'justificativa'> & {
  versao?: 2; id?: Id; autor?: ConexaoV2['autor']; estado?: ConexaoV2['estado'];
  conversa_id?: Id; criada_em?: string; decidida_em?: string;
};

export interface EntradaDoResponder {
  conversa: ConversaV2;
  pergunta: string;
  /** O bloco da âncora e, se couber no capítulo, o anterior e o seguinte. */
  blocos_nucleo: Bloco[];
  /** O resto do capítulo, na ordem do texto, escolhido dos mais próximos da âncora para os mais distantes até o orçamento. */
  blocos_contexto: Bloco[];
  modo: ModoDeLeituraV1;
}

export interface SaidaDoResponder {
  texto: string;
  citacoes: AncoraV1[];
  sugestoes: SugestaoDaResposta[];
  diagnosticos: { codigo: string; mensagem: string }[];
  modelo: string;
  esforco: string;
}

/** O sinal aborta a chamada ao Codex quando o job é cancelado. */
export type Responder = (entrada: EntradaDoResponder, sinal?: AbortSignal) => Promise<SaidaDoResponder>;

// ---------------------------------------------------------------- implementação falsa

/**
 * Responder falso e determinístico: cita a própria âncora e sugere uma conexão
 * `desenvolve` com o primeiro bloco não vazio do contexto. Nenhuma chamada ao Codex.
 */
export function responderFalso(): Responder {
  return (entrada) => {
    const { conversa, pergunta } = entrada;
    const destino = entrada.blocos_contexto.find((bloco) => bloco.texto.trim() !== '' && bloco.id !== conversa.ancora.bloco_id);
    const sugestoes: SugestaoDaResposta[] = destino === undefined ? [] : [{
      origem: conversa.ancora,
      destino: { tipo: 'trecho', ancora: {
        versao_id: conversa.versao_id, bloco_id: destino.id, inicio_utf16: 0, fim_utf16: destino.texto.length,
        citacao: destino.texto, prefixo: '', sufixo: '',
      } },
      relacao: 'desenvolve',
      justificativa: 'Sugestão determinística do responder falso.',
    }];
    return Promise.resolve({
      texto: `Resposta de teste (${entrada.modo.id}) a “${pergunta.slice(0, 200)}”, sobre “${conversa.ancora.citacao.slice(0, 200)}”.`,
      citacoes: [conversa.ancora],
      sugestoes,
      diagnosticos: [],
      modelo: 'responder-falso',
      esforco: 'nenhum',
    });
  };
}

// ---------------------------------------------------------------- fila

/** `responder:<conversa>:<pergunta>`: uma resposta por pergunta, a fila deduplica. */
export function chaveDoResponder(conversaId: Id, mensagemId: Id): string {
  return `responder:${conversaId}:${mensagemId}`;
}

export function lerChaveDoResponder(dedupKey: string): { conversa_id: Id; mensagem_id: Id } {
  const [prefixo, conversa_id, mensagem_id, ...resto] = dedupKey.split(':');
  if (prefixo !== 'responder' || !conversa_id || !mensagem_id || resto.length > 0) {
    throw new Error(`Chave de deduplicação do responder inválida: ${dedupKey}`);
  }
  return { conversa_id, mensagem_id };
}

/** Enfileira a resposta à pergunta, na transação que gravou a pergunta. */
export async function enfileirarResposta(cliente: Transacao, conversa: ConversaV2, mensagemId: Id): Promise<jobsRepo.Job> {
  return jobsRepo.enfileirar(cliente, {
    tipo: TIPO_RESPONDER,
    dedup_key: chaveDoResponder(conversa.id, mensagemId),
    input_snapshot_hash: sha256(`${conversa.id}:${mensagemId}`),
    versao_id: conversa.versao_id,
  });
}

// ---------------------------------------------------------------- contexto

/** Blocos do capítulo (seção de nível 1) que contém o bloco; sem capítulos, o documento inteiro. */
export function blocosDoCapitulo(canonico: CanonicoV1, blocoId: Id): Bloco[] {
  const posicao = new Map(canonico.blocos.map((bloco, indice) => [bloco.id, indice]));
  const alvo = posicao.get(blocoId);
  if (alvo === undefined) return [];
  for (const secao of canonico.secoes.filter((candidata) => candidata.nivel === 1)) {
    const inicio = posicao.get(secao.bloco_inicio);
    const fim = posicao.get(secao.bloco_fim);
    if (inicio !== undefined && fim !== undefined && inicio <= alvo && alvo <= fim) return canonico.blocos.slice(inicio, fim + 1);
  }
  return [...canonico.blocos];
}

/** Núcleo (âncora ± 1 no capítulo) e contexto (o resto, por proximidade, até o orçamento). */
export function recortarContexto(capitulo: readonly Bloco[], blocoId: Id, orcamento = ORCAMENTO_CONTEXTO_TOKENS): {
  blocos_nucleo: Bloco[]; blocos_contexto: Bloco[];
} {
  const indice = capitulo.findIndex((bloco) => bloco.id === blocoId);
  if (indice < 0) return { blocos_nucleo: [], blocos_contexto: [] };
  const nucleo = capitulo.slice(Math.max(0, indice - 1), indice + 2);
  let gasto = estimarTokens(nucleo.map((bloco) => bloco.texto));
  const escolhidos = new Set<number>();
  for (let distancia = 2; distancia < capitulo.length; distancia += 1) {
    for (const candidato of [indice - distancia, indice + distancia]) {
      const bloco = capitulo[candidato];
      if (!bloco) continue;
      const custo = estimarTokens([bloco.texto]);
      if (gasto + custo > orcamento) continue;
      gasto += custo;
      escolhidos.add(candidato);
    }
  }
  return {
    blocos_nucleo: nucleo,
    blocos_contexto: [...escolhidos].sort((a, b) => a - b).map((i) => capitulo[i]).filter((bloco): bloco is Bloco => bloco !== undefined),
  };
}

/** Modo da conversa: o da camada padrão da versão; sem camada, o de F1. */
async function modoDaVersao(cliente: Transacao, versaoId: Id): Promise<ModoDeLeituraV1> {
  const padrao = await camadasRepo.camadaPadrao(cliente, versaoId);
  const camada = padrao === null ? null : await camadasRepo.obter(cliente, padrao);
  const modo = modoOuNada(camada?.modo ?? MODO_F1) ?? modoOuNada(MODO_F1);
  if (!modo) throw new Error('Modo de F1 ausente de contratos/modos.');
  return modo;
}

export async function montarEntrada(cliente: Transacao, conversaId: Id, mensagemId: Id): Promise<EntradaDoResponder> {
  const conversa = await conversasRepo.obter(cliente, conversaId);
  if (!conversa) throw new Error('Conversa inexistente.');
  const pergunta = conversa.mensagens.find((mensagem) => mensagem.id === mensagemId);
  if (pergunta?.autor !== 'leitor') throw new Error('Pergunta inexistente na conversa.');
  const versao = await obterVersao(cliente, conversa.versao_id);
  const capitulo = blocosDoCapitulo(versao.canonico, conversa.ancora.bloco_id);
  // O modelo vê o fio até a pergunta que está respondendo, não o que veio depois.
  const ate = conversa.mensagens.findIndex((mensagem) => mensagem.id === mensagemId);
  return {
    conversa: { ...conversa, mensagens: conversa.mensagens.slice(0, ate + 1) },
    pergunta: pergunta.texto,
    ...recortarContexto(capitulo, conversa.ancora.bloco_id),
    modo: await modoDaVersao(cliente, conversa.versao_id),
  };
}

// ---------------------------------------------------------------- manipulador

export interface OpcoesDoResponder {
  banco: pg.Pool;
  responder: Responder;
  /** Onde a saída da porta sobrevive entre executar e publicar. Padrão: ~/.cache/margem/respostas. */
  diretorioArtefatos?: string;
  agora?: () => Date;
}

/** O que `executar` deixa em disco para `publicar` ler. */
interface ArtefatoDaResposta {
  conversa_id: Id;
  mensagem_id: Id;
  contexto: { snapshot_hash: string; blocos: Id[] };
  saida: SaidaDoResponder;
}

function agoraIso(opcoes: OpcoesDoResponder): string {
  return (opcoes.agora ?? (() => new Date()))().toISOString();
}

/** Nunca antes da última mensagem: o fio não pode andar para trás. */
function depoisDe(instante: string, anterior: string | undefined): string {
  return anterior !== undefined && Date.parse(anterior) > Date.parse(instante) ? anterior : instante;
}

export async function executarResponder(opcoes: OpcoesDoResponder, tarefa: Tarefa): Promise<ResultadoExecutor> {
  const inicio = Date.now();
  const { conversa_id, mensagem_id } = lerChaveDoResponder(entradaDoJob(tarefa.job.entrada).dedup_key);
  const entrada = await comTransacao(opcoes.banco, (cliente) => montarEntrada(cliente, conversa_id, mensagem_id));
  if (tarefa.sinal.aborted) return { estado: 'falhou', codigo: 'cancelado', mensagem: 'Job cancelado.', duracao_ms: Date.now() - inicio };
  let saida: SaidaDoResponder;
  try {
    saida = await opcoes.responder(entrada, tarefa.sinal);
  } catch (erro) {
    // Cota, prazo, schema: o desfecho do executor segue para a fila como veio (cota → adiado).
    if (erro instanceof FalhaDoResponder) return { ...erro.resultado, duracao_ms: Date.now() - inicio };
    return { estado: 'falhou', codigo: 'desconhecido', mensagem: erro instanceof Error ? erro.message : 'falha no responder', duracao_ms: Date.now() - inicio };
  }
  if (tarefa.sinal.aborted) return { estado: 'falhou', codigo: 'cancelado', mensagem: 'Job cancelado.', duracao_ms: Date.now() - inicio };
  const blocos = [...entrada.blocos_nucleo, ...entrada.blocos_contexto];
  const artefato: ArtefatoDaResposta = {
    conversa_id, mensagem_id,
    contexto: { snapshot_hash: hashEstrutural(blocos), blocos: blocos.map((bloco) => bloco.id) },
    saida,
  };
  const texto = `${JSON.stringify(artefato, null, 2)}\n`;
  const pasta = join(opcoes.diretorioArtefatos ?? join(homedir(), '.cache/margem/respostas'), `conversa-${conversa_id}`);
  await mkdir(pasta, { recursive: true, mode: 0o700 });
  // O nome carrega a tentativa e um ULID: execuções repetidas nunca dividem o arquivo.
  const caminho = join(pasta, `resposta-${mensagem_id}-${String(tarefa.job.attempt)}-${ulid()}.json`);
  await writeFile(caminho, texto, { mode: 0o600 });
  return {
    estado: 'ok', artefato: caminho, sha256: sha256(texto), duracao_ms: Date.now() - inicio,
    modelo: saida.modelo, esforco: saida.esforco,
  };
}

type Diagnostico = JobResultV1['diagnosticos'][number];

export interface PublicacaoDaResposta {
  resposta: MensagemIaV1;
  sugestoes: ConexaoV2[];
  diagnosticos: Diagnostico[];
}

function lerArtefato(bruto: unknown): ArtefatoDaResposta {
  const artefato = bruto as Partial<ArtefatoDaResposta> | null;
  const saida = artefato?.saida;
  if (!artefato || typeof artefato.conversa_id !== 'string' || typeof artefato.mensagem_id !== 'string'
    || !artefato.contexto || !Array.isArray(artefato.contexto.blocos) || typeof artefato.contexto.snapshot_hash !== 'string'
    || !saida || typeof saida.texto !== 'string' || !Array.isArray(saida.citacoes) || !Array.isArray(saida.sugestoes)
    || !Array.isArray(saida.diagnosticos) || typeof saida.modelo !== 'string' || typeof saida.esforco !== 'string') {
    throw new Error('Artefato do responder incompleto.');
  }
  return artefato as ArtefatoDaResposta;
}

/**
 * Escrita final, dentro da transação de publicação. Citação e sugestão que não conferem
 * no bloco real viram diagnóstico, nunca escolha silenciosa. Publicar duas vezes a mesma
 * pergunta é recusado pelo `UNIQUE (em_resposta_a)` — e antes disso pela concessão.
 */
export async function publicarResposta(
  opcoes: OpcoesDoResponder, cliente: Transacao, jobId: Id, execucaoOk: ExecucaoOk,
): Promise<PublicacaoDaResposta> {
  const artefato = lerArtefato(await lerJsonLimitado(execucaoOk.artefato, ORCAMENTOS.resposta));
  const atual = await conversasRepo.obter(cliente, artefato.conversa_id, { travar: true });
  if (!atual) throw new Error('Conversa inexistente.');
  if (await conversasRepo.respostaA(cliente, artefato.mensagem_id)) throw new Error('A pergunta já tem resposta publicada.');
  const versao = await obterVersao(cliente, atual.versao_id);
  const blocos = new Map(versao.canonico.blocos.map((bloco) => [bloco.id, bloco]));
  const noContexto = new Set(artefato.contexto.blocos);
  const diagnosticos: Diagnostico[] = artefato.saida.diagnosticos.map((item) => ({ nivel: 'aviso', codigo: item.codigo, mensagem: item.mensagem }));

  const citacoes: AncoraV1[] = [];
  artefato.saida.citacoes.forEach((citacao, indice) => {
    const bloco = validarAncora(citacao) ? blocos.get(citacao.bloco_id) : undefined;
    if (!bloco || citacao.versao_id !== atual.versao_id || !noContexto.has(citacao.bloco_id) || !conferirAncora(bloco, citacao)) {
      diagnosticos.push({ nivel: 'aviso', codigo: 'citacao_recusada', mensagem: `Citação ${String(indice)} não confere num bloco do contexto.` });
      return;
    }
    if (!citacoes.some((outra) => JSON.stringify(outra) === JSON.stringify(citacao))) citacoes.push(citacao);
  });
  const texto = artefato.saida.texto.trim();
  if (texto === '') throw new Error('Resposta vazia do responder.');
  const criadaEm = depoisDe(agoraIso(opcoes), atual.mensagens.at(-1)?.criada_em);
  const resposta: MensagemIaV1 = {
    id: ulid(), autor: 'ia', texto, citacoes, contexto: artefato.contexto,
    execucao: { modelo: execucaoOk.modelo, esforco: execucaoOk.esforco ?? artefato.saida.esforco }, criada_em: criadaEm,
  };
  try {
    await conversasRepo.acrescentar(cliente, atual, resposta, { em_resposta_a: artefato.mensagem_id, job_id: jobId });
  } catch (erro) {
    if (erro instanceof DadoRecusado) throw new Error(`Resposta recusada pelo contrato ConversaV2: ${erro.message}`);
    throw erro;
  }

  const sugestoes: ConexaoV2[] = [];
  for (const [indice, sugestao] of artefato.saida.sugestoes.entries()) {
    const conexao: unknown = {
      versao: 2, id: ulid(), origem: sugestao.origem, destino: sugestao.destino, relacao: sugestao.relacao,
      justificativa: sugestao.justificativa, autor: 'ia', estado: 'sugerida', conversa_id: atual.id, criada_em: criadaEm,
    };
    if (!validarConexaoV2(conexao)) {
      diagnosticos.push({ nivel: 'aviso', codigo: 'sugestao_recusada', mensagem: `Sugestão ${String(indice)} fora do contrato ConexaoV2.` });
      continue;
    }
    try {
      sugestoes.push(await conexoesRepo.criar(cliente, conexao));
    } catch (erro) {
      if (!(erro instanceof DadoRecusado)) throw erro;
      diagnosticos.push({ nivel: 'aviso', codigo: 'sugestao_recusada', mensagem: `Sugestão ${String(indice)}: ${erro.message}` });
    }
  }
  await registrarNaAuditoria('resposta.validada.json', { resposta, sugestoes });
  await registrarNaAuditoria('diagnosticos.json', diagnosticos);
  await cliente.query('INSERT INTO evento_job(job_id,tipo,detalhe) VALUES ($1,$2,$3)', [jobId, 'resposta_publicada', JSON.stringify({
    conversa_id: atual.id, pergunta_id: artefato.mensagem_id, resposta_id: resposta.id,
    citacoes: citacoes.length, sugestoes: sugestoes.length,
  })]);
  return { resposta, sugestoes, diagnosticos };
}

export function manipuladorResponder(opcoes: OpcoesDoResponder): Manipulador {
  return {
    executar: (tarefa: Tarefa) => executarResponder(opcoes, tarefa),
    publicar: async (tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao): Promise<JobResultV1> => {
      const publicacao = await publicarResposta(opcoes, exigirTransacao(contexto), contexto.job.id, execucao);
      return {
        job_id: contexto.job.id, attempt: contexto.job.attempt, lease_token: contexto.lease_token,
        duracao_ms: execucao.duracao_ms, estado: 'ok', modelo: execucao.modelo,
        artefato: { caminho: execucao.artefato, sha256: execucao.sha256 }, diagnosticos: publicacao.diagnosticos,
      };
    },
  };
}

