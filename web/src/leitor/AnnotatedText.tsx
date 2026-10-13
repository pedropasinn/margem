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

function comInline(segmento: Segmento, formatacao?: FormatoDaFonte): ReactNode {
  let conteudo: ReactNode = segmento.texto;
  for (const estilo of ORDEM_INLINE) {
    if (!segmento.inline.includes(estilo)) continue;
    if (estilo === 'codigo') conteudo = <code>{conteudo}</code>;
    else if (estilo === 'negrito') conteudo = <strong>{conteudo}</strong>;
    else if (estilo === 'italico') conteudo = <em>{conteudo}</em>;
    else conteudo = <sup className="nota-ref">{conteudo}</sup>;
  }
  for (const faixa of formatacao?.inline ?? []) {
    if (faixa.inicio <= segmento.inicio_utf16 && segmento.fim_utf16 <= faixa.fim) {
      conteudo = faixa.estilo === 'sobrescrito' ? <sup>{conteudo}</sup> : <sub>{conteudo}</sub>;
    }
  }
  return conteudo;
}

/**
 * Projeção pura de `bloco.texto` + marcas em um `span` por segmento. Nada de HTML vindo do
 * modelo e nenhum `span` por caractere. Estrofes agrupam os segmentos por verso:
 * vale sempre `segmentos.map((s) => s.texto).join('') === bloco.texto`.
 */
export function AnnotatedText({ bloco, marcas, ativa = null, formatacao }: PropsDoTextoAnotado): ReactNode {
  const versos = useMemo(() => {
    const segmentos = segmentar(bloco, marcas).flatMap((segmento) => {
      const limites = [...new Set([segmento.inicio_utf16, segmento.fim_utf16, ...(formatacao?.inline ?? [])
        .flatMap((faixa) => [faixa.inicio, faixa.fim]).filter((ponto) => ponto > segmento.inicio_utf16 && ponto < segmento.fim_utf16)])].sort((a, b) => a - b);
      return limites.slice(0, -1).map((inicio, indice) => ({ ...segmento, inicio_utf16: inicio,
        fim_utf16: limites[indice + 1]!, texto: bloco.texto.slice(inicio, limites[indice + 1]),
      }));
    });
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
  }, [bloco, marcas, formatacao]);
  // Só o primeiro segmento de cada marca recebe `tabIndex`: o Tab percorre trechos, não fatias.
  const jaVistas = new Set<Id>();
  return (
    <>
      {versos.map((segmentos) => {
        const conteudo = segmentos.map((segmento) => {
          const abreMarca = segmento.marca_ids.some((id) => !jaVistas.has(id));
          for (const id of segmento.marca_ids) jaVistas.add(id);
          return (
            <span
              key={`${bloco.id}:${segmento.inicio_utf16}`}
              className={classesDoSegmento(segmento, ativa)}
              data-inicio={segmento.inicio_utf16}
              data-editorial={segmento.marca_ids.find((id) => marcas.some((m) => m.id === id && m.funcao !== 'nenhuma'))}
              {...(segmento.marca_ids.length > 0 ? { 'data-marcas': segmento.marca_ids.join(' ') } : {})}
              {...(abreMarca ? { tabIndex: 0 } : {})}
            >
              {comInline(segmento, formatacao)}
            </span>
          );
        });
        return bloco.tipo === 'estrofe' ? <span className="verso" key={segmentos[0]?.inicio_utf16}>{conteudo}</span> : conteudo;
      })}
    </>
  );
}
