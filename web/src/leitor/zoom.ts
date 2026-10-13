/**
 * Zoom do PDF: passos fixos, como num leitor de PDF, a partir da escala atual (que, em "ajustar à
 * largura", é a da largura). O zoom é uma preferência (`zoomPdf`): número, ou `largura`.
 */
export const PASSOS_DO_ZOOM = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
export const ZOOM_MINIMO = 0.5;
export const ZOOM_MAXIMO = 3;

/** O próximo passo acima (1) ou abaixo (−1) da escala atual; nas pontas, a própria ponta. */
export function proximoZoom(atual: number, direcao: 1 | -1): number {
  const folga = 0.005;
  if (direcao === 1) return PASSOS_DO_ZOOM.find((passo) => passo > atual + folga) ?? ZOOM_MAXIMO;
  return [...PASSOS_DO_ZOOM].reverse().find((passo) => passo < atual - folga) ?? ZOOM_MINIMO;
}
