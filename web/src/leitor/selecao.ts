import type { AncoraV1 } from '@margem/contratos';
import { ancoraDaFaixa } from './ancora';
import { pontoDoNo, retanguloDoIntervalo } from './posicao';
import type { SnapshotCapitulo } from './tipos';
export interface SelecaoDoLeitor { ancora: AncoraV1; aparada: boolean; caixa: DOMRect | null }
export function ancoraDaSelecao(selecao: Selection | null, raiz: HTMLElement, snapshot: SnapshotCapitulo): SelecaoDoLeitor | null {
  if (!selecao || selecao.isCollapsed || !selecao.rangeCount) return null;
  const intervalo = selecao.getRangeAt(0).cloneRange();
  if (!raiz.contains(intervalo.startContainer)) return null;
  const inicio = pontoDoNo(intervalo.startContainer, intervalo.startOffset, snapshot);
  if (!inicio) return null;
  const bloco = snapshot.blocos.find((b) => b.id === inicio.bloco_id);
  if (!bloco) return null;
  const fim = pontoDoNo(intervalo.endContainer, intervalo.endOffset, snapshot);
  const aparada = fim?.bloco_id !== inicio.bloco_id;
  const ancora = ancoraDaFaixa(bloco, snapshot.versao_id, inicio.offset_utf16, aparada ? bloco.texto.length : fim.offset_utf16);
  if (!ancora || !ancora.citacao.trim()) return null;
  if (aparada) {
    const elemento = raiz.querySelector(`[data-bloco="${bloco.id}"]`);
    if (elemento) intervalo.setEnd(elemento, elemento.childNodes.length);
  }
  return { ancora, aparada, caixa: retanguloDoIntervalo(intervalo) };
}
