import type { Bloco, Faixa, Funcao, Id, MarcaV1 } from '@margem/contratos';
import { fatiaSegura } from './texto';

export type EstiloInline = Bloco['inline'][number]['estilo'];
export type FuncaoDeSegmento = Exclude<Funcao, 'nenhuma'> | null;

export interface Segmento extends Faixa {
  texto: string;
  marca_ids: Id[];
  funcao: FuncaoDeSegmento;
  enfase: boolean;
  inline: EstiloInline[];
}

export interface OpcoesDeSegmentacao {
  /** Inclui marcas ocultas ou não resolvidas (revisão editorial, diagnóstico). */
  incluirOcultas?: boolean;
}

function cobre(faixa: Faixa, inicio: number, fim: number): boolean {
  return faixa.inicio_utf16 <= inicio && fim <= faixa.fim_utf16;
}

/**
 * Projeta bloco + marcas em segmentos contíguos: um por trecho de formatação homogênea.
 * Os limites vêm das âncoras, das subfaixas e dos intervalos inline; nunca há um segmento
 * por caractere. Vale sempre `segmentos.map((s) => s.texto).join('') === bloco.texto`.
 */
export function segmentar(
  bloco: Pick<Bloco, 'id' | 'texto' | 'inline'>,
  marcas: readonly MarcaV1[],
  opcoes: OpcoesDeSegmentacao = {},
): Segmento[] {
  const visiveis = marcas.filter((marca) =>
    marca.ancora.bloco_id === bloco.id &&
    (opcoes.incluirOcultas === true || (marca.visivel && marca.validade === 'resolvida')));
  const fim = bloco.texto.length;
  const dentro = (valor: number): boolean => valor > 0 && valor < fim;
  const limites = new Set<number>([0, fim]);
  for (const marca of visiveis) {
    for (const faixa of [marca.ancora, ...marca.subfaixas]) {
      if (dentro(faixa.inicio_utf16)) limites.add(faixa.inicio_utf16);
      if (dentro(faixa.fim_utf16)) limites.add(faixa.fim_utf16);
    }
  }
  for (const trecho of bloco.inline) {
    if (dentro(trecho.inicio)) limites.add(trecho.inicio);
    if (dentro(trecho.fim)) limites.add(trecho.fim);
  }
  const ordenados = [...limites].sort((a, b) => a - b);
  const segmentos: Segmento[] = [];
  for (let i = 0; i + 1 < ordenados.length; i++) {
    const inicio = ordenados[i];
    const termino = ordenados[i + 1];
    if (inicio === undefined || termino === undefined || inicio === termino) continue;
    const cobrindo = visiveis.filter((marca) => cobre(marca.ancora, inicio, termino));
    const comFuncao = cobrindo.find((marca) => marca.funcao !== 'nenhuma');
    segmentos.push({
      inicio_utf16: inicio,
      fim_utf16: termino,
      texto: fatiaSegura(bloco.texto, inicio, termino),
      marca_ids: cobrindo.map((marca) => marca.id),
      funcao: comFuncao && comFuncao.funcao !== 'nenhuma' ? comFuncao.funcao : null,
      enfase: cobrindo.some((marca) => marca.subfaixas.some((faixa) => cobre(faixa, inicio, termino))),
      inline: bloco.inline
        .filter((trecho) => cobre({ inicio_utf16: trecho.inicio, fim_utf16: trecho.fim }, inicio, termino))
        .map((trecho) => trecho.estilo)
        .filter((estilo, indice, todos) => todos.indexOf(estilo) === indice),
    });
  }
  return segmentos;
}

/** Converte (segmento, deslocamento dentro dele) no offset UTF-16 do bloco. */
export function offsetDeSegmento(segmentos: readonly Segmento[], indice: number, deslocamentoLocal: number): number {
  const segmento = segmentos[indice];
  if (!Number.isSafeInteger(indice) || !segmento) throw new Error('Índice de segmento fora da lista.');
  if (!Number.isSafeInteger(deslocamentoLocal) || deslocamentoLocal < 0 || deslocamentoLocal > segmento.texto.length) {
    throw new Error('Deslocamento fora do segmento.');
  }
  return segmento.inicio_utf16 + deslocamentoLocal;
}
