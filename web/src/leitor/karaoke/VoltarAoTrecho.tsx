/**
 * Pílula flutuante "Voltar ao trecho atual" (ElevenReader: "Back to current"), a mesma na leitura
 * comentada e no player de áudio e vídeo. Aparece quando o leitor rolou por conta própria e a frase em
 * curso saiu da área de leitura; fica logo acima do player que estiver aberto.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Karaoke } from './karaoke';

/** Uma camada de karaokê para o componente, e se a frase em curso saiu da vista. */
export function useKaraoke(opcoes: { filete?: boolean } = {}): { karaoke: RefObject<Karaoke | null>; fora: boolean } {
  const karaoke = useRef<Karaoke | null>(null);
  const [fora, definirFora] = useState(false);
  // J142: sem filete por padrão (nenhuma faixa lateral colorida no Margem).
  const filete = opcoes.filete === true;
  useLayoutEffect(() => {
    const instancia = new Karaoke({ filete });
    karaoke.current = instancia;
    const soltar = instancia.aoMudarFora(definirFora);
    return () => { soltar(); instancia.destruir(); if (karaoke.current === instancia) karaoke.current = null; };
  }, [filete]);
  return { karaoke, fora };
}

export function VoltarAoTrecho({ visivel, aoVoltar, acimaDe }: { visivel: boolean; aoVoltar: () => void; acimaDe: string }): ReactNode {
  const [base, definirBase] = useState<number | null>(null);
  useEffect(() => {
    if (!visivel) return undefined;
    const medir = (): void => {
      const player = document.querySelector(acimaDe)?.getBoundingClientRect();
      definirBase(player && player.height > 0 ? Math.round(window.innerHeight - player.top + 14) : null);
    };
    medir();
    window.addEventListener('resize', medir);
    // O transporte do player se recolhe enquanto toca: a pílula acompanha.
    const player = document.querySelector(acimaDe);
    const observador = player && typeof ResizeObserver === 'function' ? new ResizeObserver(medir) : null;
    if (player) observador?.observe(player);
    return () => { window.removeEventListener('resize', medir); observador?.disconnect(); };
  }, [visivel, acimaDe]);
  if (!visivel || typeof document === 'undefined') return null;
  return createPortal(<button type="button" className="voltar-ao-trecho" style={base === null ? undefined : { bottom: `${String(base)}px` }} onClick={aoVoltar}>
Voltar ao trecho atual  </button>, document.body);
}
