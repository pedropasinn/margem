import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from 'vitest';
import { NOMES_DOS_SCHEMAS, validarImportacaoWeb } from './index';

const pasta = new URL('../casos/ImportacaoWeb/', import.meta.url);

for (const nome of readdirSync(pasta)) test(`ImportacaoWebV1 · ${nome}`, () => {
  const valor: unknown = JSON.parse(readFileSync(new URL(nome, pasta), 'utf8'));
  const copia = structuredClone(valor);
  expect(validarImportacaoWeb(valor), JSON.stringify(validarImportacaoWeb.errors)).toBe(nome.startsWith('valido-'));
  expect(valor).toEqual(copia);
});

test('ImportacaoWebV1 está registrado, fecha os objetos e tem casos suficientes', () => {
  expect(NOMES_DOS_SCHEMAS).toContain('ImportacaoWebV1');
  const schema = JSON.parse(readFileSync(new URL('../schemas/ImportacaoWebV1.schema.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  expect(schema.$id).toBe('https://margem.local/contratos/ImportacaoWebV1.schema.json');
  expect(schema.additionalProperties).toBe(false);
  const arquivos = readdirSync(pasta);
  expect(arquivos.filter((a) => a.startsWith('valido-')).length).toBeGreaterThanOrEqual(2);
  expect(arquivos.filter((a) => a.startsWith('invalido-')).length).toBeGreaterThanOrEqual(4);
});

test('o separador de linha Unicode também não entra no título', () => {
  expect(validarImportacaoWeb({ markdown: 'x', titulo: 'a b', url_origem: 'https://a.b/' })).toBe(false);
  expect(validarImportacaoWeb({ markdown: '----\n\ntexto', titulo: 'a', url_origem: 'https://a.b/' })).toBe(true);
});
