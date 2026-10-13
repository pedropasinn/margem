/**
 * Matemática da resolução (`resolver-exercicio@2`): o modelo escreve prosa com LaTeX entre `$…$` (na
 * linha) e `$$…$$` (destacada), e o leitor desenha as fórmulas com o KaTeX. Resoluções antigas (@1)
 * vêm em Unicode puro, sem `$`, e passam como texto.
 *
 * Três barreiras, como no fluxograma: (1) o texto fora das fórmulas é texto puro do React; (2) o KaTeX
 * roda com `trust: false` (sem `\href`, `\url`, `\includegraphics`, classes nem estilos do autor),
 * `throwOnError: false` (fórmula quebrada vira o próprio código em vermelho, sem derrubar a página) e
 * limites de tamanho e de expansão; (3) o HTML do KaTeX passa pelo DOMPurify e entra como nó
 * importado. Nada do modelo vai para `innerHTML`.
 */
import DOMPurify from 'dompurify';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

export type ParteDaMatematica = { tipo: 'texto'; valor: string } | { tipo: 'formula'; tex: string; destacada: boolean };

/**
 * Separa texto e fórmulas. `$$…$$` antes de `$…$`; `\$` é um cifrão literal; um `$` sem par fica como
 * texto (resoluções antigas podem ter um cifrão solto). Uma fórmula vazia não é fórmula.
 */
export function partesDaMatematica(texto: string): ParteDaMatematica[] {
  const partes: ParteDaMatematica[] = [];
  let corrente = '';
  let i = 0;
  const empurrarTexto = () => { if (corrente !== '') { partes.push({ tipo: 'texto', valor: corrente }); corrente = ''; } };
  while (i < texto.length) {
    const caractere = texto[i]!;
    if (caractere === '\\' && texto[i + 1] === '$') { corrente += '$'; i += 2; continue; }
    if (caractere === '$') {
      const destacada = texto[i + 1] === '$';
      const abre = destacada ? 2 : 1;
      const fim = fechamento(texto, i + abre, destacada);
      const tex = fim === -1 ? '' : texto.slice(i + abre, fim).trim();
      if (fim !== -1 && tex !== '') {
        empurrarTexto();
        partes.push({ tipo: 'formula', tex, destacada });
        i = fim + abre;
        continue;
      }
    }
    corrente += caractere;
    i += 1;
  }
  empurrarTexto();
  return partes;
}

function fechamento(texto: string, de: number, destacada: boolean): number {
  for (let j = de; j < texto.length; j += 1) {
    if (texto[j] === '\\') { j += 1; continue; }
    if (texto[j] !== '$') continue;
    if (!destacada) return j;
    if (texto[j + 1] === '$') return j;
  }
  return -1;
}

/** O HTML do KaTeX, higienizado, como fragmento pronto para `append`. */
export async function formulaSegura(tex: string, destacada: boolean, documento: Document = document): Promise<DocumentFragment> {
  const [{ default: katex }] = await Promise.all([import('katex'), import('katex/dist/katex.min.css')]);
  const html = katex.renderToString(tex, {
    displayMode: destacada, throwOnError: false, trust: false, strict: 'ignore', output: 'htmlAndMathml', maxSize: 20, maxExpand: 200,
  });
  const fragmento = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    FORBID_TAGS: ['a', 'script', 'style', 'iframe', 'image', 'img', 'use', 'foreignObject', 'form', 'input', 'button'],
    FORBID_ATTR: ['href', 'xlink:href', 'src', 'action', 'formaction', 'onclick', 'onload', 'onerror', 'onmouseover', 'onfocus'],
    RETURN_DOM_FRAGMENT: true,
  });
  return documento.importNode(fragmento, true);
}

function Formula({ tex, destacada }: { tex: string; destacada: boolean }): ReactNode {
  const caixa = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const alvo = caixa.current;
    if (!alvo) return;
    let vivo = true;
    alvo.textContent = tex;
    void formulaSegura(tex, destacada, alvo.ownerDocument).then((fragmento) => {
      if (vivo) alvo.replaceChildren(fragmento);
    }).catch(() => { /* Mantém o LaTeX legível se o carregamento falhar. */ });
    return () => { vivo = false; };
  }, [tex, destacada]);
  // O código fica em `data-tex`; o desenho (com MathML para leitores de tela) entra pelo efeito.
  return <span ref={caixa} className={destacada ? 'formula formula-destacada' : 'formula'} data-tex={tex} />;
}

/** Pontuação que não pode começar linha: fica colada à fórmula curta que a precede (uma longa ainda pode quebrar). */
const PONTUACAO_COLADA = /^[.,;:!?)\]…]+/u;
const FORMULA_CURTA = 40;

/** Prosa com fórmulas: o texto como texto, cada fórmula pelo KaTeX. */
export function TextoComMatematica({ texto }: { texto: string }): ReactNode {
  const partes = partesDaMatematica(texto);
  const saida: ReactNode[] = [];
  let colada = '';
  partes.forEach((parte, indice) => {
    if (parte.tipo === 'texto') {
      const resto = parte.valor.slice(colada.length);
      colada = '';
      if (resto !== '') saida.push(<span key={indice}>{resto}</span>);
      return;
    }
    const seguinte = partes[indice + 1];
    colada = !parte.destacada && parte.tex.length <= FORMULA_CURTA && seguinte?.tipo === 'texto' ? PONTUACAO_COLADA.exec(seguinte.valor)?.[0] ?? '' : '';
    const formula = <Formula tex={parte.tex} destacada={parte.destacada} />;
    saida.push(colada ? <span key={indice} className="sem-quebra">{formula}{colada}</span> : <span key={indice} className="contem-formula">{formula}</span>);
  });
  return <>{saida}</>;
}

/** As linhas de uma conta: com LaTeX, cada linha pelo KaTeX; sem (@1), o texto linha a linha como antes. */
export function LinhasDoCalculo({ calculo }: { calculo: string }): ReactNode {
  return <>{calculo.split('\n').filter((linha) => linha.trim() !== '').map((linha, indice) => <span key={indice} className="linha-do-calculo"><TextoComMatematica texto={linha} /></span>)}</>;
}
