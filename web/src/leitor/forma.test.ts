import { expect, test } from 'vitest';
import { formaDoDocumento, minutosDeLeitura, nomeDaUnidade } from './forma';

test('um só capítulo é um texto único; dois ou mais, um livro', () => {
  expect(formaDoDocumento([])).toBe('texto');
  expect(formaDoDocumento([{ id: 'a' }])).toBe('texto');
  expect(formaDoDocumento([{ id: 'a' }, { id: 'b' }])).toBe('livro');
  expect(nomeDaUnidade('texto')).toBe('texto');
  expect(nomeDaUnidade('livro')).toBe('capítulo');
});

test('o tempo de leitura conta palavras a 180 por minuto, com no mínimo 1 minuto', () => {
  expect(minutosDeLeitura(['Uma frase curta.'])).toBe(1);
  expect(minutosDeLeitura([Array.from({ length: 900 }, () => 'palavra').join(' ')])).toBe(5);
  expect(minutosDeLeitura(['a '.repeat(270), 'b '.repeat(270)])).toBe(3);
});
