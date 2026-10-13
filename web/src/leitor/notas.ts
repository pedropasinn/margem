import type { MarcaDoLeitor } from './f2';
import type { Bloco, Id } from '@margem/contratos';

/** Recortes do menu do leitor: o que aparece no texto e na margem. */
export type RecorteDeMarcas = 'todas' | 'confirmadas' | 'ocultas';
export type OrigemDeMarca = MarcaDoLeitor['origem'];

export interface FiltroDeMarcas {
  recorte: RecorteDeMarcas;
  /** Uma origem só, ou os dois grupos dos chips do Caderno: `ia` (tudo o que não é do leitor) e `manual`. */
  origem: OrigemDeMarca | 'todas' | 'ia';
}

export const FILTRO_PADRAO: FiltroDeMarcas = { recorte: 'todas', origem: 'todas' };

export const ROTULOS_DO_RECORTE: Record<RecorteDeMarcas, string> = {
  todas: 'Todas', confirmadas: 'Confirmadas', ocultas: 'Ocultas',
};

export const ROTULOS_DA_ORIGEM: Record<OrigemDeMarca, string> = {
  parte: 'leitura', revisao_consistencia: 'revisão de consistência',
  revisao_cobertura: 'revisão de cobertura', manual: 'manual', importacao: 'importação',
  projecao: 'compreensão do capítulo',
};

/**
 * Recorte das marcas. `todas` e `confirmadas` só trazem marcas visíveis e resolvidas — as
 * únicas que `segmentar` sublinha; `ocultas` traz as escondidas, para poder devolvê-las.
 */
export function marcasFiltradas(marcas: readonly MarcaDoLeitor[], filtro: FiltroDeMarcas): MarcaDoLeitor[] {
  return marcas.filter((marca) => {
    if (filtro.origem === 'ia' ? marca.origem === 'manual' : filtro.origem !== 'todas' && marca.origem !== filtro.origem) return false;
    if (filtro.recorte === 'ocultas') return !marca.visivel;
    if (!marca.visivel || marca.validade !== 'resolvida') return false;
    return filtro.recorte === 'todas' || marca.avaliacao === 'confirmada';
  });
}

/** As origens presentes no capítulo, para o filtro não oferecer o que não existe. */
export function origensPresentes(marcas: readonly MarcaDoLeitor[]): OrigemDeMarca[] {
  const vistas = new Set<OrigemDeMarca>();
  for (const marca of marcas) vistas.add(marca.origem);
  return [...vistas];
}

export interface Nota {
  marca: MarcaDoLeitor;
  numero: number;
  comentario: NonNullable<MarcaDoLeitor['comentario']>;
}

/** Ordem do capítulo: ordem do bloco e, dentro dele, início da âncora. */
function ordenarPeloTexto(blocos: readonly Bloco[], marcas: readonly MarcaDoLeitor[]): MarcaDoLeitor[] {
  const posicao = new Map<Id, number>(blocos.map((bloco, indice) => [bloco.id, indice]));
  return [...marcas].sort((a, b) => {
    const diferenca = (posicao.get(a.ancora.bloco_id) ?? Infinity) - (posicao.get(b.ancora.bloco_id) ?? Infinity);
    return diferenca !== 0 ? diferenca : a.ancora.inicio_utf16 - b.ancora.inicio_utf16;
  });
}

/** Uma nota por marca com comentário, numerada na ordem do capítulo. */
export function notasDoCapitulo(blocos: readonly Bloco[], marcas: readonly MarcaDoLeitor[]): Nota[] {
  const notas: Nota[] = [];
  for (const marca of ordenarPeloTexto(blocos, marcas)) {
    if (marca.comentario === null) continue;
    notas.push({ marca, numero: notas.length + 1, comentario: marca.comentario });
  }
  return notas;
}

/** Marcas do capítulo em ordem de leitura: é a ordem que o Tab percorre. */
export function marcasEmOrdem(blocos: readonly Bloco[], marcas: readonly MarcaDoLeitor[]): MarcaDoLeitor[] {
  return ordenarPeloTexto(blocos, marcas);
}

/** Aplica uma mudança local (otimista) sobre a lista vinda do servidor. */
export type MudancaDeMarca = { visivel: boolean } | { avaliacao: MarcaDoLeitor['avaliacao'] };

export function comMudanca(marcas: readonly MarcaDoLeitor[], id: Id, mudanca: MudancaDeMarca): MarcaDoLeitor[] {
  return marcas.map((marca) => (marca.id === id ? { ...marca, ...mudanca } : marca));
}
