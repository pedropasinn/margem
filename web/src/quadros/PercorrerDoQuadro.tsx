/**
 * "Percorrer" as afirmações do quadro, como o Percorrer de grifos e relações do leitor: a pílula central
 * salta de afirmação em afirmação (na ordem da aba Análise), a câmera enquadra as regiões dela, que
 * acendem, e o cartão mostra o texto com o tipo e a confiança. ← → andam, Esc fecha.
 */
import { useEffect, type ReactNode } from 'react';
import type { AfirmacaoDaObra, ModeloDaObraV1 } from '@margem/contratos';
import { BotaoDoPlayer, PlayerCentral } from '../leitor/player/PlayerCentral';
import { linkDaFonte, ROTULO_DA_CONFIANCA, ROTULO_DO_TIPO } from './rotulos';

export function CartaoDaAfirmacao({ afirmacao, modelo }: { afirmacao: AfirmacaoDaObra; modelo: ModeloDaObraV1 }): ReactNode {
  const regioes = afirmacao.regioes.map((id) => modelo.regioes.find((r) => r.id === id)?.rotulo).filter((r): r is string => r !== undefined);
  const fontes = afirmacao.fontes.map((id) => modelo.fontes.find((f) => f.id === id)).filter((f) => f !== undefined);
  return <aside className="cartao-do-quadro" aria-label="Afirmação">
    <span className="eyebrow"><span className="tipo-da-afirmacao" data-tipo={afirmacao.tipo} aria-hidden="true" />{ROTULO_DO_TIPO[afirmacao.tipo]} · {ROTULO_DA_CONFIANCA[afirmacao.confianca]}</span>
    <p className="fala-no-quadro">{afirmacao.texto}</p>
    {regioes.length > 0 && <p className="regioes-no-cartao">{regioes.join(' · ')}</p>}
    <details><summary>Evidência</summary><p>{afirmacao.evidencia}</p>
      {fontes.map((f) => { const link = linkDaFonte(f); return link ? <a key={f.id} href={link} target="_blank" rel="noreferrer">{f.titulo}</a> : <span key={f.id}>{f.titulo}</span>; })}
    </details>
  </aside>;
}

export function PercorrerDoQuadro({ itens, indice, modelo, aoMover, aoFechar }: {
  itens: readonly AfirmacaoDaObra[];
  indice: number;
  modelo: ModeloDaObraV1;
  aoMover: (indice: number) => void;
  aoFechar: () => void;
}): ReactNode {
  const atual = itens[indice] ?? null;
  const ref = { indice, aoMover, aoFechar, total: itens.length };
  useEffect(() => {
    const teclar = (evento: KeyboardEvent) => {
      if (evento.altKey || evento.ctrlKey || evento.metaKey || evento.shiftKey) return;
      if (evento.target instanceof Element && evento.target.closest('input, textarea, select, [contenteditable], [role="dialog"]')) return;
      if (evento.key === 'ArrowLeft' || evento.key === 'ArrowRight') {
        evento.preventDefault(); evento.stopPropagation();
        const destino = ref.indice + (evento.key === 'ArrowLeft' ? -1 : 1);
        if (destino >= 0 && destino < ref.total) ref.aoMover(destino);
      } else if (evento.key === 'Escape') { evento.preventDefault(); evento.stopPropagation(); ref.aoFechar(); }
    };
    window.addEventListener('keydown', teclar, true);
    return () => window.removeEventListener('keydown', teclar, true);
  });
  return <>
    {atual && <CartaoDaAfirmacao afirmacao={atual} modelo={modelo} />}
    <PlayerCentral rotulo="Percorrer as afirmações" className="percorrer percorrer-do-quadro">
      <div className="linha-do-player linha-do-percorrer">
        <BotaoDoPlayer icone="anterior" rotulo="Afirmação anterior" atalho="←" disabled={!atual || indice === 0} onClick={() => aoMover(indice - 1)} />
        <p className="contagem-do-percorrer" role="status">
          {atual ? <><strong>{indice + 1} / {itens.length}</strong> · {ROTULO_DO_TIPO[atual.tipo].toLocaleLowerCase('pt-BR')}<span>{atual.texto}</span></> : 'Nenhuma afirmação nesta análise'}
        </p>
        <BotaoDoPlayer icone="proximo" rotulo="Próxima afirmação" atalho="→" disabled={!atual || indice === itens.length - 1} onClick={() => aoMover(indice + 1)} />
        <BotaoDoPlayer icone="xis" rotulo="Fechar o percorrer" atalho="Esc" onClick={aoFechar} />
      </div>
    </PlayerCentral>
  </>;
}
