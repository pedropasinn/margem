import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  contratoConexao, contratoConexaoV2, contratoConversa, contratoConversaV2, contratoLoteRevisao, contratoLoteRevisaoV2,
  contratoResolucao, contratoResolucaoV2, conexaoV1ParaV2, conversaV1ParaV2, decidirConexao, lerConexao, lerConversa,
  lerLoteRevisao, lerResolucao, loteRevisaoV1ParaV2, resolucaoV1ParaV2, validarConexaoV2, validarConversaV2,
  validarLoteRevisaoV2, validarResolucaoV2,
} from './index';
import type { ConexaoV1, ConexaoV2, ConversaV1, LoteRevisaoV1, ResolucaoV1 } from './tipos';

/** J101: as V2 trocam o autor humano `pedro` por `leitor`; as V1 continuam aceitas na leitura. */
const ler = (caminho: string): unknown => JSON.parse(readFileSync(new URL(`../${caminho}`, import.meta.url), 'utf8')) as unknown;
const arquivos = (pasta: string): string[] => readdirSync(new URL(`../casos/${pasta}/`, import.meta.url)).sort();

const familias = {
  Conversa: { v1: contratoConversa, v2: contratoConversaV2, validar: validarConversaV2, converter: (v: unknown) => conversaV1ParaV2(v as ConversaV1), lerV2: lerConversa, versionada: true },
  Conexao: { v1: contratoConexao, v2: contratoConexaoV2, validar: validarConexaoV2, converter: (v: unknown) => conexaoV1ParaV2(v as ConexaoV1), lerV2: lerConexao, versionada: true },
  Resolucao: { v1: contratoResolucao, v2: contratoResolucaoV2, validar: validarResolucaoV2, converter: (v: unknown) => resolucaoV1ParaV2(v as ResolucaoV1), lerV2: lerResolucao, versionada: true },
  LoteRevisao: { v1: contratoLoteRevisao, v2: contratoLoteRevisaoV2, validar: validarLoteRevisaoV2, converter: (v: unknown) => loteRevisaoV1ParaV2(v as LoteRevisaoV1), lerV2: lerLoteRevisao, versionada: false },
};

for (const [familia, f] of Object.entries(familias)) describe(`${familia}V2`, () => {
  const pasta = `${familia}V2`;
  test('tem ao menos dois válidos e quatro inválidos, com campo desconhecido, versão errada e autor pedro', () => {
    const nomes = arquivos(pasta);
    expect(nomes.filter((nome) => nome.startsWith('valido-')).length).toBeGreaterThanOrEqual(2);
    expect(nomes.filter((nome) => nome.startsWith('invalido-')).length).toBeGreaterThanOrEqual(4);
    expect(nomes).toEqual(expect.arrayContaining(['invalido-campo-desconhecido.json', 'invalido-versao.json', 'invalido-autor-pedro.json']));
  });
  for (const arquivo of arquivos(pasta)) test(arquivo, () => {
    const valor = ler(`casos/${pasta}/${arquivo}`);
    const copia = structuredClone(valor);
    expect(f.validar(valor), JSON.stringify(f.validar.errors)).toBe(arquivo.startsWith('valido-'));
    expect(valor).toEqual(copia);
  });
  test('o schema V2 difere da V1 só na identidade, na versão e no autor humano', () => {
    const v1 = JSON.stringify(ler(`schemas/${familia}V1.schema.json`));
    const v2 = JSON.stringify(ler(`schemas/${familia}V2.schema.json`));
    let esperado = v1.replace(`${familia}V1.schema.json`, `${familia}V2.schema.json`).replaceAll('"pedro"', '"leitor"');
    if (f.versionada) esperado = esperado.replace('"versao":{"const":1}', '"versao":{"const":2}');
    expect(v2).toBe(esperado);
    expect(v2.toLowerCase()).not.toContain('pedro');
  });
  test('a composição exporta exatamente os schemas publicados (V1 e V2)', () => {
    expect(f.v1.schema).toEqual(ler(`schemas/${familia}V1.schema.json`));
    expect(f.v2.schema).toEqual(ler(`schemas/${familia}V2.schema.json`));
  });
  test('cada caso válido da V1 converte para uma V2 válida, e a leitura aceita as duas', () => {
    for (const arquivo of arquivos(familia).filter((nome) => nome.startsWith('valido-'))) {
      const v1 = ler(`casos/${familia}/${arquivo}`);
      const copia = structuredClone(v1);
      const v2 = f.converter(v1);
      expect(v1, arquivo).toEqual(copia);
      expect(f.validar(v2), `${arquivo}: ${JSON.stringify(f.validar.errors)}`).toBe(true);
      expect(JSON.stringify(v2)).not.toContain('"pedro"');
      expect(f.lerV2(v1)).toEqual(v2);
      expect(f.lerV2(v2)).toEqual(v2);
    }
    // `invalido-versao` da V1 traz `versao: 2`, que é justamente a V2: fica de fora.
    for (const arquivo of arquivos(familia).filter((nome) => nome.startsWith('invalido-') && nome !== 'invalido-versao.json')) {
      expect(f.lerV2(ler(`casos/${familia}/${arquivo}`)), arquivo).toBeNull();
    }
  });
  test('toda âncora do corpus V2 produz diagnóstico preciso', () => {
    for (const arquivo of arquivos(pasta).filter((nome) => nome.startsWith('valido-'))) {
      expect(f.v2.validarLocal(ler(`casos/${pasta}/${arquivo}`)).ok, arquivo).toBe(true);
    }
  });
});

test('decidirConexao devolve a mesma versão que recebe', () => {
  const sugerida = ler('casos/ConexaoV2/valido-sugerida.json') as ConexaoV2;
  const aceita = decidirConexao(sugerida, 'aceita', '2026-09-23T13:00:00Z');
  expect(aceita).toMatchObject({ versao: 2, estado: 'aceita' });
  expect(() => decidirConexao(ler('casos/ConexaoV2/valido-leitor.json') as ConexaoV2, 'rejeitada', '2026-09-23T13:00:00Z')).toThrow();
  expect(decidirConexao(ler('casos/Conexao/valido-sugerida.json') as ConexaoV1, 'rejeitada', '2026-09-23T13:00:00Z').versao).toBe(1);
});
