import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  FAMILIA_DA_RELACAO_SEMANTICA, NOMES_DOS_SCHEMAS, RELACOES_DE_CONEXAO, ROTULOS_DA_RELACAO, ROTULOS_DA_RELACAO_SEMANTICA,
  TIPOS_DE_RELACAO_SEMANTICA, conexaoV2ParaV3, decidirConexao, lerConexaoV3, validarConexaoV3,
} from './index';
import type { ConexaoV2, ConexaoV3 } from './tipos';

const ler = (caminho: string): unknown => JSON.parse(readFileSync(new URL(`../${caminho}`, import.meta.url), 'utf8')) as unknown;
const arquivos = readdirSync(new URL('../casos/ConexaoV3/', import.meta.url)).sort();

describe('vocabulário de relação: família (6) e tipo fino (9)', () => {
  test('todo tipo fino tem família, e toda família e todo tipo têm rótulo', () => {
    expect(TIPOS_DE_RELACAO_SEMANTICA).toHaveLength(9);
    for (const tipo of TIPOS_DE_RELACAO_SEMANTICA) expect(RELACOES_DE_CONEXAO).toContain(FAMILIA_DA_RELACAO_SEMANTICA[tipo]);
    expect(Object.keys(ROTULOS_DA_RELACAO).sort()).toEqual([...RELACOES_DE_CONEXAO].sort());
    expect(Object.keys(ROTULOS_DA_RELACAO_SEMANTICA).sort()).toEqual([...TIPOS_DE_RELACAO_SEMANTICA].sort());
  });
  test('o enum do schema V3 é o da lista', () => {
    const schema = ler('schemas/ConexaoV3.schema.json') as { properties: { relacao_semantica: { enum: string[] }; relacao: { enum: string[] } } };
    expect(schema.properties.relacao_semantica.enum).toEqual([...TIPOS_DE_RELACAO_SEMANTICA]);
    expect(schema.properties.relacao.enum).toEqual([...RELACOES_DE_CONEXAO]);
  });
});

describe('ConexaoV3', () => {
  test('registrada, com válidos e inválidos (família errada, origem sem tipo)', () => {
    expect(NOMES_DOS_SCHEMAS).toContain('ConexaoV3');
    expect(arquivos).toEqual(expect.arrayContaining([
      'valido-adotada-responde.json', 'invalido-semantica-de-outra-familia.json', 'invalido-origem-sem-semantica.json', 'invalido-versao-2.json',
    ]));
  });
  for (const arquivo of arquivos) test(arquivo, () => {
    const valor = ler(`casos/ConexaoV3/${arquivo}`);
    expect(validarConexaoV3(valor), JSON.stringify(validarConexaoV3.errors)).toBe(arquivo.startsWith('valido-'));
  });
  test('V2 e V1 lidas como V3 sem o tipo fino; a conversão leva o tipo quando dado', () => {
    const v2 = ler('casos/ConexaoV2/valido-aceita.json') as ConexaoV2;
    const lida = lerConexaoV3(v2);
    expect(lida?.versao).toBe(3);
    expect(lida).not.toHaveProperty('relacao_semantica');
    expect(lerConexaoV3(ler('casos/Conexao/valido-pedro.json'))?.autor).toBe('leitor');
    expect(lerConexaoV3({ versao: 9 })).toBeNull();
    const comTipo = conexaoV2ParaV3({ ...v2, relacao: 'tensao' }, { relacao_semantica: 'responde' });
    expect(validarConexaoV3(comTipo), JSON.stringify(validarConexaoV3.errors)).toBe(true);
    expect(comTipo.relacao_semantica).toBe('responde');
  });
  test('decidirConexao devolve a V3', () => {
    const sugerida = ler('casos/ConexaoV3/valido-sugerida-com-semantica.json') as ConexaoV3;
    const aceita = decidirConexao(sugerida, 'aceita', '2026-09-23T13:00:00Z');
    expect(aceita.versao).toBe(3);
    expect(aceita.relacao_semantica).toBe('contrasta');
  });
});
