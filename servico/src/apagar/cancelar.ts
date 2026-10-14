/**
 * Cancelar o que se pediu ao Codex sem deixar nada registrado (V-T8).
 *
 * O job cancelado perde a concessão na hora: o worker que ainda roda recebe `ConcessaoPerdida` ao tentar
 * publicar (nada é escrito) e aborta o executor, que mata o processo do Codex e a árvore dele (grupo de
 * processos no Linux e no macOS, `taskkill /T` no Windows: `executor/codex.ts`). O worker também acorda
 * com o aviso do banco e confere o cancelamento sem esperar a próxima batida.
 *
 * A publicação de um job é uma transação só, então um job sozinho nunca deixa nada pela metade. A
 * análise de um capítulo, não: várias etapas publicam uma de cada vez. Cancelar uma etapa cancela as
 * outras pendentes do mesmo capítulo e, se o capítulo ainda não ficou pronto, apaga o que as primeiras
 * já tinham gravado (`purgarCapitulo`); uma execução que fica sem nada some inteira. O pedido de cada
 * operação (o visual pedido, a sessão de resolução, o tipo de texto à espera) também sai: a operação
 * volta ao estado de antes do pedido.
 */
import type { Id } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import * as jobsRepo from '../repos/jobs.js';
import { estadoDoCapitulo } from '../compreensao/pipeline.js';
import { apagarJobs, capituloDoJob, execucaoVazia, apagarExecucao, ligarApagamento, purgarCapitulo, type CapituloDaExecucao } from './compreensao.js';

/** Jobs que não são do Codex nem pedidos da pessoa: o texto do documento e a mídia. */
export const FORA_DO_CANCELAMENTO: readonly string[] = ['canonizar', 'canonizar_revisao', 'importar_youtube'];

export interface LinhaDoJob { id: Id; tipo: string; dedup_key: string; estado: jobsRepo.EstadoJob; parte_id: Id | null; documento_id: Id | null; versao_id: Id | null }

export interface AlvoDoCancelamento {
  /** Um job (e, se for uma etapa da análise, o capítulo inteiro dela). */
  job_id?: Id;
  /** Tudo o que está pendente no documento (ou só no capítulo `secao_id`). */
  documento_id?: Id;
  secao_id?: Id;
}

export interface ResultadoDoCancelamento {
  /** Jobs que estavam na fila ou rodando e foram cancelados. */
  cancelados: number;
  /** Capítulos cuja análise incompleta foi apagada. */
  capitulos_descartados: number;
  /** Execuções que ficaram sem nada e sumiram. */
  execucoes_descartadas: number;
}

const ATIVOS = jobsRepo.CANCELAVEIS;

/**
 * Jobs cujo estado é lido do próprio job (o mapa "falhou", o tipo "já tentado"): cancelados, eles somem
 * e a operação volta a "nenhum pedido". Os outros ficam marcados como cancelados (o Diagnóstico ainda
 * oferece "Reenfileirar"), sem nada publicado.
 */
export const SOMEM_AO_CANCELAR: readonly string[] = [
  'identificar_tipo', 'gerar_esquema', 'gerar_flashcards', 'roteirizar_visita', 'comentar_leitura', 'conceitos_do_video',
  'resolver_exercicio', 'transcrever_escaneado',
];

/**
 * Cancela os jobs ativos `ids` na transação aberta, sem descartar nada além disso: tira a concessão e grava
 * o evento que acorda o worker. `pela_pessoa: false` quando é o próprio Margem que desiste (V-T4: a
 * identificação do tipo que passou do prazo).
 */
