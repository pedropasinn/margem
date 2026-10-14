/**
 * V-W3 (auditoria B-01): todo schema de prompts/, saneado como vai para a CLI, obedece ao modo
 * estrito. Este teste falha se um schema novo (ou alterado) violar uma regra, antes de alguém
 * descobrir pelo "A CLI terminou com código 1" no Windows.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { raizDoRepositorio } from '../dados.js';
import { sanearSchemaParaOCodex } from '../executor/artefato.js';
import { conferirModoEstrito } from '../executor/modo-estrito.js';
import { schemasDosPrompts, sondarSchemas } from './sondar-schemas.js';

test('todos os prompts/*.schema.json passam no modo estrito depois do saneador', async () => {
  const arquivos = await schemasDosPrompts();
  expect(arquivos.length).toBeGreaterThan(40);
  const resultados = await sondarSchemas(arquivos);
  const problemas = resultados.flatMap((r) => r.violacoes.map((v) => `${r.arquivo.split('/').at(-1) ?? ''} ${v.caminho}: ${v.regra}`));
  expect(problemas).toEqual([]);
});

test('a revisão de consistência como ia antes para a CLI viola o modo estrito; saneada, passa', () => {
  const original = JSON.parse(readFileSync(join(raizDoRepositorio(), 'prompts', 'revisao-consistencia@1.schema.json'), 'utf8')) as unknown;
  // O que o saneador antigo mandava: só oneOf → anyOf e sem uniqueItems; os dois `depois: {properties: {}}` sem `required`.
  const antigo = JSON.parse(JSON.stringify(original).replaceAll('"oneOf"', '"anyOf"').replaceAll('"uniqueItems":true', '"x":1').replaceAll(',"x":1', '')) as unknown;
  const regras = conferirModoEstrito(antigo).map((v) => `${v.caminho}: ${v.regra}`);
  expect(regras.some((r) => r.includes('/depois') && r.includes('objeto sem "required"'))).toBe(true);
  expect(conferirModoEstrito(sanearSchemaParaOCodex(original))).toEqual([]);
});

test('saneador: todo objeto sai com required igual às chaves e additionalProperties false; nomes de propriedade não são palavras-chave', () => {
  const saneado = sanearSchemaParaOCodex({
    type: 'object',
    properties: {
      // Uma propriedade pode se chamar como uma palavra-chave; não pode sumir nem virar outra.
      uniqueItems: { type: 'boolean' },
      oneOf: { type: 'string' },
      depois: { type: 'object', additionalProperties: false, properties: {} },
      opcional: { type: 'object', properties: { a: { const: 1 }, b: { type: 'array', items: { type: 'string' }, uniqueItems: true } }, required: ['a'] },
      escolha: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    },
    required: ['depois'],
  }) as Record<string, unknown>;
  expect(saneado).toEqual({
    type: 'object',
    additionalProperties: false,
    properties: {
      uniqueItems: { type: 'boolean' },
      oneOf: { type: 'string' },
      depois: { type: 'object', additionalProperties: false, properties: {}, required: [] },
      opcional: {
        type: 'object', additionalProperties: false, required: ['a', 'b'],
        properties: { a: { const: 1, type: 'integer' }, b: { type: 'array', items: { type: 'string' } } },
      },
      escolha: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    },
    required: ['uniqueItems', 'oneOf', 'depois', 'opcional', 'escolha'],
  });
  expect(conferirModoEstrito(saneado)).toEqual([]);
});

test('o conferidor acusa o que a API recusa', () => {
  const regras = (schema: unknown) => conferirModoEstrito(schema).map((v) => `${v.caminho}: ${v.regra}`);
  expect(regras({ anyOf: [{ type: 'object' }] })).toContain('/: a raiz precisa ser "type": "object" (sem anyOf)');
  expect(regras({ type: 'object', properties: { a: { type: 'string' } }, required: [], additionalProperties: false }))
    .toEqual(['/: "required" sem: a (toda propriedade é obrigatória; opcional vira tipo com null)']);
  expect(regras({ type: 'object', properties: {}, required: [] })).toEqual(['/: "additionalProperties" precisa ser false (mapa livre não é aceito)']);
  expect(regras({ type: 'object', properties: { m: { type: 'object', additionalProperties: { type: 'string' }, properties: {}, required: [] } }, required: ['m'], additionalProperties: false }))
    .toEqual(['/properties/m: "additionalProperties" precisa ser false (mapa livre não é aceito)']);
  const recusadas = regras({
    type: 'object', additionalProperties: false, required: ['a', 'b', 'c', 'd'],
    properties: {
      a: { type: 'array', items: { type: 'string' }, uniqueItems: true },
      b: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
      c: { enum: ['x', 'y'] },
      d: { type: 'string', format: 'uri', default: 'x' },
    },
    allOf: [],
  });
  expect(recusadas).toEqual(expect.arrayContaining([
    '/: "allOf": não é aceito',
    '/properties/a: "uniqueItems": a API recusa (J10); o saneador tira',
    '/properties/b: "oneOf": use anyOf (o saneador troca)',
    '/properties/b: falta "type" (a API recusa: schema must have a \'type\' key)',
    '/properties/c: falta "type" (a API recusa: schema must have a \'type\' key)',
    '/properties/d: "default": não é aceito no modo estrito',
    '/properties/d: "format": "uri" não é aceito',
  ]));
  expect(regras({ type: 'object', properties: { r: { $ref: '#/$defs/nada' } }, required: ['r'], additionalProperties: false }))
    .toEqual(['/properties/r: "$ref" fora do schema ou sem destino: #/$defs/nada']);
  // Onze níveis de objetos aninhados.
  let fundo: Record<string, unknown> = { type: 'object', properties: {}, required: [], additionalProperties: false };
  for (let i = 0; i < 10; i += 1) fundo = { type: 'object', properties: { f: fundo }, required: ['f'], additionalProperties: false };
  expect(regras(fundo).some((r) => r.includes('mais de 10 níveis'))).toBe(true);
});
