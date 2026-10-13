import { segmentar } from './segmentos';
import type { Id } from '@margem/contratos';
import { offsetDeSegmento } from '@margem/core/segmentos';
import type { PontoDeTexto, SnapshotCapitulo } from './tipos';

/** Todos os nós de texto de um elemento, em ordem de documento. */
export function nosDeTexto(elemento: Element): Text[] {
  const nos: Text[] = [];
  const percurso = elemento.ownerDocument.createTreeWalker(elemento, NodeFilter.SHOW_TEXT);
  for (let no = percurso.nextNode(); no !== null; no = percurso.nextNode()) {
    if (no.nodeType === Node.TEXT_NODE) nos.push(no as Text);
  }
  return nos;
}

/** Os `span` de segmento de um bloco, na ordem em que foram renderizados. */
export function segmentosDoBloco(raiz: ParentNode, blocoId: Id): HTMLElement[] {
  const bloco = raiz.querySelector(`[data-bloco="${blocoId}"]`);
  if (bloco === null) return [];
  return [...bloco.querySelectorAll<HTMLElement>('span[data-inicio]')];
}

function inicioDe(span: HTMLElement): number {
  return Number(span.dataset['inicio'] ?? '0');
}

/** Converte (bloco, offset UTF-16) num `Range` do DOM, sem estimar por quantidade de caracteres. */
export function intervaloDoOffset(raiz: ParentNode, blocoId: Id, offsetUtf16: number): Range | null {
  const spans = segmentosDoBloco(raiz, blocoId);
  for (const [indice, span] of spans.entries()) {
    const inicio = inicioDe(span);
    const comprimento = span.textContent?.length ?? 0;
    const ultimo = indice === spans.length - 1;
    const dentro = offsetUtf16 >= inicio && (offsetUtf16 < inicio + comprimento || (ultimo && offsetUtf16 === inicio + comprimento));
    if (!dentro) continue;
    let restante = offsetUtf16 - inicio;
    for (const no of nosDeTexto(span)) {
      const tamanho = no.data.length;
      if (restante <= tamanho) {
        const intervalo = span.ownerDocument.createRange();
        intervalo.setStart(no, restante);
        intervalo.setEnd(no, Math.min(restante + 1, tamanho));
        return intervalo;
      }
      restante -= tamanho;
    }
  }
  return null;
}

/**
 * Converte um ponto do DOM (nó + deslocamento local) na identidade textual do canônico.
 * Usa `data-bloco`, `data-inicio` e `offsetDeSegmento` do núcleo; nunca reconta o texto.
 */
export function pontoDoNo(no: Node, deslocamento: number, snapshot: SnapshotCapitulo): PontoDeTexto | null {
  const elemento = no.nodeType === Node.ELEMENT_NODE ? (no as Element) : no.parentElement;
  const caixa = elemento?.closest<HTMLElement>('[data-bloco]') ?? null;
  const blocoId = caixa?.dataset['bloco'];
  if (!caixa || blocoId === undefined) return null;
  const bloco = snapshot.blocos.find((b) => b.id === blocoId);
  if (!bloco) return null;
  // Range trata corretamente limites em elementos (offset = índice do filho) e nós inline.
  const atePonto = caixa.ownerDocument.createRange();
  atePonto.selectNodeContents(caixa);
  try { atePonto.setEnd(no, deslocamento); } catch { return null; }
  const offset = atePonto.toString().length;
  const segmentos = segmentar(bloco, snapshot.marcas);
  const indice = segmentos.findIndex((s) => s.inicio_utf16 <= offset && offset <= s.fim_utf16);
  if (indice < 0) return null;
  const local = offset - segmentos[indice]!.inicio_utf16;
  return { bloco_id: blocoId, offset_utf16: offsetDeSegmento(segmentos.map((s) => ({ ...s, funcao: null })), indice, local) };
}

/**
 * Retângulo de um intervalo. `Range.getBoundingClientRect` não existe no jsdom; nesse caso
 * vale o retângulo do elemento que contém o intervalo, e a geometria fina fica para o navegador.
 */
export function retanguloDoIntervalo(intervalo: Range): DOMRect | null {
  if (typeof intervalo.getBoundingClientRect === 'function') return intervalo.getBoundingClientRect();
  const reserva = intervalo.startContainer.nodeType === Node.ELEMENT_NODE
    ? (intervalo.startContainer as Element)
    : intervalo.startContainer.parentElement;
  return reserva?.getBoundingClientRect() ?? null;
}
