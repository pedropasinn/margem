import { useEffect, useState } from 'react';

/** Abaixo desta largura a margem de notas não cabe: quem responde é a folha inferior. */
export const LARGURA_DA_MARGEM = 1418;

function avaliar(limiar: number): boolean {
  if (typeof window === 'undefined') return false;
  const ponteiroGrosso = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return ponteiroGrosso || window.innerWidth < limiar;
}

/** `true` quando a interação é de toque ou a tela é estreita demais para a margem. */
export function useTelaEstreita(limiar: number = LARGURA_DA_MARGEM): boolean {
  const [estreita, definir] = useState(() => avaliar(limiar));
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const conferir = (): void => { definir(avaliar(limiar)); };
    conferir();
    window.addEventListener('resize', conferir);
    const consulta = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null;
    consulta?.addEventListener('change', conferir);
    return () => {
      window.removeEventListener('resize', conferir);
      consulta?.removeEventListener('change', conferir);
    };
  }, [limiar]);
  return estreita;
}
