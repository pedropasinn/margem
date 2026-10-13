/** Range inclui texto fora de overflow:hidden; as projeções da dobra só expõem sua janela. */
export function caixasVisiveis(elemento: Element, caixas: readonly DOMRect[]): DOMRect[] {
  const janela = elemento.closest<HTMLElement>('[data-recorte-texto]');
  if (!janela) return [...caixas];
  const limite = janela.getBoundingClientRect();
  return caixas.flatMap((r) => {
    const x = Math.max(r.left, limite.left); const y = Math.max(r.top, limite.top);
    const direita = Math.min(r.right, limite.right); const base = Math.min(r.bottom, limite.bottom);
    return direita > x && base > y ? [new DOMRect(x, y, direita - x, base - y)] : [];
  });
}
