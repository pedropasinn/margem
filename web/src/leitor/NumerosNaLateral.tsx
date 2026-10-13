/**
 * Números das notas na lateral direita, quando a margem não cabe (celular, janela estreita, PDF sem
 * espaço ao lado): o número de cada marca fica na altura da linha em que ela começa, à direita do
 * texto (no PDF, dentro da margem branca da página). O que cai na mesma linha vira uma pilha, como
 * de avatares: até três círculos sobrepostos e um "+N" que espalha o resto. Tocar abre a nota na
 * folha inferior. As chaves ficam do outro lado, à esquerda.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { AncoraV1 } from '@margem/contratos';
import { IconButton } from '../ui/Primitives';
import type { ApiDoLeitor } from './tipos';
import { estiloDoNumero } from './f2';

export interface ItemDaLateral {
  id: string;
  ancora: AncoraV1;
  /** O que vai no círculo: o número da nota ou "?". */
  rotulo: string;
  cor?: string | undefined;
  tracejado?: boolean;
  classe?: string;
  /** Sem `aoAbrir`, o toque abre `conteudo` numa folha própria. */
  aoAbrir?: () => void;
  conteudo?: ReactNode;
  descricao: string;
}

const DIAMETRO = 14;
/** Na pilha, cada círculo avança só uma parte do diâmetro e cobre a borda do anterior. */
const AVANCO = 9;
/** Aberta, a fileira se espalha, um ao lado do outro. */
const AVANCO_ABERTO = 17;
const VISIVEIS = 3;

interface Grupo { chave: string; y: number; direita: number; itens: ItemDaLateral[] }

export function NumerosNaLateral({ itens, leitor, coluna }: { itens: readonly ItemDaLateral[]; leitor: RefObject<ApiDoLeitor | null>; coluna: () => DOMRect | null }): ReactNode {
  const [grupos, definir] = useState<Grupo[]>([]);
  const [sobrePagina, definirSobrePagina] = useState(false);
  const [aberto, abrir] = useState<ItemDaLateral | null>(null);
  const [espalhado, espalhar] = useState<string | null>(null);
  const fechar = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (aberto) fechar.current?.focus({ preventScroll: true }); }, [aberto]);
  useEffect(() => {
    let quadro = 0;
    const medir = () => {
      const caixa = coluna();
      if (!caixa) { definir([]); return; }
      // À direita do texto se houver sarjeta; senão (PDF), dentro da margem direita da página.
      const naSarjeta = window.innerWidth - caixa.right >= DIAMETRO + 6;
      definirSobrePagina(!naSarjeta);
      const direita = naSarjeta ? caixa.right + DIAMETRO + 4 : caixa.right - 4;
      const linhas = itens.flatMap((item) => {
        const primeira = leitor.current?.retangulosDaAncora?.(item.ancora).find((r) => r.height > 0);
        return primeira ? [{ item, y: primeira.top + primeira.height / 2 }] : [];
      }).sort((a, b) => a.y - b.y);
      const novos: Grupo[] = [];
      for (const linha of linhas) {
        const ultimo = novos[novos.length - 1];
        if (ultimo && linha.y - ultimo.y < 14) ultimo.itens.push(linha.item);
        else novos.push({ chave: linha.item.id, y: linha.y, direita, itens: [linha.item] });
      }
      definir(novos);
    };
    const agendar = () => { cancelAnimationFrame(quadro); quadro = requestAnimationFrame(medir); };
    medir();
    window.addEventListener('scroll', agendar, { passive: true });
    window.addEventListener('resize', agendar);
    window.addEventListener('margem:geometria', agendar);
    void document.fonts?.ready.then(agendar);
    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener('scroll', agendar); window.removeEventListener('resize', agendar); window.removeEventListener('margem:geometria', agendar);
    };
  }, [itens, leitor, coluna]);
  // Tocar fora de uma pilha espalhada a recolhe.
  useEffect(() => {
    if (espalhado === null) return;
    const recolher = (evento: PointerEvent) => { if (!(evento.target instanceof Element) || !evento.target.closest('.pilha-lateral')) espalhar(null); };
    window.addEventListener('pointerdown', recolher);
    return () => window.removeEventListener('pointerdown', recolher);
  }, [espalhado]);

  // Como uma pilha de avatares: até três círculos sobrepostos, e "+N" pelos outros. Tocar na pilha
  // espalha a fileira inteira (para a esquerda, sobre a margem); tocar num círculo espalhado abre a nota.
  const pilha = (grupo: Grupo): ReactNode => {
    const aberta = espalhado === grupo.chave;
    const sobram = aberta || grupo.itens.length <= VISIVEIS + 1 ? 0 : grupo.itens.length - VISIVEIS;
    const mostrados = sobram > 0 ? grupo.itens.slice(0, VISIVEIS) : grupo.itens;
    const avanco = aberta ? AVANCO_ABERTO : AVANCO;
    const total = mostrados.length + (sobram > 0 ? 1 : 0);
    const inicio = grupo.direita - DIAMETRO - (total - 1) * avanco;
    return <div key={grupo.chave} className={`pilha-lateral${aberta ? ' espalhada' : ''}`}>
      {mostrados.map((item, indice) => <button key={item.id} type="button" aria-label={item.descricao}
        className={`nota-numero numero-lateral${item.tracejado ? ' periferica' : ''}${item.classe ? ` ${item.classe}` : ''}`}
        style={{ left: inicio + indice * avanco, top: grupo.y - DIAMETRO / 2, zIndex: indice + 1, ...(item.cor ? estiloDoNumero(item.cor) : {}) }}
        onClick={() => {
          // Numa pilha, o primeiro toque espalha (os de baixo ficam meio cobertos); o segundo abre a nota.
          if (grupo.itens.length > 1 && !aberta) { espalhar(grupo.chave); return; }
          espalhar(null); if (item.aoAbrir) item.aoAbrir(); else abrir(item);
        }}>{item.rotulo}</button>)}
      {sobram > 0 && <button type="button" className="numero-lateral mais-numeros" aria-label={`Mais ${String(sobram)} notas nesta linha`} aria-expanded={false}
        style={{ left: inicio + mostrados.length * avanco, top: grupo.y - DIAMETRO / 2, zIndex: mostrados.length + 1 }}
        onClick={() => espalhar(grupo.chave)}>+{sobram}</button>}
    </div>;
  };
  return <div className={sobrePagina ? 'numeros-na-lateral sobre-pagina' : 'numeros-na-lateral'}>
    {grupos.map(pilha)}
    {aberto && <div className="folha" role="dialog" aria-modal="false" aria-label={aberto.descricao}>
      <div className="folha-cabeca">
        <span />
        <IconButton ref={fechar} className="folha-fechar" aria-label="Fechar" onClick={() => abrir(null)}>×</IconButton>
      </div>
      {aberto.conteudo}
    </div>}
  </div>;
}
