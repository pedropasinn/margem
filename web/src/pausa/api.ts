/**
 * Trabalho do Codex em pausa (V-F1): o cliente das rotas de `servico/src/http/rotas-pausa.ts`. O que ficou
 * parado desde antes de o app abrir espera a pessoa mandar retomar ou descartar.
 */
import { escrever, pedir } from '../biblioteca/api';

export interface ItemEmPausa { ids: string[]; rotulo: string; quantidade: number; desde: string }
export interface GrupoEmPausa { documento_id: string | null; titulo: string | null; itens: ItemEmPausa[] }
export interface TrabalhosEmPausa { total: number; desde: string | null; grupos: GrupoEmPausa[] }
/** `todos`, ou os ids de um item da lista. */
export type AlvoDaPausa = { todos: true } | { ids: readonly string[] };

export const VAZIO: TrabalhosEmPausa = { total: 0, desde: null, grupos: [] };

/** Um serviço anterior à pausa responde 404: vale como "nada em pausa". */
export function normalizarPausa(valor: unknown): TrabalhosEmPausa {
  if (typeof valor !== 'object' || valor === null) return VAZIO;
  const v = valor as Partial<TrabalhosEmPausa>;
  if (typeof v.total !== 'number' || !Array.isArray(v.grupos)) return VAZIO;
  return { total: v.total, desde: typeof v.desde === 'string' ? v.desde : null, grupos: v.grupos };
}

export const trabalhosEmPausa = async (): Promise<TrabalhosEmPausa> => normalizarPausa(await pedir<unknown>('/api/trabalhos-em-pausa'));
export const retomarEmPausa = async (alvo: AlvoDaPausa): Promise<TrabalhosEmPausa> =>
  normalizarPausa(await escrever<unknown>('/api/trabalhos-em-pausa/retomar', alvo));
export const descartarEmPausa = async (alvo: AlvoDaPausa): Promise<TrabalhosEmPausa> =>
  normalizarPausa(await escrever<unknown>('/api/trabalhos-em-pausa/descartar', alvo));

export interface FontesDaPausa {
  listar: () => Promise<TrabalhosEmPausa>;
  retomar: (alvo: AlvoDaPausa) => Promise<TrabalhosEmPausa>;
  descartar: (alvo: AlvoDaPausa) => Promise<TrabalhosEmPausa>;
}
export const FONTES_DA_PAUSA: FontesDaPausa = { listar: trabalhosEmPausa, retomar: retomarEmPausa, descartar: descartarEmPausa };
