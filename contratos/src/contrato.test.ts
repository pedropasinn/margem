import Ajv from 'ajv/dist/2020.js';
import { expect, test, vi } from 'vitest';
import { alternativas, compilarContrato, folha, objeto, referenciar, type ConferirEstrutura } from './contrato';
const ajv = new Ajv({ strict: false });
const estrutura: ConferirEstrutura = (schema, valor) => ajv.compile(schema)(valor) ? [] : [{ caminho: [], codigo: 'estrutura', mensagem: 'Inválido' }];

test('uma referência nova incorpora sua regra uma única vez', () => {
  const regra = vi.fn(() => []);
  const filho = folha({ type: 'string' }, regra);
  ajv.addSchema(filho.schema, 'https://teste.local/filho');
  const pai = objeto({ type: 'object', required: ['filho'], properties: { filho: {} } }, { filho: referenciar(filho, 'https://teste.local/filho') });
  expect(compilarContrato(pai, estrutura).validarLocal({ filho: 'texto' }).ok).toBe(true);
  expect(regra).toHaveBeenCalledTimes(1);
  expect(() => folha({ $ref: 'https://teste.local/filho' })).toThrow('referenciar');
  expect(() => objeto({ type: 'object', properties: { filho: { $ref: 'https://teste.local/filho' } } }, {})).toThrow('referenciar');
});

test('oneOf não usa a semântica para salvar uma ambiguidade estrutural', () => {
  const falha = folha({ type: 'string' }, () => [{ caminho: [], codigo: 'falha', mensagem: 'Falha' }]);
  const passa = folha({ type: 'string' });
  expect(compilarContrato(alternativas({}, 'oneOf', [falha, passa]), estrutura).validarLocal('x').ok).toBe(false);
  expect(compilarContrato(alternativas({}, 'anyOf', [falha, passa]), estrutura).validarLocal('x').ok).toBe(true);
  expect(compilarContrato(alternativas({}, 'anyOf', [falha, folha({ type: 'null' })]), estrutura).validarLocal('x').ok).toBe(false);
});
