import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { contratoVisual, validarVisual } from './index';

describe('casos Visual', () => {
  const arquivos = readdirSync(new URL('../casos/Visual/', import.meta.url));
  test('tem válidos dos três alvos e inválidos das regras locais, com campo desconhecido', () => {
    expect(arquivos.filter((nome) => nome.startsWith('valido-')).length).toBeGreaterThanOrEqual(5);
    expect(arquivos.filter((nome) => nome.startsWith('invalido-')).length).toBeGreaterThanOrEqual(12);
    expect(arquivos).toContain('invalido-campo-desconhecido.json');
  });
  for (const arquivo of arquivos) test(arquivo, () => {
    const caso = JSON.parse(readFileSync(new URL(`../casos/Visual/${arquivo}`, import.meta.url), 'utf8')) as unknown;
    expect(validarVisual(caso), JSON.stringify(validarVisual.errors)).toBe(arquivo.startsWith('valido-'));
    expect(contratoVisual.validarLocal(caso).ok).toBe(arquivo.startsWith('valido-'));
  });
  test('a âncora do nó é conferida pelo contrato composto (intervalo da citação)', () => {
    const caso = JSON.parse(readFileSync(new URL('../casos/Visual/valido-diagrama-capitulo.json', import.meta.url), 'utf8')) as {
      artefato: { nos: { ancora?: { fim_utf16: number } }[] };
    };
    caso.artefato.nos[0]!.ancora!.fim_utf16 += 1;
    const resultado = contratoVisual.validarLocal(caso);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erros[0]?.caminho).toEqual(['artefato', 'nos', 0, 'ancora', 'fim_utf16']);
  });
});
