/**
 * Os alvos de toque e de teclado das marcas sobre uma página do PDF. Cada linha da marca tem o seu retângulo
 * para o clique, mas só um deles é alvo de teclado (U-09): a primeira linha na primeira página da marca, com o
 * nome dela; os outros ficam escondidos da árvore de acessibilidade. Enter e Espaço o ativam (no controlador).
 */
import type { ReactNode } from 'react';
import type { AncoraV1 } from '@margem/contratos';

interface RetanguloNaTela { x: number; y: number; largura: number; altura: number }
interface MarcaComAlvo { id: string; ancora: AncoraV1; comentario?: { rotulo?: string } | null }

export interface PropsDosAlvos {
  pagina: number;
  marcas: readonly MarcaComAlvo[];
  /** Os retângulos da âncora nesta página, já na escala da tela. */
  linhas: (ancora: AncoraV1) => readonly RetanguloNaTela[];
  /** As páginas em que a âncora tem retângulos. */
  paginasDaAncora: (ancora: AncoraV1) => readonly number[];
}

export function AlvosDoPdf({ pagina, marcas, linhas, paginasDaAncora }: PropsDosAlvos): ReactNode {
  return <div className="pdf-alvos">{marcas.flatMap((m) => {
    const primeira = Math.min(...paginasDaAncora(m.ancora));
    return linhas(m.ancora).map((r, i) => <span key={`${m.id}-${String(i)}`} data-marcas={m.id} style={{ left: r.x, top: r.y, width: r.largura, height: r.altura }}
      {...(i === 0 && primeira === pagina ? { tabIndex: 0, role: 'button', 'aria-label': m.comentario?.rotulo ?? m.ancora.citacao } : { 'aria-hidden': true })} />);
  })}</div>;
}
