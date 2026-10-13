import { expect, test } from 'vitest';
import { proximoZoom } from './zoom';

test('o zoom anda pelos passos a partir da escala atual, e para nas pontas', () => {
  // Ajustado à largura (139%): o próximo passo acima é 150%, abaixo é 125%.
  expect(proximoZoom(1.39, 1)).toBe(1.5);
  expect(proximoZoom(1.39, -1)).toBe(1.25);
  // Exatamente num passo, anda um.
  expect(proximoZoom(1, 1)).toBe(1.1);
  expect(proximoZoom(1, -1)).toBe(0.9);
  expect(proximoZoom(3, 1)).toBe(3);
  expect(proximoZoom(0.5, -1)).toBe(0.5);
});
