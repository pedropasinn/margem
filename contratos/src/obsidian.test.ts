import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { NOMES_DOS_SCHEMAS, validarIndiceObsidian } from './index';

describe('casos IndiceObsidian', () => {
  const arquivos = readdirSync(new URL('../casos/IndiceObsidian/', import.meta.url));
  test('está registrado e tem ao menos dois válidos e quatro inválidos, com campo desconhecido', () => {
    expect(NOMES_DOS_SCHEMAS).toContain('IndiceObsidianV1');
    expect(arquivos.filter((nome) => nome.startsWith('valido-')).length).toBeGreaterThanOrEqual(2);
    expect(arquivos.filter((nome) => nome.startsWith('invalido-')).length).toBeGreaterThanOrEqual(4);
    expect(arquivos).toContain('invalido-campo-desconhecido.json');
  });
  for (const arquivo of arquivos) test(arquivo, () => {
    const caso = JSON.parse(readFileSync(new URL(`../casos/IndiceObsidian/${arquivo}`, import.meta.url), 'utf8')) as unknown;
    expect(validarIndiceObsidian(caso), JSON.stringify(validarIndiceObsidian.errors)).toBe(arquivo.startsWith('valido-'));
  });
});
