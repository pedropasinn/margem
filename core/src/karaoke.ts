/**
 * Karaokê palavra a palavra: puro, sem DOM.
 *
 * - `palavrasDoTexto`: as palavras de um trecho do bloco, com um peso de fala (sílabas) e a pausa que a
 *   pontuação pede depois delas.
 * - `estimarPalavras`: sem voz, distribui o tempo da frase pelas palavras, pelo peso de cada uma, no
 *   mesmo ritmo que já vale para a frase (a frase começa e termina onde começava e terminava).
 * - `completarPalavras`: com voz, usa o tempo real de cada palavra alinhada e interpola as que faltam
 *   (pelo peso, entre as vizinhas com tempo, ou pela frase inteira se nenhuma tem).
 * - `palavraDaFraseNoInstante`: a palavra em curso dentro de uma frase, por busca binária.
 */
import type { Id, TrechoTemporizado } from '@margem/contratos';

export interface PalavraDoTexto {
  inicio_utf16: number;
  fim_utf16: number;
  /** Peso de fala (≈ sílabas). */
  peso: number;
  /** Silêncio depois dela, no mesmo peso (vírgula, ponto…); zero na última palavra da frase. */
  pausa: number;
}

/** Uma frase com tempo e o seu texto (o trecho do bloco entre `inicio_utf16` e `fim_utf16`). */
export interface FraseComTexto extends TrechoTemporizado { texto: string }

