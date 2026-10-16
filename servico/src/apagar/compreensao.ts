/**
 * Apagar a análise do Codex de um capítulo ou de uma execução inteira, de verdade (V-T8).
 *
 * A compreensão espalha o resultado por várias tabelas imutáveis (análise local, revisões do modelo,
 * lotes, planos, visita, leitura comentada) e projeta marcas na camada da execução. Apagar remove tudo
 * isso e os jobs do capítulo, para que "Analisar" de novo comece do zero: os `dedup_key` somem com os
 * jobs, a execução sem nada some com a camada, e a idempotência da preparação (J131) não reaproveita o
 * que foi apagado. A nota e os sinais de dificuldade de um grifo apagado saem com ele; as conversas ficam
 * (sem o grifo).
 *
 * Tudo roda na transação do chamador, depois de `ligarApagamento`: só ela libera o DELETE nas tabelas
 * imutáveis (migração 0033).
 */
import { raizDaAuditoria } from '../executor/auditoria.js';
import { apagarAuditoriaDosJobs } from '../worker/retencao.js';
import type { DificuldadeTextualV1, ElementoSemanticoV1, Id, ModeloDoCapituloV1, PlanoPedagogicoV1, RelacaoSemanticaV1 } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';

/** Libera o DELETE nas tabelas imutáveis, só até o fim desta transação. */
export async function ligarApagamento(cliente: Transacao): Promise<void> {
  await cliente.query(`SET LOCAL margem.apagando = 'sim'`);
}

/** Etapas da compreensão de um capítulo: a chave traz a execução e a seção (a análise, a parte). */
export const ETAPAS_DA_COMPREENSAO = ['analisar', 'sintetizar', 'revisar', 'planejar'] as const;
/** O que nasce do modelo do capítulo e tem a execução e a seção na chave. */
export const DERIVADOS_DO_CAPITULO = ['esquema', 'visita', 'comentada'] as const;

export interface CapituloDaExecucao { execucao_id: Id; secao_id: Id }

/**
 * A execução e o capítulo de um job da compreensão (ou de um derivado: mapa, visita, leitura comentada);
 * `null` para os outros jobs.
 */
export async function capituloDoJob(cliente: Transacao, job: { dedup_key: string; parte_id: Id | null }): Promise<CapituloDaExecucao & { etapa: boolean } | null> {
  const [prefixo, execucao, terceiro] = job.dedup_key.split(':');
  if (!execucao || !terceiro) return null;
  if (prefixo === 'analisar') {
    const parte = (await cliente.query<{ secao_id: Id | null }>('SELECT secao_id FROM parte WHERE id=$1', [job.parte_id ?? terceiro])).rows[0];
    return parte?.secao_id ? { execucao_id: execucao, secao_id: parte.secao_id, etapa: true } : null;
  }
  if ((ETAPAS_DA_COMPREENSAO as readonly string[]).includes(prefixo ?? '')) return { execucao_id: execucao, secao_id: terceiro, etapa: true };
  if ((DERIVADOS_DO_CAPITULO as readonly string[]).includes(prefixo ?? '')) return { execucao_id: execucao, secao_id: terceiro, etapa: false };
  return null;
}

/** Ids dos jobs da compreensão de um capítulo (etapas e derivados). */
export async function jobsDoCapitulo(cliente: Transacao, execucaoId: Id, secaoId: Id): Promise<Id[]> {
  return (await cliente.query<{ id: Id }>(`SELECT id FROM job
    WHERE parte_id IN (SELECT id FROM parte WHERE execucao_id=$1 AND secao_id=$2)
       OR (split_part(dedup_key, ':', 2) = $1 AND split_part(dedup_key, ':', 3) = $2
           AND split_part(dedup_key, ':', 1) = ANY($3::text[]))`,
  [execucaoId, secaoId, [...ETAPAS_DA_COMPREENSAO, ...DERIVADOS_DO_CAPITULO]])).rows.map((linha) => linha.id);
}

