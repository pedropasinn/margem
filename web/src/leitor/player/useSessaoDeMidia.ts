import { useEffect, useRef } from 'react';

interface SessaoDeMidia {
  ativa?: boolean;
  titulo: string;
  capitulo: string;
  tocando: boolean;
  duracao: number;
  tempo: number;
  velocidade: number;
  tocar: () => void;
  pausar: () => void;
  buscar: (segundos: number) => void;
  instante: () => number;
  anterior: () => void;
  proximo: () => void;
}

/** Os dois players compartilham os controles do sistema; navegadores antigos seguem sem eles. */
export function useSessaoDeMidia(opcoes: SessaoDeMidia): void {
  const atual = useRef(opcoes);
  atual.current = opcoes;
  const ativa = opcoes.ativa !== false;
  useEffect(() => {
    if (!ativa || !navigator.mediaSession) return;
    const sessao = navigator.mediaSession;
    const acoes: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
      play: () => atual.current.tocar(), pause: () => atual.current.pausar(),
      seekto: (evento) => { if (evento.seekTime !== undefined) atual.current.buscar(evento.seekTime); },
      seekbackward: (evento) => atual.current.buscar(atual.current.instante() - (evento.seekOffset ?? 10)),
      seekforward: (evento) => atual.current.buscar(atual.current.instante() + (evento.seekOffset ?? 10)),
      previoustrack: () => atual.current.anterior(), nexttrack: () => atual.current.proximo(),
    };
    const registradas: MediaSessionAction[] = [];
    for (const acao of Object.keys(acoes) as MediaSessionAction[]) {
      try { sessao.setActionHandler(acao, acoes[acao]!); registradas.push(acao); } catch { /* Ações variam por navegador. */ }
    }
    return () => {
      for (const acao of registradas) sessao.setActionHandler(acao, null);
      sessao.metadata = null;
      sessao.playbackState = 'none';
      try { sessao.setPositionState?.(); } catch { /* Sem suporte. */ }
    };
  }, [ativa]);
  useEffect(() => {
    if (!ativa || !navigator.mediaSession || typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: opcoes.capitulo, album: opcoes.titulo });
  }, [ativa, opcoes.titulo, opcoes.capitulo]);
  useEffect(() => {
    if (!ativa || !navigator.mediaSession) return;
    navigator.mediaSession.playbackState = opcoes.tocando ? 'playing' : 'paused';
    try {
      if (Number.isFinite(opcoes.duracao) && opcoes.duracao > 0) navigator.mediaSession.setPositionState?.({
        duration: opcoes.duracao, position: Math.max(0, Math.min(opcoes.tempo, opcoes.duracao)), playbackRate: opcoes.velocidade,
      });
    } catch { /* Sem suporte à posição. */ }
  }, [ativa, opcoes.tocando, opcoes.duracao, opcoes.tempo, opcoes.velocidade]);
}
