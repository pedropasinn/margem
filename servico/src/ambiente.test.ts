import { expect, test } from 'vitest';

test('executa o serviço em Node', () => {
  expect(process.release.name).toBe('node');
});
