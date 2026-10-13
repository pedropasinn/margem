/**
 * Preparar em segundo plano basta para a leitura parecer instantânea? (`docs/desenho/09-VISAO.md` §6.)
 * Mede, por capítulo, o tempo de trabalho gasto na preparação (soma dos jobs: da reserva à publicação) e
 * o tempo de leitura estimado; para os capítulos ainda não preparados, estima a preparação pela taxa
 * medida (segundos por mil caracteres). Com isso, simula a leitura do livro com 0 a 3 capítulos
 * preparados adiante (`core/src/tempo.ts`) e diz quanto se esperaria em cada abertura.
 */
import type { Id } from '@margem/contratos';
import { profundidadeRecomendada, simularPreparacao, tempoDeLeitura, type ResultadoDaSimulacao } from '@margem/core';
import type { Transacao } from '../db/transacao.js';
import { obterVersao } from '../repos/documentos.js';
import * as repo from '../repos/compreensao.js';
import { capituloDe, capitulosDaExecucao } from './pipeline.js';

export interface TempoDoCapitulo {
  secao_id: Id; titulo: string; caracteres: number; leitura_s: number;
  /** Trabalho medido (jobs publicados); `null` se o capítulo não foi preparado. */
  preparo_medido_s: number | null;
  /** Do pedido à última publicação (inclui a espera na fila). */
  pronto_em_s: number | null;
  jobs: number;
  /** O que entra na simulação: o medido ou, sem medida, a estimativa pela taxa. */
  preparo_s: number | null;
  estimado: boolean;
}
export interface MedidaDaPreparacao {
  capitulos: TempoDoCapitulo[];
  segundos_por_mil_caracteres: number | null;
  profundidade_atual: number;
  simulacoes: ResultadoDaSimulacao[];
  recomendada: ResultadoDaSimulacao | null;
}

export async function medirPreparacao(cliente: Transacao, execucaoId: Id, profundidadeAtual: number, taxaPadrao?: number, trabalhadores = 1): Promise<MedidaDaPreparacao> {
  const execucao = await repo.obterExecucao(cliente, execucaoId);
  if (!execucao) throw new Error('Compreensão inexistente.');
  const versao = await obterVersao(cliente, execucao.versao_id);
  const ordem = await capitulosDaExecucao(cliente, execucaoId);
  const partes = await repo.listarPartes(cliente, execucaoId);
  const secaoDaParte = new Map(partes.map((parte) => [parte.id, parte.secao_id]));
  const pedidos = await repo.pedidosDePreparacao(cliente, execucaoId);
  const porSecao = new Map<Id, { segundos: number; jobs: number; ultima: Date | null }>();
  for (const job of await repo.temposDosJobs(cliente, execucaoId)) {
    if (job.estado !== 'ok' || job.segundos === null) continue;
    const [tipo, , terceiro] = job.dedup_key.split(':');
    const secao = tipo === 'analisar' ? secaoDaParte.get(terceiro ?? '') : terceiro;
    if (!secao) continue;
    const atual = porSecao.get(secao) ?? { segundos: 0, jobs: 0, ultima: null };
    atual.segundos += job.segundos;
    atual.jobs += 1;
    if (job.publicado_em && (!atual.ultima || job.publicado_em > atual.ultima)) atual.ultima = job.publicado_em;
    porSecao.set(secao, atual);
  }
  const medidos = ordem.map((secaoId) => {
    const capitulo = capituloDe(versao.canonico, secaoId);
    const textos = capitulo.blocos.map((bloco) => bloco.texto);
    const medida = porSecao.get(secaoId);
    const pedido = pedidos.get(secaoId);
    return {
      secao_id: secaoId, titulo: capitulo.titulo, caracteres: textos.reduce((total, texto) => total + texto.length, 0), leitura_s: tempoDeLeitura(textos),
      preparo_medido_s: medida ? Math.round(medida.segundos) : null,
      pronto_em_s: medida?.ultima && pedido ? Math.round((medida.ultima.getTime() - pedido.getTime()) / 1000) : null,
      jobs: medida?.jobs ?? 0,
    };
  });
  const comMedida = medidos.filter((capitulo) => capitulo.preparo_medido_s !== null && capitulo.caracteres > 0);
  const caracteresMedidos = comMedida.reduce((total, capitulo) => total + capitulo.caracteres, 0);
  const taxa = caracteresMedidos > 0
    ? comMedida.reduce((total, capitulo) => total + (capitulo.preparo_medido_s ?? 0), 0) / (caracteresMedidos / 1000)
    : taxaPadrao ?? null;
  const capitulos: TempoDoCapitulo[] = medidos.map((capitulo) => {
    const estimado = capitulo.preparo_medido_s === null;
    const preparo = estimado ? (taxa === null ? null : Math.round((capitulo.caracteres / 1000) * taxa)) : capitulo.preparo_medido_s;
    return { ...capitulo, preparo_s: preparo, estimado };
  });
  const simulaveis = capitulos.every((capitulo) => capitulo.preparo_s !== null)
    ? capitulos.map((capitulo) => ({ leitura_s: capitulo.leitura_s, preparo_s: capitulo.preparo_s ?? 0 }))
    : null;
  return {
    capitulos, segundos_por_mil_caracteres: taxa === null ? null : Math.round(taxa * 10) / 10, profundidade_atual: profundidadeAtual,
    simulacoes: simulaveis ? [0, 1, 2, 3].map((profundidade) => simularPreparacao(simulaveis, profundidade, new Set(), trabalhadores)) : [],
    recomendada: simulaveis ? profundidadeRecomendada(simulaveis, 3, trabalhadores) : null,
  };
}
