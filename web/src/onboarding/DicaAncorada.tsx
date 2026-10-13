import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui/Icon';
import { Button, IconButton } from '../ui/Primitives';
import './onboarding.css';

export interface Caixa { x: number; y: number; largura: number; altura: number }
export interface Janela { largura: number; altura: number }
export type Lado = 'abaixo' | 'acima' | 'folha';

const MARGEM = 12;
const AFASTAMENTO = 12;
/** Abaixo desta largura a dica vira uma folha presa ao pé da tela. */
export const LARGURA_DA_FOLHA = 600;

/**
 * Onde a dica fica, dados o alvo, o tamanho da dica e a janela (puro, testável). Prefere abaixo do
 * alvo; sem espaço, acima; sem alvo ou em tela estreita, vira folha no pé da tela. Nunca sai da janela.
 */
export function posicionarDica(alvo: Caixa | null, dica: { largura: number; altura: number }, janela: Janela): { lado: Lado; x: number; y: number; seta: number | null } {
  if (alvo === null || janela.largura < LARGURA_DA_FOLHA) return { lado: 'folha', x: 0, y: 0, seta: null };
  const largura = Math.min(dica.largura, janela.largura - 2 * MARGEM);
  const centro = alvo.x + alvo.largura / 2;
  const x = Math.max(MARGEM, Math.min(centro - largura / 2, janela.largura - largura - MARGEM));
  const seta = Math.max(20, Math.min(centro - x, largura - 20));
  const abaixo = alvo.y + alvo.altura + AFASTAMENTO;
  if (abaixo + dica.altura <= janela.altura - MARGEM) return { lado: 'abaixo', x, y: abaixo, seta };
  const acima = alvo.y - AFASTAMENTO - dica.altura;
  if (acima >= MARGEM) return { lado: 'acima', x, y: acima, seta };
  // O alvo ocupa a tela toda (um parágrafo longo, a coluna de texto): a dica fica dentro dele, embaixo.
  return { lado: 'acima', x, y: Math.max(MARGEM, janela.altura - dica.altura - MARGEM), seta: null };
}

export interface PropsDaDica {
  /** Seletores do alvo, em ordem de preferência; o primeiro visível vence. Nenhum: a dica fica solta. */
  alvos: readonly string[];
  titulo: string;
  children: ReactNode;
  passo: number;
  total: number;
  aoAvancar: () => void;
  aoVoltar: () => void;
  /** Esc e o "×": encerra o tour (reabrível em Primeiros passos). */
  aoFechar: () => void;
  rotuloFinal?: string;
  extra?: ReactNode;
}

function visivel(elemento: Element): boolean {
  const caixa = elemento.getBoundingClientRect();
  return caixa.width > 0 && caixa.height > 0;
}

export function encontrarAlvo(alvos: readonly string[], raiz: ParentNode = document): HTMLElement | null {
  for (const seletor of alvos) {
    const encontrado = [...raiz.querySelectorAll<HTMLElement>(seletor)].find(visivel);
    if (encontrado) return encontrado;
  }
  return null;
}

/**
 * Dica ancorada a um elemento da tela: um diálogo não modal (a página continua utilizável), com
 * contorno no alvo, foco no botão principal, Tab circulando dentro da dica, Esc para fechar e as
 * setas ← → para voltar e avançar. Ao fechar, o foco volta para onde estava.
 */
