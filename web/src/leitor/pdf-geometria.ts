import type { GeometriaV1 } from '@margem/contratos';
import type { Retangulo } from '../ui/marcador/tracos';
export type PaginaPdf = GeometriaV1['paginas'][number];
export type PalavraPdf = GeometriaV1['palavras'][number];
export type GeometriaPdf = Omit<GeometriaV1, 'versao'>;
/** PyMuPDF: pontos não rotacionados, origem superior esquerda. */
export function pontoNaTela(x: number, y: number, pagina: PaginaPdf, escala: number): [number, number] {
  switch (pagina.rotacao) {
    case 90: return [(pagina.altura - y) * escala, x * escala];
    case 180: return [(pagina.largura - x) * escala, (pagina.altura - y) * escala];
    case 270: return [y * escala, (pagina.largura - x) * escala];
    default: return [x * escala, y * escala];
  }
}
export function pontoNoPdf(x: number, y: number, pagina: PaginaPdf, escala: number): [number, number] {
  x /= escala; y /= escala;
  switch (pagina.rotacao) {
    case 90: return [y, pagina.altura - x];
    case 180: return [pagina.largura - x, pagina.altura - y];
    case 270: return [pagina.largura - y, x];
    default: return [x, y];
  }
}
export function caixaDosPontos(pontos: readonly [number, number][]): Retangulo {
  const xs = pontos.map(([x]) => x); const ys = pontos.map(([, y]) => y);
  const x = Math.min(...xs); const y = Math.min(...ys);
  return { x, y, largura: Math.max(...xs) - x, altura: Math.max(...ys) - y };
}
export function quadNaTela(quad: PalavraPdf['quad'], pagina: PaginaPdf, escala: number): Retangulo {
  return caixaDosPontos([0, 2, 4, 6].map((i) => pontoNaTela(quad[i]!, quad[i + 1]!, pagina, escala)));
}
export function caixaNoPdf(caixa: DOMRect, base: DOMRect, pagina: PaginaPdf, escala: number): Retangulo {
  return caixaDosPontos([[caixa.left, caixa.top], [caixa.right, caixa.top], [caixa.right, caixa.bottom], [caixa.left, caixa.bottom]].map(([x, y]) => pontoNoPdf(x! - base.left, y! - base.top, pagina, escala)));
}
export function tamanhoDaPagina(pagina: PaginaPdf, escala: number): { largura: number; altura: number } {
  const girada = pagina.rotacao === 90 || pagina.rotacao === 270;
  return { largura: (girada ? pagina.altura : pagina.largura) * escala, altura: (girada ? pagina.largura : pagina.altura) * escala };
}

/** Mede somente texto selecionado: canvas e caixas de páginas não viram seleção semântica. */
export function retangulosDoTextoPdf(intervalo: Range, pagina: HTMLElement): DOMRect[] {
  const caixas: DOMRect[] = [];
  for (const span of pagina.querySelectorAll('.textLayer span')) {
    if (!span.textContent?.trim() || !intervalo.intersectsNode(span)) continue;
    const trecho = pagina.ownerDocument.createRange();
    trecho.selectNodeContents(span);
    if (intervalo.compareBoundaryPoints(Range.START_TO_START, trecho) > 0) trecho.setStart(intervalo.startContainer, intervalo.startOffset);
    if (intervalo.compareBoundaryPoints(Range.END_TO_END, trecho) < 0) trecho.setEnd(intervalo.endContainer, intervalo.endOffset);
    if (!trecho.collapsed) caixas.push(...trecho.getClientRects());
  }
  return caixas.filter((r) => r.width > 0 && r.height > 0);
}
