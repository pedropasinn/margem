/**
 * Markdown do agente, desenhado como React puro: nada do modelo vai para `innerHTML`.
 *
 * Subconjunto pequeno e fechado: títulos (`#`…`####`), parágrafos, listas (`-`, `*`, `1.`), citação
 * (`>`), tabelas com `|`, linha (`---`), blocos de código (```` ``` ````; ```` ```mermaid ```` vai para
 * o `DiagramaMermaid` do J70, com a régua do core e o DOMPurify) e, na linha, `código`, **negrito**,
 * *itálico* e as marcas de citação `[c1]`, que viram botões para o trecho. Matemática (`$…$`, `$$…$$`)
 * passa pelo `TextoComMatematica` (KaTeX com `trust: false`, higienizado). HTML cru aparece como texto;
 * links do modelo também (não viram `<a>`).
 */
import { Fragment, type ReactNode } from 'react';
import { TextoComMatematica } from '../leitor/resolucao/Matematica';
import { DiagramaMermaid } from '../leitor/visuais/DiagramaMermaid';

export interface OpcoesDoMarkdown {
  /** Marca `[cN]` conhecida → o nó que a representa (botão). Sem ela, a marca fica como texto. */
  citacao?: (ref: string) => ReactNode | null;
  /** Id para os diagramas Mermaid desta resposta. */
  id?: string;
}

type Bloco =
  | { tipo: 'titulo'; nivel: number; texto: string }
  | { tipo: 'paragrafo'; texto: string }
  | { tipo: 'lista'; ordenada: boolean; itens: string[] }
  | { tipo: 'citacao'; texto: string }
  | { tipo: 'codigo'; linguagem: string; texto: string }
  | { tipo: 'tabela'; cabecalho: string[]; linhas: string[][] }
  | { tipo: 'linha' };

const ITEM = /^\s*(?:[-*+]|(\d{1,3})[.)])\s+(.*)$/u;
const SEPARADOR_DA_TABELA = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/u;

function celulas(linha: string): string[] {
  const limpa = linha.trim().replace(/^\|/u, '').replace(/\|$/u, '');
  return limpa.split(/(?<!\\)\|/u).map((celula) => celula.trim().replace(/\\\|/gu, '|'));
}

/** Texto → blocos. Nunca lança: o que não reconhece vira parágrafo. */
export function blocosDoMarkdown(texto: string): Bloco[] {
  const linhas = texto.replace(/\r\n?/gu, '\n').split('\n');
  const blocos: Bloco[] = [];
  let i = 0;
  while (i < linhas.length) {
    const linha = linhas[i]!;
    if (linha.trim() === '') { i += 1; continue; }
    const cerca = /^\s*(`{3,}|~{3,})\s*([A-Za-z0-9_-]*)\s*$/u.exec(linha);
    if (cerca) {
      const fim = linhas.findIndex((candidata, j) => j > i && candidata.trim().startsWith(cerca[1]!));
      const corpo = linhas.slice(i + 1, fim === -1 ? linhas.length : fim);
      blocos.push({ tipo: 'codigo', linguagem: (cerca[2] ?? '').toLowerCase(), texto: corpo.join('\n') });
      i = fim === -1 ? linhas.length : fim + 1;
      continue;
    }
    const titulo = /^(#{1,6})\s+(.*?)\s*#*\s*$/u.exec(linha);
    if (titulo) { blocos.push({ tipo: 'titulo', nivel: titulo[1]!.length, texto: titulo[2]! }); i += 1; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/u.test(linha)) { blocos.push({ tipo: 'linha' }); i += 1; continue; }
    if (linha.includes('|') && SEPARADOR_DA_TABELA.test(linhas[i + 1] ?? '')) {
      const cabecalho = celulas(linha);
      const corpo: string[][] = [];
      i += 2;
      while (i < linhas.length && linhas[i]!.includes('|') && linhas[i]!.trim() !== '') { corpo.push(celulas(linhas[i]!)); i += 1; }
      blocos.push({ tipo: 'tabela', cabecalho, linhas: corpo });
      continue;
    }
    if (/^\s*>/u.test(linha)) {
      const corpo: string[] = [];
      while (i < linhas.length && /^\s*>/u.test(linhas[i]!)) { corpo.push(linhas[i]!.replace(/^\s*>\s?/u, '')); i += 1; }
      blocos.push({ tipo: 'citacao', texto: corpo.join('\n') });
      continue;
    }
    const item = ITEM.exec(linha);
    if (item) {
      const ordenada = item[1] !== undefined;
      const itens: string[] = [];
      while (i < linhas.length) {
        const atual = ITEM.exec(linhas[i]!);
        if (atual) { itens.push(atual[2]!); i += 1; continue; }
        // Continuação recuada do item anterior.
        if (/^\s{2,}\S/u.test(linhas[i]!) && itens.length > 0) { itens[itens.length - 1] += ` ${linhas[i]!.trim()}`; i += 1; continue; }
        break;
      }
      blocos.push({ tipo: 'lista', ordenada, itens });
      continue;
    }
    const corpo: string[] = [];
    while (i < linhas.length && linhas[i]!.trim() !== '' && !/^\s*(#{1,6}\s|>|`{3,}|~{3,})/u.test(linhas[i]!) && !ITEM.exec(linhas[i]!)
      && !(linhas[i]!.includes('|') && SEPARADOR_DA_TABELA.test(linhas[i + 1] ?? ''))) {
      corpo.push(linhas[i]!);
      i += 1;
    }
    if (corpo.length === 0) { corpo.push(linha); i += 1; }
    blocos.push({ tipo: 'paragrafo', texto: corpo.join('\n') });
  }
  return blocos;
}