export async function cancelarJobs(cliente: Transacao, ids: readonly Id[], opcoes: { pela_pessoa?: boolean } = {}): Promise<LinhaDoJob[]> {
  if (ids.length === 0) return [];
  const linhas = (await cliente.query<LinhaDoJob & { estado_anterior: string }>(`WITH antes AS (
      SELECT id, estado FROM job WHERE id = ANY($1::text[]) AND estado = ANY($2::text[]) ORDER BY id FOR UPDATE)
    UPDATE job SET estado='cancelado', cancel_requested_at=clock_timestamp(), lease_token=NULL, lease_owner=NULL,
      lease_expires_at=NULL, heartbeat_at=NULL, atualizado_em=clock_timestamp()
    FROM antes WHERE job.id = antes.id
    RETURNING job.id, job.tipo, job.dedup_key, job.estado, job.parte_id, job.documento_id, job.versao_id, antes.estado AS estado_anterior`,
  [[...ids], ATIVOS])).rows;
  for (const linha of linhas) {
    // O evento acorda o worker (NOTIFY) e a lista de execuções; o job some logo depois.
    await cliente.query('INSERT INTO evento_job(job_id,tipo,detalhe) VALUES ($1,$2,$3)',
      [linha.id, 'cancelado', JSON.stringify({ estado_anterior: linha.estado_anterior, pela_pessoa: opcoes.pela_pessoa ?? true })]);
  }
  return linhas;
}

/** O capítulo (seção) de um job fora da compreensão, quando ele tem um: flashcards e visuais. */
async function secaoDoJob(cliente: Transacao, job: LinhaDoJob): Promise<Id | null> {
  const capitulo = await capituloDoJob(cliente, job);
  if (capitulo) return capitulo.secao_id;
  const [prefixo, , terceiro] = job.dedup_key.split(':');
  if (prefixo === 'flashcards') return terceiro ?? null;
  return (await cliente.query<{ secao_id: Id }>('SELECT secao_id FROM visual WHERE job_id=$1', [job.id])).rows[0]?.secao_id ?? null;
}

/** Os jobs ativos do alvo; uma etapa da análise traz junto as outras etapas ativas do capítulo. */
async function jobsDoAlvo(cliente: Transacao, alvo: AlvoDoCancelamento): Promise<LinhaDoJob[]> {
  const campos = 'id, tipo, dedup_key, estado, parte_id, documento_id, versao_id';
  if (alvo.job_id !== undefined) {
    const job = (await cliente.query<LinhaDoJob>(`SELECT ${campos} FROM job WHERE id=$1`, [alvo.job_id])).rows[0];
    if (!job) return [];
    const capitulo = await capituloDoJob(cliente, job);
    if (!capitulo?.etapa) return [job];
    const doCapitulo = (await cliente.query<LinhaDoJob>(`SELECT ${campos} FROM job WHERE estado = ANY($3::text[]) AND (
        parte_id IN (SELECT id FROM parte WHERE execucao_id=$1 AND secao_id=$2)
        OR (split_part(dedup_key, ':', 2) = $1 AND split_part(dedup_key, ':', 3) = $2 AND split_part(dedup_key, ':', 1) IN ('sintetizar','revisar','planejar')))`,
    [capitulo.execucao_id, capitulo.secao_id, ATIVOS])).rows;
    return [job, ...doCapitulo.filter((outro) => outro.id !== job.id)];
  }
  if (alvo.documento_id === undefined) return [];
  const todos = (await cliente.query<LinhaDoJob>(`SELECT ${campos} FROM job WHERE documento_id=$1 AND estado = ANY($2::text[])
    AND NOT (tipo = ANY($3::text[])) ORDER BY criado_em, id`, [alvo.documento_id, ATIVOS, FORA_DO_CANCELAMENTO])).rows;
  if (alvo.secao_id === undefined) return todos;
  const doCapitulo: LinhaDoJob[] = [];
  for (const job of todos) if (await secaoDoJob(cliente, job) === alvo.secao_id) doCapitulo.push(job);
  return doCapitulo;
}