/** Apaga os jobs (e o histórico deles); um job que outra linha ainda cita fica, cancelado. */
export async function apagarJobs(cliente: Transacao, ids: readonly Id[]): Promise<number> {
  let apagados = 0;
  for (const id of ids) {
    await cliente.query('SAVEPOINT apagar_job');
    try {
      await cliente.query('DELETE FROM evento_job WHERE job_id=$1', [id]);
      const apagado = (await cliente.query('DELETE FROM job WHERE id=$1', [id])).rowCount ?? 0;
      apagados += apagado;
      await cliente.query('RELEASE SAVEPOINT apagar_job');
      // A auditoria do job (prompt e resposta com o texto do documento) sai com ele.
      if (apagado > 0) await apagarAuditoriaDosJobs(raizDaAuditoria(), [id]).catch(() => undefined);
    } catch (erro) {
      // 23503: uma linha fora da limpeza ainda aponta para o job (ex.: um visual guardado). Ele fica.
      if ((erro as { code?: string }).code !== '23503') throw erro;
      await cliente.query('ROLLBACK TO SAVEPOINT apagar_job');
    }
  }
  return apagados;
}

/**
 * Apaga marcas (e a origem delas na compreensão). No modelo D (J138) a nota é do grifo: sai com ele, junto
 * com as anotações que a 0032 fundiu nela, e os sinais de dificuldade ligados ao grifo também saem. As
 * conversas ficam, sem o grifo.
 */
export async function apagarMarcas(cliente: Transacao, ids: readonly Id[]): Promise<number> {
  if (ids.length === 0) return 0;
  await cliente.query('DELETE FROM dificuldade WHERE marca_id = ANY($1::text[])', [[...ids]]);
  await cliente.query('DELETE FROM anotacao WHERE marca_id = ANY($1::text[]) AND fundida_em IS NOT NULL', [[...ids]]);
  await cliente.query('DELETE FROM anotacao WHERE marca_id = ANY($1::text[])', [[...ids]]);
  await cliente.query('DELETE FROM marca_elemento WHERE marca_id = ANY($1::text[])', [[...ids]]);
  return (await cliente.query('DELETE FROM marca WHERE id = ANY($1::text[])', [[...ids]])).rowCount ?? 0;
}

/**
 * Apaga a análise do capítulo dentro da execução: marcas projetadas, revisões, planos, visita, leitura
 * comentada, mapa, análises das partes, o pedido de preparação e os jobs. As partes voltam a "na fila"
 * (sem resumo): preparar de novo refaz tudo. Devolve quantos jobs foram apagados.
 */
export async function purgarCapitulo(cliente: Transacao, execucaoId: Id, secaoId: Id): Promise<number> {
  const partes = (await cliente.query<{ id: Id }>('SELECT id FROM parte WHERE execucao_id=$1 AND secao_id=$2', [execucaoId, secaoId])).rows.map((l) => l.id);
  const modelos = (await cliente.query<{ id: Id }>('SELECT id FROM modelo_capitulo WHERE execucao_id=$1 AND secao_id=$2', [execucaoId, secaoId])).rows.map((l) => l.id);
  const jobs = await jobsDoCapitulo(cliente, execucaoId, secaoId);
  const marcas = (await cliente.query<{ id: Id }>(`SELECT marca_id AS id FROM marca_elemento WHERE modelo_id = ANY($1::text[])
    UNION SELECT id FROM marca WHERE job_id = ANY($2::text[])`, [modelos, jobs])).rows.map((l) => l.id);
  await apagarMarcas(cliente, marcas);
  await cliente.query('DELETE FROM relacao_adotada WHERE modelo_id = ANY($1::text[])', [modelos]);
  // As decisões do leitor sobre as dificuldades que o Codex apontou neste capítulo (DificuldadeV1, origem codex).
  await cliente.query("DELETE FROM dificuldade WHERE origem='codex' AND codex_modelo_id = ANY($1::text[])", [modelos]);
  await cliente.query(`DELETE FROM narracao_visita WHERE roteiro_id IN (SELECT id FROM roteiro_visita WHERE execucao_id=$1 AND secao_id=$2)`, [execucaoId, secaoId]);
  await cliente.query('DELETE FROM roteiro_visita WHERE execucao_id=$1 AND secao_id=$2', [execucaoId, secaoId]);
  await cliente.query(`DELETE FROM narracao_leitura WHERE leitura_id IN (SELECT id FROM leitura_comentada WHERE execucao_id=$1 AND secao_id=$2)`, [execucaoId, secaoId]);
  await cliente.query('DELETE FROM leitura_comentada WHERE execucao_id=$1 AND secao_id=$2', [execucaoId, secaoId]);
  await cliente.query('DELETE FROM plano_pedagogico WHERE execucao_id=$1 AND secao_id=$2', [execucaoId, secaoId]);
  await cliente.query('DELETE FROM lote_modelo WHERE execucao_id=$1 AND secao_id=$2', [execucaoId, secaoId]);
  await cliente.query('DELETE FROM revisao_janela WHERE execucao_id=$1 AND secao_id=$2', [execucaoId, secaoId]);
  // O índice da página Notas (J145) sai com as revisões que ele resume.
  await cliente.query('DELETE FROM item_do_modelo WHERE modelo_id = ANY($1::text[])', [modelos]);
  await cliente.query('DELETE FROM modelo_capitulo WHERE execucao_id=$1 AND secao_id=$2', [execucaoId, secaoId]);
  await cliente.query('DELETE FROM analise_local WHERE parte_id = ANY($1::text[])', [partes]);
  await cliente.query('DELETE FROM preparacao_capitulo WHERE execucao_id=$1 AND secao_id=$2', [execucaoId, secaoId]);
  await cliente.query('DELETE FROM elemento_apagado WHERE execucao_id=$1 AND secao_id=$2', [execucaoId, secaoId]);
  await cliente.query(`UPDATE parte SET estado='fila', resumo_da_parte=NULL, limites='[]', leitura_integral=NULL, recuperacao='[]', mapa_da_secao='[]'
    WHERE id = ANY($1::text[])`, [partes]);
  return apagarJobs(cliente, jobs);
}

