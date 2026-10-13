import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from 'vitest';
import { NOMES_DOS_SCHEMAS, validarMidia } from './index';

const pasta = new URL('../casos/Midia/', import.meta.url);

for (const nome of readdirSync(pasta)) test(`MidiaV1 · ${nome}`, () => {
  const valor: unknown = JSON.parse(readFileSync(new URL(nome, pasta), 'utf8'));
  const copia = structuredClone(valor);
  expect(validarMidia(valor), JSON.stringify(validarMidia.errors)).toBe(nome.startsWith('valido-'));
  expect(valor).toEqual(copia);
});

test('MidiaV1 está registrado e tem casos suficientes', () => {
  expect(NOMES_DOS_SCHEMAS).toContain('MidiaV1');
  const arquivos = readdirSync(pasta);
  expect(arquivos.filter((a) => a.startsWith('valido-')).length).toBeGreaterThanOrEqual(2);
  expect(arquivos.filter((a) => a.startsWith('invalido-')).length).toBeGreaterThanOrEqual(4);
});
