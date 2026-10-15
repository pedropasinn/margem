/**
 * "Preparar leitura" (v0.1, auditoria A §6.3): um clique só, sempre sobre a compreensão do capítulo.
 *
 *   POST /api/documentos/:id/preparacao  { todos? }  → cria ou reaproveita a compreensão e enfileira já
 *   GET  /api/documentos/:id/preparacao              → estado honesto, capítulo a capítulo
 *
 * Idempotente: a compreensão da última versão no mesmo modo é reaproveitada (não nasce outra execução nem
 * outra camada), e `avancar` só enfileira o que falta (os `dedup_key` são únicos). Clicar de novo depois de
 * uma falha devolve à fila os jobs que falharam: é o "Tentar de novo". As leituras antigas (F1 e V2) ficam
 * fora deste fluxo; `POST /api/documentos/:id/leituras` continua para ferramentas e testes.
 */
import type { ExecucaoCompreensaoV1, Id, ModoDeLeituraV1, TipoDoDocumentoV1 } from '@margem/contratos';
import { mesmoModo, tipoDeTexto } from '@margem/contratos';
import { comTransacao, type Transacao } from '../db/transacao.js';
import { cancelarJobs } from '../apagar/cancelar.js';
import { mensagemDaFalha } from './mensagens.js';
import {
  gravarItensPedidos, itensPedidos, normalizarItens, pedirItensDoCapitulo, pedirItensDoDocumento, progressoDosItens, type ProgressoDoItem,
} from './itens.js';
import { exigirModo } from '../modos.js';
import { obterVersao } from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import * as preferencias from '../repos/preferencias.js';
import * as repo from '../repos/compreensao.js';
import { chaveDaIdentificacao, enfileirarIdentificacao, lerTipoDoDocumento, tiposDeTexto } from '../tipo-de-texto/identificar.js';
import {
  SemCapitulos, capitulosDaExecucao, estadoDoCapitulo, iniciarCompreensaoNa, pedirEAvancar, prepararCapituloNa, reenfileirarFalhas,
  type ConfiguracaoDaCompreensao, type EstadoInterno, type EstadoVisivel,
} from './pipeline.js';

export class DocumentoSemTexto extends Error {
  constructor() { super('O documento ainda não tem texto canonizado.'); this.name = 'DocumentoSemTexto'; }
}

export interface PedidoDaPreparacao {
  /** Prepara todos os capítulos agora (em prioridade normal), e não só o primeiro. */
  todos?: boolean;
  /** O que criar (janela "Preparar leitura"); sem a lista, só grifos e relações. */
  itens?: readonly unknown[];
}

export interface ResultadoDaPreparacao {
  /** `null` enquanto a leitura espera o tipo do texto ser reconhecido. */
  compreensao_id: Id | null;
  /** `false` quando a compreensão já existia (ou ainda não nasceu): nada novo foi criado. */
  criada: boolean;
  /** Jobs enfileirados (ou com a prioridade elevada) por este pedido. */
  enfileirados: number;
  /** Jobs que tinham falhado e voltaram à fila. */
  devolvidos: number;
  /** A leitura começa sozinha quando o tipo do texto for reconhecido (job `identificar_tipo`). */
  aguardando_tipo: boolean;
}

async function ultimaVersaoId(cliente: Transacao, documentoId: Id): Promise<Id | null> {
  return (await cliente.query<{ id: Id }>('SELECT id FROM versao_texto WHERE documento_id=$1 ORDER BY numero DESC LIMIT 1', [documentoId])).rows[0]?.id ?? null;
}

/** O tipo gravado (ou o padrão, "Outro ou não sei") e o modo de leitura dele. */
export function modoDoTipo(tipo: Pick<TipoDoDocumentoV1, 'tipo_id'> | null): { tipo_id: string; modo: ModoDeLeituraV1 } {
  const tipos = tiposDeTexto();
  const achado = (tipo ? tipoDeTexto(tipos, tipo.tipo_id) : undefined) ?? tipoDeTexto(tipos, tipos.padrao);
  if (!achado) throw new Error('O catálogo de tipos não tem o tipo padrão.');
  return { tipo_id: achado.tipo.id, modo: exigirModo(achado.tipo.modo) };
}

