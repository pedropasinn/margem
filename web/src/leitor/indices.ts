import type { AncoraV1, PalavraGeometria } from '@margem/contratos';
import { quadsDaAncora } from '../../../core/src/geometria';

/** Mantém a ordem original dentro de cada grupo (inclusive a precedência das marcas). */
export function agruparPor<T, K>(itens: readonly T[], chave: (item: T) => K): Map<K, T[]> {
  const mapa = new Map<K, T[]>();
  for (const item of itens) {
    const k = chave(item), grupo = mapa.get(k);
    if (grupo) grupo.push(item); else mapa.set(k, [item]);
  }
  return mapa;
}

/** Geometria imutável em coordenadas PDF: independe de zoom, rolagem e marca ativa. */
export function consultarQuads(versao_id: string, porBloco: ReadonlyMap<string, PalavraGeometria[]>) {
  const cache = new WeakMap<AncoraV1, ReturnType<typeof quadsDaAncora>>();
  return (ancora: AncoraV1): ReturnType<typeof quadsDaAncora> => {
    let valor = cache.get(ancora);
    if (!valor) { valor = quadsDaAncora(ancora, { versao_id, palavras: porBloco.get(ancora.bloco_id) ?? [] }); cache.set(ancora, valor); }
    return valor;
  };
}
export function porPaginaDaAncora<T extends { ancora: AncoraV1 }>(itens: readonly T[], quads: ReturnType<typeof consultarQuads>): Map<number, T[]> {
  const mapa = new Map<number, T[]>();
  for (const item of itens) for (const pagina of quads(item.ancora)) {
    const grupo = mapa.get(pagina.pagina);
    if (grupo) grupo.push(item); else mapa.set(pagina.pagina, [item]);
  }
  return mapa;
}
