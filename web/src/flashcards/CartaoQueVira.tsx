/**
 * O cartão que vira: frente e verso empilhados na mesma célula da grade, girados em 3D (perspective +
 * backface-visibility) com uma mola suave em CSS. A referência é o Flip Card do React Bits (mola
 * stiffness 170 / damping 20, perspective 1100, um leve erguer e a sombra que se abre no giro); aqui a
 * mola vira uma curva `linear()` e o erguer e a sombra, keyframes. Sem dependência e sem JavaScript na
 * animação. Com `prefers-reduced-motion`, as faces só trocam por opacidade.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import './flashcards.css';

export interface PropsDoCartao {
  virado: boolean;
  aoVirar: () => void;
  frente: ReactNode;
  verso: ReactNode;
  /** Como o leitor de tela chama o botão ("flashcard"). */
  rotulo?: string;
}

export function CartaoQueVira({ virado, aoVirar, frente, verso, rotulo = 'Flashcard' }: PropsDoCartao): ReactNode {
  // O erguer e a sombra só tocam depois do primeiro giro (não na chegada do cartão).
  const inicial = useRef(virado);
  const [girou, marcarGiro] = useState(false);
  useEffect(() => { if (virado !== inicial.current) marcarGiro(true); }, [virado]);
  return <div className="cartao-que-vira" data-virado={virado ? '' : undefined} data-girou={girou ? '' : undefined}>
    <span className="cartao-sombra" aria-hidden="true" />
    <button type="button" className="cartao-giro" aria-pressed={virado} aria-roledescription={rotulo}
      title={virado ? 'Virar para a pergunta (Espaço)' : 'Virar para a resposta (Espaço)'} onClick={aoVirar}>
      <span className="cartao-face cartao-frente" aria-hidden={virado}>
        <span className="eyebrow">Pergunta</span>
        <span className="cartao-texto">{frente}</span>
      </span>
      <span className="cartao-face cartao-verso" aria-hidden={!virado}>
        <span className="eyebrow">Resposta</span>
        <span className="cartao-texto">{verso}</span>
      </span>
    </button>
  </div>;
}
