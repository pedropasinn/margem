import { describe, expect, test } from 'vitest';
import { completarPalavras, estimarPalavras, palavraDaFraseNoInstante, palavrasDoTexto, silabasDaPalavra, ultimaPalavraNoInstante } from './karaoke';

const B = 'B1';

describe('karaokê palavra a palavra', () => {
  test('palavras do texto: offsets no bloco, sílabas e pausa da pontuação', () => {
    const palavras = palavrasDoTexto('Sim, a arquitetura importa. Fim', 10);
    expect(palavras.map((p) => [p.inicio_utf16, p.fim_utf16])).toEqual([[10, 13], [15, 16], [17, 28], [29, 36], [38, 41]]);
    expect(palavras[0]!.pausa).toBeGreaterThan(0); // vírgula
    expect(palavras[3]!.pausa).toBeGreaterThan(palavras[0]!.pausa); // ponto pesa mais que a vírgula
    expect(palavras[1]!.pausa).toBe(0);
    expect(palavras.at(-1)!.pausa).toBe(0);
    expect(silabasDaPalavra('arquitetura')).toBe(5);
    expect(silabasDaPalavra('a')).toBe(1);
    expect(silabasDaPalavra('DDD')).toBe(3);
    expect(silabasDaPalavra('1994')).toBeGreaterThanOrEqual(4);
  });

  test('sem voz: a frase inteira é repartida pelo tamanho de cada palavra, e a pontuação alonga a pausa', () => {
    const texto = 'É arquitetura, não decoração.';
    const palavras = estimarPalavras({ bloco_id: B, inicio_utf16: 0, fim_utf16: texto.length, inicio_s: 10, fim_s: 14, texto });
    expect(palavras).toHaveLength(4);
    expect(palavras[0]!.inicio_s).toBe(10);
    expect(palavras.at(-1)!.fim_s).toBeCloseTo(14);
    // Ordem de tempo e sem sobreposição.
    for (let i = 1; i < palavras.length; i += 1) expect(palavras[i]!.inicio_s).toBeGreaterThanOrEqual(palavras[i - 1]!.fim_s);
    const duracao = (i: number): number => palavras[i]!.fim_s - palavras[i]!.inicio_s;
    expect(duracao(1)).toBeGreaterThan(duracao(0) * 2); // "arquitetura" dura bem mais que "É"
    // Depois de "arquitetura," há silêncio; entre "não" e "decoração", não.
    expect(palavras[2]!.inicio_s - palavras[1]!.fim_s).toBeGreaterThan(0.05);
    expect(palavras[3]!.inicio_s - palavras[2]!.fim_s).toBeCloseTo(0);
  });

  test('com voz: tempo real das alinhadas e interpolação das que faltam', () => {
    const texto = 'um dois três quatro cinco';
    //            0  3    8    13     20
    const alinhadas = [
      { bloco_id: B, inicio_utf16: 0, fim_utf16: 2, inicio_s: 1, fim_s: 1.3 },
      { bloco_id: B, inicio_utf16: 13, fim_utf16: 19, inicio_s: 3, fim_s: 3.5 },
    ];
    const palavras = completarPalavras([{ bloco_id: B, inicio_utf16: 0, fim_utf16: texto.length, inicio_s: 1, fim_s: 5, texto }], alinhadas);
    expect(palavras.map((p) => p.inicio_utf16)).toEqual([0, 3, 8, 13, 20]);
    expect(palavras[0]).toMatchObject({ inicio_s: 1, fim_s: 1.3 });
    expect(palavras[3]).toMatchObject({ inicio_s: 3, fim_s: 3.5 });
    // "dois" e "três" cabem entre o fim de "um" e o começo de "quatro".
    expect(palavras[1]!.inicio_s).toBeCloseTo(1.3);
    expect(palavras[2]!.fim_s).toBeLessThanOrEqual(3 + 1e-9);
    expect(palavras[2]!.inicio_s).toBeGreaterThan(palavras[1]!.inicio_s);
    // "cinco", sem tempo, vai do fim de "quatro" ao fim da frase.
    expect(palavras[4]!.inicio_s).toBeCloseTo(3.5);
    expect(palavras[4]!.fim_s).toBeCloseTo(5);
  });

  test('palavra no instante: a última que já começou, e só dentro da frase', () => {
    const texto = 'um dois três';
    const frase = { bloco_id: B, inicio_utf16: 0, fim_utf16: texto.length, inicio_s: 0, fim_s: 3, texto };
    const alinhadas = [
      { bloco_id: B, inicio_utf16: 0, fim_utf16: 2, inicio_s: 0, fim_s: 0.5 },
      { bloco_id: B, inicio_utf16: 3, fim_utf16: 7, inicio_s: 1, fim_s: 1.6 },
      { bloco_id: B, inicio_utf16: 8, fim_utf16: 12, inicio_s: 2, fim_s: 2.7 },
    ];
    const palavras = completarPalavras([frase], alinhadas);
    expect(ultimaPalavraNoInstante(palavras, -1)).toBe(-1);
    expect(palavraDaFraseNoInstante(palavras, frase, 1.2)?.inicio_utf16).toBe(3);
    expect(palavraDaFraseNoInstante(palavras, frase, 1.8)?.inicio_utf16).toBe(3); // no vão, a anterior fica acesa
    expect(palavraDaFraseNoInstante(palavras, frase, 2)?.inicio_utf16).toBe(8);
    expect(palavraDaFraseNoInstante(palavras, { bloco_id: 'B2', inicio_utf16: 0, fim_utf16: 5 }, 2)).toBeNull();
    expect(palavraDaFraseNoInstante(palavras, null, 2)).toBeNull();
  });
});
