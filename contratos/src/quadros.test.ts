/** Quadros da pessoa (J118): a identificação corrigida e a obra enquanto é preparada. */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { NOMES_DOS_SCHEMAS, validarIdentificacaoDaObra, validarQuadroDaPessoa } from './index';

const casos = { IdentificacaoDaObra: validarIdentificacaoDaObra, QuadroDaPessoa: validarQuadroDaPessoa } as const;

for (const [nome, validar] of Object.entries(casos)) {
  describe(`${nome}V1`, () => {
    const pasta = new URL(`../casos/${nome}/`, import.meta.url);
    const arquivos = readdirSync(pasta);
    test('está registrado, fecha os objetos e tem casos suficientes', () => {
      expect(NOMES_DOS_SCHEMAS).toContain(`${nome}V1`);
      const schema = JSON.parse(readFileSync(new URL(`../schemas/${nome}V1.schema.json`, import.meta.url), 'utf8')) as Record<string, unknown>;
      expect(schema.$id).toBe(`https://margem.local/contratos/${nome}V1.schema.json`);
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
      expect(validar(valor), JSON.stringify(validar.errors)).toBe(arquivo.startsWith('valido-'));
    });
  });
}
