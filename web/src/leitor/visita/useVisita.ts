/**
 * Liga o leitor à visita guiada do capítulo (J91): o roteiro narrado e a voz, quando existem. Enquanto o
 * roteiro prepara, consulta de tempos em tempos. Preparar é sempre um pedido explícito (um clique): o
 * roteiro custa uma chamada ao Codex.
 */
import { useCallback, useEffect, useState } from 'react';
import type { NarracaoDaVisitaV1, RoteiroGuiadoV1 } from '@margem/contratos';
import { prepararVisita, visitaDoCapitulo, type EstadoDaVisita } from '../../biblioteca/api';

export interface FontesDaVisita { detalhe: typeof visitaDoCapitulo; preparar: typeof prepararVisita }
export const FONTES_DA_VISITA: FontesDaVisita = { detalhe: visitaDoCapitulo, preparar: prepararVisita };
export const INTERVALO_DA_VISITA_MS = 10_000;

export interface EstadoDaVisitaNoLeitor {
  estado: EstadoDaVisita | null;
  roteiro: RoteiroGuiadoV1 | null;
  narracao: NarracaoDaVisitaV1 | null;
  erro: string | null;
  preparar: () => void;
}

export function useVisita(ativa: string | null, secaoId: string, fontes: FontesDaVisita = FONTES_DA_VISITA, intervaloMs = INTERVALO_DA_VISITA_MS): EstadoDaVisitaNoLeitor {
  const [estado, definirEstado] = useState<EstadoDaVisita | null>(null);
  const [roteiro, definirRoteiro] = useState<RoteiroGuiadoV1 | null>(null);
  const [narracao, definirNarracao] = useState<NarracaoDaVisitaV1 | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [rodada, novaRodada] = useState(0);

  const preparar = useCallback(() => {
    if (ativa === null) return;
    definirErro(null);
    fontes.preparar(ativa, secaoId).then((resposta) => {
      definirEstado(resposta.estado); definirRoteiro(resposta.roteiro); definirNarracao(resposta.narracao); novaRodada((n) => n + 1);
    }, (falha: unknown) => definirErro(falha instanceof Error ? falha.message : 'Não foi possível preparar a visita.'));
  }, [ativa, fontes, secaoId]);

  useEffect(() => {
    definirEstado(null); definirRoteiro(null); definirNarracao(null); definirErro(null);
    if (ativa === null) return undefined;
    let vivo = true;
    let relogio: ReturnType<typeof setTimeout> | undefined;
    const ciclo = async (): Promise<void> => {
      try {
        const detalhe = await fontes.detalhe(ativa, secaoId);
        if (!vivo) return;
        definirEstado(detalhe.estado); definirRoteiro(detalhe.roteiro); definirNarracao(detalhe.narracao);
        if (detalhe.estado === 'preparando') relogio = setTimeout(() => { void ciclo(); }, intervaloMs);
      } catch (falha) {
        if (vivo) definirErro(falha instanceof Error ? falha.message : 'Não foi possível consultar a visita.');
      }
    };
    void ciclo();
    return () => { vivo = false; if (relogio !== undefined) clearTimeout(relogio); };
  }, [ativa, secaoId, fontes, intervaloMs, rodada]);

  return { estado, roteiro, narracao, erro, preparar };
}
