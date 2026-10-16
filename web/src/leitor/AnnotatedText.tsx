import type { FormatoDaFonte } from './tipos';
import type { MarcaDoLeitor } from './f2';
import { useMemo, type ReactNode } from 'react';
import type { Bloco, Id } from '@margem/contratos';
import { segmentar, type SegmentoDoLeitor as Segmento } from './segmentos';

export interface PropsDoTextoAnotado {
  bloco: Pick<Bloco, 'id' | 'texto' | 'inline'> & Partial<Pick<Bloco, 'tipo'>>;
  marcas: readonly MarcaDoLeitor[];
  formatacao?: FormatoDaFonte | undefined;
  /** Marca ativa (J09): muda o sublinhado do trecho, nunca o fundo nem o peso. */
  ativa?: Id | null;
}

/** Ordem fixa de aninhamento: o código fica por dentro, a chamada de nota por fora. */
const ORDEM_INLINE = ['codigo', 'negrito', 'italico', 'nota_ref'] as const;

function classesDoSegmento(segmento: Segmento, ativa: Id | null): string | undefined {
  const classes = ['segmento'];
  if (segmento.funcao) classes.push(`marca-${segmento.funcao}`);
  if (segmento.enfase) classes.push('enfase');
  if (ativa !== null && segmento.marca_ids.includes(ativa)) classes.push('ativa');
  return classes.join(' ');
}

/** O bloco da nota a que a chamada aponta (`nota_ref` com `ref`), se a faixa cobre o segmento. */
function notaDoSegmento(bloco: PropsDoTextoAnotado['bloco'], segmento: Segmento): Id | undefined {
  return bloco.inline.find((faixa) => faixa.estilo === 'nota_ref' && faixa.ref !== undefined
    && faixa.inicio <= segmento.inicio_utf16 && segmento.fim_utf16 <= faixa.fim)?.ref;
}

function comInline(segmento: Segmento, bloco: PropsDoTextoAnotado['bloco'], formatacao?: FormatoDaFonte): ReactNode {
  let conteudo: ReactNode = segmento.texto;
  for (const estilo of ORDEM_INLINE) {
    if (!segmento.inline.includes(estilo)) continue;
    if (estilo === 'codigo') conteudo = <code>{conteudo}</code>;
    else if (estilo === 'negrito') conteudo = <strong>{conteudo}</strong>;
    else if (estilo === 'italico') conteudo = <em>{conteudo}</em>;
    else {
      // A chamada ligada à nota vira link: o leitor abre a nota no lugar (`ChapterContent`), mesmo de outro capítulo.
      const nota = notaDoSegmento(bloco, segmento);
      conteudo = <sup className="nota-ref">{nota === undefined ? conteudo
        : <a className="nota-ref-link" href={`#rodape-${nota}`} data-rodape={nota} aria-haspopup="dialog" aria-expanded="false" aria-label={`Nota ${segmento.texto.trim()}`}>{conteudo}</a>}</sup>;
    }
  }
  for (const faixa of formatacao?.inline ?? []) {
    if (faixa.inicio <= segmento.inicio_utf16 && segmento.fim_utf16 <= faixa.fim) {
      conteudo = faixa.estilo === 'sobrescrito' ? <sup>{conteudo}</sup> : <sub>{conteudo}</sub>;
    }
  }
  return conteudo;
}

/** Corta os segmentos nos pontos dados (sem mudar nenhum caractere nem offset). */
function partir<T extends Segmento>(segmentos: readonly T[], texto: string, pontos: readonly number[]): T[] {
  return segmentos.flatMap((segmento) => {
    const limites = [...new Set([segmento.inicio_utf16, segmento.fim_utf16, ...pontos
      .filter((ponto) => ponto > segmento.inicio_utf16 && ponto < segmento.fim_utf16)])].sort((a, b) => a - b);
    return limites.slice(0, -1).map((inicio, indice) => ({ ...segmento, inicio_utf16: inicio,
      fim_utf16: limites[indice + 1]!, texto: texto.slice(inicio, limites[indice + 1]) }));
  });
}

/** Separadores da tabela linearizada do EPUB: `\n` entre linhas, ` | ` entre células. */
const SEPARADOR_DA_TABELA = /\n| \| /g;

/**
 * A tabela só vira grade quando o texto é inequívoco: no máximo uma linha de legenda (sem ` | `) no
 * começo, e todas as outras com o mesmo número de células (duas ou mais). Senão, fica o texto com as quebras.
 */
export function linhasDaTabela(texto: string): { legenda: number } | null {
  const linhas = texto.split('\n');
  const legenda = linhas[0]?.includes(' | ') === false ? 1 : 0;
  const corpo = linhas.slice(legenda);
  const celulas = corpo[0]?.split(' | ').length ?? 0;
  return corpo.length > 0 && celulas >= 2 && corpo.every((linha) => linha.split(' | ').length === celulas) ? { legenda } : null;
}

interface Pedaco extends Segmento { separador?: boolean; fecha?: 'linha' | 'celula' }

