import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { ApiDoLeitor, SnapshotCapitulo } from './tipos';

/** Folga, em px, para considerar a rolagem no fim (arredondamentos do zoom e da barra do navegador). */
const FOLGA_DO_FIM_PX = 4;
function rolagemNoFim(): boolean {
  const pagina = document.documentElement;
  return window.scrollY + window.innerHeight >= pagina.scrollHeight - FOLGA_DO_FIM_PX;
}

/**
 * Quanto do documento já foi lido, só o percentual, discreto no canto. A posição é textual (funciona
 * também sobre a geometria do PDF original): a primeira palavra visível do capítulo. No fim da rolagem o
 * capítulo inteiro conta como lido; e, no último capítulo (ou com a última página do PDF na tela), o
 * documento chega a 100%: o fim do documento nunca fica em 96%.
 */
export function ProgressoNoLivro({ snapshot, leitor, concluido, ultimaParte = false }: {
  snapshot: SnapshotCapitulo; leitor: RefObject<ApiDoLeitor | null>; concluido: boolean;
  /** Este capítulo vai até o fim do documento (o último capítulo, ou a última página do PDF). */
  ultimaParte?: boolean;
}) {
  const contagem = useMemo(() => {
    let total = 0;
    const blocos = new Map(snapshot.blocos.map((bloco) => {
      const antes = total;
      const palavras = [...bloco.texto.matchAll(/\S+/g)].map((m) => m.index + m[0].length);
      total += palavras.length;
      return [bloco.id, { antes, palavras }] as const;
    }));
    return { total, blocos };
  }, [snapshot.blocos]);
  const [lidas, definirLidas] = useState(0);
  const [noFim, definirNoFim] = useState(false);
  useEffect(() => {
    definirLidas(0); definirNoFim(false);
    let quadro = 0;
    const atualizar = () => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(() => {
        // Só conta o fim quando há o que rolar: na abertura de um texto curto, nada foi lido ainda.
        definirNoFim(window.scrollY > 0 && rolagemNoFim());
        const ponto = leitor.current?.ancoraVisivel();
        const bloco = ponto && contagem.blocos.get(ponto.bloco_id);
        if (bloco && ponto) definirLidas(bloco.antes + bloco.palavras.filter((fim) => fim <= ponto.offset_utf16).length);
      });
    };
    atualizar();
    window.addEventListener('scroll', atualizar, { passive: true });
    window.addEventListener('resize', atualizar);
    window.addEventListener('margem:geometria', atualizar);
    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener('scroll', atualizar);
      window.removeEventListener('resize', atualizar);
      window.removeEventListener('margem:geometria', atualizar);
    };
  }, [contagem, leitor]);
  const livro = snapshot.palavras_no_livro;
  if (!livro || livro.total <= 0) return null;
  const posicao = concluido || noFim ? contagem.total : lidas;
  const percentual = noFim && ultimaParte ? 100 : Math.min(100, Math.floor((livro.antes + posicao) / livro.total * 100));
  return <span className="progresso-no-livro" title="Quanto do documento você já leu">{percentual}%</span>;
}
