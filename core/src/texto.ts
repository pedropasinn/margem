import { fronteiraUtf16 } from '@margem/contratos/texto';

/** Comprimento em unidades UTF-16, a mesma convenção de `String.length` e das âncoras. */
export function comprimentoUtf16(texto: string): number {
  return texto.length;
}

/** Um índice só é limite válido se não parte um par substituto (regra dos contratos). */
export function ehLimiteValido(texto: string, indice: number): boolean {
  return fronteiraUtf16(texto, indice);
}

/** Fatia recusando qualquer corte no meio de um par substituto. */
export function fatiaSegura(texto: string, inicio: number, fim: number): string {
  if (!Number.isSafeInteger(inicio) || !Number.isSafeInteger(fim)) throw new Error('Limites precisam ser inteiros seguros.');
  if (inicio < 0 || fim > texto.length || inicio > fim) throw new Error('Limites fora do texto.');
  if (!ehLimiteValido(texto, inicio) || !ehLimiteValido(texto, fim)) throw new Error('Limite corta um par substituto UTF-16.');
  return texto.slice(inicio, fim);
}

export interface Paragrafo {
  texto: string;
  inicio: number;
  fim: number;
  separador: string;
}

/** Equivalente a `splitParagraphs` do Horarium: separa por linha em branco, sem normalizar nada. */
export function paragrafosDe(rawText: string): Paragrafo[] {
  const partes: Paragrafo[] = [];
  const separador = /\r?\n\r?\n/g;
  let inicio = 0;
  let achado: RegExpExecArray | null = separador.exec(rawText);
  while (achado) {
    partes.push({ texto: rawText.slice(inicio, achado.index), inicio, fim: achado.index, separador: achado[0] });
    inicio = achado.index + achado[0].length;
    achado = separador.exec(rawText);
  }
  partes.push({ texto: rawText.slice(inicio), inicio, fim: rawText.length, separador: '' });
  return partes;
}
