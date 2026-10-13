import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { ApiDoLeitor, SnapshotCapitulo } from './tipos';

/** A posição é textual: funciona também sobre a geometria do PDF original. */
export function ProgressoNoLivro({ snapshot, leitor, concluido }: {
  snapshot: SnapshotCapitulo; leitor: RefObject<ApiDoLeitor | null>; concluido: boolean;
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
  useEffect(() => {
    definirLidas(0);
    let quadro = 0;
    const atualizar = () => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(() => {
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
  const posicao = concluido ? contagem.total : lidas;
  const percentual = Math.min(100, Math.floor((livro.antes + posicao) / livro.total * 100));
  const minutos = (palavras: number) => Math.ceil(Math.max(0, palavras) / 230);
  const capitulo = minutos(contagem.total - posicao);
  const restante = minutos(livro.total - livro.antes - posicao);
  return <span className="progresso-no-livro" title="Estimativa de leitura a 230 palavras por minuto">
    <span>{percentual}% do livro</span><span>~{capitulo} min no capítulo · ~{restante} min no livro</span>
  </span>;
}
