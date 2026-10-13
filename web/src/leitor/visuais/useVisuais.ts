/**
 * Visuais do capítulo (J70): carrega, e enquanto algum estiver na fila ou sendo gerado, relê
 * de tempos em tempos (o banco é a verdade; o estado vem do job).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Id, VisualV1 } from '@margem/contratos';
import { listarVisuais } from './api';

export const INTERVALO_DA_FILA_MS = 3000;

/** Uma sequência de versões: a mais nova (`atual`) e as que ela substituiu, da mais nova para a mais antiga. */
export interface SerieDeVisuais { atual: VisualV1; anteriores: VisualV1[] }

/** Agrupa pelas substituições: cada visual vivo que ninguém substitui abre uma série. */
export function seriesDosVisuais(visuais: readonly VisualV1[]): SerieDeVisuais[] {
  const porId = new Map(visuais.map((visual) => [visual.id, visual]));
  const substituidos = new Set(visuais.flatMap((visual) => (visual.substitui !== undefined && porId.has(visual.substitui) ? [visual.substitui] : [])));
  return visuais.filter((visual) => !substituidos.has(visual.id)).map((atual) => {
    const anteriores: VisualV1[] = [];
    const vistos = new Set([atual.id]);
    let proximo = atual.substitui === undefined ? undefined : porId.get(atual.substitui);
    while (proximo && !vistos.has(proximo.id)) {
      anteriores.push(proximo); vistos.add(proximo.id);
      proximo = proximo.substitui === undefined ? undefined : porId.get(proximo.substitui);
    }
    return { atual, anteriores };
  });
}

export function emCurso(visual: VisualV1): boolean {
  return visual.estado === 'pendente' || visual.estado === 'executando';
}

export function useVisuais(versaoId: Id, secaoId: Id, intervaloMs = INTERVALO_DA_FILA_MS) {
  const [visuais, definir] = useState<VisualV1[]>([]);
  const [erro, definirErro] = useState<string | null>(null);
  const atual = useRef(`${versaoId}:${secaoId}`);
  atual.current = `${versaoId}:${secaoId}`;
  const recarregar = useCallback(async () => {
    const chave = `${versaoId}:${secaoId}`;
    try {
      const { visuais: lidos } = await listarVisuais(versaoId, secaoId);
      if (atual.current === chave) { definir(lidos); definirErro(null); }
    } catch (falha) {
      if (atual.current === chave) definirErro(falha instanceof Error ? falha.message : 'Não foi possível ler os visuais.');
    }
  }, [versaoId, secaoId]);
  useEffect(() => { definir([]); void recarregar(); }, [recarregar]);
  const trabalhando = visuais.some(emCurso);
  useEffect(() => {
    if (!trabalhando) return;
    const relogio = setInterval(() => { void recarregar(); }, intervaloMs);
    return () => clearInterval(relogio);
  }, [trabalhando, recarregar, intervaloMs]);
  const series = useMemo(() => seriesDosVisuais(visuais), [visuais]);
  return { visuais, series, erro, recarregar };
}
