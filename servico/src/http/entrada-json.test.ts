import { expect, test } from 'vitest';
import { lerCorpoJson } from './entrada-json.js';
import { ORCAMENTOS } from '../entrada-json.js';
test('sem Content-Length, interrompe stream excedente e recusa profundidade; vazio só quando autorizado', async () => {
  let cancelado = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) { c.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelado = true; },
  });
  const req = new Request('http://localhost/teste', { method: 'POST', body: stream, duplex: 'half' });
  await expect(lerCorpoJson(req)).rejects.toMatchObject({ status: 413 });
  expect(cancelado).toBe(true);
  const profunda = new Request('http://localhost/teste', { method: 'POST', body: '['.repeat(ORCAMENTOS.canonico.profundidade + 1) + '0' });
  await expect(lerCorpoJson(profunda)).rejects.toMatchObject({ status: 413 });
  expect(await lerCorpoJson(new Request('http://localhost/teste'), true)).toEqual({});
  await expect(lerCorpoJson(new Request('http://localhost/teste'))).rejects.toMatchObject({ status: 400 });
});
