/**
 * Liga o leitor à leitura comentada do capítulo (J92): a leitura (frases e pausas) e a voz, quando
 * existem. Enquanto prepara, consulta de tempos em tempos. Preparar é um pedido explícito (um clique):
 * as falas custam uma chamada ao Codex.
 */
import { useCallback, useEffect, useState } from 'react';
import type { LeituraComentadaV1, NarracaoDaLeituraV1 } from '@margem/contratos';
import { leituraComentadaDoCapitulo, prepararLeituraComentada, type EstadoDaLeituraComentada } from '../../biblioteca/api';

export interface FontesDaLeituraComentada { detalhe: typeof leituraComentadaDoCapitulo; preparar: typeof prepararLeituraComentada }
export const FONTES_DA_LEITURA_COMENTADA: FontesDaLeituraComentada = { detalhe: leituraComentadaDoCapitulo, preparar: prepararLeituraComentada };
export const INTERVALO_DA_LEITURA_MS = 10_000;

export interface EstadoDaLeituraComentadaNoLeitor {
  estado: EstadoDaLeituraComentada | null;
  leitura: LeituraComentadaV1 | null;
  narracao: NarracaoDaLeituraV1 | null;
  erro: string | null;
  preparar: () => void;
}

export function useLeituraComentada(ativa: string | null, secaoId: string, fontes: FontesDaLeituraComentada = FONTES_DA_LEITURA_COMENTADA, intervaloMs = INTERVALO_DA_LEITURA_MS): EstadoDaLeituraComentadaNoLeitor {
  const [estado, definirEstado] = useState<EstadoDaLeituraComentada | null>(null);
  const [leitura, definirLeitura] = useState<LeituraComentadaV1 | null>(null);
  const [narracao, definirNarracao] = useState<NarracaoDaLeituraV1 | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [rodada, novaRodada] = useState(0);

  const preparar = useCallback(() => {
    if (ativa === null) return;
    definirErro(null);
    fontes.preparar(ativa, secaoId).then((resposta) => {
      definirEstado(resposta.estado); definirLeitura(resposta.leitura); definirNarracao(resposta.narracao); novaRodada((n) => n + 1);
    }, (falha: unknown) => definirErro(falha instanceof Error ? falha.message : 'Não foi possível preparar a leitura comentada.'));
  }, [ativa, fontes, secaoId]);

  useEffect(() => {
    definirEstado(null); definirLeitura(null); definirNarracao(null); definirErro(null);
    if (ativa === null) return undefined;
    let vivo = true;
    let relogio: ReturnType<typeof setTimeout> | undefined;
    const ciclo = async (): Promise<void> => {
      try {
        const detalhe = await fontes.detalhe(ativa, secaoId);
        if (!vivo) return;
        definirEstado(detalhe.estado); definirLeitura(detalhe.leitura); definirNarracao(detalhe.narracao);
        if (detalhe.estado === 'preparando') relogio = setTimeout(() => { void ciclo(); }, intervaloMs);
      } catch (falha) {
        if (vivo) definirErro(falha instanceof Error ? falha.message : 'Não foi possível consultar a leitura comentada.');
      }
    };
    void ciclo();
    return () => { vivo = false; if (relogio !== undefined) clearTimeout(relogio); };
  }, [ativa, secaoId, fontes, intervaloMs, rodada]);

  return { estado, leitura, narracao, erro, preparar };
}
