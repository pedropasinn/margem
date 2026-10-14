import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { NOMES_DOS_SCHEMAS, TIPOS_DE_DIFICULDADE, notaDoGrifoDaAnotacao, validarDificuldade, validarNotaDoGrifo } from './index';
import type { AnotacaoV1 } from './tipos';

const ler = (caminho: string): unknown => JSON.parse(readFileSync(new URL(`../${caminho}`, import.meta.url), 'utf8')) as unknown;

describe('modelo D: a nota do grifo e o sinal de dificuldade', () => {
  test('registrados', () => {
    expect(NOMES_DOS_SCHEMAS).toContain('NotaDoGrifoV1');
    expect(NOMES_DOS_SCHEMAS).toContain('DificuldadeV1');
  });
  for (const [nome, validar] of [['NotaDoGrifoV1', validarNotaDoGrifo], ['DificuldadeV1', validarDificuldade]] as const) {
    const arquivos = readdirSync(new URL(`../casos/${nome}/`, import.meta.url)).sort();
    test(`${nome}: há válidos e inválidos`, () => {
      expect(arquivos.some((a) => a.startsWith('valido-'))).toBe(true);
      expect(arquivos.some((a) => a.startsWith('invalido-'))).toBe(true);
    });
    for (const arquivo of arquivos) test(`${nome}/${arquivo}`, () => {
      expect(validar(ler(`casos/${nome}/${arquivo}`)), JSON.stringify(validar.errors)).toBe(arquivo.startsWith('valido-'));
    });
  }
  test('as sete categorias são as do schema', () => {
    const schema = ler('schemas/DificuldadeV1.schema.json') as { properties: { tipo: { enum: string[] } } };
    expect([...TIPOS_DE_DIFICULDADE].sort()).toEqual([...schema.properties.tipo.enum].sort());
  });
  test('a anotação ligada a um grifo vira a nota dele, com o mesmo id; a solta não', () => {
    const anotacao = ler('casos/Anotacao/' + readdirSync(new URL('../casos/Anotacao/', import.meta.url)).find((a) => a.startsWith('valido-'))) as AnotacaoV1;
    expect(notaDoGrifoDaAnotacao({ ...anotacao, marca_id: undefined })).toBeNull();
    const nota = notaDoGrifoDaAnotacao({ ...anotacao, marca_id: '00000000000000000000000050', atualizada_em: anotacao.criada_em });
    expect(nota?.id).toBe(anotacao.id);
    expect(validarNotaDoGrifo(nota), JSON.stringify(validarNotaDoGrifo.errors)).toBe(true);
    expect(nota).not.toHaveProperty('tipo');
  });
});
