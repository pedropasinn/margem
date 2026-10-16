/** Conferência do sumário (J164): a resposta do Codex, com proposta feita só de seções existentes. */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { NOMES_DOS_SCHEMAS, validarConferenciaDoSumario } from './index';

describe('ConferenciaDoSumarioV1', () => {
  const pasta = new URL('../casos/ConferenciaDoSumario/', import.meta.url);
  const arquivos = readdirSync(pasta);
  test('está registrado, fecha os objetos e tem casos suficientes', () => {
    expect(NOMES_DOS_SCHEMAS).toContain('ConferenciaDoSumarioV1');
    const schema = JSON.parse(readFileSync(new URL('../schemas/ConferenciaDoSumarioV1.schema.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    expect(schema.$id).toBe('https://margem.local/contratos/ConferenciaDoSumarioV1.schema.json');
    const conferir = (valor: unknown): void => {
      if (!valor || typeof valor !== 'object') return;
      if (Array.isArray(valor)) { valor.forEach(conferir); return; }
      const objeto = valor as Record<string, unknown>;
      if (objeto.type === 'object') expect(objeto.additionalProperties).toBe(false);
      Object.values(objeto).forEach(conferir);
    };
    conferir(schema);
    expect(arquivos.filter((a) => a.startsWith('valido-')).length).toBeGreaterThanOrEqual(2);
    expect(arquivos.filter((a) => a.startsWith('invalido-')).length).toBeGreaterThanOrEqual(4);
  });
  for (const arquivo of arquivos) test(arquivo, () => {
    const valor: unknown = JSON.parse(readFileSync(new URL(arquivo, pasta), 'utf8'));
    expect(validarConferenciaDoSumario(valor), JSON.stringify(validarConferenciaDoSumario.errors)).toBe(arquivo.startsWith('valido-'));
  });
});
