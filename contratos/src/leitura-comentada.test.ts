import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { NOMES_DOS_SCHEMAS, falasDaLeitura, validarLeituraComentada, validarNarracaoDaLeitura, type LeituraComentadaV1 } from './index';

const casos = { LeituraComentada: validarLeituraComentada, NarracaoDaLeitura: validarNarracaoDaLeitura };
describe('leitura comentada (J92)', () => {
  test('os dois schemas estão registrados', () => {
    expect(NOMES_DOS_SCHEMAS).toContain('LeituraComentadaV1');
    expect(NOMES_DOS_SCHEMAS).toContain('NarracaoDaLeituraV1');
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
  test('a ordem das falas: cada trecho e, depois dele, a sua pausa; pausa sem fala não entra', () => {
    const caso = JSON.parse(readFileSync(new URL('../casos/LeituraComentada/valido-pausa-sem-fala.json', import.meta.url), 'utf8')) as LeituraComentadaV1;
    expect(falasDaLeitura(caso).map((f) => f.id)).toEqual(['t0001', 't0002', 't0003', 'p002']);
  });
});
