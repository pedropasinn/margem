/**
 * O painel esquerdo do leitor (Player v2, etapas 1 e 7): o sumário do documento e, no PDF, as miniaturas
 * das páginas, alternáveis no alto (Shift [). Sobreposto à viewport, como o painel direito: abrir o painel
 * nunca desloca o texto; ele cobre a faixa das braquetes, que se escondem enquanto ele está aberto. `[`
 * abre e recolhe.
 */
import type { ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/Primitives';

export type VistaDoPainelEsquerdo = 'sumario' | 'miniaturas';

export function PainelEsquerdo({ sumario, miniaturas, vista, aoMudarVista, aoFechar }: {
  sumario?: ReactNode; miniaturas?: ReactNode; vista: VistaDoPainelEsquerdo;
  aoMudarVista: (vista: VistaDoPainelEsquerdo) => void; aoFechar: () => void;
}): ReactNode {
  const atual = vista === 'miniaturas' && miniaturas ? 'miniaturas' : sumario ? 'sumario' : 'miniaturas';
  const duas = sumario !== undefined && miniaturas !== undefined;
  return <aside className="painel-esquerdo" aria-label="Sumário do documento">
    <header className="painel-esquerdo-cabeca">
      {duas ? <div className="vistas-do-painel" role="tablist" aria-label="Painel esquerdo">
        {(['sumario', 'miniaturas'] as const).map((v) => <button key={v} type="button" role="tab" aria-selected={atual === v} data-dica={v === 'sumario' ? 'Sumário' : 'Miniaturas'} data-atalho="Shift ["
          onClick={() => aoMudarVista(v)}><Icon name={v === 'sumario' ? 'sumario' : 'miniaturas'} size={16} /><span>{v === 'sumario' ? 'Sumário' : 'Miniaturas'}</span></button>)}
      </div> : <span className="painel-esquerdo-titulo">{atual === 'sumario' ? 'Sumário' : 'Páginas'}</span>}
      <IconButton aria-label="Recolher o painel esquerdo" data-dica="Recolher" data-atalho="[" className="botao-da-barra" onClick={aoFechar}><Icon name="painel-esquerdo" size={18} /></IconButton>
    </header>
    <div className="painel-esquerdo-conteudo">{atual === 'sumario' ? sumario : miniaturas}</div>
  </aside>;
}