type Resolucao = { modo: ModoDeLeituraV1 } | { aguardando: true };
/**
 * O modo da leitura: o do tipo gravado; sem tipo, espera a identificação (pedindo-a, se ainda não foi
 * pedida). Se a identificação falhou, segue com o tipo padrão: a pessoa pode trocar o tipo depois.
 */
async function resolverModo(cliente: Transacao, documentoId: Id, versaoId: Id, semEsperar = false): Promise<Resolucao> {
  const tipo = await lerTipoDoDocumento(cliente, documentoId);
  if (tipo) return { modo: modoDoTipo(tipo).modo };
  // O tipo não chegou a tempo (`seguirSemTipo`): a leitura começa com o modo padrão.
  if (semEsperar) return { modo: modoDoTipo(null).modo };
  const job = (await cliente.query<{ estado: jobsRepo.EstadoJob }>('SELECT estado FROM job WHERE dedup_key=$1', [chaveDaIdentificacao(versaoId)])).rows[0];
  if (job && ['ok', 'falhou', 'cancelado'].includes(job.estado)) return { modo: modoDoTipo(null).modo };
  // Sem job, ou ainda na fila: pede (ou sobe a prioridade, porque agora alguém espera por ele).
  await enfileirarIdentificacao(cliente, versaoId, jobsRepo.PRIORIDADE.capitulo_aberto);
  return { aguardando: true };
}

/** A compreensão vigente da versão: a mais recente no modo pedido. */
async function compreensaoNoModo(cliente: Transacao, versaoId: Id, modo: ModoDeLeituraV1): Promise<ExecucaoCompreensaoV1 | null> {
  return (await repo.listarExecucoes(cliente, versaoId)).find((execucao) => mesmoModo(execucao.modo, modo)) ?? null;
}

/**
 * Prepara a leitura do documento, dentro de uma transação aberta: com o tipo conhecido, reaproveita (ou
 * cria) a compreensão no modo dele, grava-a como camada padrão e enfileira o primeiro capítulo (com o
 * seguinte em segundo plano) ou, com `todos`, o livro inteiro. Sem tipo, guarda o pedido em
 * `documento.preparacao_pedida`: a identificação, ao publicar, chama esta função de novo.
 */
