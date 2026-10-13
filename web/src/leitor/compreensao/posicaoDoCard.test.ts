import { expect, test } from 'vitest';
import { posicaoDoCard } from './Braquetes';

const num = (valor: unknown) => Number(valor);

test('o card toma o lugar do círculo: centrado nele, com o círculo a 3/4 da largura', () => {
  const p = posicaoDoCard(600, 400, 900);
  expect(num(p.width)).toBe(340);
  expect(num(p.left) + num(p.width) * (3 / 4)).toBeCloseTo(600, 5);
  expect(num(p.top)).toBe(400);
  // Perto da borda da tela, estreita para o círculo continuar a 3/4.
  const perto = posicaoDoCard(209, 400, 900);
  expect(num(perto.left)).toBeGreaterThanOrEqual(12);
  expect(num(perto.left) + num(perto.width) * (3 / 4)).toBeCloseTo(209, 5);
});

test('sem lugar à direita, o card desliza para a esquerda e não passa do limite; o círculo fica dentro dele', () => {
  const p = posicaoDoCard(600, 400, 640);
  expect(num(p.left) + num(p.width)).toBeLessThanOrEqual(640);
  expect(num(p.left)).toBeLessThanOrEqual(600);
  expect(num(p.left) + num(p.width)).toBeGreaterThanOrEqual(600);
  // Pouco espaço na tela: encolhe (até 160) e não sai pela esquerda.
  const estreito = posicaoDoCard(200, 400, 230);
  expect(num(estreito.width)).toBe(218);
  expect(num(estreito.left)).toBe(12);
});