/** A execução ainda tem algo publicado ou pedido? Sem nada, ela pode sumir inteira. */
export async function execucaoVazia(cliente: Transacao, execucaoId: Id): Promise<boolean> {
  const linha = (await cliente.query<{ algo: boolean }>(`SELECT
      EXISTS (SELECT 1 FROM modelo_capitulo WHERE execucao_id=$1)
      OR EXISTS (SELECT 1 FROM analise_local a JOIN parte p ON p.id=a.parte_id WHERE p.execucao_id=$1)
      OR EXISTS (SELECT 1 FROM preparacao_capitulo WHERE execucao_id=$1)
      OR EXISTS (SELECT 1 FROM marca WHERE execucao_id=$1 OR camada_id=$1)
      OR EXISTS (SELECT 1 FROM job WHERE parte_id IN (SELECT id FROM parte WHERE execucao_id=$1) OR split_part(dedup_key, ':', 2) = $1) AS algo`,
  [execucaoId])).rows[0];
  return linha?.algo !== true;
}

/**
 * Apaga a execução inteira: cada capítulo, as marcas e os lotes das leituras antigas (F1/V2), os jobs,
 * as partes, a camada e a própria execução. A camada padrão que apontava para ela volta a vazia.
 */
export async function apagarExecucao(cliente: Transacao, execucaoId: Id): Promise<void> {
  const secoes = (await cliente.query<{ secao_id: Id }>(`SELECT DISTINCT secao_id FROM parte WHERE execucao_id=$1 AND secao_id IS NOT NULL
    UNION SELECT DISTINCT secao_id FROM modelo_capitulo WHERE execucao_id=$1
    UNION SELECT DISTINCT secao_id FROM preparacao_capitulo WHERE execucao_id=$1`, [execucaoId])).rows.map((l) => l.secao_id);
  for (const secao of secoes) await purgarCapitulo(cliente, execucaoId, secao);
  const jobs = (await cliente.query<{ id: Id }>(`SELECT id FROM job WHERE parte_id IN (SELECT id FROM parte WHERE execucao_id=$1)
    OR split_part(dedup_key, ':', 2) = $1`, [execucaoId])).rows.map((l) => l.id);
  const marcas = (await cliente.query<{ id: Id }>('SELECT id FROM marca WHERE execucao_id=$1 OR camada_id=$1 OR job_id = ANY($2::text[])', [execucaoId, jobs]))
    .rows.map((l) => l.id);
  await apagarMarcas(cliente, marcas);
  await cliente.query('DELETE FROM revisao_marca WHERE lote_id IN (SELECT id FROM lote_revisao WHERE execucao_id=$1)', [execucaoId]);
  await cliente.query('DELETE FROM lote_revisao WHERE execucao_id=$1', [execucaoId]);
  await cliente.query('UPDATE preferencia_documento SET camada_padrao=NULL WHERE camada_padrao=$1', [execucaoId]);
  await cliente.query('DELETE FROM elemento_apagado WHERE execucao_id=$1', [execucaoId]);
  for (const id of jobs) {
    await cliente.query('DELETE FROM evento_job WHERE job_id=$1', [id]);
    await cliente.query('DELETE FROM job WHERE id=$1', [id]);
  }
  await apagarAuditoriaDosJobs(raizDaAuditoria(), jobs).catch(() => undefined);
  await cliente.query('DELETE FROM parte WHERE execucao_id=$1', [execucaoId]);
  await cliente.query('DELETE FROM camada WHERE id=$1', [execucaoId]);
  await cliente.query('DELETE FROM execucao_leitura WHERE id=$1', [execucaoId]);
}

