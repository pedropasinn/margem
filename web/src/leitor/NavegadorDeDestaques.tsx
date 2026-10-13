/**
 * "Percorrer" grifos e relações (Player v2, etapa 5): o player central inferior salta de destaque em
 * destaque na ordem do texto — grifos e relações misturados, como aparecem na leitura. Cada salto rola
 * até o trecho e o foca no próprio documento: o grifo acende (e a nota dele abre na margem), a relação
 * acende a chave com o véu e a dobra, como no hover. ← → andam, Esc fecha. Substitui o antigo painel
 * "Destaques" (☷), que abria à direita e duplicava o Caderno.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { AncoraV1 } from '@margem/contratos';
import { BotaoDoPlayer, PlayerCentral } from './player/PlayerCentral';

export interface DestaqueNavegavel {
  id: string;
  tipo: 'grifo' | 'braquete';
  ancora: AncoraV1;
  destino?: AncoraV1;
  titulo: string;
  texto: string;
  cor?: string;
}
export interface NavegacaoDeDestaques {
  aberta: boolean; relacaoId: string | null;
  /** O Percorrer mostra o cartão da relação ao lado da chave, como no hover (a leitura comentada e a visita têm o seu próprio). */
  cartao?: boolean;
}

export function PercorrerDestaques({ itens, inicial = null, aoSelecionar, aoFechar }: {
  itens: readonly DestaqueNavegavel[];
  /** Por onde começar (um item do Caderno); sem ele, o primeiro. */
  inicial?: string | null;
  aoSelecionar: (id: string | null) => void;
  aoFechar: () => void;
}): ReactNode {
  const [id, selecionar] = useState<string | null>(inicial);
  const indice = Math.max(0, itens.findIndex((item) => item.id === id));
  const atual = itens[indice] ?? null;
  const atualId = atual?.id ?? null;
  useEffect(() => { aoSelecionar(atualId); }, [atualId, aoSelecionar]);
  const mover = (delta: number) => { const item = itens[indice + delta]; if (item) selecionar(item.id); };
  const moverRef = { mover, fechar: aoFechar };
  useEffect(() => {
    // As setas são do Percorrer enquanto ele está aberto (fora de campos de texto e das janelas).
    const teclar = (evento: KeyboardEvent) => {
      if (evento.altKey || evento.ctrlKey || evento.metaKey || evento.shiftKey) return;
      if (evento.target instanceof Element && evento.target.closest('input, textarea, select, [contenteditable], [role="dialog"]')) return;
      if (evento.key === 'ArrowLeft' || evento.key === 'ArrowRight') { evento.preventDefault(); evento.stopPropagation(); moverRef.mover(evento.key === 'ArrowLeft' ? -1 : 1); }
      else if (evento.key === 'Escape') { evento.preventDefault(); evento.stopPropagation(); moverRef.fechar(); }
    };
    window.addEventListener('keydown', teclar, true);
    return () => window.removeEventListener('keydown', teclar, true);
  });
  const tipo = atual?.tipo === 'braquete' ? 'relação' : 'grifo';
  return <PlayerCentral rotulo="Percorrer grifos e relações" className="percorrer">
    <div className="linha-do-player linha-do-percorrer">
      <BotaoDoPlayer icone="anterior" rotulo="Destaque anterior" atalho="←" disabled={!atual || indice === 0} onClick={() => mover(-1)} />
      <p className="contagem-do-percorrer" role="status">
        {atual ? <><strong>{indice + 1} / {itens.length}</strong> · {tipo}<span style={atual.cor ? { color: atual.cor } : undefined}>{atual.titulo}</span></> : 'Nenhum grifo ou relação neste capítulo'}
      </p>
      <BotaoDoPlayer icone="proximo" rotulo="Próximo destaque" atalho="→" disabled={!atual || indice === itens.length - 1} onClick={() => mover(1)} />
      <BotaoDoPlayer icone="xis" rotulo="Fechar o percorrer" atalho="Esc" onClick={aoFechar} />
    </div>
  </PlayerCentral>;
}
