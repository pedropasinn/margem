/**
 * O player central inferior (Player v2, etapa 5): uma pílula pequena, embaixo e no centro, na linguagem
 * do player de áudio e vídeo (J71). Serve ao "Percorrer" grifos e relações, à leitura comentada (J92) e
 * à visita (J91). O que se lê e se comenta acontece no próprio documento: o trecho em foco, o karaokê e
 * o `CartaoNoTexto`, ancorado ao lado do trecho (na margem, onde houver; senão logo abaixo dele).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { AncoraV1 } from '@margem/contratos';
import { Icon } from '../../ui/Icon';
import { faixaDaAncora } from '../compreensao/geometria';
import type { ApiDoLeitor } from '../tipos';
import './player-central.css';

export function PlayerCentral({ rotulo, children, className = '', aoTeclar }: { rotulo: string; children: ReactNode; className?: string; aoTeclar?: (evento: KeyboardEvent<HTMLElement>) => void }): ReactNode {
  return <section className={`player-central dicas-acima ${className}`} role="region" aria-label={rotulo} onKeyDown={aoTeclar}>{children}</section>;
}

/** Um botão redondo do player, só com o ícone e a dica. */
export function BotaoDoPlayer({ icone, rotulo, atalho, onClick, disabled, pressionado, className = '' }: { icone: string; rotulo: string; atalho?: string; onClick?: () => void; disabled?: boolean; pressionado?: boolean; className?: string }): ReactNode {
  return <button type="button" className={`botao-do-player ${className}`} aria-label={rotulo} data-dica={rotulo} data-atalho={atalho} disabled={disabled}
    aria-pressed={pressionado} onClick={onClick}><Icon name={icone} size={18} /></button>;
}

/** O botão grande de tocar e pausar, na cor do botão primário (como no player de mídia). */
export function BotaoDeTocar({ tocando, aoAlternar }: { tocando: boolean; aoAlternar: () => void }): ReactNode {
  return <button type="button" className="tocar-central" aria-label={tocando ? 'Pausar' : 'Tocar'} data-dica={tocando ? 'Pausar' : 'Tocar'} data-atalho="Espaço" onClick={aoAlternar}>
    <Icon name={tocando ? 'pausar' : 'tocar'} size={20} />
  </button>;
}

export function formatarTempo(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${String(h)}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${String(m)}:${String(s % 60).padStart(2, '0')}`;
}

/** A trilha do tempo, com as marcas das pausas (os comentários, as paradas). */
export function TrilhaCentral({ t, duracao, marcas, aoPassar, rotulo }: { t: number; duracao: number; marcas: readonly number[]; aoPassar: (t: number) => void; rotulo: string }): ReactNode {
  return <div className="trilha-central" role="slider" tabIndex={0} aria-label={rotulo} aria-valuemin={0} aria-valuemax={Math.round(duracao)} aria-valuenow={Math.round(t)}
    aria-valuetext={`${formatarTempo(t)} de ${formatarTempo(duracao)}`}
    onPointerDown={(evento) => { const r = evento.currentTarget.getBoundingClientRect(); aoPassar(((evento.clientX - r.left) / r.width) * duracao); }}>
    <span className="trilha-central-cheia" style={{ width: `${String(duracao > 0 ? (t / duracao) * 100 : 0)}%` }} />
    {marcas.map((inicio, i) => <span key={String(i)} className="marca-da-parada" style={{ left: `${String((inicio / Math.max(1, duracao)) * 100)}%` }} />)}
  </div>;
}

/** A coluna do texto (ou das páginas do PDF): onde o cartão procura a margem. */
function colunaDoTexto(): DOMRect | null {
  return document.querySelector('.leitor-controlado .capitulo')?.getBoundingClientRect() ?? null;
}

/**
 * O comentário dentro do documento, ao lado do trecho comentado: na margem direita quando ela cabe
 * (como uma nota), senão logo abaixo do trecho, na largura do texto. Acompanha a rolagem; com o trecho
 * fora da tela, some (o player continua com o "voltar ao trecho").
 */
export function CartaoNoTexto({ ancora, leitor, rotulo, children, className = '' }: { ancora: AncoraV1 | null; leitor: RefObject<ApiDoLeitor | null>; rotulo: string; children: ReactNode; className?: string }): ReactNode {
  const cartao = useRef<HTMLElement>(null);
  const [estilo, definirEstiloBruto] = useState<CSSProperties | null>(null);
  // Mede a cada desenho (o cartão muda de altura com a fala): só troca o estado quando a posição muda.
  const definirEstilo = useCallback((novo: CSSProperties | null) => {
    definirEstiloBruto((atual) => JSON.stringify(atual) === JSON.stringify(novo) ? atual : novo);
  }, []);
  const medir = useCallback(() => {
    if (!ancora) { definirEstilo(null); return; }
    const faixa = faixaDaAncora(leitor.current, ancora);
    // Sem a coluna do leitor (fora dele), vale a largura da janela.
    const coluna = colunaDoTexto() ?? new DOMRect(12, 0, Math.max(0, window.innerWidth - 24), 0);
    if (!faixa) { definirEstilo(null); return; }
    const altura = cartao.current?.offsetHeight ?? 160;
    // No celular, o cartão vira uma folha logo acima do player: o trecho já foi rolado para o alto da tela.
    if (window.innerWidth < 600) {
      const player = document.querySelector<HTMLElement>('.player-central')?.offsetHeight ?? 96;
      definirEstilo({ left: 8, right: 8, bottom: player + 16, maxHeight: '36vh', visibility: faixa.base < 56 || faixa.topo > window.innerHeight - 60 ? 'hidden' : 'visible' });
      return;
    }
    const largo = window.innerWidth - coluna.right >= 300;
    if (largo) {
      const largura = Math.min(360, window.innerWidth - coluna.right - 56);
      const topo = Math.max(72, Math.min(faixa.topo, window.innerHeight - altura - 132));
      definirEstilo({ left: coluna.right + 36, top: topo, width: largura, visibility: faixa.base < 56 || faixa.topo > window.innerHeight - 96 ? 'hidden' : 'visible' });
    } else {
      const topo = Math.min(faixa.base + 12, window.innerHeight - altura - 132);
      definirEstilo({ left: Math.max(12, coluna.left), top: Math.max(72, topo), width: Math.min(coluna.width, window.innerWidth - 24), visibility: faixa.base < 56 || faixa.topo > window.innerHeight - 120 ? 'hidden' : 'visible' });
    }
  }, [ancora, leitor, definirEstilo]);
  useLayoutEffect(() => { medir(); });
  useEffect(() => {
    let quadro = 0;
    const agendar = () => { cancelAnimationFrame(quadro); quadro = requestAnimationFrame(medir); };
    window.addEventListener('scroll', agendar, { passive: true });
    window.addEventListener('resize', agendar);
    window.addEventListener('margem:geometria', agendar);
    // A rolagem suave até o trecho termina depois do primeiro quadro: mede de novo um pouco depois.
    const tardio = setTimeout(agendar, 450);
    return () => { cancelAnimationFrame(quadro); clearTimeout(tardio); window.removeEventListener('scroll', agendar); window.removeEventListener('resize', agendar); window.removeEventListener('margem:geometria', agendar); };
  }, [medir]);
  if (!ancora) return null;
  return <aside ref={cartao} className={`cartao-no-texto ${className}`} aria-label={rotulo} style={estilo ?? { visibility: 'hidden' }}>{children}</aside>;
}