/**
 * Projeção pura de `bloco.texto` + marcas em um `span` por segmento. Nada de HTML vindo do
 * modelo e nenhum `span` por caractere. Estrofes agrupam os segmentos por verso, e tabelas por
 * linha e célula (os separadores continuam no DOM, escondidos):
 * vale sempre `segmentos.map((s) => s.texto).join('') === bloco.texto`.
 */
export function AnnotatedText({ bloco, marcas, ativa = null, formatacao }: PropsDoTextoAnotado): ReactNode {
  const tabela = useMemo(() => bloco.tipo === 'tabela' ? linhasDaTabela(bloco.texto) : null, [bloco.tipo, bloco.texto]);
  const versos = useMemo(() => {
    const segmentos: Pedaco[] = partir(segmentar(bloco, marcas), bloco.texto, (formatacao?.inline ?? []).flatMap((faixa) => [faixa.inicio, faixa.fim]));
    if (tabela) {
      const separadores = [...bloco.texto.matchAll(SEPARADOR_DA_TABELA)].map((achado) => ({ inicio: achado.index, fim: achado.index + achado[0].length }));
      return [partir(segmentos, bloco.texto, separadores.flatMap((s) => [s.inicio, s.fim])).map((pedaco): Pedaco => {
        // Uma marca pode cortar o separador em dois pedaços: só o último fecha a célula ou a linha.
        const separador = separadores.find((s) => s.inicio <= pedaco.inicio_utf16 && pedaco.fim_utf16 <= s.fim);
        if (!separador) return pedaco;
        const fecha = pedaco.fim_utf16 !== separador.fim ? undefined : separador.fim - separador.inicio === 1 ? 'linha' : 'celula';
        return { ...pedaco, separador: true, ...(fecha ? { fecha } : {}) };
      })];
    }
    if (bloco.tipo !== 'estrofe') return [segmentos];
    // Quebra só a projeção, conservando cada caractere e os offsets do bloco.
    const linhas: typeof segmentos[] = [[]];
    for (const segmento of segmentos) {
      let inicio = segmento.inicio_utf16;
      for (const texto of segmento.texto.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
        linhas[linhas.length - 1]!.push({ ...segmento, texto, inicio_utf16: inicio, fim_utf16: inicio + texto.length });
        inicio += texto.length;
        if (texto.endsWith('\n')) linhas.push([]);
      }
    }
    return linhas.filter((linha) => linha.length > 0);
  }, [bloco, marcas, formatacao, tabela]);
  // Só o primeiro segmento de cada marca recebe `tabIndex`: o Tab percorre trechos, não fatias.
  const jaVistas = new Set<Id>();
  const desenhar = (segmento: Pedaco) => {
    // Um separador escondido não recebe o foco: ele fica com o primeiro pedaço visível da marca.
    const abreMarca = !segmento.separador && segmento.marca_ids.some((id) => !jaVistas.has(id));
    if (!segmento.separador) for (const id of segmento.marca_ids) jaVistas.add(id);
    return (
      <span
        key={`${bloco.id}:${segmento.inicio_utf16}`}
        className={`${classesDoSegmento(segmento, ativa) ?? ''}${segmento.separador ? ' separador-da-tabela' : ''}`}
        data-inicio={segmento.inicio_utf16}
        data-editorial={segmento.marca_ids.find((id) => marcas.some((m) => m.id === id && m.funcao !== 'nenhuma'))}
        {...(segmento.marca_ids.length > 0 ? { 'data-marcas': segmento.marca_ids.join(' ') } : {})}
        {...(abreMarca ? { tabIndex: 0 } : {})}
        {...(segmento.separador ? { 'aria-hidden': true } : {})}
      >
        {comInline(segmento, bloco, formatacao)}
      </span>
    );
  };
  if (tabela) {
    // Linhas e células na ordem do texto; o separador fica no fim da célula (` | `) ou da linha (`\n`).
    const linhas: Pedaco[][][] = [[[]]];
    for (const pedaco of versos[0] ?? []) {
      const linha = linhas[linhas.length - 1]!;
      linha[linha.length - 1]!.push(pedaco);
      if (pedaco.fecha === 'linha') linhas.push([[]]);
      else if (pedaco.fecha === 'celula') linha.push([]);
    }
    return <>{linhas.map((celulas, indice) => indice < tabela.legenda
      ? <span key={`l${String(indice)}`} className="tabela-legenda">{celulas.flat().map(desenhar)}</span>
      : <span key={`l${String(indice)}`} className="tabela-linha" role="row">
        {celulas.map((celula, coluna) => <span key={String(coluna)} className="tabela-celula" role="cell">{celula.map(desenhar)}</span>)}
      </span>)}</>;
  }
  return (
    <>
      {versos.map((segmentos) => {
        const conteudo = segmentos.map(desenhar);
        return bloco.tipo === 'estrofe' ? <span className="verso" key={segmentos[0]?.inicio_utf16}>{conteudo}</span> : conteudo;
      })}
    </>
  );
}
