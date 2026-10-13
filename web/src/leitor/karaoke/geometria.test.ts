import { expect, test } from 'vitest';
import { blocosPorLinha, foraDaVista } from './geometria';

const caixa = (left: number, top: number, width: number, height = 24) => ({ left, top, width, height });

test('junta os retângulos de cada linha num bloco só, com os vãos da justificação, e desconta a origem', () => {
  // Três nós de texto na primeira linha (com vãos entre eles), dois na segunda, e um de altura diferente no meio.
  const caixas = [caixa(300, 100, 80), caixa(390, 100, 120), caixa(520, 102, 60, 20), caixa(300, 140, 200), caixa(505, 140, 40), caixa(700, 100, 0)];
  const blocos = blocosPorLinha(caixas, { left: 280, top: 90 });
  expect(blocos).toEqual([
    { x: 20, y: 10, largura: 280, altura: 24 },
    { x: 20, y: 50, largura: 245, altura: 24 },
  ]);
});

test('a folga alarga o bloco para os lados e para cima e para baixo; ordem pela altura na página', () => {
  const blocos = blocosPorLinha([caixa(100, 200, 50), caixa(100, 160, 70)], { left: 0, top: 0 }, { x: 4, y: 3 });
  expect(blocos).toEqual([
    { x: 96, y: 157, largura: 78, altura: 30 },
    { x: 96, y: 197, largura: 58, altura: 30 },
  ]);
  expect(blocosPorLinha([], { left: 0, top: 0 })).toEqual([]);
});

test('fora da vista: a frase inteira acima da barra ou abaixo do player', () => {
  const blocos = [{ x: 0, y: 100, largura: 10, altura: 20 }, { x: 0, y: 140, largura: 10, altura: 20 }];
  const vista = { topo: 56, base: 700 };
  expect(foraDaVista(blocos, { top: 0 }, vista)).toBe(false);
  expect(foraDaVista(blocos, { top: -200 }, vista)).toBe(true);
  expect(foraDaVista(blocos, { top: 700 }, vista)).toBe(true);
  expect(foraDaVista(blocos, { top: -80 }, vista)).toBe(false); // a última linha ainda aparece
  expect(foraDaVista([], { top: -9999 }, vista)).toBe(false);
});