export async function prepararDocumentoNa(
  config: ConfiguracaoDaCompreensao, cliente: Transacao, documentoId: Id, pedido: PedidoDaPreparacao = {}, opcoes: { semEsperarTipo?: boolean } = {},
): Promise<ResultadoDaPreparacao> {
  // Dois cliques simultâneos (ou o clique e a identificação publicando) não criam duas execuções.
  await cliente.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 3131))', [documentoId]);
  const versaoId = await ultimaVersaoId(cliente, documentoId);
  if (versaoId === null) throw new DocumentoSemTexto();
  // Sem lista (o "Tentar de novo", o pedido guardado antes do tipo), vale o que já foi pedido; sem nada, a compreensão.
  const guardados = pedido.itens === undefined ? await itensPedidos(cliente, documentoId) : [];
  const itens = normalizarItens(pedido.itens ?? (guardados.length > 0 ? guardados : ['grifos_relacoes']));
  await gravarItensPedidos(cliente, documentoId, itens);
  await pedirItensDoDocumento(cliente, documentoId, itens);
  if (!itens.includes('grifos_relacoes')) {
    // Sem a compreensão: flashcards e fluxograma saem na hora, do texto (o primeiro capítulo ou todos).
    await cliente.query('UPDATE documento SET preparacao_pedida=NULL, preparacao_retida_em=NULL WHERE id=$1 AND preparacao_pedida IS NOT NULL', [documentoId]);
    const canonico = (await obterVersao(cliente, versaoId)).canonico;
    const capitulos = canonico.secoes.filter((secao) => secao.nivel === 1).map((secao) => secao.id);
    for (const secaoId of pedido.todos ? capitulos : capitulos.slice(0, 1)) {
      await pedirItensDoCapitulo(cliente, itens, { versaoId, secaoId, compreensaoId: null });
    }
    return { compreensao_id: null, criada: false, enfileirados: 0, devolvidos: 0, aguardando_tipo: false };
  }
  const resolucao = await resolverModo(cliente, documentoId, versaoId, opcoes.semEsperarTipo === true);
  if ('aguardando' in resolucao) {
    await cliente.query(`UPDATE documento SET preparacao_pedida=$2, preparacao_retida_em=NULL WHERE id=$1`,
      [documentoId, JSON.stringify({ todos: pedido.todos === true, itens, em: new Date().toISOString() })]);
    return { compreensao_id: null, criada: false, enfileirados: 0, devolvidos: 0, aguardando_tipo: true };
  }
  await cliente.query('UPDATE documento SET preparacao_pedida=NULL, preparacao_retida_em=NULL WHERE id=$1 AND preparacao_pedida IS NOT NULL', [documentoId]);
  const { modo } = resolucao;
  const existente = await compreensaoNoModo(cliente, versaoId, modo);
  const execucao = existente ?? await iniciarCompreensaoNa(config, cliente, versaoId, modo);
  await preferencias.gravar(cliente, documentoId, { camada_padrao: execucao.id });
  const capitulos = await capitulosDaExecucao(cliente, execucao.id);
  const [primeiro] = capitulos;
  let enfileirados = 0;
  let devolvidos = 0;
  if (primeiro !== undefined) {
    const alvo = pedido.todos ? capitulos : [primeiro];
    for (const secaoId of alvo) devolvidos += (await reenfileirarFalhas(cliente, execucao.id, secaoId)).length;
    enfileirados += (await prepararCapituloNa(config, cliente, execucao.id, primeiro, { prefetch: true })).enfileirados.length;
    if (pedido.todos) {
      for (const secaoId of capitulos.slice(1)) {
        enfileirados += (await pedirEAvancar(config, cliente, execucao.id, secaoId, jobsRepo.PRIORIDADE.padrao)).length;
      }
    }
    // Capítulos que já estavam prontos recebem agora os itens marcados (os outros, quando ficarem prontos).
    for (const secaoId of capitulos) {
      if ((await estadoDoCapitulo(cliente, execucao.id, secaoId)).visivel === 'pronto') {
        await pedirItensDoCapitulo(cliente, itens, { versaoId, secaoId, compreensaoId: execucao.id });
      }
    }
  }
  return { compreensao_id: execucao.id, criada: existente === null, enfileirados, devolvidos, aguardando_tipo: false };
}

/**
 * A leitura que esperava o tipo começa (chamada pela publicação de `identificar_tipo`). Um documento sem
 * capítulos não derruba a identificação: o pedido é descartado e a página diz "não preparada".
 */
export async function comecarLeituraPedida(config: ConfiguracaoDaCompreensao, cliente: Transacao, documentoId: Id, pedido: PedidoDaPreparacao): Promise<void> {
  try {
    await prepararDocumentoNa(config, cliente, documentoId, pedido);
  } catch (erro) {
    if (!(erro instanceof SemCapitulos)) throw erro;
    await cliente.query('UPDATE documento SET preparacao_pedida=NULL, preparacao_retida_em=NULL WHERE id=$1', [documentoId]);
  }
}

/**
 * Quanto a leitura pedida espera pelo tipo do texto. Reconhecer o tipo é um job leve, mas pode ficar
 * preso (fila cheia, vagas do Codex ocupadas por trabalhos longos, Codex lento ou fora do ar): passado este
 * prazo, a leitura começa com o tipo padrão e a identificação é cancelada. `MARGEM_ESPERA_DO_TIPO_S` troca.
 */
export const ESPERA_DO_TIPO_PADRAO_MS = 90_000;
export function esperaDoTipoMs(ambiente: NodeJS.ProcessEnv = process.env): number {
  const segundos = Number(ambiente.MARGEM_ESPERA_DO_TIPO_S);
  return Number.isFinite(segundos) && segundos > 0 ? segundos * 1000 : ESPERA_DO_TIPO_PADRAO_MS;
}

