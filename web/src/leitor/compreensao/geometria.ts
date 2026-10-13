/**
 * Onde, na tela, estão um trecho e uma faixa de blocos (J31). Serve à leitura guiada (foco) e aos
 * braquetes, nos dois leitores (texto e PDF), só pela superfície `ApiDoLeitor`.
 */
import type { AncoraV1, Bloco } from '@margem/contratos';
import type { ApiDoLeitor } from '../tipos';

export interface Faixa { topo: number; base: number; esquerda: number; direita: number }

function juntar(retangulos: readonly DOMRect[]): Faixa | null {
  const validos = retangulos.filter((r) => r.width > 0 || r.height > 0);
  if (validos.length === 0) return null;
  return {
    topo: Math.min(...validos.map((r) => r.top)), base: Math.max(...validos.map((r) => r.bottom)),
    esquerda: Math.min(...validos.map((r) => r.left)), direita: Math.max(...validos.map((r) => r.right)),
  };
}

/** O bloco inteiro como âncora, para pedir os retângulos ao leitor. */
export function ancoraDoBloco(versaoId: string, bloco: Pick<Bloco, 'id' | 'texto'>): AncoraV1 {
  return { versao_id: versaoId, bloco_id: bloco.id, inicio_utf16: 0, fim_utf16: bloco.texto.length, citacao: bloco.texto, prefixo: '', sufixo: '' };
}

export function faixaDaAncora(api: ApiDoLeitor | null, ancora: AncoraV1): Faixa | null {
  if (!api) return null;
  const retangulos = api.retangulosDaAncora?.(ancora) ?? [];
  const faixa = juntar(retangulos);
  if (faixa) return faixa;
  const inicio = api.localizar(ancora.bloco_id, ancora.inicio_utf16);
  const fim = api.localizar(ancora.bloco_id, ancora.fim_utf16);
  return juntar([inicio, fim].filter((r): r is DOMRect => r !== null));
}

/** Da primeira à última linha dos blocos `[inicio, fim]` (inclusive), na ordem do capítulo. */
export function faixaDosBlocos(api: ApiDoLeitor | null, versaoId: string, blocos: readonly Pick<Bloco, 'id' | 'texto'>[], inicio: string, fim: string): Faixa | null {
  const a = blocos.findIndex((bloco) => bloco.id === inicio);
  const b = blocos.findIndex((bloco) => bloco.id === fim);
  if (a === -1 || b === -1) return null;
  const faixas = blocos.slice(a, b + 1).map((bloco) => faixaDaAncora(api, ancoraDoBloco(versaoId, bloco))).filter((item): item is Faixa => item !== null);
  if (faixas.length === 0) return null;
  return {
    topo: Math.min(...faixas.map((f) => f.topo)), base: Math.max(...faixas.map((f) => f.base)),
    esquerda: Math.min(...faixas.map((f) => f.esquerda)), direita: Math.max(...faixas.map((f) => f.direita)),
  };
}

/** Faixas que se sobrepõem na vertical vão para pistas diferentes (braquetes lado a lado). */
export function distribuirEmPistas<T extends { topo: number; base: number }>(itens: readonly T[]): (T & { pista: number })[] {
  const ordenados = [...itens].sort((a, b) => a.topo - b.topo || b.base - a.base);
  const fimDaPista: number[] = [];
  return ordenados.map((item) => {
    let pista = fimDaPista.findIndex((fim) => fim < item.topo - 4);
    if (pista === -1) { pista = fimDaPista.length; fimDaPista.push(item.base); } else fimDaPista[pista] = item.base;
    return { ...item, pista };
  });
}
