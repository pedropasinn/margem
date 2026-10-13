import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Traco } from './tracos';
import './marcador.css';

const vistas = new Set<string>();
function jaVista(id: string): boolean {
  if (vistas.has(id)) return true;
  try { return sessionStorage.getItem(`margem:animada:${id}`) === '1'; } catch { return false; }
}
function registrar(id: string): void {
  vistas.add(id);
  try { sessionStorage.setItem(`margem:animada:${id}`, '1'); } catch { /* A sessão em memória basta. */ }
}

/** Uma animação por marca na sessão, inclusive ao recarregar ou trocar filtros. */
/** Quanto o traço leva para se desenhar: devagar o bastante para se ver a mão passando. */
export const DURACAO_DO_TRACO_MS = 800;

export const Desenho = memo(function Desenho({ id, caminhos, animacao = true, duracao = DURACAO_DO_TRACO_MS, opacidade = .3 }: {
  id: string; caminhos: readonly Traco[]; animacao?: boolean; duracao?: number; opacidade?: number;
}): ReactNode {
  const grupo = useRef<SVGGElement>(null);
  const [estado, definirEstado] = useState<'aguardando' | 'desenhando' | 'pronta'>('pronta');
  useEffect(() => {
    const movimento = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    let observador: IntersectionObserver | undefined;
    const preparar = () => {
      observador?.disconnect();
      if (!animacao || duracao <= 0 || movimento?.matches || jaVista(id) || typeof IntersectionObserver !== 'function') {
        definirEstado('pronta');
        return;
      }
      definirEstado('aguardando');
      observador = new IntersectionObserver((entradas) => {
        if (!entradas.some((entrada) => entrada.isIntersecting)) return;
        registrar(id);
        definirEstado('desenhando');
        observador?.disconnect();
      });
      if (grupo.current) observador.observe(grupo.current);
    };
    preparar();
    movimento?.addEventListener?.('change', preparar);
    return () => { observador?.disconnect(); movimento?.removeEventListener?.('change', preparar); };
  }, [id, animacao, duracao]);
  return (
    <g ref={grupo} data-desenho={id} data-animacao={estado}
      style={{ '--duracao-marca': `${duracao}ms` } as CSSProperties}
      onAnimationEnd={() => { definirEstado('pronta'); }}>
      {caminhos.map((traco, indice) => (
        <path key={indice} d={traco.d} fill={traco.preenchido ? traco.cor : 'none'}
          stroke={traco.preenchido ? 'none' : traco.cor} strokeWidth={traco.espessura}
          strokeLinecap="round" strokeLinejoin="round" pathLength={traco.tracejado === true ? undefined : 1}
          strokeDasharray={traco.tracejado === true ? '1 4' : undefined}
          opacity={traco.preenchido ? opacidade : Math.min(1, opacidade + .5)}
          className={traco.preenchido ? 'traco-faixa' : traco.tracejado === true ? 'traco-tracejado' : 'traco-linha'} />
      ))}
    </g>
  );
});
