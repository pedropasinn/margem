import type { RefObject } from 'react';
import type { ApiDoLeitor } from './tipos';
import { Button } from '../ui/Primitives';
import { intervaloDoOffset, retanguloDoIntervalo } from './posicao';
import { useEffect, useState, type ReactNode } from 'react';
import type { AncoraV1 } from '@margem/contratos';
export interface NotaPessoal { id: string; ancora: AncoraV1; conteudo: ReactNode }
/** No celular as notas também ficam listadas ao fim do capítulo; o indicador abre a folha. */
export function NotasPessoais({ notas }: { notas: readonly NotaPessoal[] }): ReactNode {
  return <div className="notas-pessoais pessoais-moveis" role="group" aria-label="Suas notas e conversas">
    {notas.map((nota) => <aside className="nota-pessoal" data-pessoal={nota.id} key={nota.id}>{nota.conteudo}</aside>)}
  </div>;
}
export function IndicadoresDeEstudo({ leitor, notas, raiz, aoAbrir }: { leitor?: RefObject<ApiDoLeitor>; notas: readonly { id: string; ancora: AncoraV1; rotulo: string; simbolo: string }[]; raiz: HTMLElement | null; aoAbrir: (id: string) => void }): ReactNode {
  const [posicoes, definir] = useState<{ top: number; left: number }[]>([]);
  useEffect(() => {
    if (!raiz) return;
    const medir = () => {
      const base = raiz.getBoundingClientRect();
      const ocupadas = new Map<string, number>();
      definir(notas.map((nota) => {
        const bloco = raiz.querySelector(`[data-bloco="${nota.ancora.bloco_id}"]`);
        const caixa = leitor?.current?.localizar(nota.ancora.bloco_id, nota.ancora.inicio_utf16) ?? bloco?.getBoundingClientRect();
        const intervalo = intervaloDoOffset(raiz, nota.ancora.bloco_id, nota.ancora.inicio_utf16);
        const topo = (intervalo ? retanguloDoIntervalo(intervalo)?.top : caixa?.top) ?? base.top;
        const linha = `${nota.ancora.bloco_id}:${Math.round(topo / 24)}`;
        const ordem = ocupadas.get(linha) ?? 0;
        ocupadas.set(linha, ordem + 1);
        return { top: topo - base.top + ordem * 42, left: Math.min((caixa?.right ?? base.left) - base.left + 3, window.innerWidth - base.left - 40) };
      }));
    };
    medir();
    const o = typeof ResizeObserver === 'function' ? new ResizeObserver(medir) : null;
    o?.observe(raiz); window.addEventListener('resize', medir); window.addEventListener('margem:geometria', medir);
    return () => { o?.disconnect(); window.removeEventListener('resize', medir); window.removeEventListener('margem:geometria', medir); };
  }, [notas, raiz, leitor]);
  return <div className="indicadores-estudo">{notas.map((n, i) => <Button variante="ghost" key={n.id} type="button" aria-label={n.rotulo} style={posicoes[i]} onClick={() => aoAbrir(n.id)}>{n.simbolo}</Button>)}</div>;
}
