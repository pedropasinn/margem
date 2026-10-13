/**
 * A forma do documento: um livro (vários capítulos, com índice e navegação entre eles) ou um texto
 * único (um artigo, um ensaio, um texto colado), que se lê como uma página só — sem índice, sem
 * "capítulo 1 de 1", com o fim do texto no lugar do próximo capítulo.
 */
import { createContext, useContext } from 'react';

export type FormaDoDocumento = 'livro' | 'texto';

/** Um só capítulo (o motor cria um quando o original não tem títulos) é um texto único. */
export function formaDoDocumento(capitulos: readonly unknown[]): FormaDoDocumento {
  return capitulos.length <= 1 ? 'texto' : 'livro';
}

/** Como a unidade de leitura se chama nos rótulos: "Mapa do capítulo" ou "Mapa do texto". */
export function nomeDaUnidade(forma: FormaDoDocumento): 'capítulo' | 'texto' {
  return forma === 'texto' ? 'texto' : 'capítulo';
}

export const ContextoDaForma = createContext<FormaDoDocumento>('livro');
export function usarForma(): FormaDoDocumento { return useContext(ContextoDaForma); }

/** Leitura de estudo, a mesma do `core/src/tempo.ts`: 180 palavras por minuto, no mínimo 1 minuto. */
export function minutosDeLeitura(textos: readonly string[]): number {
  const palavras = textos.reduce((total, texto) => total + (texto.match(/\S+/g)?.length ?? 0), 0);
  return Math.max(1, Math.round(palavras / 180));
}
