import { nosDeTexto } from '../posicao';
import { recorteDaRegiao } from '../pdf-recortes';
import type { Faixa } from './geometria';

export interface RecorteDeTexto { elemento: HTMLElement; topo: number; altura: number; largura: number }

/** Usa as linhas reais do DOM e o mesmo limite de duas linhas do PDF. */
export function prepararRecortesDoTexto(raiz: HTMLElement, pontas: readonly { blocoId: string; faixa: Faixa }[]): RecorteDeTexto[] {
  const recortes: RecorteDeTexto[] = [];
  for (const ponta of pontas) {
    const elemento = raiz.querySelector<HTMLElement>(`[data-bloco="${ponta.blocoId}"]`);
    if (!elemento) continue;
    const caixa = elemento.getBoundingClientRect();
    if (caixa.height <= 0 || caixa.width <= 0) continue;
    const linhas = nosDeTexto(elemento).flatMap((no) => {
      if (!no.textContent?.trim()) return [];
      const intervalo = document.createRange(); intervalo.selectNodeContents(no);
      return typeof intervalo.getClientRects === 'function' ? [...intervalo.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({ y: r.top - caixa.top, altura: r.height })) : [];
    });
    if (!linhas.length) continue;
    const faixa = ponta.faixa;
    const recorte = recorteDaRegiao({ pagina: 0, escala: 1, largura: caixa.width, altura: caixa.height, linhasDaPagina: linhas,
      linhas: [{ x: 0, y: faixa.topo - caixa.top, largura: caixa.width, altura: faixa.base - faixa.topo }] }, caixa.height);
    recortes.push({ elemento, topo: recorte.y, altura: recorte.altura, largura: caixa.width });
  }
  // Duas citações no mesmo parágrafo: contextos sobrepostos viram um único recorte.
  const unidos: RecorteDeTexto[] = [];
  for (const recorte of recortes.sort((a, b) => a.elemento === b.elemento ? a.topo - b.topo : a.elemento.compareDocumentPosition(b.elemento) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)) {
    const anterior = unidos.at(-1);
    if (anterior && anterior.elemento === recorte.elemento && recorte.topo <= anterior.topo + anterior.altura) {
      anterior.altura = Math.max(anterior.altura, recorte.topo + recorte.altura - anterior.topo);
    } else unidos.push({ ...recorte });
  }
  return unidos;
}

/** Projeções descartáveis: o React continua dono dos blocos originais, que ficam ocultos. */
export function montarRecortesDoTexto(recortes: readonly RecorteDeTexto[]): HTMLElement[] {
  return recortes.map((recorte) => {
    const janela = document.createElement('div');
    janela.dataset['recorteTexto'] = '';
    janela.dataset['recorteBloco'] = recorte.elemento.dataset['bloco'];
    janela.style.height = `${recorte.altura}px`;
    janela.style.width = `${recorte.largura}px`;
    const copia = recorte.elemento.cloneNode(true) as HTMLElement;
    for (const elemento of [copia, ...copia.querySelectorAll('[id]')]) elemento.removeAttribute('id');
    copia.style.setProperty('margin', '0', 'important');
    copia.style.setProperty('width', `${recorte.largura}px`);
    copia.style.setProperty('box-sizing', 'border-box');
    copia.style.setProperty('position', 'relative');
    copia.style.setProperty('top', `${-recorte.topo}px`);
    janela.append(copia);
    recorte.elemento.before(janela);
    return janela;
  });
}
