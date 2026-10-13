import { createHash } from 'node:crypto';
import type { Bloco, MarcaV1, MarcaV2 } from './tipos';

export function unicodeValido(valor: unknown): boolean {
  if (typeof valor === 'string') return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(valor);
  if (Array.isArray(valor)) return valor.every(unicodeValido);
  if (valor !== null && typeof valor === 'object') return Object.entries(valor).every(([chave, item]) => unicodeValido(chave) && unicodeValido(item));
  return true;
}

/** JSON compacto; chaves de objetos em ordem lexicográfica, sem normalizar texto. */
export function serializarEstavel(valor: unknown): string {
  if (valor === null || typeof valor === 'boolean' || typeof valor === 'string') return JSON.stringify(valor);
  if (typeof valor === 'number' && Number.isFinite(valor)) return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map(serializarEstavel).join(',')}]`;
  if (typeof valor === 'object' && valor !== null) {
    return `{${Object.entries(valor).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([chave, item]) => `${JSON.stringify(chave)}:${serializarEstavel(item)}`).join(',')}}`;
  }
  throw new Error('Valor não representável em JSON.');
}

export function sha256(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

/** A ordem recebida é canônica; não reordena nem normaliza os blocos. */
export function hashEstrutural(blocos: readonly Pick<Bloco, 'id' | 'tipo' | 'texto'>[]): string {
  const tuplas = blocos.map(({ id, tipo, texto }) => [id, tipo, texto]);
  if (!unicodeValido(tuplas)) throw new Error('Unicode inválido.');
  return sha256(JSON.stringify(tuplas));
}

export interface ProjecaoRawText {
  raw_text: string;
  offsets: Record<string, { inicio_utf16: number; fim_utf16: number }>;
}
export function projetarRawText(blocos: readonly Pick<Bloco, 'id' | 'texto'>[]): ProjecaoRawText {
  if (!unicodeValido(blocos)) throw new Error('Unicode inválido.');
  let inicio = 0;
  const entradas = blocos.map((bloco) => {
    const faixa = { inicio_utf16: inicio, fim_utf16: inicio + bloco.texto.length };
    inicio = faixa.fim_utf16 + 2;
    return [bloco.id, faixa] as const;
  });
  if (new Set(blocos.map((bloco) => bloco.id)).size !== blocos.length) throw new Error('Blocos duplicados.');
  return { raw_text: blocos.map((bloco) => bloco.texto).join('\n\n'), offsets: Object.fromEntries(entradas) };
}

/** Serve às duas versões de marca; um conjunto não mistura V1 e V2 por convenção do chamador. */
export function hashMarcas(marcas: readonly (MarcaV1 | MarcaV2)[]): string {
  return sha256(serializarEstavel([...marcas].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}
