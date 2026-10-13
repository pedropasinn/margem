import type { PDFDocumentProxy } from 'pdfjs-dist';
import { caixasVisiveis } from './caixas-visiveis';
import { forwardRef, useImperativeHandle, useRef, type ReactNode } from 'react';
import type { Id } from '@margem/contratos';
import { ancoraDaSelecao } from './selecao';
import { ChapterContent } from './ChapterContent';
import { intervaloDoOffset, pontoDoNo, retanguloDoIntervalo, segmentosDoBloco } from './posicao';
import type { ApiDoLeitor, EstrategiaDeLayout, PontoDeTexto, SnapshotCapitulo } from './tipos';

export interface PropsDoLeitor {
  aoMudarDocumentoPdf?: (documento: PDFDocumentProxy | null) => void;
  aoMudarEscala?: (escala: number) => void;
  aoMudarMargem?: (disponivel: boolean) => void;
  /** Só no PDF: o total de páginas do arquivo, para a posição no centro da barra. */
  aoMudarTotalDePaginas?: (total: number) => void;
  snapshot: SnapshotCapitulo;
  /** `scroll` é a única estratégia de F1; nenhuma muda o texto nem os identificadores. */
  estrategia?: EstrategiaDeLayout;
  /** Marca ativa (J09): o sublinhado do trecho acompanha o da nota. */
  ativa?: Id | null;
  /** Coluna da direita (J09: `MarginNotes`); vive dentro da grade, sem empurrar o texto. */
  margem?: ReactNode;
  /** Fim do capítulo, na coluna do texto (J09: concluir capítulo e aviso de progresso). */
  rodape?: ReactNode;
  /** Logo abaixo do título, no texto único: autor e tempo de leitura, como a abertura de um artigo. */
  abertura?: ReactNode;
  /** O número de cada nota na margem, por marca: a dobra do PDF mostra os mesmos números ao lado dos recortes. */
  numerosDasNotas?: ReadonlyMap<Id, number>;
}

interface PosicaoDeCursor {
  offsetNode: Node;
  offset: number;
}

interface DocumentoComCursor {
  caretPositionFromPoint?: (x: number, y: number) => PosicaoDeCursor | null;
}

function pontoPorCursor(raiz: HTMLElement, snapshot: SnapshotCapitulo, topo: number): PontoDeTexto | null {
  const documento: DocumentoComCursor = raiz.ownerDocument;
  if (typeof documento.caretPositionFromPoint !== 'function') return null;
  const caixa = raiz.getBoundingClientRect();
  const posicao = documento.caretPositionFromPoint(caixa.left + Math.min(24, caixa.width / 2), topo + 1);
  if (posicao === null || posicao === undefined || !raiz.contains(posicao.offsetNode)) return null;
  return pontoDoNo(posicao.offsetNode, posicao.offset, snapshot);
}

/** Alternativa para navegadores sem cursor por ponto: primeiro segmento cujo retângulo é visível. */
function pontoPorRetangulos(raiz: HTMLElement, snapshot: SnapshotCapitulo, topo: number): PontoDeTexto | null {
  let primeiro: PontoDeTexto | null = null;
  for (const bloco of snapshot.blocos) {
    for (const span of segmentosDoBloco(raiz, bloco.id)) {
      const ponto = pontoDoNo(span, 0, snapshot);
      if (ponto === null) continue;
      primeiro ??= ponto;
      const intervalo = raiz.ownerDocument.createRange();
      intervalo.selectNodeContents(span);
      if ((retanguloDoIntervalo(intervalo)?.bottom ?? 0) > topo) return ponto;
    }
  }
  return primeiro;
}

/**
 * Casca do leitor. Sem `max-width`: a largura que sobra vira a coluna da margem (J09).
 * Expõe por `ref` a geometria de uma posição textual e a âncora visível para retomada.
 */
export const ReaderViewport = forwardRef<ApiDoLeitor, PropsDoLeitor>(function ReaderViewport(
  { snapshot, estrategia = 'scroll', ativa = null, margem, rodape, abertura },
  ref,
): ReactNode {
  const raiz = useRef<HTMLDivElement>(null);

  useImperativeHandle(
    ref,
    (): ApiDoLeitor => ({
      selecao(selecao) { return raiz.current ? ancoraDaSelecao(selecao, raiz.current, snapshot) : null; },
      retangulosDaAncora(ancora) {
        if (!raiz.current) return [];
        const recortes = [...raiz.current.querySelectorAll<HTMLElement>(`[data-recorte-bloco="${ancora.bloco_id}"]`)];
        return (recortes.length ? recortes : [raiz.current]).flatMap((regiao) => {
          const inicio = intervaloDoOffset(regiao, ancora.bloco_id, ancora.inicio_utf16);
          const fim = intervaloDoOffset(regiao, ancora.bloco_id, ancora.fim_utf16);
          if (!inicio || !fim) return [];
          inicio.setEnd(fim.startContainer, fim.startOffset);
          return typeof inicio.getClientRects === 'function' ? caixasVisiveis(regiao, [...inicio.getClientRects()]) : [];
        });
      },
      localizar(blocoId: Id, offsetUtf16: number): DOMRect | null {
        const elemento = raiz.current;
        if (elemento === null) return null;
        const recortes = [...elemento.querySelectorAll<HTMLElement>(`[data-recorte-bloco="${blocoId}"]`)];
        for (const regiao of recortes.length ? recortes : [elemento]) {
          const intervalo = intervaloDoOffset(regiao, blocoId, offsetUtf16);
          const caixa = intervalo ? retanguloDoIntervalo(intervalo) : null;
          const visivel = caixa ? caixasVisiveis(regiao, [caixa])[0] : null;
          if (visivel) return visivel;
        }
        return null;
      },
      ancoraVisivel(): PontoDeTexto | null {
        const elemento = raiz.current;
        if (elemento === null) return null;
        // O que interessa é o primeiro texto visível na janela: com a página rolada, o topo da
        // casca fica acima dela e devolveria sempre o começo do capítulo (corrigido no J09).
        const topo = Math.max(elemento.getBoundingClientRect().top, 0);
        return pontoPorCursor(elemento, snapshot, topo) ?? pontoPorRetangulos(elemento, snapshot, topo);
      },
    }),
    [snapshot],
  );

  return (
    <div ref={raiz} className="leitor" data-estrategia={estrategia}>
      <ChapterContent snapshot={snapshot} ativa={ativa} abertura={abertura} />
      {margem}
      {rodape}
    </div>
  );
});
