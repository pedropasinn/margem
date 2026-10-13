import { caixasVisiveis } from '../../leitor/caixas-visiveis';
import type { Retangulo } from './tracos';

/** Junta fragmentos inline da mesma linha, sem unir linhas nem lacunas de subfaixas. */
export function retangulosDosTrechos(elementos: readonly Element[], base: DOMRect): Retangulo[] {
  const retangulos: Retangulo[] = [];
  for (const elemento of elementos) {
    const intervalo = document.createRange();
    intervalo.selectNodeContents(elemento);
    const caixas = typeof intervalo.getClientRects === 'function' ? [...intervalo.getClientRects()] : [];
    for (const r of caixasVisiveis(elemento, caixas)) {
      if (r.width <= 0 || r.height <= 0) continue;
      retangulos.push({ x: r.left - base.left, y: r.top - base.top, largura: r.width, altura: r.height });
    }
  }
  retangulos.sort((a, b) => a.y - b.y || a.x - b.x);
  const linhas: Retangulo[] = [];
  for (const r of retangulos) {
    const ultima = linhas[linhas.length - 1];
    if (ultima && Math.abs(ultima.y - r.y) < 3 && r.x <= ultima.x + ultima.largura + 1) {
      ultima.largura = Math.max(ultima.x + ultima.largura, r.x + r.largura) - ultima.x;
      ultima.altura = Math.max(ultima.altura, r.altura);
    } else linhas.push({ ...r });
  }
  return linhas;
}

/** Uma caixa por linha também para âncoras pessoais que atravessam segmentos inline. */
export function retangulosDoIntervalo(intervalo: Range, base: DOMRect): Retangulo[] {
  const caixas = typeof intervalo.getClientRects === 'function' ? [...intervalo.getClientRects()] : [];
  const linhas: Retangulo[] = [];
  const elemento = intervalo.startContainer instanceof Element ? intervalo.startContainer : intervalo.startContainer.parentElement;
  for (const r of (elemento ? caixasVisiveis(elemento, caixas) : caixas).filter((r) => r.width > 0 && r.height > 0).sort((a, b) => a.top - b.top || a.left - b.left)) {
    const atual = { x: r.left - base.left, y: r.top - base.top, largura: r.width, altura: r.height };
    const ultima = linhas.at(-1);
    if (ultima && Math.abs(ultima.y - atual.y) < 3 && atual.x <= ultima.x + ultima.largura + 1) {
      ultima.largura = Math.max(ultima.x + ultima.largura, atual.x + atual.largura) - ultima.x;
      ultima.altura = Math.max(ultima.altura, atual.altura);
    } else linhas.push(atual);
  }
  return linhas;
}

/**
 * No PDF, cada palavra chega como um retângulo próprio, e o grifo sairia picotado entre elas. Junta
 * os retângulos da mesma linha que estão próximos (vão menor que a altura da linha) num só.
 */
export function juntarPorLinha(retangulos: readonly Retangulo[]): Retangulo[] {
  const validos = [...retangulos].filter((r) => r.largura > 0 && r.altura > 0).sort((a, b) => a.y - b.y);
  // Primeiro as linhas (centros verticais próximos), depois as palavras de cada linha da esquerda para a direita.
  const grupos: Retangulo[][] = [];
  for (const r of validos) {
    const centro = r.y + r.altura / 2;
    const grupo = grupos.find((g) => g.some((o) => Math.abs(o.y + o.altura / 2 - centro) < Math.min(o.altura, r.altura) / 2));
    if (grupo) grupo.push(r); else grupos.push([r]);
  }
  const linhas: Retangulo[] = [];
  for (const grupo of grupos) {
    const feitas: Retangulo[] = [];
    for (const r of grupo.sort((a, b) => a.x - b.x)) {
      const ultima = feitas.at(-1);
      if (ultima && r.x - (ultima.x + ultima.largura) < Math.max(ultima.altura, r.altura)) {
        const topo = Math.min(ultima.y, r.y);
        const base = Math.max(ultima.y + ultima.altura, r.y + r.altura);
        ultima.largura = Math.max(ultima.x + ultima.largura, r.x + r.largura) - ultima.x;
        ultima.y = topo; ultima.altura = base - topo;
      } else feitas.push({ ...r });
    }
    linhas.push(...feitas);
  }
  return linhas;
}
