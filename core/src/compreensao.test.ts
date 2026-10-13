import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { LoteDoModeloV1, ModeloDoCapituloV1 } from '@margem/contratos';
import { validarModeloDoCapitulo } from '@margem/contratos';
import {
  OperacaoInaplicavel, TabelaDeAliases, aliasesParaAuditoria, aplicarOperacoes, elementosNosBlocos, novosAliases, particionarPorInicios,
} from './compreensao';

function caso<T>(pasta: string, nome: string): T {
  return JSON.parse(readFileSync(new URL(`../../contratos/casos/${pasta}/${nome}.json`, import.meta.url), 'utf8')) as T;
}
const id = (numero: number): string => String(numero).padStart(26, '0');

test('aliases são estáveis, sequenciais e reversíveis', () => {
  const tabela = new TabelaDeAliases('L', 2);
  expect(tabela.registrar(id(7))).toBe('L01');
  expect(tabela.registrar(id(9))).toBe('L02');
  expect(tabela.registrar(id(7))).toBe('L01');
  expect(tabela.id('L02')).toBe(id(9));
  expect(tabela.id('L03')).toBeUndefined();
  expect(tabela.alias(id(9))).toBe('L02');
  const aliases = novosAliases();
  for (let i = 0; i < 120; i += 1) aliases.blocos.registrar(id(1000 + i));
  expect(aliases.blocos.alias(id(1000))).toBe('B001');
  expect(aliases.blocos.alias(id(1119))).toBe('B120');
  expect(aliasesParaAuditoria(aliases).blocos).toHaveLength(120);
});

test('particionar por inícios cobre o capítulo, ignora inícios de fora e ajusta o primeiro', () => {
  const ordem = ['a', 'b', 'c', 'd', 'e'];
  const { faixas, ignorados, primeiro_ajustado } = particionarPorInicios(ordem, [
    { inicio: 'd', nome: 'terceira' }, { inicio: 'b', nome: 'primeira' }, { inicio: 'zz', nome: 'fora' }, { inicio: 'c', nome: 'segunda' },
    { inicio: 'c', nome: 'repetida' },
  ]);
  expect(faixas.map((faixa) => [faixa.nome, faixa.bloco_inicio, faixa.bloco_fim])).toEqual([
    ['primeira', 'a', 'b'], ['segunda', 'c', 'c'], ['terceira', 'd', 'e'],
  ]);
  expect(ignorados.map((item) => item.nome)).toEqual(['fora', 'repetida']);
  expect(primeiro_ajustado).toBe(true);
  expect(particionarPorInicios(ordem, []).faixas).toEqual([]);
});

test('a revisão global promove a hipótese do começo sem tocar a base', () => {
  const base = caso<ModeloDoCapituloV1>('ModeloDoCapitulo', 'valido-sintese');
  const lote = caso<LoteDoModeloV1>('LoteDoModelo', 'valido-minimo');
  const copia = structuredClone(base);
  const r2 = aplicarOperacoes(base, lote.operacoes, { id: id(503), estagio: 'revisao', lote_id: lote.id, criada_em: '2026-09-25T12:10:00Z' });
  expect(base).toEqual(copia);
  expect(r2).toMatchObject({ id: id(503), revisao: 2, estagio: 'revisao', base_id: base.id, lote_id: lote.id });
  expect(r2.elementos.find((item) => item.id === id(101))?.centralidade).toBe(1);
  expect(validarModeloDoCapitulo(r2), JSON.stringify(validarModeloDoCapitulo.errors)).toBe(true);
});

test('fundir redireciona relações, sem laço nem repetição; remover leva as relações junto', () => {
  const base = caso<ModeloDoCapituloV1>('ModeloDoCapitulo', 'valido-sintese');
  const [e1, e2] = base.elementos;
  if (!e1 || !e2) throw new Error('caso incompleto');
  const fundido = aplicarOperacoes(base, [{
    ordem: 0, op: 'fundir', alvo_id: e1.id, antes: { absorvidos: [e2] }, depois: { ancoras: [...e1.ancoras, ...e2.ancoras] },
    motivo: 'mesmo elemento visto por duas partes', evidencia: [],
  }], { id: id(504), estagio: 'sintese', lote_id: id(602), criada_em: '2026-09-25T12:00:00Z' });
  expect(fundido.elementos.map((item) => item.id)).toEqual([e1.id]);
  expect(fundido.elementos[0]?.ancoras).toHaveLength(2);
  expect(fundido.relacoes).toEqual([]);
  const removido = aplicarOperacoes(base, [{ ordem: 0, op: 'remover_elemento', alvo_id: e2.id, antes: e2, depois: null, motivo: 'x', evidencia: [] }],
    { id: id(505), estagio: 'revisao', lote_id: id(603), criada_em: '2026-09-25T12:00:00Z' });
  expect(removido.relacoes).toEqual([]);
  expect(validarModeloDoCapitulo(removido)).toBe(true);
});

test('operação sobre alvo inexistente ou antes divergente lança', () => {
  const base = caso<ModeloDoCapituloV1>('ModeloDoCapitulo', 'valido-minimo');
  const dados = { id: id(506), estagio: 'sintese' as const, lote_id: id(604), criada_em: '2026-09-25T12:00:00Z' };
  expect(() => aplicarOperacoes(base, [{ ordem: 0, op: 'promover', alvo_id: id(999), antes: { centralidade: 3 }, depois: { centralidade: 1 }, motivo: 'x', evidencia: [] }], dados))
    .toThrow(OperacaoInaplicavel);
  expect(() => aplicarOperacoes(base, [{ ordem: 0, op: 'promover', alvo_id: id(101), antes: { centralidade: 2 }, depois: { centralidade: 1 }, motivo: 'x', evidencia: [] }], dados))
    .toThrow('centralidade anterior');
});

test('definir unidades poda etapas do movimento que perderam a unidade', () => {
  const base = caso<ModeloDoCapituloV1>('ModeloDoCapitulo', 'valido-sintese');
  const r = aplicarOperacoes(base, [{ ordem: 0, op: 'definir_unidades', antes: base.unidades, depois: [], motivo: 'x', evidencia: [] }],
    { id: id(507), estagio: 'revisao', lote_id: id(605), criada_em: '2026-09-25T12:00:00Z' });
  expect(r.movimento?.etapas).toEqual([]);
  expect(elementosNosBlocos(base, new Set([id(2)])).map((item) => item.id)).toEqual([id(102)]);
});

test('revisão exige estado anterior correto também em edições textuais', () => {
  const base = caso<ModeloDoCapituloV1>('ModeloDoCapitulo', 'valido-sintese');
  const alvo = base.elementos[0]!;
  expect(() => aplicarOperacoes(base, [{ ordem: 0, op: 'reescrever_enunciado', alvo_id: alvo.id,
    antes: { enunciado: 'outro estado' }, depois: { enunciado: 'novo texto' }, motivo: 'Teste', evidencia: [] }],
  { id: id(503), estagio: 'revisao', lote_id: id(601), criada_em: base.criada_em })).toThrow('estado anterior');
});
