/** Regras de texto compartilhadas entre Node e navegador, sem dependências de runtime. */
import type { AncoraV1, Bloco, Faixa } from './tipos';

export function fronteiraUtf16(texto: string, indice: number): boolean {
  return Number.isSafeInteger(indice) && indice >= 0 && indice <= texto.length &&
    !(indice > 0 && indice < texto.length && /[\uD800-\uDBFF]/u.test(texto[indice - 1] ?? '') && /[\uDC00-\uDFFF]/u.test(texto[indice] ?? ''));
}
/**
 * Regra V1.1 da `estrofe`: versos separados só por LF, nenhum verso vazio ou só de espaços,
 * sem LF no começo nem no fim; CR, U+2028 e U+2029 são recusados.
 */
export function versosValidos(texto: string): boolean {
  return texto.length > 0 && !/[\r\u2028\u2029]/u.test(texto) && texto.split('\n').every((verso) => /\S/u.test(verso));
}
/** Faixas UTF-16 de cada verso, relativas ao texto do bloco. */
export function faixasDosVersos(texto: string): Faixa[] {
  if (!versosValidos(texto)) throw new Error('Estrofe inválida.');
  let inicio = 0;
  return texto.split('\n').map((verso) => {
    const faixa = { inicio_utf16: inicio, fim_utf16: inicio + verso.length };
    inicio = faixa.fim_utf16 + 1;
    return faixa;
  });
}
export function conferirTextoAncora(bloco: Pick<Bloco, 'id' | 'texto'>, ancora: AncoraV1): boolean {
  return bloco.id === ancora.bloco_id && fronteiraUtf16(bloco.texto, ancora.inicio_utf16) &&
    fronteiraUtf16(bloco.texto, ancora.fim_utf16) && bloco.texto.slice(ancora.inicio_utf16, ancora.fim_utf16) === ancora.citacao &&
    bloco.texto.slice(0, ancora.inicio_utf16).endsWith(ancora.prefixo) && bloco.texto.slice(ancora.fim_utf16).startsWith(ancora.sufixo);
}
