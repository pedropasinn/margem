import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { validarEtiqueta } from './index';

describe('casos Etiqueta', () => {
  const arquivos = readdirSync(new URL('../casos/Etiqueta/', import.meta.url));
  test('tem ao menos dois válidos e quatro inválidos, com campo desconhecido', () => {
    expect(arquivos.filter((nome) => nome.startsWith('valido-')).length).toBeGreaterThanOrEqual(2);
    expect(arquivos.filter((nome) => nome.startsWith('invalido-')).length).toBeGreaterThanOrEqual(4);
    expect(arquivos).toContain('invalido-campo-desconhecido.json');
  });
  for (const arquivo of arquivos) test(arquivo, () => {
    const caso = JSON.parse(readFileSync(new URL(`../casos/Etiqueta/${arquivo}`, import.meta.url), 'utf8')) as unknown;
    expect(validarEtiqueta(caso), JSON.stringify(validarEtiqueta.errors)).toBe(arquivo.startsWith('valido-'));
  });
});