export function DicaAncorada({ alvos, titulo, children, passo, total, aoAvancar, aoVoltar, aoFechar, rotuloFinal = 'Concluir', extra }: PropsDaDica): ReactNode {
  const raiz = useRef<HTMLDivElement>(null);
  const principal = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [alvo, definirAlvo] = useState<Caixa | null>(null);
  const [posicao, posicionar] = useState<ReturnType<typeof posicionarDica>>({ lado: 'folha', x: 0, y: 0, seta: null });
  const chaveDosAlvos = alvos.join('|');

  // Leva o alvo à vista uma vez por passo, sem animação quando o sistema pede menos movimento.
  useEffect(() => {
    const elemento = encontrarAlvo(alvos);
    if (!elemento) return;
    const caixa = elemento.getBoundingClientRect();
    if (caixa.top < 64 || caixa.bottom > window.innerHeight - 160) {
      const reduzir = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      elemento.scrollIntoView?.({ block: 'center', behavior: reduzir ? 'auto' : 'smooth' });
    }
  }, [chaveDosAlvos]);

  useLayoutEffect(() => {
    const medir = () => {
      const elemento = encontrarAlvo(alvos);
      const caixa = elemento?.getBoundingClientRect();
      const medida = caixa ? { x: caixa.left, y: caixa.top, largura: caixa.width, altura: caixa.height } : null;
      definirAlvo(medida);
      const dica = raiz.current?.getBoundingClientRect();
      posicionar(posicionarDica(medida, { largura: 360, altura: dica?.height ?? 200 }, { largura: window.innerWidth, altura: window.innerHeight }));
    };
    medir();
    window.addEventListener('resize', medir); window.addEventListener('scroll', medir, true);
    const observador = typeof ResizeObserver === 'function' ? new ResizeObserver(medir) : null;
    if (raiz.current) observador?.observe(raiz.current);
    return () => { window.removeEventListener('resize', medir); window.removeEventListener('scroll', medir, true); observador?.disconnect(); };
  }, [chaveDosAlvos, passo]);

  // O foco entra na dica ao abrir e volta para onde estava ao fechar o tour.
  useEffect(() => {
    const anterior = document.activeElement;
    return () => { if (anterior instanceof HTMLElement && anterior.isConnected) anterior.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { principal.current?.focus({ preventScroll: true }); }, [passo]);

  const ultimo = passo === total - 1;
  const teclado = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); aoFechar(); return; }
    if (e.key === 'ArrowRight' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); e.stopPropagation(); aoAvancar(); return; }
    if (e.key === 'ArrowLeft' && passo > 0) { e.preventDefault(); e.stopPropagation(); aoVoltar(); return; }
    if (e.key !== 'Tab') return;
    const focaveis = [...(raiz.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href]') ?? [])];
    const primeiro = focaveis[0]; const final = focaveis.at(-1);
    if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); final?.focus(); }
    else if (!e.shiftKey && document.activeElement === final) { e.preventDefault(); primeiro?.focus(); }
  };

  return createPortal(<>
    {alvo && <div className="contorno-da-dica" aria-hidden="true" style={{ left: alvo.x - 6, top: alvo.y - 6, width: alvo.largura + 12, height: alvo.altura + 12 }} />}
    <div ref={raiz} role="dialog" aria-modal="false" aria-labelledby={`${id}-titulo`} aria-describedby={`${id}-texto`}
      className="dica-ancorada" data-lado={posicao.lado} onKeyDown={teclado}
      style={posicao.lado === 'folha' ? undefined : { left: posicao.x, top: posicao.y }}>
      {posicao.seta !== null && <span className="seta-da-dica" aria-hidden="true" style={{ left: posicao.seta }} />}
      <header>
        <span className="eyebrow">Dica {passo + 1} de {total}</span>
        <IconButton aria-label="Fechar as dicas" title="Fechar as dicas (Esc)" onClick={aoFechar}><Icon name="xis" size={16} /></IconButton>
      </header>
      <h2 id={`${id}-titulo`}>{titulo}</h2>
      <div id={`${id}-texto`} className="dica-texto">{children}</div>
      {extra}
      <footer>
        <span className="pontos-das-telas" aria-hidden="true">{Array.from({ length: total }, (_, i) => <span key={i} data-atual={i === passo} />)}</span>
        <div className="button-row">
          {passo > 0 && <Button variante="ghost" className="small" onClick={aoVoltar}>Voltar</Button>}
          <Button ref={principal} variante="primario" className="small" onClick={aoAvancar}>{ultimo ? rotuloFinal : 'Próxima'}</Button>
        </div>
      </footer>
    </div>
  </>, document.body);
}
