import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Desenho, DURACAO_DO_TRACO_MS } from './Desenho';
import { retangulosDosTrechos } from './geometria';
import { tracos, type OpcoesDoTraco, type Retangulo } from './tracos';

export interface PropsDoDestaque extends OpcoesDoTraco {
  children: ReactNode;
  duracao?: number;
  animacao?: boolean;
  opacidade?: number;
}
export function Destaque({ children, duracao = DURACAO_DO_TRACO_MS, animacao = true, opacidade = .3, ...opcoes }: PropsDoDestaque): ReactNode {
  const id = useId();
  const raiz = useRef<HTMLSpanElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const texto = useRef<HTMLSpanElement>(null);
  const [linhas, definirLinhas] = useState<Retangulo[]>([]);
  useLayoutEffect(() => {
    const elemento = raiz.current;
    const conteudo = texto.current;
    if (!elemento || !conteudo) return;
    let vivo = true;
    const medir = () => {
      if (vivo) definirLinhas(retangulosDosTrechos([conteudo], (svg.current ?? elemento).getBoundingClientRect()));
    };
    medir();
    const observador = typeof ResizeObserver === 'function' ? new ResizeObserver(medir) : null;
    // Um inline não dispara ResizeObserver de forma confiável; observe seu bloco também.
    observador?.observe(elemento.parentElement ?? elemento);
    window.addEventListener('resize', medir);
    void document.fonts?.ready.then(medir);
    return () => { vivo = false; observador?.disconnect(); window.removeEventListener('resize', medir); };
  }, [children]);
  return (
    <span className="destaque" ref={raiz}>
      <span ref={texto}>{children}</span>
      <svg ref={svg} className="destaque-svg" aria-hidden="true">
        {linhas.length > 0 && <Desenho id={`destaque:${id}`} caminhos={tracos(linhas, { ...opcoes, semente: opcoes.semente ?? id })}
          duracao={duracao} animacao={animacao} opacidade={opacidade} />}
      </svg>
    </span>
  );
}
