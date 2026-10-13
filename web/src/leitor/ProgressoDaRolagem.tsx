import { useEffect, useRef, type ReactNode } from 'react';
import { nomeDaUnidade, usarForma } from './forma';

/**
 * Atualiza só a faixa, sem renderizar ou medir as marcas a cada rolagem. O artigo pode ainda não
 * existir quando a barra monta: o leitor de PDF carrega depois ("Abrindo PDF…"). A barra espera ele
 * aparecer (e acompanha se for trocado) em vez de desistir.
 */
export function ProgressoDaRolagem({ raiz }: { raiz: HTMLElement | null }): ReactNode {
  const faixa = useRef<HTMLDivElement>(null);
  const unidade = nomeDaUnidade(usarForma());
  useEffect(() => {
    if (!raiz) return;
    let quadro = 0;
    let artigo: Element | null = null;
    const tamanho = typeof ResizeObserver === 'function' ? new ResizeObserver(() => agendar()) : null;
    const medir = () => {
      if (!artigo) return;
      const caixa = artigo.getBoundingClientRect();
      const total = Math.max(1, caixa.height - window.innerHeight);
      const fracao = Math.max(0, Math.min(1, -caixa.top / total));
      faixa.current?.style.setProperty('--progresso-capitulo', String(fracao));
      faixa.current?.setAttribute('aria-valuenow', String(Math.round(fracao * 100)));
    };
    const agendar = () => { cancelAnimationFrame(quadro); quadro = requestAnimationFrame(medir); };
    const localizar = () => {
      const atual = raiz.querySelector('.capitulo');
      if (atual === artigo) return;
      if (artigo) tamanho?.unobserve(artigo);
      artigo = atual;
      if (artigo) { tamanho?.observe(artigo); medir(); }
    };
    localizar();
    const estrutura = new MutationObserver(localizar);
    estrutura.observe(raiz, { childList: true, subtree: true });
    window.addEventListener('scroll', agendar, { passive: true });
    window.addEventListener('resize', agendar);
    // O PDF desenha as páginas depois de montar: a altura do artigo muda com a geometria.
    window.addEventListener('margem:geometria', agendar);
    return () => {
      cancelAnimationFrame(quadro); estrutura.disconnect(); tamanho?.disconnect();
      window.removeEventListener('scroll', agendar); window.removeEventListener('resize', agendar); window.removeEventListener('margem:geometria', agendar);
    };
  }, [raiz]);
  return <div className="progresso-capitulo" ref={faixa} role="progressbar" aria-label={`Rolagem do ${unidade}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}><span /></div>;
}