const PALAVRA = /[\p{L}\p{N}]+(?:[’'‐\-.,/][\p{L}\p{N}]+)*/gu;
const VOGAIS = /[aeiouyáàâãäéèêëíìîïóòôõöúùûüœæ]+/giu;

/** Sílabas aproximadas: grupos de vogais; número conta um pouco por algarismo; sigla, por letra. */
export function silabasDaPalavra(palavra: string): number {
  const digitos = palavra.replace(/[^\p{N}]/gu, '').length;
  if (digitos > 0) return Math.max(1, Math.min(8, Math.ceil(digitos * 1.2)));
  if (/^\p{Lu}{2,5}$/u.test(palavra)) return palavra.length; // "DDD", "API": soletradas
  return Math.max(1, palavra.match(VOGAIS)?.length ?? 1);
}

/** O peso do silêncio que o que vem entre duas palavras pede. */
function pausaDoIntervalo(entre: string): number {
  if (/[.!?…]/u.test(entre)) return 1.4;
  if (/[;:]/u.test(entre)) return 1;
  if (/[,—–()]/u.test(entre)) return 0.6;
  return 0;
}

/** As palavras de `texto`, com offsets somados a `base` (o início do trecho no bloco). */
export function palavrasDoTexto(texto: string, base = 0): PalavraDoTexto[] {
  const achadas = [...texto.matchAll(PALAVRA)];
  return achadas.map((achado, i) => {
    const inicio = achado.index;
    const fim = inicio + achado[0].length;
    const seguinte = achadas[i + 1];
    return {
      inicio_utf16: base + inicio,
      fim_utf16: base + fim,
      // Um pouco pelo tamanho também: "é" e "constitucionalmente" não duram o mesmo por sílaba.
      peso: silabasDaPalavra(achado[0]) + 0.35 + achado[0].length * 0.03,
      pausa: seguinte ? pausaDoIntervalo(texto.slice(fim, seguinte.index)) : 0,
    };
  });
}

/** Distribui [de, ate] pelas palavras, pelo peso (e pela pausa depois de cada uma, menos a última). */
function distribuir(bloco_id: Id, palavras: readonly PalavraDoTexto[], de: number, ate: number): TrechoTemporizado[] {
  if (palavras.length === 0) return [];
  const total = palavras.reduce((soma, p, i) => soma + p.peso + (i < palavras.length - 1 ? p.pausa : 0), 0);
  const unidade = Math.max(0, ate - de) / total;
  let cursor = de;
  return palavras.map((p, i) => {
    const inicio_s = cursor;
    const fim_s = inicio_s + p.peso * unidade;
    cursor = fim_s + (i < palavras.length - 1 ? p.pausa * unidade : 0);
    return { bloco_id, inicio_utf16: p.inicio_utf16, fim_utf16: p.fim_utf16, inicio_s, fim_s };
  });
}

/** Sem voz: o tempo de cada palavra dentro da frase, pelo tamanho dela e pela pontuação. */
export function estimarPalavras(frase: FraseComTexto): TrechoTemporizado[] {
  return distribuir(frase.bloco_id, palavrasDoTexto(frase.texto, frase.inicio_utf16), frase.inicio_s, frase.fim_s);
}

/**
 * Com voz: cada palavra da frase com o tempo real (a palavra alinhada que cobre os mesmos offsets) e,
 * onde o alinhamento falhou, um tempo interpolado entre as vizinhas. Frases sem nenhuma palavra
 * alinhada são estimadas. O resultado sai em ordem de tempo.
 */
export function completarPalavras(frases: readonly FraseComTexto[], alinhadas: readonly TrechoTemporizado[]): TrechoTemporizado[] {
  const porBloco = new Map<Id, TrechoTemporizado[]>();
  for (const p of alinhadas) { const lista = porBloco.get(p.bloco_id) ?? []; lista.push(p); porBloco.set(p.bloco_id, lista); }
  for (const lista of porBloco.values()) lista.sort((a, b) => a.inicio_utf16 - b.inicio_utf16);
  /** A palavra alinhada que cruza [inicio, fim) no bloco (busca binária pela primeira que termina depois do início). */
  const alinhadaEm = (bloco: Id, inicio: number, fim: number): TrechoTemporizado | null => {
    const lista = porBloco.get(bloco);
    if (!lista) return null;
    let baixo = 0;
    let alto = lista.length;
    while (baixo < alto) { const meio = (baixo + alto) >> 1; if (lista[meio]!.fim_utf16 <= inicio) baixo = meio + 1; else alto = meio; }
    const achada = lista[baixo];
    return achada && achada.inicio_utf16 < fim ? achada : null;
  };
  const saida: TrechoTemporizado[] = [];
  for (const frase of frases) {
    const palavras = palavrasDoTexto(frase.texto, frase.inicio_utf16);
    if (palavras.length === 0) {
      // Sem o texto da frase (bloco fora do capítulo carregado): ficam as alinhadas que caem nela.
      saida.push(...(porBloco.get(frase.bloco_id) ?? []).filter((p) => p.inicio_utf16 >= frase.inicio_utf16 && p.fim_utf16 <= frase.fim_utf16));
      continue;
    }
    const tempos = palavras.map((p) => alinhadaEm(frase.bloco_id, p.inicio_utf16, p.fim_utf16));
    let i = 0;
    while (i < palavras.length) {
      const tempo = tempos[i];
      if (tempo) {
        saida.push({ bloco_id: frase.bloco_id, inicio_utf16: palavras[i]!.inicio_utf16, fim_utf16: palavras[i]!.fim_utf16, inicio_s: tempo.inicio_s, fim_s: Math.max(tempo.inicio_s, tempo.fim_s) });
        i += 1;
        continue;
      }
      // Um trecho de palavras sem tempo: entre o fim da anterior (ou o começo da frase) e o começo da seguinte.
      let j = i;
      while (j < palavras.length && !tempos[j]) j += 1;
      const de = i > 0 ? Math.max(tempos[i - 1]!.fim_s, tempos[i - 1]!.inicio_s) : frase.inicio_s;
      const ate = j < palavras.length ? tempos[j]!.inicio_s : Math.max(frase.fim_s, de);
      saida.push(...distribuir(frase.bloco_id, palavras.slice(i, j), de, Math.max(de, ate)));
      i = j;
    }
  }
  return saida.sort((a, b) => a.inicio_s - b.inicio_s);
}

/** Índice da última palavra que já começou no instante (-1 antes da primeira). Busca binária. */
export function ultimaPalavraNoInstante(palavras: readonly Pick<TrechoTemporizado, 'inicio_s'>[], t: number): number {
  let baixo = 0;
  let alto = palavras.length;
  while (baixo < alto) { const meio = (baixo + alto) >> 1; if (palavras[meio]!.inicio_s <= t + 1e-6) baixo = meio + 1; else alto = meio; }
  return baixo - 1;
}

/**
 * A palavra em curso no instante, desde que seja da frase dada: a última que já começou. Entre duas
 * palavras, a anterior fica acesa (como no ElevenReader); antes da primeira da frase, nenhuma.
 */
export function palavraDaFraseNoInstante(palavras: readonly TrechoTemporizado[], frase: Pick<TrechoTemporizado, 'bloco_id' | 'inicio_utf16' | 'fim_utf16'> | null, t: number): TrechoTemporizado | null {
  if (!frase) return null;
  const palavra = palavras[ultimaPalavraNoInstante(palavras, t)];
  if (!palavra || palavra.bloco_id !== frase.bloco_id || palavra.inicio_utf16 < frase.inicio_utf16 || palavra.fim_utf16 > frase.fim_utf16) return null;
  return palavra;
}
