import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { NOMES_DOS_SCHEMAS, contratoEsquemaDoCapitulo, validarEsquemaDoCapitulo } from './index';

describe('casos EsquemaDoCapitulo', () => {
  const arquivos = readdirSync(new URL('../casos/EsquemaDoCapitulo/', import.meta.url));
  test('schema registrado, com válidos e inválidos das regras locais', () => {
    expect(NOMES_DOS_SCHEMAS).toContain('EsquemaDoCapituloV1');
    expect(arquivos.filter((nome) => nome.startsWith('valido-')).length).toBeGreaterThanOrEqual(2);
    expect(arquivos.filter((nome) => nome.startsWith('invalido-')).length).toBeGreaterThanOrEqual(10);
  });
  for (const arquivo of arquivos) test(arquivo, () => {
    const caso = JSON.parse(readFileSync(new URL(`../casos/EsquemaDoCapitulo/${arquivo}`, import.meta.url), 'utf8')) as unknown;
    expect(validarEsquemaDoCapitulo(caso), JSON.stringify(validarEsquemaDoCapitulo.errors)).toBe(arquivo.startsWith('valido-'));
    expect(contratoEsquemaDoCapitulo.validarLocal(caso).ok).toBe(arquivo.startsWith('valido-'));
  });
  test('a âncora do nó é conferida pelo contrato composto', () => {
    const caso = JSON.parse(readFileSync(new URL('../casos/EsquemaDoCapitulo/invalido-intervalo-da-ancora.json', import.meta.url), 'utf8')) as unknown;
    const resultado = contratoEsquemaDoCapitulo.validarLocal(caso);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erros[0]?.caminho).toEqual(['nos', 0, 'ancora', 'fim_utf16']);
  });
});