// ---------------------------------------------------------------- itens apagados um a um

export type TipoDoItemApagado = 'elemento' | 'relacao' | 'dificuldade';

export async function itensApagados(cliente: Transacao, execucaoId: Id, secaoId?: Id): Promise<Set<Id>> {
  return new Set((await cliente.query<{ item_id: Id }>(`SELECT item_id FROM elemento_apagado WHERE execucao_id=$1 AND ($2::text IS NULL OR secao_id=$2)`,
    [execucaoId, secaoId ?? null])).rows.map((linha) => linha.item_id));
}

export async function marcarApagado(cliente: Transacao, execucaoId: Id, secaoId: Id, itemId: Id, tipo: TipoDoItemApagado): Promise<void> {
  await cliente.query(`INSERT INTO elemento_apagado (execucao_id, secao_id, item_id, tipo) VALUES ($1,$2,$3,$4)
    ON CONFLICT (execucao_id, item_id) DO NOTHING`, [execucaoId, secaoId, itemId, tipo]);
}

/** O tipo de um item do modelo do capítulo (elemento, relação ou dificuldade), ou `null`. */
export function tipoDoItem(modelo: Pick<ModeloDoCapituloV1, 'elementos' | 'relacoes' | 'dificuldades'>, itemId: Id): TipoDoItemApagado | null {
  if (modelo.relacoes.some((item) => item.id === itemId)) return 'relacao';
  if (modelo.dificuldades.some((item) => item.id === itemId)) return 'dificuldade';
  if (modelo.elementos.some((item) => item.id === itemId)) return 'elemento';
  return null;
}

/**
 * O modelo como o leitor o vê: sem os itens apagados e sem as relações que tocam um elemento apagado.
 * As revisões gravadas não mudam; só a leitura passa por aqui.
 */
export function semApagados<M extends { elementos: ElementoSemanticoV1[]; relacoes: RelacaoSemanticaV1[]; dificuldades: DificuldadeTextualV1[] }>(
  modelo: M, apagados: ReadonlySet<Id>,
): M {
  if (apagados.size === 0) return modelo;
  const elementos = modelo.elementos.filter((item) => !apagados.has(item.id));
  const vivos = new Set(elementos.map((item) => item.id));
  return {
    ...modelo, elementos,
    relacoes: modelo.relacoes.filter((item) => !apagados.has(item.id) && vivos.has(item.origem_id) && vivos.has(item.destino_id)),
    dificuldades: modelo.dificuldades.filter((item) => !apagados.has(item.id)),
  };
}

/** O plano sem referências a itens apagados (os passos continuam; só perdem o foco e as relações que sumiram). */
export function planoSemApagados(plano: PlanoPedagogicoV1, apagados: ReadonlySet<Id>): PlanoPedagogicoV1 {
  if (apagados.size === 0) return plano;
  return {
    ...plano,
    passos: plano.passos.map((passo) => ({ ...passo, foco: passo.foco.filter((id) => !apagados.has(id)), relacoes: passo.relacoes.filter((id) => !apagados.has(id)) })),
    apoios: plano.apoios.filter((apoio) => !apagados.has(apoio.alvo_id)),
  };
}