/**
 * V-T4: a leitura que espera o tipo do texto não fica parada. Para cada documento com pedido guardado e
 * ainda sem tipo, segue com o tipo padrão quando a identificação falhou, foi cancelada, sumiu, ou quando o
 * pedido passou do prazo (a identificação em curso é cancelada: não gasta vaga do Codex à toa e não troca o
 * modo da leitura que já começou). Chamada pelo worker de tempos em tempos e pela consulta da página
 * (a configuração pode vir como função: só é montada quando algum documento segue). Devolve os que seguiram.
 *
 * V-F1: a preparação em pausa (pedida horas antes de o worker partir, `pausa/pausa.ts`) fica de fora até a
 * pessoa mandar retomar; sem isso, abrir o app começaria de uma vez tudo o que esperava.
 */
export async function seguirSemTipo(
  config: ConfiguracaoDaCompreensao | (() => ConfiguracaoDaCompreensao), cliente: Transacao, opcoes: { documentoId?: Id; agora?: Date; esperaMs?: number } = {},
): Promise<Id[]> {
  const agora = opcoes.agora ?? new Date();
  const limite = new Date(agora.getTime() - (opcoes.esperaMs ?? esperaDoTipoMs()));
  const candidatos = (await cliente.query<{ id: Id; pedido: PedidoDaPreparacao & { em?: string }; versao_id: Id | null }>(`SELECT d.id, d.preparacao_pedida AS pedido,
      (SELECT v.id FROM versao_texto v WHERE v.documento_id=d.id ORDER BY v.numero DESC LIMIT 1) AS versao_id
    FROM documento d WHERE d.preparacao_pedida IS NOT NULL AND d.tipo_de_texto IS NULL AND d.preparacao_retida_em IS NULL
      AND ($1::text IS NULL OR d.id=$1)`,
  [opcoes.documentoId ?? null])).rows;
  const seguiram: Id[] = [];
  for (const { id, pedido, versao_id: versaoId } of candidatos) {
    if (versaoId === null) continue;
    const job = (await cliente.query<{ id: Id; estado: jobsRepo.EstadoJob }>('SELECT id, estado FROM job WHERE dedup_key=$1', [chaveDaIdentificacao(versaoId)])).rows[0];
    const desistiu = job === undefined || ['falhou', 'cancelado'].includes(job.estado);
    const em = typeof pedido.em === 'string' ? new Date(pedido.em) : null;
    const venceu = em === null || Number.isNaN(em.getTime()) || em <= limite;
    if (job?.estado === 'ok' || (!desistiu && !venceu)) continue;
    if (job && !desistiu) await cancelarJobs(cliente, [job.id], { pela_pessoa: false });
    try {
      await prepararDocumentoNa(typeof config === 'function' ? config() : config, cliente, id, { ...(pedido.todos === undefined ? {} : { todos: pedido.todos }), ...(pedido.itens === undefined ? {} : { itens: pedido.itens }) }, { semEsperarTipo: true });
      seguiram.push(id);
    } catch (erro) {
      if (!(erro instanceof SemCapitulos) && !(erro instanceof DocumentoSemTexto)) throw erro;
      await cliente.query('UPDATE documento SET preparacao_pedida=NULL, preparacao_retida_em=NULL WHERE id=$1', [id]);
    }
  }
  return seguiram;
}

export async function prepararDocumento(
  config: ConfiguracaoDaCompreensao, documentoId: Id, pedido: PedidoDaPreparacao = {},
): Promise<ResultadoDaPreparacao> {
  return comTransacao(config.banco, (cliente) => prepararDocumentoNa(config, cliente, documentoId, pedido));
}

// ---------------------------------------------------------------- estado

export type EstadoDaPreparacao = 'sem_texto' | 'nao_preparada' | 'identificando' | 'preparando' | 'pronta' | 'parcial' | 'falhou';

/** O tipo do documento como a página mostra: "Conto · Literatura", com a origem e as alternativas. */
export interface TipoDaPreparacao {
  tipo_id: string; rotulo: string; grupo: string; origem: TipoDoDocumentoV1['origem'];
  confianca: TipoDoDocumentoV1['confianca']; justificativa: string | null; alternativas: { tipo_id: string; rotulo: string }[];
}

