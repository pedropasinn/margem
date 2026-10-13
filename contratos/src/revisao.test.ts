import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from 'vitest';
import * as contratos from './validadores';
import { comporContratos } from './composicoes';
import type { Schema } from './contrato';
import { conferirEntrada } from './entrada';
import type { CanonicoV1 } from './tipos';

const ler = (nome: string): unknown => JSON.parse(readFileSync(new URL(`../${nome}.json`, import.meta.url), 'utf8'));

test('todos os schemas publicados têm registro e validador estrutural', () => {
  const arquivos = readdirSync(new URL('../schemas/', import.meta.url)).filter(n => n.endsWith('.schema.json')).map(n => n.replace('.schema.json', '')).sort();
  expect([...contratos.NOMES_DOS_SCHEMAS].sort()).toEqual(arquivos);
  expect(Object.keys(contratos.validadoresSchema).sort()).toEqual(arquivos);
});

test('todos os componentes preservam exatamente o schema publicado', () => {
  const schemas = Object.fromEntries(contratos.NOMES_DOS_SCHEMAS.map(n => [n, ler(`schemas/${n}.schema`) as Schema]));
  const compostos = comporContratos(schemas);
  for (const [nome, componente] of Object.entries(compostos)) expect(componente.schema, nome).toEqual(schemas[nome]);
  for (const [nome, schema] of Object.entries(schemas)) {
    if (JSON.stringify(schema).includes('https://margem.local/contratos/AncoraV1.schema.json')) {
      expect(compostos, `Família com âncora precisa de composição: ${nome}`).toHaveProperty(nome);
    }
  }
});

test('ciclo e profundidade são recusados antes do schema recursivo do canônico', () => {
  const canonico = ler('casos/Canonico/valido-minimo') as CanonicoV1;
  const config: NonNullable<CanonicoV1['canonizacao']['config']> = {};
  config.volta = config;
  canonico.canonizacao.config = config;
  expect(contratos.validarCanonico(canonico)).toBe(false);
  expect(contratos.validarCanonico.errors).toMatchObject([{ keyword: 'ciclo', instancePath: '/canonizacao/config/volta' }]);
  let profundo: typeof config = {};
  for (let i = 0; i < 2500; i++) profundo = { filho: profundo };
  canonico.canonizacao.config = profundo;
  expect(contratos.validarCanonico(canonico)).toBe(false);
  expect(contratos.validarCanonico.errors?.[0]?.keyword).toBe('profundidade');
});

test('API Local não executa acessores, inclusive não enumeráveis', () => {
  const ancora = ler('casos/Ancora/valido-minimo') as object;
  let chamadas = 0;
  Object.defineProperty(ancora, 'citacao', { get() { chamadas++; throw new Error('Não executar'); }, enumerable: false });
  expect(contratos.contratoAncora.validarLocal(ancora)).toMatchObject({ ok: false, erros: [{ codigo: 'acessor', caminho: ['citacao'] }] });
  expect(chamadas).toBe(0);
});

test('proteção admite aliases sem ciclo, valores opcionais e objetos congelados', () => {
  const comum = Object.freeze({ texto: '📖' });
  expect(conferirEntrada({ primeiro: comum, segundo: comum, opcional: undefined })).toEqual([]);
  expect(conferirEntrada(Object.assign(Object.create(null) as object, { texto: 'ok' }))).toEqual([]);
  expect(conferirEntrada(new Date())).toMatchObject([{ codigo: 'objeto' }]);
});

test('notícias também recusam Unicode inválido e campos herdados', () => {
  const editorial = { titulo: 'IA aplicada', abertura: 'Hoje', roteiro: '', noticias: [] };
  expect(contratos.validarEditorialDeNoticias(editorial)).toBe(true);
  expect(contratos.validarEditorialDeNoticias({ ...editorial, titulo: '\ud800' })).toBe(false);
  expect(contratos.validarEditorialDeNoticias(Object.create(editorial))).toBe(false);
  expect(contratos.validarEditorialDeNoticias({ ...editorial, extra: true })).toBe(false);
});

// Percurso só do corpus de teste: cada mutação atinge uma âncora completa, por vez.
function ancoras(valor: unknown, caminho: (string | number)[] = []): (string | number)[][] {
  if (!valor || typeof valor !== 'object') return [];
  if ('inicio_utf16' in valor && 'fim_utf16' in valor && 'citacao' in valor && 'versao_id' in valor) return [caminho];
  return Object.entries(valor).flatMap(([chave, filho]) => ancoras(filho, [...caminho, Array.isArray(valor) ? Number(chave) : chave]));
}
const familias = {
  Marca: contratos.contratoMarca, Progresso: contratos.contratoProgresso, Anotacao: contratos.contratoAnotacao,
  Conversa: contratos.contratoConversa, Conexao: contratos.contratoConexao, LoteRevisao: contratos.contratoLoteRevisao,
  RoteiroGuiado: contratos.contratoRoteiroGuiado, LeituraComentada: contratos.contratoLeituraComentada,
};
for (const [familia, contrato] of Object.entries(familias)) test(`${familia}: toda âncora do corpus produz diagnóstico preciso`, () => {
  let mutacoes = 0;
  const arquivos = readdirSync(new URL(`../casos/${familia}/`, import.meta.url)).filter(n => n.startsWith('valido-'));
  for (const arquivo of arquivos) {
    const valor = ler(`casos/${familia}/${arquivo.replace('.json', '')}`);
    expect(contrato.validarLocal(valor).ok, arquivo).toBe(true);
    for (const caminho of ancoras(valor)) {
      const copia: unknown = structuredClone(valor);
      let alvo = copia as Record<string, unknown>;
      for (const passo of caminho) alvo = alvo[passo] as Record<string, unknown>;
      alvo.fim_utf16 = (alvo.fim_utf16 as number) + 1;
      expect(contrato.validarLocal(copia), `${arquivo}: ${caminho.join('/')}`).toMatchObject({
        ok: false, erros: [{ codigo: 'intervalo_citacao', caminho: [...caminho, 'fim_utf16'] }],
      });
      mutacoes++;
    }
  }
  expect(mutacoes).toBeGreaterThan(0);
});
