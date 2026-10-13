/**
 * O destaque do parágrafo em foco (↑ ↓): uma área suave, de cantos redondos, atrás da coluna, que
 * acompanha a rolagem. É do leitor, não de uma marca: não mexe no texto e não recebe o ponteiro.
 */
import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import type { AncoraV1 } from '@margem/contratos';
import { faixaDaAncora, type Faixa } from '../compreensao/geometria';
import type { ApiDoLeitor } from '../tipos';

const FOLGA_X = 14;
const FOLGA_Y = 8;

export function FocoDoParagrafo({ leitor, ancora }: { leitor: RefObject<ApiDoLeitor>; ancora: AncoraV1 }): ReactNode {
  const [faixa, definirFaixa] = useState<Faixa | null>(null);
  const medir = useCallback(() => { definirFaixa(faixaDaAncora(leitor.current, ancora)); }, [leitor, ancora]);
  useLayoutEffect(() => { medir(); }, [medir]);
  useEffect(() => {
    let quadro = 0;
    const agendar = () => { cancelAnimationFrame(quadro); quadro = requestAnimationFrame(medir); };
    window.addEventListener('scroll', agendar, true);
    window.addEventListener('resize', agendar);
    return () => { cancelAnimationFrame(quadro); window.removeEventListener('scroll', agendar, true); window.removeEventListener('resize', agendar); };
  }, [medir]);
  if (!faixa) return null;
  return <div className="foco-do-paragrafo" aria-hidden="true" data-bloco={ancora.bloco_id} style={{
    left: faixa.esquerda - FOLGA_X, top: faixa.topo - FOLGA_Y, width: faixa.direita - faixa.esquerda + 2 * FOLGA_X, height: faixa.base - faixa.topo + 2 * FOLGA_Y,
  }} />;
}