export interface CapituloDaPreparacao {
  secao_id: Id;
  titulo: string;
  estado: EstadoVisivel;
  etapa: EstadoInterno;
  /** Relações da última revisão do capítulo; `null` enquanto ele não tem modelo. */
  relacoes: number | null;
}

export interface ErroDaPreparacao { codigo: string; mensagem: string }

export interface SituacaoDaPreparacao {
  documento_id: Id;
  versao_id: Id | null;
  estado: EstadoDaPreparacao;
  /** Tipo detectado ou escolhido; `null` enquanto não se sabe. */
  tipo: TipoDaPreparacao | null;
  compreensao: { id: Id; modo: { id: string; revisao: number } } | null;
  capitulos: CapituloDaPreparacao[];
  erro: ErroDaPreparacao | null;
  /** Itens pedidos além da compreensão (flashcards, mapa…) e o andamento de cada um. */
  itens: ProgressoDoItem[];
}

/**
 * A compreensão que a página do documento acompanha: com tipo conhecido, a do modo dele (trocar o tipo
 * pede uma leitura nova); sem tipo, a da camada padrão, senão a mais recente da versão.
 */
async function compreensaoVigente(cliente: Transacao, documentoId: Id, versaoId: Id, tipo: TipoDoDocumentoV1 | null): Promise<ExecucaoCompreensaoV1 | null> {
  const execucoes = await repo.listarExecucoes(cliente, versaoId);
  const { camada_padrao } = await preferencias.ler(cliente, documentoId);
  if (tipo) {
    const { modo } = modoDoTipo(tipo);
    const doTipo = execucoes.find((execucao) => mesmoModo(execucao.modo, modo)) ?? null;
    // Um tipo detectado depois de a leitura já ter começado com o padrão (o prazo do tipo venceu) não
    // esconde essa leitura; só a escolha da pessoa pede uma leitura nova no modo dela.
    if (doTipo || tipo.origem === 'escolhido') return doTipo;
    return execucoes.find((execucao) => execucao.id === camada_padrao) ?? null;
  }
  return execucoes.find((execucao) => execucao.id === camada_padrao) ?? execucoes[0] ?? null;
}

function tipoParaMostrar(tipo: TipoDoDocumentoV1 | null): TipoDaPreparacao | null {
  if (!tipo) return null;
  const tipos = tiposDeTexto();
  const achado = tipoDeTexto(tipos, tipo.tipo_id);
  if (!achado) return null;
  return {
    tipo_id: achado.tipo.id, rotulo: achado.tipo.rotulo, grupo: achado.grupo.rotulo, origem: tipo.origem, confianca: tipo.confianca,
    justificativa: tipo.justificativa,
    alternativas: tipo.alternativas.flatMap((id) => { const outro = tipoDeTexto(tipos, id); return outro ? [{ tipo_id: id, rotulo: outro.tipo.rotulo }] : []; }),
  };
}

async function relacoesPorCapitulo(cliente: Transacao, execucaoId: Id): Promise<Map<Id, number>> {
  const linhas = (await cliente.query<{ secao_id: Id; relacoes: number }>(`SELECT DISTINCT ON (secao_id) secao_id,
      jsonb_array_length(conteudo->'relacoes')::int AS relacoes
    FROM modelo_capitulo WHERE execucao_id=$1 ORDER BY secao_id, revisao DESC`, [execucaoId])).rows;
  return new Map(linhas.map((linha) => [linha.secao_id, linha.relacoes]));
}

export { mensagemDaFalha };

/**
 * A frase da causa que o worker anotou no job (diagnóstico `causa`, de uma tabela fixa do serviço:
 * `executor/stderr.ts` e o modelo recusado de Configurações → Modelos), quando há uma.
 */
const CAUSA_DO_JOB = `(SELECT left(d->>'mensagem', 200) FROM jsonb_array_elements(diagnosticos) d WHERE d->>'codigo' = 'causa' LIMIT 1)`;

