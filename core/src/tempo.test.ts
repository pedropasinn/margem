import { expect, test } from 'vitest';
import { profundidadeRecomendada, simularPreparacao, tempoDeLeitura } from './tempo';

test('tempo de leitura: palavras a 180 por minuto', () => {
  expect(tempoDeLeitura(['um dois três', 'quatro'], 60)).toBe(4);
  expect(tempoDeLeitura(Array.from({ length: 180 }, () => 'palavra'))).toBe(60);
});

test('preparar o seguinte basta quando preparar é mais rápido que ler', () => {
  const capitulos = [0, 1, 2].map(() => ({ leitura_s: 1000, preparo_s: 300 }));
  expect(simularPreparacao(capitulos, 0).esperas_s).toEqual([300, 300, 300]);
  expect(simularPreparacao(capitulos, 1).esperas_s).toEqual([300, 0, 0]);
  expect(profundidadeRecomendada(capitulos).profundidade).toBe(1);
});

test('preparar mais devagar do que se lê: nem dois adiante bastam, e a espera cresce a cada capítulo', () => {
  const capitulos = [0, 1, 2, 3].map(() => ({ leitura_s: 600, preparo_s: 900 }));
  const um = simularPreparacao(capitulos, 1);
  expect(um.esperas_s).toEqual([900, 300, 300, 300]);
  const recomendada = profundidadeRecomendada(capitulos);
  expect(recomendada.espera_depois_do_primeiro_s).toBeGreaterThan(0);
  // Um capítulo curto antes de um longo: a folga do anterior não cobre o seguinte.
  expect(simularPreparacao([{ leitura_s: 200, preparo_s: 100 }, { leitura_s: 2000, preparo_s: 800 }], 1).esperas_s).toEqual([100, 600]);
});

test('capítulos já prontos não esperam', () => {
  expect(simularPreparacao([{ leitura_s: 100, preparo_s: 500 }, { leitura_s: 100, preparo_s: 500 }], 1, new Set([0, 1])).esperas_s).toEqual([0, 0]);
});

test('com duas vagas, preparar dois adiante acompanha quem lê mais rápido do que um capítulo se prepara', () => {
  const capitulos = [0, 1, 2, 3, 4].map(() => ({ leitura_s: 600, preparo_s: 900 }));
  expect(simularPreparacao(capitulos, 1).espera_depois_do_primeiro_s).toBeGreaterThan(0);
  expect(simularPreparacao(capitulos, 2, new Set(), 2).espera_depois_do_primeiro_s).toBeLessThan(simularPreparacao(capitulos, 1, new Set(), 1).espera_depois_do_primeiro_s);
  expect(profundidadeRecomendada(capitulos, 3, 2).trabalhadores).toBe(2);
});
