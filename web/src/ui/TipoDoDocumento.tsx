import type { ReactNode } from 'react';
import { Icon } from './Icon';

/** O tipo do documento com o seu ícone (livro, texto, PDF, vídeo): no Info, no painel e na página do documento. */
export function TipoDoDocumento({ icone, rotulo, tamanho = 16 }: { icone: string; rotulo: string; tamanho?: number }): ReactNode {
  return <span className="tipo-do-documento"><Icon name={icone} size={tamanho} /><span>{rotulo}</span></span>;
}
