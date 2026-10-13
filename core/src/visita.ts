/**
 * A visita guiada no tempo (J91): do roteiro (e da narração, se houver) para uma linha do tempo única
 * de etapas, uma por fala. Puro; o leitor usa isto para saber, a cada instante, que fala toca, que
 * parada está em foco e que frase da fala acender no painel.
 *
 * Sem narração, a visita anda no ritmo de leitura em voz alta (`PALAVRAS_POR_SEGUNDO`), com a mesma
 * pausa entre falas que a fábrica põe entre cenas.
 */
import type { FalaDoRoteiroV1, NarracaoDaVisitaV1, RoteiroGuiadoV1 } from '@margem/contratos';

/** Ritmo de uma fala em português lida com calma (≈ 150 palavras por minuto). */
export const PALAVRAS_POR_SEGUNDO = 2.5;
/** Pausa entre falas quando não há narração (a mesma `gap_cena_s` da receita de voz). */
export const PAUSA_ENTRE_FALAS_S = 0.35;

export interface EtapaDaVisita {
  indice: number;
  fala: FalaDoRoteiroV1;
  /** Ordem da parada em foco (1…n), ou `null` na abertura, no fechamento e na ponte. */
  parada: number | null;
  inicio_s: number;
  fim_s: number;
}

export interface SequenciaDaVisita {
  etapas: EtapaDaVisita[];
  duracao_s: number;
  /** Com voz: os tempos vêm do manifesto; sem voz, são estimados. */
  narrada: boolean;
}

export function palavras(texto: string): number {
  return texto.trim() === '' ? 0 : texto.trim().split(/\s+/u).length;
}

/** Duração estimada de uma fala lida em voz alta. */
export function duracaoEstimada(texto: string): number {
  return Math.max(1.2, palavras(texto) / PALAVRAS_POR_SEGUNDO);
}

/**
 * A linha do tempo. Com narração, cada fala usa o seu intervalo; uma fala sem intervalo (narração de
 * um roteiro diferente) invalida a narração inteira, e a visita cai para os tempos estimados.
 */
export function montarSequenciaDaVisita(roteiro: RoteiroGuiadoV1, narracao: NarracaoDaVisitaV1 | null): SequenciaDaVisita {
  const tempos = narracao && narracao.roteiro_id === roteiro.id ? new Map(narracao.falas.map((f) => [f.fala_id, f])) : null;
  const narrada = tempos !== null && roteiro.falas.every((fala) => tempos.has(fala.id));
  let cursor = 0;
  const etapas = roteiro.falas.map((fala, indice): EtapaDaVisita => {
    if (narrada) {
      const tempo = tempos.get(fala.id)!;
      return { indice, fala, parada: fala.parada, inicio_s: tempo.inicio_s, fim_s: tempo.fim_s };
    }
    const inicio = cursor;
    const fim = inicio + duracaoEstimada(fala.texto);
    cursor = fim + PAUSA_ENTRE_FALAS_S;
    return { indice, fala, parada: fala.parada, inicio_s: inicio, fim_s: fim };
  });
  const duracao = narrada ? Math.max(narracao!.duracao_s, etapas.at(-1)?.fim_s ?? 0) : Math.max(0, cursor - PAUSA_ENTRE_FALAS_S);
  return { etapas, duracao_s: duracao, narrada };
}

/** A etapa que vale no instante: a última que já começou (as pausas entre falas ficam com a anterior). */
export function etapaNoInstante(sequencia: SequenciaDaVisita, t: number): EtapaDaVisita | null {
  let achada: EtapaDaVisita | null = null;
  for (const etapa of sequencia.etapas) {
    if (etapa.inicio_s <= t + 1e-6) achada = etapa;
    else break;
  }
  return achada ?? sequencia.etapas[0] ?? null;
}

/** Onde começa a parada `ordem` (a sua primeira fala). */
export function inicioDaParada(sequencia: SequenciaDaVisita, ordem: number): number | null {
  return sequencia.etapas.find((etapa) => etapa.parada === ordem)?.inicio_s ?? null;
}

/**
 * Para "próxima/anterior parada": o instante de destino a partir de `t`. Próxima = a primeira parada
 * depois da atual (ou o fechamento, depois da última); anterior = o começo da parada atual se já se
 * passaram mais de 3 s dela, senão o da parada de antes (ou a abertura).
 */
export function saltarParada(sequencia: SequenciaDaVisita, t: number, sentido: 1 | -1): number {
  const atual = etapaNoInstante(sequencia, t);
  if (!atual) return 0;
  // "Paradas" aqui incluem a abertura (0) e o fechamento (n+1) como pontos de parada da navegação.
  const n = Math.max(0, ...sequencia.etapas.map((etapa) => etapa.parada ?? 0));
  const posicao = (etapa: EtapaDaVisita): number => etapa.parada ?? (etapa.fala.papel === 'abertura' ? 0 : n + 1);
  const pontos = new Map<number, number>();
  for (const etapa of sequencia.etapas) if (!pontos.has(posicao(etapa))) pontos.set(posicao(etapa), etapa.inicio_s);
  const aqui = posicao(atual);
  if (sentido === 1) {
    const seguinte = [...pontos.keys()].filter((p) => p > aqui).sort((a, b) => a - b)[0];
    return seguinte === undefined ? sequencia.duracao_s : pontos.get(seguinte)!;
  }
  const inicioAqui = pontos.get(aqui) ?? 0;
  if (t - inicioAqui > 3) return inicioAqui;
  const antes = [...pontos.keys()].filter((p) => p < aqui).sort((a, b) => b - a)[0];
  return antes === undefined ? 0 : pontos.get(antes)!;
}

/** As frases de uma fala, com a fração do tempo da fala em que cada uma começa (pelo tamanho). */
export function frasesDaFala(texto: string): { texto: string; inicio: number; fim: number }[] {
  const frases = texto.match(/[^.!?…]+(?:[.!?…]+["”»)]*\s*|$)/gu)?.map((frase) => frase).filter((frase) => frase.trim() !== '') ?? [texto];
  const total = frases.reduce((soma, frase) => soma + frase.length, 0) || 1;
  let acumulado = 0;
  return frases.map((frase) => {
    const inicio = acumulado / total;
    acumulado += frase.length;
    return { texto: frase, inicio, fim: acumulado / total };
  });
}

/** Índice da frase em curso numa etapa, no instante `t`. */
export function fraseNoInstante(etapa: EtapaDaVisita, t: number): number {
  const frases = frasesDaFala(etapa.fala.texto);
  const duracao = etapa.fim_s - etapa.inicio_s;
  const fracao = duracao <= 0 ? 0 : Math.min(1, Math.max(0, (t - etapa.inicio_s) / duracao));
  const indice = frases.findIndex((frase) => fracao < frase.fim);
  return indice === -1 ? frases.length - 1 : indice;
}
