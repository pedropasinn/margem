/**
 * Fluxograma Mermaid de um visual (J70), desenhado no navegador.
 *
 * Três barreiras antes de chegar à página: (1) o código passa de novo pela régua do core
 * (`conferirFluxograma`: só `flowchart TD`, sem diretivas, cliques, estilos nem HTML nos rótulos);
 * (2) o Mermaid roda com `securityLevel: 'strict'` e rótulos em SVG puro (`htmlLabels: false`);
 * (3) o SVG resultante passa pelo DOMPurify (perfil SVG, sem `foreignObject`, links nem
 * manipuladores) e entra como nó importado. Nada do modelo vai para `innerHTML`.
 */
import DOMPurify from 'dompurify';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AncoraV1, NoDoDiagramaV1 } from '@margem/contratos';
import { conferirFluxograma } from '@margem/core/fluxograma';

export type Renderizador = (id: string, codigo: string, escuro: boolean) => Promise<string>;

let contador = 0;
/** O Mermaid é pesado: só é carregado quando o primeiro diagrama aparece. */
export const renderizarMermaid: Renderizador = async (id, codigo, escuro) => {
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: escuro ? 'dark' : 'neutral',
    htmlLabels: false,
    // Caixas mais largas e baixas (J132): o rótulo quebra em linhas de até 220 px, sem cortar.
    flowchart: { htmlLabels: false, useMaxWidth: false, curve: 'basis', padding: 14, nodeSpacing: 32, rankSpacing: 40, wrappingWidth: 220 },
    fontFamily: '"Figtree Variable", system-ui, sans-serif',
    fontSize: 14,
  });
  const { svg } = await mermaid.render(id, codigo);
  return svg;
};

/**
 * A orientação do desenho (J132): o código conferido é sempre `flowchart TD`; com poucos nós (até
 * `NOS_NA_HORIZONTAL`), o desenho sai da esquerda para a direita, que cabe melhor no painel e na tela.
 * Só o cabeçalho muda, depois da conferência.
 */
export const NOS_NA_HORIZONTAL = 5;
export function orientarFluxograma(codigo: string, nos: number): string {
  return nos <= NOS_NA_HORIZONTAL ? codigo.replace(/^(\s*)flowchart TD\b/u, '$1flowchart LR') : codigo;
}

/** O SVG higienizado como elemento pronto para `appendChild`; `null` se não sobrar um `<svg>`. */
export function svgSeguro(svg: string, documento: Document = document): SVGSVGElement | null {
  const fragmento = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['foreignObject', 'a', 'script', 'iframe', 'image', 'use'],
    FORBID_ATTR: ['href', 'xlink:href', 'onclick', 'onload', 'onerror', 'onmouseover'],
    RETURN_DOM_FRAGMENT: true,
  });
  const raiz = fragmento.querySelector('svg');
  return raiz ? documento.importNode(raiz, true) : null;
}

/** Id do nó do Mermaid a partir do elemento `g.node` (`…flowchart-<ID>-<n>`). */
export function idDoNo(elemento: Element): string | null {
  const direto = elemento.getAttribute('data-id');
  if (direto && /^[A-Za-z][A-Za-z0-9_]{0,31}$/u.test(direto)) return direto;
  return /flowchart-([A-Za-z][A-Za-z0-9_]{0,31})-\d+$/u.exec(elemento.id)?.[1] ?? null;
}

export function temaEscuro(): boolean {
  const tema = document.documentElement.dataset.tema;
  if (tema === 'escuro') return true;
  if (tema === 'claro' || tema === 'sepia') return false;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export interface PropsDoDiagrama {
  /** Id do visual; entra no id do SVG. */
  id: string;
  codigo: string;
  nos: readonly NoDoDiagramaV1[];
  /** Com ele, os nós que têm trecho viram botões que levam ao texto. */
  aoCitar?: (ancora: AncoraV1) => void;
  className?: string;
  renderizar?: Renderizador;
}

export function DiagramaMermaid({ id, codigo, nos, aoCitar, className = '', renderizar = renderizarMermaid }: PropsDoDiagrama): ReactNode {
  const caixa = useRef<HTMLDivElement>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [pronto, definirPronto] = useState(false);
  const aoCitarRef = useRef(aoCitar); aoCitarRef.current = aoCitar;
  // A lista chega nova a cada releitura da fila: redesenhar só quando o conteúdo muda.
  const nosRef = useRef(nos); nosRef.current = nos;
  const chaveDosNos = JSON.stringify(nos);
  useEffect(() => {
    let vivo = true;
    const alvo = caixa.current;
    definirErro(null); definirPronto(false);
    const conferencia = conferirFluxograma(codigo);
    if (!conferencia.ok) { definirErro(`Fluxograma recusado na linha ${String(conferencia.linha)}: ${conferencia.erro}.`); return; }
    contador += 1;
    void renderizar(`mermaid-${id}-${String(contador)}`, orientarFluxograma(codigo, conferencia.nos.length), temaEscuro()).then((texto) => {
      if (!vivo || !alvo) return;
      const svg = svgSeguro(texto);
      if (!svg) { definirErro('O desenho do fluxograma veio vazio.'); return; }
      svg.removeAttribute('style');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Fluxograma');
      const porId = new Map(nosRef.current.map((no) => [no.id, no]));
      for (const elemento of svg.querySelectorAll('g.node')) {
        const no = porId.get(idDoNo(elemento) ?? '');
        if (!no?.ancora || !aoCitarRef.current) continue;
        const ancora = no.ancora;
        elemento.setAttribute('role', 'button');
        elemento.setAttribute('tabindex', '0');
        elemento.setAttribute('aria-label', `${no.rotulo} — ir ao trecho`);
        elemento.classList.add('no-com-trecho');
        elemento.addEventListener('click', () => aoCitarRef.current?.(ancora));
        elemento.addEventListener('keydown', (evento) => {
          if ((evento as KeyboardEvent).key === 'Enter' || (evento as KeyboardEvent).key === ' ') { evento.preventDefault(); aoCitarRef.current?.(ancora); }
        });
      }
      alvo.replaceChildren(svg);
      definirPronto(true);
    }, (falha: unknown) => {
      if (vivo) definirErro(falha instanceof Error ? `O Mermaid não desenhou o fluxograma: ${falha.message}` : 'O Mermaid não desenhou o fluxograma.');
    });
    return () => { vivo = false; alvo?.replaceChildren(); };
  }, [id, codigo, chaveDosNos, renderizar]);
  return <div className={`diagrama-mermaid ${className}`} data-pronto={pronto || undefined}>
    {erro !== null && <p className="erro-do-visual" role="alert">{erro}</p>}
    {!pronto && erro === null && <p className="estado-do-visual" role="status">Desenhando…</p>}
    <div ref={caixa} className="svg-do-diagrama" />
  </div>;
}
