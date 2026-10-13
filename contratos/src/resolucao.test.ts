import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { validarResolucao, validarResolucaoGerada } from './index';

function caso(pasta: string, arquivo: string): unknown {
  return JSON.parse(readFileSync(new URL(`../casos/${pasta}/${arquivo}`, import.meta.url), 'utf8')) as unknown;
}

for (const [pasta, validar] of Object.entries({ Resolucao: validarResolucao, ResolucaoGerada: validarResolucaoGerada })) {
  describe(`casos ${pasta}`, () => {
    const arquivos = readdirSync(new URL(`../casos/${pasta}/`, import.meta.url));
    test('tem ao menos dois válidos e quatro inválidos, com campo desconhecido', () => {
      expect(arquivos.filter((nome) => nome.startsWith('valido-')).length).toBeGreaterThanOrEqual(2);
      expect(arquivos.filter((nome) => nome.startsWith('invalido-')).length).toBeGreaterThanOrEqual(4);
      expect(arquivos).toContain('invalido-campo-desconhecido.json');
    });
    for (const arquivo of arquivos) test(arquivo, () => {
      expect(validar(caso(pasta, arquivo)), JSON.stringify(validar.errors)).toBe(arquivo.startsWith('valido-'));
    });
  });
}
