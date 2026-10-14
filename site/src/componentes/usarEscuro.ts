import { useEffect, useState } from 'react';

/** O tema escuro do sistema: o Marcador do app usa outra opacidade e outra mistura no escuro. */
export function usarEscuro(): boolean {
  const consulta = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const [escuro, definir] = useState(consulta?.matches ?? false);
  useEffect(() => {
    if (!consulta) return;
    const mudar = (): void => { definir(consulta.matches); };
    consulta.addEventListener('change', mudar);
    return () => { consulta.removeEventListener('change', mudar); };
  }, [consulta]);
  return escuro;
}
