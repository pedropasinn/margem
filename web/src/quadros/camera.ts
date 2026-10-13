/**
 * A câmera sobre o quadro: um retângulo normalizado (0..1) da imagem inteira, o mesmo sistema das
 * regiões e das câmeras da análise curta. Zoom e arrasto só mudam esse retângulo; o SVG desenha a imagem
 * e as regiões no `viewBox` correspondente.
 */
import type { FormaDaRegiao, RetanguloDaObra } from '@margem/contratos';
import { limitesDaRegiao, QUADRO_INTEIRO } from '../../../core/src/arte';

export { QUADRO_INTEIRO };
/** O menor lado visível: 1/25 da imagem (zoom de 2500 %). */
export const LADO_MINIMO = 0.04;

const entre = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/** Mantém a câmera dentro da imagem (ou centrada nela, quando maior). */
export function limitarCamera(c: RetanguloDaObra): RetanguloDaObra {
  const largura = entre(c.largura, LADO_MINIMO, 1);
  const altura = entre(c.altura, LADO_MINIMO, 1);
  return { largura, altura, x: entre(c.x, 0, 1 - largura), y: entre(c.y, 0, 1 - altura) };
}

/** Quanto se vê ampliado: 1 = a imagem inteira. */
export function nivelDeZoom(c: RetanguloDaObra): number {
  return 1 / Math.max(c.largura, c.altura);
}

/** Zoom por `fator` (> 1 aproxima) em torno de um ponto da imagem (por padrão, o centro da câmera). */
export function zoomEm(c: RetanguloDaObra, fator: number, px = c.x + c.largura / 2, py = c.y + c.altura / 2): RetanguloDaObra {
  const escala = entre(1 / fator, LADO_MINIMO / Math.min(c.largura, c.altura), 1 / Math.max(c.largura, c.altura));
  const largura = c.largura * escala;
  const altura = c.altura * escala;
  return limitarCamera({ largura, altura, x: px - (px - c.x) * escala, y: py - (py - c.y) * escala });
}

/** Arrasto: desloca a câmera (em unidades da imagem). */
export function arrastar(c: RetanguloDaObra, dx: number, dy: number): RetanguloDaObra {
  return limitarCamera({ ...c, x: c.x + dx, y: c.y + dy });
}

/** A câmera que enquadra uma ou mais regiões, com folga em volta. */
export function enquadrar(formas: readonly FormaDaRegiao[], folga = 0.35): RetanguloDaObra {
  if (formas.length === 0) return QUADRO_INTEIRO;
  const caixas = formas.map(limitesDaRegiao);
  const x0 = Math.min(...caixas.map((c) => c.x)); const y0 = Math.min(...caixas.map((c) => c.y));
  const x1 = Math.max(...caixas.map((c) => c.x + c.largura)); const y1 = Math.max(...caixas.map((c) => c.y + c.altura));
  const lado = (v: number) => Math.min(1, Math.max(0.14, v * (1 + folga)));
  const largura = lado(x1 - x0); const altura = lado(y1 - y0);
  return limitarCamera({ largura, altura, x: (x0 + x1) / 2 - largura / 2, y: (y0 + y1) / 2 - altura / 2 });
}

export function interpolarCamera(a: RetanguloDaObra, b: RetanguloDaObra, u: number): RetanguloDaObra {
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, largura: a.largura + (b.largura - a.largura) * u, altura: a.altura + (b.altura - a.altura) * u };
}

export function mesmaCamera(a: RetanguloDaObra, b: RetanguloDaObra): boolean {
  return Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4 && Math.abs(a.largura - b.largura) < 1e-4 && Math.abs(a.altura - b.altura) < 1e-4;
}
