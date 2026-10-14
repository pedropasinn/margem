import { expect, test } from 'vitest';
import { avisosDoApp } from './estado.js';

test('MARGEM_AVISOS: um aviso por linha, sem linhas vazias; ausente é lista vazia', () => {
  expect(avisosDoApp({})).toEqual([]);
  expect(avisosDoApp({ MARGEM_AVISOS: ' Primeiro aviso.\r\n\n  Segundo.  ' })).toEqual(['Primeiro aviso.', 'Segundo.']);
});
