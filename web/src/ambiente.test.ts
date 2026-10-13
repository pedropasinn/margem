import { expect, test } from 'vitest';

test('disponibiliza o DOM pelo jsdom', () => {
  const paragrafo = document.createElement('p');
  paragrafo.textContent = 'Leitura na margem.';
  expect(paragrafo.textContent).toBe('Leitura na margem.');
});
