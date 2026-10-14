/**
 * "Apagar…" na página Notas (V-T8 + V-T9): o "⋯" de cada item chama a rota de apagar do tipo dele, com a
 * confirmação do J143 antes. O que não tem rota de apagar um a um fica sem "Apagar…" na lista:
 * - as conexões (do leitor ou aceitas do Codex) e os sinais de dificuldade já decididos se tiram no leitor;
 * - as perguntas presas a trechos e as notas antigas soltas, idem.
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { removerResolucao } from '../biblioteca/api';
import { Notas, type PropsDasNotas } from '../biblioteca/Notas';
import type { ItemDaCentral } from '../biblioteca/tipos';
import { API_DOS_FLASHCARDS } from '../flashcards/api';
import { apagarVisual } from '../leitor/visuais/api';
import { ConfirmarApagar } from './ConfirmarApagar';
import { apagarGrifoDeQualquerUm, apagarItemDaAnalise } from './api';

interface ComoApagar { titulo: string; texto: string; executar: () => Promise<unknown> }

/** Como apagar o item, ou `null` quando a lista não oferece "Apagar…" para ele. */
export function comoApagar(item: ItemDaCentral): ComoApagar | null {
  switch (item.tipo) {
    case 'grifo':
      return { titulo: 'Apagar o grifo?', executar: () => apagarGrifoDeQualquerUm(item.id),
        texto: item.nota !== null ? 'O grifo sai do texto, com a sua nota.' : 'O grifo sai do texto.' };
    case 'relacao':
      // Só a relação que está na análise do Codex; a conexão gravada se tira no leitor.
      if (item.estado !== 'da_leitura' || item.analise === null) return null;
      return { titulo: 'Apagar a relação?', texto: 'A relação sai da análise do capítulo.',
        executar: () => apagarItemDaAnalise(item.analise!.execucao_id, item.analise!.secao_id, item.id) };
    case 'dificuldade':
      if (item.estado !== 'sugerida' || item.analise === null) return null;
      return { titulo: 'Apagar a dificuldade?', texto: 'A dificuldade apontada pelo Codex sai da análise do capítulo.',
        executar: () => apagarItemDaAnalise(item.analise!.execucao_id, item.analise!.secao_id, item.id) };
    case 'resolucao':
      return { titulo: 'Apagar a resolução?', texto: 'A resolução do exercício sai, com a conversa sobre ela.', executar: () => removerResolucao(item.id) };
    case 'flashcard':
      return { titulo: 'Apagar o flashcard?', texto: 'O cartão sai, com as revisões dele.', executar: () => API_DOS_FLASHCARDS.apagar(item.id) };
    case 'visual':
      return { titulo: item.rotulo === 'Imagem' ? 'Apagar a imagem?' : 'Apagar o diagrama?', texto: 'Ele sai do capítulo.', executar: () => apagarVisual(item.id) };
    default:
      return null;
  }
}

const podeApagar = (item: ItemDaCentral) => comoApagar(item) !== null;

/** A página Notas com o "Apagar…" ligado às rotas do J143. */
export function NotasComApagar(props: Omit<PropsDasNotas, 'apagar' | 'podeApagar'>): ReactNode {
  const [pedido, pedir] = useState<{ item: ItemDaCentral; como: ComoApagar } | null>(null);
  const resolver = useRef<((apagado: boolean) => void) | null>(null);
  const apagar = useCallback((item: ItemDaCentral) => new Promise<boolean>((resolve) => {
    const como = comoApagar(item);
    if (!como) { resolve(false); return; }
    resolver.current?.(false);
    resolver.current = resolve;
    pedir({ item, como });
  }), []);
  const fechar = (apagado: boolean) => { resolver.current?.(apagado); resolver.current = null; pedir(null); };
  const apagou = useRef(false);
  return <>
    <Notas {...props} apagar={apagar} podeApagar={podeApagar} />
    {pedido && <ConfirmarApagar titulo={pedido.como.titulo} itens={[pedido.item.citacao ? `“${pedido.item.citacao}”` : pedido.item.rotulo]} texto={pedido.como.texto}
      aoConfirmar={async () => { await pedido.como.executar(); apagou.current = true; }}
      aoFechar={() => { const feito = apagou.current; apagou.current = false; fechar(feito); }} />}
  </>;
}
