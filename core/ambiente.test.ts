import { expect, test } from 'vitest';

test('preserva unidades UTF-16 do JavaScript', () => {
  expect('📖'.length).toBe(2);
});
