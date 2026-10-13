/** "Ver no e-ink" no menu do leitor: só com o recurso `eink` ligado (J102b). */
import type { ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { usarRecurso } from '../recursos';

export function LinkDoEink({ documento_id, secao_id }: { documento_id: string; secao_id: string }): ReactNode {
  if (!usarRecurso('eink')) return null;
  return <li><a className="ui-button ui-ghost" href={`/eink/${documento_id}/${secao_id}`}><Icon name="eink" size={18} /><span><span className="acao-rotulo">Ver no e-ink</span><span className="acao-detalhe">X4 Pro</span></span></a></li>;
}
