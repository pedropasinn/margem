import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { NOMES_DOS_SCHEMAS, validarExecucoesDoCodex } from './index';

describe('execuções do Codex visíveis na interface', () => {
  const arquivos = readdirSync(new URL('../casos/ExecucoesDoCodex/', import.meta.url));
  test('o schema está registrado e há válidos e inválidos', () => {
    expect(NOMES_DOS_SCHEMAS).toContain('ExecucoesDoCodexV1');
    expect(arquivos.filter((a) => a.startsWith('valido-')).length).toBeGreaterThanOrEqual(2);
    expect(arquivos.filter((a) => a.startsWith('invalido-')).length).toBeGreaterThanOrEqual(5);
    expect(arquivos).toContain('invalido-campo-desconhecido.json');
  });
  for (const arquivo of arquivos) test(arquivo, () => {
    const caso = JSON.parse(readFileSync(new URL(`../casos/ExecucoesDoCodex/${arquivo}`, import.meta.url), 'utf8')) as unknown;
    expect(validarExecucoesDoCodex(caso), JSON.stringify(validarExecucoesDoCodex.errors)).toBe(arquivo.startsWith('valido-'));
  });
});
