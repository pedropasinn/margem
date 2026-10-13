import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { NOMES_DOS_SCHEMAS, validarAudioV2 } from './index';

describe('casos AudioV2 (J106)', () => {
  const arquivos = readdirSync(new URL('../casos/AudioV2/', import.meta.url));
  test('o schema está registrado e há casos válidos e inválidos', () => {
    expect(NOMES_DOS_SCHEMAS).toContain('AudioV2');
    expect(arquivos.filter((nome) => nome.startsWith('valido-')).length).toBeGreaterThanOrEqual(2);
    expect(arquivos.filter((nome) => nome.startsWith('invalido-')).length).toBeGreaterThanOrEqual(4);
    expect(arquivos).toContain('invalido-campo-desconhecido.json');
  });
  for (const arquivo of arquivos) test(arquivo, () => {
    const caso = JSON.parse(readFileSync(new URL(`../casos/AudioV2/${arquivo}`, import.meta.url), 'utf8')) as unknown;
    expect(validarAudioV2(caso), JSON.stringify(validarAudioV2.errors)).toBe(arquivo.startsWith('valido-'));
  });
});
