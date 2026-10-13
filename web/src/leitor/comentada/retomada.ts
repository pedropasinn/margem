/**
 * Onde a leitura comentada parou (J92), por documento, e o pedido de continuar no capítulo seguinte.
 * Só neste navegador; sem storage, a leitura começa do início do capítulo.
 */
export interface PontoDaLeitura { secao_id: string; leitura_id: string; t: number }

const chave = (documentoId: string): string => `margem:comentada:${documentoId}`;
const CHAVE_DE_CONTINUAR = 'margem:comentada:continuar';
export const CHAVE_DOS_COMENTARIOS = 'margem:comentada:comentarios';

export function lerPontoDaLeitura(documentoId: string): PontoDaLeitura | null {
  try {
    const bruto = localStorage.getItem(chave(documentoId));
    if (bruto === null) return null;
    const valor = JSON.parse(bruto) as Partial<PontoDaLeitura>;
    return typeof valor.secao_id === 'string' && typeof valor.leitura_id === 'string' && typeof valor.t === 'number' && Number.isFinite(valor.t) && valor.t >= 0
      ? { secao_id: valor.secao_id, leitura_id: valor.leitura_id, t: valor.t } : null;
  } catch { return null; }
}

export function gravarPontoDaLeitura(documentoId: string, ponto: PontoDaLeitura): void {
  try { localStorage.setItem(chave(documentoId), JSON.stringify({ ...ponto, t: Math.round(ponto.t * 10) / 10 })); } catch { /* sem storage */ }
}

export function pedirContinuacaoDaLeitura(documentoId: string, secaoId: string): void {
  try { sessionStorage.setItem(CHAVE_DE_CONTINUAR, JSON.stringify({ documento_id: documentoId, secao_id: secaoId })); } catch { /* sem storage */ }
}

export function consumirContinuacaoDaLeitura(documentoId: string, secaoId: string): boolean {
  try {
    const bruto = sessionStorage.getItem(CHAVE_DE_CONTINUAR);
    if (bruto === null) return false;
    const valor = JSON.parse(bruto) as { documento_id?: unknown; secao_id?: unknown };
    if (valor.documento_id !== documentoId || valor.secao_id !== secaoId) return false;
    sessionStorage.removeItem(CHAVE_DE_CONTINUAR);
    return true;
  } catch { return false; }
}

/** Comentários ligados ou desligados (preferência do navegador; padrão: ligados). */
export function comentariosLigados(): boolean {
  try { return localStorage.getItem(CHAVE_DOS_COMENTARIOS) !== 'off'; } catch { return true; }
}
export function gravarComentariosLigados(ligados: boolean): void {
  try { localStorage.setItem(CHAVE_DOS_COMENTARIOS, ligados ? 'on' : 'off'); } catch { /* sem storage */ }
}
