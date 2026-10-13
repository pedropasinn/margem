/**
 * Geometria do karaokê: dos retângulos que `Range.getClientRects()` devolve (um por nó de texto, por
 * linha, com os vãos da justificação no meio) a um bloco arredondado por linha, em coordenadas do
 * artigo. Pura, para testar sem layout.
 */

export interface CaixaDaTela { left: number; top: number; width: number; height: number }
export interface Bloco { x: number; y: number; largura: number; altura: number }

/**
 * Um bloco por linha: junta os retângulos cujos centros verticais estão na mesma linha (a menos de
 * metade da altura do menor), do mais à esquerda ao mais à direita, e desconta a origem `base`.
 * `folga` alarga cada bloco (x para os lados, y para cima e para baixo), para a faixa não raspar as letras.
 */
export function blocosPorLinha(caixas: readonly CaixaDaTela[], base: { left: number; top: number }, folga: { x: number; y: number } = { x: 0, y: 0 }): Bloco[] {
  const validas = caixas.filter((c) => c.width > 0.5 && c.height > 0.5).sort((a, b) => a.top + a.height / 2 - (b.top + b.height / 2) || a.left - b.left);
  const linhas: { esquerda: number; direita: number; topo: number; base: number }[] = [];
  for (const c of validas) {
    const centro = c.top + c.height / 2;
    const linha = linhas.find((l) => Math.abs((l.topo + l.base) / 2 - centro) < Math.min(l.base - l.topo, c.height) / 2);
    if (linha) {
      linha.esquerda = Math.min(linha.esquerda, c.left); linha.direita = Math.max(linha.direita, c.left + c.width);
      linha.topo = Math.min(linha.topo, c.top); linha.base = Math.max(linha.base, c.top + c.height);
    } else linhas.push({ esquerda: c.left, direita: c.left + c.width, topo: c.top, base: c.top + c.height });
  }
  return linhas.sort((a, b) => a.topo - b.topo).map((l) => ({
    x: l.esquerda - base.left - folga.x,
    y: l.topo - base.top - folga.y,
    largura: l.direita - l.esquerda + 2 * folga.x,
    altura: l.base - l.topo + 2 * folga.y,
  }));
}

/** O bloco se afastou da área de leitura (acima da barra ou abaixo do player)? */
export function foraDaVista(blocos: readonly Bloco[], artigo: { top: number }, vista: { topo: number; base: number }): boolean {
  if (blocos.length === 0) return false;
  const topo = artigo.top + Math.min(...blocos.map((b) => b.y));
  const base = artigo.top + Math.max(...blocos.map((b) => b.y + b.altura));
  return base < vista.topo || topo > vista.base;
}