/** Na linha: código primeiro (o que está nele fica literal), depois negrito, itálico e citações. */
export function Inline({ texto, opcoes = {} }: { texto: string; opcoes?: OpcoesDoMarkdown }): ReactNode {
  const partes = texto.split(/(`[^`\n]+`)/u);
  return <>{partes.map((parte, indice) => (parte.length > 2 && parte.startsWith('`') && parte.endsWith('`')
    ? <code key={indice}>{parte.slice(1, -1)}</code>
    : <Fragment key={indice}>{enfase(parte, opcoes)}</Fragment>))}</>;
}

function enfase(texto: string, opcoes: OpcoesDoMarkdown): ReactNode[] {
  const saida: ReactNode[] = [];
  // Fórmulas não passam pela ênfase: `$a*b*c$` não vira itálico.
  const padrao = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)|\*\*([^*\n]+?)\*\*|(?<![*\w])\*([^*\n]+?)\*(?![*\w])|(?<![\w])_([^_\n]+?)_(?![\w])|\[(c\d{1,3})\]/gu;
  let ultimo = 0;
  let chave = 0;
  for (const achado of texto.matchAll(padrao)) {
    const inicio = achado.index ?? 0;
    if (inicio > ultimo) saida.push(<TextoComMatematica key={chave++} texto={texto.slice(ultimo, inicio)} />);
    const [, formula, negrito, italico, sublinhado, ref] = achado;
    if (formula !== undefined) saida.push(<TextoComMatematica key={chave++} texto={formula} />);
    else if (negrito !== undefined) saida.push(<strong key={chave++}>{enfase(negrito, opcoes)}</strong>);
    else if (italico !== undefined || sublinhado !== undefined) saida.push(<em key={chave++}>{enfase(italico ?? sublinhado ?? '', opcoes)}</em>);
    else if (ref !== undefined) saida.push(<Fragment key={chave++}>{opcoes.citacao?.(ref) ?? `[${ref}]`}</Fragment>);
    ultimo = inicio + achado[0].length;
  }
  if (ultimo < texto.length) saida.push(<TextoComMatematica key={chave++} texto={texto.slice(ultimo)} />);
  return saida;
}

export function Markdown({ texto, opcoes = {} }: { texto: string; opcoes?: OpcoesDoMarkdown }): ReactNode {
  return <div className="markdown">{blocosDoMarkdown(texto).map((bloco, indice) => {
    switch (bloco.tipo) {
      case 'titulo': {
        // Na conversa, os títulos ficam pequenos: `#` e `##` viram h3.
        const Nivel = (['h3', 'h4', 'h5', 'h6'] as const)[Math.min(3, Math.max(0, bloco.nivel - 2))]!;
        return <Nivel key={indice}><Inline texto={bloco.texto} opcoes={opcoes} /></Nivel>;
      }
      case 'paragrafo': return <p key={indice}><Inline texto={bloco.texto} opcoes={opcoes} /></p>;
      case 'citacao': return <blockquote key={indice}><Inline texto={bloco.texto} opcoes={opcoes} /></blockquote>;
      case 'linha': return <hr key={indice} />;
      case 'lista': {
        const itens = bloco.itens.map((item, j) => <li key={j}><Inline texto={item} opcoes={opcoes} /></li>);
        return bloco.ordenada ? <ol key={indice}>{itens}</ol> : <ul key={indice}>{itens}</ul>;
      }
      case 'tabela': return <div className="markdown-tabela" key={indice}><table>
        <thead><tr>{bloco.cabecalho.map((celula, j) => <th key={j} scope="col"><Inline texto={celula} opcoes={opcoes} /></th>)}</tr></thead>
        <tbody>{bloco.linhas.map((linha, j) => <tr key={j}>{bloco.cabecalho.map((_, k) => <td key={k}><Inline texto={linha[k] ?? ''} opcoes={opcoes} /></td>)}</tr>)}</tbody>
      </table></div>;
      case 'codigo':
        if (bloco.linguagem === 'mermaid') return <DiagramaMermaid key={indice} id={`${opcoes.id ?? 'md'}-${String(indice)}`} codigo={bloco.texto} nos={[]} className="markdown-diagrama" />;
        if (bloco.linguagem === 'latex' || bloco.linguagem === 'math') return <div key={indice} className="markdown-formula"><TextoComMatematica texto={`$$${bloco.texto}$$`} /></div>;
        return <pre key={indice}><code>{bloco.texto}</code></pre>;
      default: return null;
    }
  })}</div>;
}