/** O que o pedido deixou fora dos jobs (o visual pedido, a sessão, o tipo à espera) sai junto. */
async function descartarPedido(cliente: Transacao, job: LinhaDoJob): Promise<void> {
  const [prefixo, segundo, terceiro] = job.dedup_key.split(':');
  switch (job.tipo) {
    case 'gerar_imagem':
    case 'gerar_diagrama':
      await cliente.query('UPDATE visual SET apagado_em=clock_timestamp() WHERE job_id=$1 AND apagado_em IS NULL', [job.id]);
      return;
    case 'resolver_exercicio':
      if (prefixo === 'resolver' && segundo) await cliente.query('DELETE FROM resolucao WHERE id=$1', [segundo]);
      return;
    case 'identificar_tipo':
      // A preparação que esperava o tipo também sai: ela nunca começou.
      if (job.documento_id) await cliente.query('UPDATE documento SET preparacao_pedida=NULL WHERE id=$1', [job.documento_id]);
      return;
    case 'revisar_anotacao':
      if (segundo && terceiro) await cliente.query(`UPDATE anotacao SET pedido_de_revisao=NULL WHERE id=$1 AND pedido_de_revisao->>'id' = $2`, [segundo, terceiro]);
      return;
    default:
  }
}

/**
 * Cancela e descarta, numa transação só. Repete a busca uma vez: um job que outra publicação enfileirou
 * enquanto este cancelamento esperava um lock também entra.
 */
export async function cancelarOperacoes(cliente: Transacao, alvo: AlvoDoCancelamento): Promise<ResultadoDoCancelamento> {
  await ligarApagamento(cliente);
  if (alvo.documento_id !== undefined) await cliente.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 3131))', [alvo.documento_id]);
  const cancelados: LinhaDoJob[] = [];
  for (let rodada = 0; rodada < 2; rodada += 1) {
    const ids = (await jobsDoAlvo(cliente, alvo)).map((job) => job.id).filter((id) => !cancelados.some((job) => job.id === id));
    if (ids.length === 0) break;
    cancelados.push(...await cancelarJobs(cliente, ids));
    if (alvo.job_id !== undefined) break;
  }
  if (alvo.documento_id !== undefined && alvo.secao_id === undefined) {
    // Uma preparação à espera do tipo (sem job da leitura ainda) também é cancelada.
    await cliente.query('UPDATE documento SET preparacao_pedida=NULL WHERE id=$1 AND preparacao_pedida IS NOT NULL', [alvo.documento_id]);
  }
  // Capítulos cuja análise foi interrompida antes de ficar pronta: o que já foi gravado sai.
  const capitulos = new Map<string, CapituloDaExecucao>();
  const soltos: LinhaDoJob[] = [];
  for (const job of cancelados) {
    const capitulo = await capituloDoJob(cliente, job);
    if (capitulo?.etapa) capitulos.set(`${capitulo.execucao_id}:${capitulo.secao_id}`, capitulo);
    else soltos.push(job);
  }
  let descartados = 0;
  const execucoes = new Set<Id>();
  for (const { execucao_id, secao_id } of capitulos.values()) {
    const estado = await estadoDoCapitulo(cliente, execucao_id, secao_id);
    // Pronto (ex.: um plano novo para outro perfil): o que já estava pronto fica; só os jobs cancelados saem.
    const temModeloFinal = estado.revisao !== null && estado.revisao >= 2 && estado.plano_id !== null;
    if (temModeloFinal) { soltos.push(...cancelados.filter((job) => estado.jobs.some((outro) => outro.id === job.id))); continue; }
    await purgarCapitulo(cliente, execucao_id, secao_id);
    descartados += 1;
    execucoes.add(execucao_id);
  }
  let execucoesDescartadas = 0;
  for (const execucao of execucoes) {
    if (await execucaoVazia(cliente, execucao)) { await apagarExecucao(cliente, execucao); execucoesDescartadas += 1; }
  }
  for (const job of soltos) await descartarPedido(cliente, job);
  await apagarJobs(cliente, soltos.filter((job) => SOMEM_AO_CANCELAR.includes(job.tipo)).map((job) => job.id));
  return { cancelados: cancelados.length, capitulos_descartados: descartados, execucoes_descartadas: execucoesDescartadas };
}
