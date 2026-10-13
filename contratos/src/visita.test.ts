import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { NOMES_DOS_SCHEMAS, validarNarracaoDaVisita, validarRoteiroGuiado } from './index';

const casos = { RoteiroGuiado: validarRoteiroGuiado, NarracaoDaVisita: validarNarracaoDaVisita };
describe('visita guiada (J91)', () => {
  test('os dois schemas estão registrados', () => {
    expect(NOMES_DOS_SCHEMAS).toContain('RoteiroGuiadoV1');
    expect(NOMES_DOS_SCHEMAS).toContain('NarracaoDaVisitaV1');
  });
  for (const [nome, validar] of Object.entries(casos)) {
    const arquivos = readdirSync(new URL(`../casos/${nome}/`, import.meta.url));
    test(`${nome}: válidos e inválidos, com campo desconhecido`, () => {
      expect(arquivos.filter((a) => a.startsWith('valido-')).length).toBeGreaterThanOrEqual(2);
      expect(arquivos.filter((a) => a.startsWith('invalido-')).length).toBeGreaterThanOrEqual(5);
      expect(arquivos).toContain('invalido-campo-desconhecido.json');
    });
    for (const arquivo of arquivos) test(`${nome}/${arquivo}`, () => {
      const caso = JSON.parse(readFileSync(new URL(`../casos/${nome}/${arquivo}`, import.meta.url), 'utf8')) as unknown;
      expect(validar(caso), JSON.stringify(validar.errors)).toBe(arquivo.startsWith('valido-'));
    });
  }
});
