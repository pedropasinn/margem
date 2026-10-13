import { expect, test } from 'vitest';

test('executa o workspace de contratos', () => {
  expect(JSON.parse('{"versao":1}') as unknown).toEqual({ versao: 1 });
});
