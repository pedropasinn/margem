import { IconButton } from '../ui/Primitives';
import { usarFuncoes } from './ContextoDosModos';
import { estiloDoNumero, type MarcaDoLeitor } from './f2';
import { useEffect, useRef, type ReactNode } from 'react';
import { ROTULOS_DA_ORIGEM } from './notas';

const NOME_DA_FUNCAO: Record<string, string> = {
  tese: 'tese', conceito: 'conceito', justificativa: 'justificativa', nenhuma: 'sem função',
};

export interface PropsDaFolha {
  marca: MarcaDoLeitor;
  /** Número da nota quando a marca tem comentário; trechos sem comentário não têm número. */
  numero?: number | undefined;
  aoFechar: () => void;
  conexao?: ReactNode;
}

/**
 * Folha inferior para toque e telas estreitas. Não rola o documento: a posição de rolagem é
 * anotada na abertura e restaurada no fechamento, caso alguma coisa a tenha mexido.
 */
export function NoteSheet({ marca, numero, aoFechar, conexao }: PropsDaFolha): ReactNode {
  const { daMarca, funcoes } = usarFuncoes();
  const cor = daMarca(marca);
  const fechar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const rolagem = document.scrollingElement ?? document.documentElement;
    const posicao = rolagem.scrollTop;
    fechar.current?.focus({ preventScroll: true });
    return () => {
      if (rolagem.scrollTop !== posicao) rolagem.scrollTop = posicao;
    };
  }, []);

  // O trecho já está aceso no texto, logo acima: a folha não o repete. Só a nota, e um × para fechar.
  return (
    <div className="folha" role="dialog" aria-modal="false" aria-label="Nota do trecho">
      <div className="folha-cabeca">
        <p className="folha-funcao">
          {numero === undefined ? null : <span className={`nota-numero funcao-${marca.funcao}${'saliencia' in marca && marca.saliencia === 3 ? ' periferica' : ''}`} style={estiloDoNumero(cor)}>{numero}</span>}
          <span>{funcoes.find((f) => f.chave === marca.funcao)?.rotulo ?? NOME_DA_FUNCAO[marca.funcao] ?? marca.funcao.replaceAll('_', ' ')} · {ROTULOS_DA_ORIGEM[marca.origem]}</span>
        </p>
        <IconButton ref={fechar} aria-label="Fechar" className="folha-fechar" onClick={aoFechar}>×</IconButton>
      </div>
      {marca.comentario === null ? <p className="folha-citacao">{marca.ancora.citacao}</p> : (
        <>
          <p className="nota-rotulo">{marca.comentario.rotulo}</p>
          <p className="nota-texto">{marca.comentario.texto}</p>
        </>
      )}
      {conexao}
    </div>
  );
}
