/**
 * Estado da narração gerada do capítulo (J106): consulta ao abrir, acompanha enquanto está na fila
 * ou gerando, e avisa quando fica pronta (para o player recarregar as fontes).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Id } from '@margem/contratos';
import { situacaoDaNarracao, type SituacaoDaNarracao } from './api';

export const INTERVALO_DA_NARRACAO_MS = 2000;

export interface Narracao {
  /** `null` enquanto carrega ou se a API não respondeu: nada aparece no menu. */
  situacao: SituacaoDaNarracao | null;
  atualizar: (nova?: SituacaoDaNarracao) => void;
  /** Muda a cada narração que fica pronta enquanto o capítulo está aberto. */
  prontas: number;
}

export function useNarracao(versaoId: Id, secaoId: Id, intervaloMs = INTERVALO_DA_NARRACAO_MS): Narracao {
  const [situacao, definir] = useState<SituacaoDaNarracao | null>(null);
  const [prontas, contar] = useState(0);
  const [pedido, repetir] = useState(0);
  const anterior = useRef<SituacaoDaNarracao | null>(null);
  useEffect(() => { anterior.current = null; definir(null); }, [versaoId, secaoId]);
  useEffect(() => {
    let vivo = true;
    let relogio: ReturnType<typeof setTimeout> | undefined;
    const consultar = (): void => {
      situacaoDaNarracao(versaoId, secaoId).then((nova) => {
        if (!vivo || typeof nova.chave_configurada !== 'boolean' || typeof nova.estado !== 'string') return;
        const antes = anterior.current;
        if (nova.estado === 'pronto' && antes !== null && (antes.estado === 'pendente' || antes.estado === 'executando')) contar((n) => n + 1);
        anterior.current = nova; definir(nova);
        if (nova.estado === 'pendente' || nova.estado === 'executando') relogio = setTimeout(consultar, intervaloMs);
      }, () => { /* sem API de narração: segue sem a ação */ });
    };
    consultar();
    return () => { vivo = false; if (relogio) clearTimeout(relogio); };
  }, [versaoId, secaoId, pedido, intervaloMs]);
  const atualizar = useCallback((nova?: SituacaoDaNarracao) => {
    if (nova) { anterior.current = nova; definir(nova); }
    repetir((n) => n + 1);
  }, []);
  return { situacao, atualizar, prontas };
}
