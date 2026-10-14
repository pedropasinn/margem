import type { ReactNode } from 'react';
import type { AncoraV1 } from '@margem/contratos';
export interface NotaPessoal {
  id: string; ancora: AncoraV1; conteudo: ReactNode;
  /** Abre a nota, a conversa ou as conexões no painel do trecho (a margem e o Caderno só leem). */
  aoAbrir?: () => void;
  /** O texto da nota, para o Caderno mostrar sem os controles da margem. */
  resumo?: string;
  /** Com a margem recolhida, a bolinha que a representa (N nota, C conversa, ↗ conexões, V visual, ! falha) e o que ela diz. */
  sinal?: string;
  descricao?: string;
}
/** No celular as notas também ficam listadas ao fim do capítulo; o indicador abre a folha. */
export function NotasPessoais({ notas }: { notas: readonly NotaPessoal[] }): ReactNode {
  return <div className="notas-pessoais pessoais-moveis" role="group" aria-label="Suas notas e conversas">
    {notas.map((nota) => <aside className="nota-pessoal" data-pessoal={nota.id} key={nota.id}>{nota.conteudo}</aside>)}
  </div>;
}