export async function situacaoDaPreparacao(cliente: Transacao, documentoId: Id): Promise<SituacaoDaPreparacao> {
  const versao = (await cliente.query<{ id: Id }>('SELECT id FROM versao_texto WHERE documento_id=$1 ORDER BY numero DESC LIMIT 1', [documentoId])).rows[0];
  const documento = (await cliente.query<{ tipo_de_texto: TipoDoDocumentoV1 | null; preparacao_pedida: unknown }>(
    'SELECT tipo_de_texto, preparacao_pedida FROM documento WHERE id=$1', [documentoId])).rows[0];
  const tipo = documento?.tipo_de_texto ?? null;
  const base = { documento_id: documentoId, versao_id: versao?.id ?? null, tipo: tipoParaMostrar(tipo),
    itens: versao ? await progressoDosItens(cliente, documentoId, versao.id) : [] };
  if (!versao) return { ...base, estado: 'sem_texto', compreensao: null, capitulos: [], erro: null };
  if (documento?.preparacao_pedida) {
    // O pedido espera o tipo: "reconhecendo o tipo de texto", ou a falha dessa etapa.
    const job = (await cliente.query<{ estado: string; error_code: string | null; causa: string | null }>(`SELECT estado, error_code, ${CAUSA_DO_JOB} AS causa
      FROM job WHERE dedup_key=$1`, [chaveDaIdentificacao(versao.id)])).rows[0];
    if (job && (job.estado === 'falhou' || job.estado === 'cancelado')) {
      return { ...base, estado: 'falhou', compreensao: null, capitulos: [],
        erro: { codigo: job.error_code ?? 'desconhecido', mensagem: `o tipo do texto não foi reconhecido. ${job.causa ?? mensagemDaFalha(job.error_code)}` } };
    }
    return { ...base, estado: 'identificando', compreensao: null, capitulos: [], erro: null };
  }
  const execucao = await compreensaoVigente(cliente, documentoId, versao.id, tipo);
  if (!execucao) return { ...base, estado: 'nao_preparada', compreensao: null, capitulos: [], erro: null };
  const canonico = (await obterVersao(cliente, versao.id)).canonico;
  const titulos = new Map(canonico.secoes.map((secao) => [secao.id, secao.titulo]));
  const relacoes = await relacoesPorCapitulo(cliente, execucao.id);
  const capitulos: CapituloDaPreparacao[] = [];
  const falhas: Id[] = [];
  for (const secaoId of await capitulosDaExecucao(cliente, execucao.id)) {
    const estado = await estadoDoCapitulo(cliente, execucao.id, secaoId);
    falhas.push(...estado.jobs.filter((job) => job.estado === 'falhou' || job.estado === 'cancelado').map((job) => job.id));
    capitulos.push({ secao_id: secaoId, titulo: titulos.get(secaoId) ?? '', estado: estado.visivel, etapa: estado.estado, relacoes: relacoes.get(secaoId) ?? null });
  }
  let erro: ErroDaPreparacao | null = null;
  if (falhas.length > 0) {
    const ultima = (await cliente.query<{ error_code: string | null; causa: string | null }>(`SELECT coalesce(error_code, estado) AS error_code,
      ${CAUSA_DO_JOB} AS causa FROM job WHERE id = ANY($1::text[]) ORDER BY atualizado_em DESC LIMIT 1`, [falhas])).rows[0];
    const codigo = ultima?.error_code ?? null;
    erro = { codigo: codigo ?? 'desconhecido', mensagem: ultima?.causa ?? mensagemDaFalha(codigo) };
  }
  const visiveis = capitulos.map((capitulo) => capitulo.estado);
  const estado: EstadoDaPreparacao = visiveis.includes('falhou') ? 'falhou'
    : visiveis.includes('preparando') ? 'preparando'
      : visiveis.length > 0 && visiveis.every((item) => item === 'pronto') ? 'pronta'
        : visiveis.includes('pronto') ? 'parcial' : 'nao_preparada';
  return { ...base, estado, compreensao: { id: execucao.id, modo: { ...execucao.modo } }, capitulos, erro };
}
