import { describe, expect, test } from 'vitest';
import * as nucleo from './index';
import { comprimentoUtf16, ehLimiteValido, fatiaSegura, paragrafosDe } from './texto';

describe('comprimentoUtf16', () => {
  test('conta unidades UTF-16, não grafemas', () => {
    expect(comprimentoUtf16('🧭')).toBe(2);
    expect(comprimentoUtf16('café')).toBe(5);
    expect(comprimentoUtf16('ﬁ')).toBe(1);
  });
});

describe('ehLimiteValido', () => {
  const texto = 'a🧭b';
  test('aceita as bordas e recusa o meio do par substituto', () => {
    expect(ehLimiteValido(texto, 0)).toBe(true);
    expect(ehLimiteValido(texto, 1)).toBe(true);
    expect(ehLimiteValido(texto, 2)).toBe(false);
    expect(ehLimiteValido(texto, 3)).toBe(true);
    expect(ehLimiteValido(texto, 4)).toBe(true);
  });
  test('recusa índices fora do texto', () => {
    expect(ehLimiteValido(texto, -1)).toBe(false);
    expect(ehLimiteValido(texto, 5)).toBe(false);
    expect(ehLimiteValido(texto, 1.5)).toBe(false);
  });
});

describe('fatiaSegura', () => {
  const texto = 'um 🧭 aqui';
  test('fatia normalmente quando os limites são válidos', () => {
    expect(fatiaSegura(texto, 3, 5)).toBe('🧭');
    expect(fatiaSegura(texto, 0, 0)).toBe('');
  });
  test('lança ao cortar um par substituto', () => {
    expect(() => fatiaSegura(texto, 3, 4)).toThrow(/par substituto/);
    expect(() => fatiaSegura(texto, 4, 5)).toThrow(/par substituto/);
  });
  test('lança fora do texto ou com limites invertidos', () => {
    expect(() => fatiaSegura(texto, -1, 2)).toThrow(/fora do texto/);
    expect(() => fatiaSegura(texto, 2, 99)).toThrow(/fora do texto/);
    expect(() => fatiaSegura(texto, 5, 3)).toThrow(/fora do texto/);
    expect(() => fatiaSegura(texto, 1.5, 3)).toThrow(/inteiros seguros/);
  });
});

describe('paragrafosDe', () => {
  test('separa por linha em branco preservando offsets', () => {
    const paragrafos = paragrafosDe('um\n\ndois\r\n\r\ntrês');
    expect(paragrafos.map((p) => p.texto)).toEqual(['um', 'dois', 'três']);
    expect(paragrafos[0]).toEqual({ texto: 'um', inicio: 0, fim: 2, separador: '\n\n' });
    expect(paragrafos[2]?.inicio).toBe('um\n\ndois\r\n\r\n'.length);
    expect(paragrafos.at(-1)?.separador).toBe('');
  });
  test('texto sem separador vira um único parágrafo e texto vazio, um vazio', () => {
    expect(paragrafosDe('linha\nsó')).toHaveLength(1);
    expect(paragrafosDe('')).toEqual([{ texto: '', inicio: 0, fim: 0, separador: '' }]);
  });
});

describe('índice do núcleo', () => {
  test('reexporta a API pública dos quatro módulos', () => {
    expect(Object.keys(nucleo)).toEqual(expect.arrayContaining([
      'resolverCitacao', 'resolverSubfaixas', 'reancorar', 'ancoraDeSelecao',
      'segmentar', 'offsetDeSegmento', 'comprimentoUtf16', 'fatiaSegura', 'ehLimiteValido', 'paragrafosDe', 'deMarcasLegado',
    ]));
  });
});
