import { expect, test } from 'vitest';
import { ESFORCO_DOS_VISUAIS_PADRAO, ESFORCO_PADRAO, esforcoDosVisuais, profundidadeDoPrefetch } from './configuracao.js';

test('MARGEM_PREFETCH: de 0 a 5 capítulos adiante; fora disso, o seguinte', () => {
  expect(profundidadeDoPrefetch({})).toBe(1);
  expect(profundidadeDoPrefetch({ MARGEM_PREFETCH: '2' })).toBe(2);
  expect(profundidadeDoPrefetch({ MARGEM_PREFETCH: '0' })).toBe(0);
  expect(profundidadeDoPrefetch({ MARGEM_PREFETCH: '9' })).toBe(1);
  expect(profundidadeDoPrefetch({ MARGEM_PREFETCH: 'x' })).toBe(1);
});

test('MARGEM_ESFORCO_VISUAL: os visuais (J70) usam medium por padrão, sem mexer no esforço das leituras', () => {
  expect(ESFORCO_DOS_VISUAIS_PADRAO).toBe('medium');
  expect(ESFORCO_PADRAO).toBe('high');
  expect(esforcoDosVisuais({})).toBe('medium');
  expect(esforcoDosVisuais({ MARGEM_ESFORCO_VISUAL: ' high ' })).toBe('high');
  expect(esforcoDosVisuais({ MARGEM_ESFORCO_VISUAL: '', MARGEM_ESFORCO: 'low' })).toBe('medium');
});
