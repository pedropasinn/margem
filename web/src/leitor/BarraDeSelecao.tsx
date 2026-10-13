import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { SelecaoDoLeitor } from './selecao';

/** A largura acompanha ações, fontes e viewport; o aviso não quebra a linha de ações. */
export function BarraDeSelecao({ selecao, children }: { selecao: SelecaoDoLeitor; children: ReactNode }) {
  const raiz = useRef<HTMLDivElement>(null);
  const [posicao, posicionar] = useState({ left: 12, top: 12 });
  useLayoutEffect(() => {
    const medir = () => {
      const caixa = raiz.current?.getBoundingClientRect();
      posicionar({
        left: Math.max(12, Math.min(selecao.caixa?.left ?? 12, window.innerWidth - (caixa?.width ?? 0) - 12)),
        top: Math.max(12, Math.min((selecao.caixa?.bottom ?? 0) + 8, window.innerHeight - (caixa?.height ?? 40) - (selecao.aparada ? 48 : 12))),
      });
    };
    medir();
    const observador = typeof ResizeObserver === 'function' ? new ResizeObserver(medir) : null;
    if (raiz.current) observador?.observe(raiz.current);
    window.addEventListener('resize', medir);
    return () => { observador?.disconnect(); window.removeEventListener('resize', medir); };
  }, [selecao, children]);
  return <div ref={raiz} className="barra-selecao" role="toolbar" aria-label="Ações da seleção" style={posicao} onPointerDown={(evento) => evento.preventDefault()}>
    {children}
    {selecao.aparada && <p className="aviso-selecao" role="status">Seleção aparada ao primeiro bloco.</p>}
  </div>;
}

const TRACOS = {
  grifar: 'm5 15 9-11 6 6-11 9H5v-4Zm-2 6h11',
  anotar: 'M4 4h16v12H9l-5 4V4Zm4 5h8m-8 4h5',
  perguntar: 'M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v.1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  conectar: 'm10 14 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 10a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1',
  resolver: 'M5 3h14v18H5V3Zm3 5h8m-8 5 2 2 5-5',
  imagem: 'M4 5h16v14H4V5Zm0 11 5-5 4 4 2-2 5 5M15.5 9.5v.1',
  fluxograma: 'M9 3h6v5H9V3Zm-5 13h6v5H4v-5Zm10 0h6v5h-6v-5ZM12 8v4m-5 4v-4h10v4',
  flashcard: 'M8 3h11a2 2 0 0 1 2 2v10M5 7h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z',
  fechar: 'm6 6 12 12M6 18 18 6',
};
export function IconeDaSelecao({ nome }: { nome: keyof typeof TRACOS }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={TRACOS[nome]} /></svg>;
}
