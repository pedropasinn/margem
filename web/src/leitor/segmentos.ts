import type { Bloco, MarcaV1 } from '@margem/contratos';
import { segmentar as segmentarNucleo, type Segmento } from '@margem/core/segmentos';
import type { MarcaDoLeitor } from './f2';
export interface SegmentoDoLeitor extends Omit<Segmento, 'funcao'> { funcao: string | null }
/** O núcleo resolve os intervalos; a função visual vem da camada, em ordem de precedência. */
export function segmentar(bloco: Pick<Bloco, 'id' | 'texto' | 'inline'>, marcas: readonly MarcaDoLeitor[]): SegmentoDoLeitor[] {
  marcas = marcas.filter(m => m.ancora.bloco_id === bloco.id);
  // O núcleo só usa os intervalos: a origem `projecao` (V2) vira `parte` para caber no tipo V1.
  const intervalos: MarcaV1[] = marcas.map((m) => ({ ...m, origem: m.origem === 'projecao' ? 'parte' : m.origem, funcao: 'nenhuma', comentario: null }));
  return segmentarNucleo(bloco, intervalos).map((s) => ({ ...s,
    funcao: marcas.find((m) => s.marca_ids.includes(m.id) && m.funcao !== 'nenhuma')?.funcao ?? null,
  }));
}
