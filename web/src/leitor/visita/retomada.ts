/**
 * Onde a visita parou (J91), por documento, e o pedido de continuar no capítulo seguinte. Só neste
 * navegador (`localStorage`/`sessionStorage`); sem storage, a visita começa do início.
 */
export interface PontoDaVisita { secao_id: string; roteiro_id: string; t: number }

const chave = (documentoId: string): string => `margem:visita:${documentoId}`;
const CHAVE_DE_CONTINUAR = 'margem:visita:continuar';

export function lerPonto(documentoId: string): PontoDaVisita | null {
  try {
    const bruto = localStorage.getItem(chave(documentoId));
    if (bruto === null) return null;
    const valor = JSON.parse(bruto) as Partial<PontoDaVisita>;
    return typeof valor.secao_id === 'string' && typeof valor.roteiro_id === 'string' && typeof valor.t === 'number' && Number.isFinite(valor.t) && valor.t >= 0
      ? { secao_id: valor.secao_id, roteiro_id: valor.roteiro_id, t: valor.t } : null;
  } catch { return null; }
}

export function gravarPonto(documentoId: string, ponto: PontoDaVisita): void {
  try { localStorage.setItem(chave(documentoId), JSON.stringify({ ...ponto, t: Math.round(ponto.t * 10) / 10 })); } catch { /* sem storage */ }
}

/** Ao passar para o próximo capítulo, a visita pede para continuar tocando lá. */
export function pedirContinuacao(documentoId: string, secaoId: string): void {
  try { sessionStorage.setItem(CHAVE_DE_CONTINUAR, JSON.stringify({ documento_id: documentoId, secao_id: secaoId })); } catch { /* sem storage */ }
}

/** Consome o pedido de continuar, se for deste capítulo. */
export function consumirContinuacao(documentoId: string, secaoId: string): boolean {
  try {
    const bruto = sessionStorage.getItem(CHAVE_DE_CONTINUAR);
    if (bruto === null) return false;
    const valor = JSON.parse(bruto) as { documento_id?: unknown; secao_id?: unknown };
    if (valor.documento_id !== documentoId || valor.secao_id !== secaoId) return false;
    sessionStorage.removeItem(CHAVE_DE_CONTINUAR);
    return true;
  } catch { return false; }
}
