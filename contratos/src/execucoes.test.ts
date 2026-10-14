import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { NOMES_DOS_SCHEMAS, validarExecucoesDoCodex, validarExecucoesDoCodexV2 } from './index';

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

describe('execuções do Codex V2 (com os avisos das concluídas)', () => {
  const arquivos = readdirSync(new URL('../casos/ExecucoesDoCodexV2/', import.meta.url));
  test('o schema está registrado e há o caso de concluída com aviso', () => {
    expect(NOMES_DOS_SCHEMAS).toContain('ExecucoesDoCodexV2');
    expect(arquivos).toContain('valido-concluida-com-aviso.json');
    expect(arquivos).toContain('invalido-mensagem-em-concluida-sem-aviso.json');
  });
  for (const arquivo of arquivos) test(arquivo, () => {
    const caso = JSON.parse(readFileSync(new URL(`../casos/ExecucoesDoCodexV2/${arquivo}`, import.meta.url), 'utf8')) as unknown;
    expect(validarExecucoesDoCodexV2(caso), JSON.stringify(validarExecucoesDoCodexV2.errors)).toBe(arquivo.startsWith('valido-'));
  });
});
