import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { expect, test } from 'vitest';
import { compressao } from './compressao.js';
import { servirWeb } from './estatico.js';

function api() {
  const app = new Hono();
  app.use('*', compressao());
  app.get('/json', (c) => { c.header('Vary', 'Origin'); c.header('ETag', '"texto"'); return c.json({ texto: 'Capítulo '.repeat(1000) }); });
  return app;
}

test.each(['gzip', 'br'] as const)('JSON e estáticos: %s preserva corpo e negocia cache', async (formato) => {
  const app = api();
  const pasta = await mkdtemp(join(tmpdir(), 'margem-compressao-'));
  const texto = 'const titulo = "Capítulo";\n'.repeat(100);
  try {
    await writeFile(join(pasta, 'app.js'), texto);
    servirWeb(app, pasta);
    for (const caminho of ['/json', '/app.js']) {
      const original = await (await app.request(caminho)).text();
      const resposta = await app.request(caminho, { headers: { 'Accept-Encoding': formato } });
      expect(resposta.headers.get('Content-Encoding')).toBe(formato);
      expect(resposta.headers.get('Vary')).toContain('Accept-Encoding');
      expect(resposta.headers.has('Content-Length')).toBe(false);
      const bytes = Buffer.from(await resposta.arrayBuffer());
      expect((formato === 'br' ? brotliDecompressSync(bytes) : gunzipSync(bytes)).toString()).toBe(original);
      if (caminho === '/json') {
        expect(resposta.headers.get('Vary')).toBe('Origin, Accept-Encoding');
        expect(resposta.headers.get('ETag')).toBe('W/"texto"');
      }
    }
  } finally { await rm(pasta, { recursive: true, force: true }); }
});

test.each([
  ['', null], ['gzip;q=0, br;q=0', null], ['br;q=0, gzip;q=0.5', 'gzip'],
  ['gzip;q=0.5, br;q=1', 'br'], ['*;q=1, br;q=0', 'gzip'],
  ['gzip;q=0.5, identity;q=1', null], ['br, gzip', 'br'],
] as const)('Accept-Encoding %s', async (aceita, esperado) => {
  const resposta = await api().request('/json', { headers: { 'Accept-Encoding': aceita } });
  expect(resposta.headers.get('Content-Encoding')).toBe(esperado);
});

test.each(['application/pdf', 'image/png', 'audio/mpeg', 'video/mp4', 'text/event-stream'])('não comprime %s nem altera ETag', async (tipo) => {
  const app = api();
  app.get('/arquivo', (c) => {
    c.header('Content-Type', tipo); c.header('ETag', '"original"');
    return c.body('data: exemplo\n\n');
  });
  const resposta = await app.request('/arquivo', { headers: { 'Accept-Encoding': 'br, gzip' } });
  expect(resposta.headers.has('Content-Encoding')).toBe(false);
  expect(resposta.headers.get('ETag')).toBe('"original"');
  expect(await resposta.text()).toBe('data: exemplo\n\n');
});

test('206 e no-transform não são comprimidos mesmo em texto', async () => {
  const app = api();
  app.get('/parcial', (c) => { c.header('Content-Range', 'bytes 0-2/10'); return c.text('abc', 206); });
  app.get('/intacto', (c) => { c.header('Cache-Control', 'private, no-transform'); return c.text('abc'); });
  for (const caminho of ['/parcial', '/intacto']) {
    const resposta = await app.request(caminho, { headers: { 'Accept-Encoding': 'gzip, br', Range: 'bytes=0-2' } });
    expect(resposta.headers.has('Content-Encoding')).toBe(false);
    expect(await resposta.text()).toBe('abc');
    if (caminho === '/parcial') {
      expect(resposta.status).toBe(206);
      expect(resposta.headers.get('Content-Range')).toBe('bytes 0-2/10');
    }
  }
});

test('SSE de verdade não é bufferizado: o primeiro evento chega com o fluxo aberto', async () => {
  const app = api();
  app.get('/eventos', (c) => streamSSE(c, async (fluxo) => {
    await fluxo.writeSSE({ data: 'primeiro' });
    await new Promise<void>((fim) => { fluxo.onAbort(fim); });
  }));
  const resposta = await app.request('/eventos', { headers: { 'Accept-Encoding': 'br, gzip' } });
  expect(resposta.headers.has('Content-Encoding')).toBe(false);
  const leitor = (resposta.body as ReadableStream<Uint8Array>).getReader();
  expect(new TextDecoder().decode((await leitor.read()).value)).toContain('data: primeiro');
  await leitor.cancel();
});

test('corpo pequeno sai sem compressão, mas com Vary', async () => {
  const app = api();
  app.get('/pequeno', (c) => c.json({ ok: true }));
  const resposta = await app.request('/pequeno', { headers: { 'Accept-Encoding': 'gzip' } });
  expect(resposta.headers.has('Content-Encoding')).toBe(false);
  expect(resposta.headers.get('Vary')).toBe('Accept-Encoding');
  expect(await resposta.json()).toEqual({ ok: true });
});

// Integração (#61 + #65): pelo @hono/node-server de verdade, não só por app.request. Com o Response
// leve do node-server, `new Response(corpo, respostaAnterior)` perdia os cabeçalhos postos depois
// (Content-Encoding e os de segurança de um middleware interno).
test('pelo node-server: comprime e conserva os cabeçalhos dos middlewares internos', async () => {
  const { serve } = await import('@hono/node-server');
  const { request } = await import('node:http');
  const app = new Hono();
  app.use('*', compressao());
  app.use('*', async (c, proximo) => { await proximo(); c.res.headers.set('X-Content-Type-Options', 'nosniff'); });
  app.get('/grande', (c) => c.json({ texto: 'Capítulo '.repeat(1000) }));
  app.get('/pequeno', (c) => c.json({ ok: true }));
  const servidor = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise<void>((pronto) => servidor.once('listening', () => pronto()));
  const porta = (servidor.address() as { port: number }).port;
  const pedir = (caminho: string) => new Promise<Record<string, string | string[] | undefined>>((ok, falha) => {
    request({ host: '127.0.0.1', port: porta, path: caminho, headers: { 'Accept-Encoding': 'gzip' } }, (resposta) => {
      resposta.resume(); resposta.on('end', () => ok(resposta.headers));
    }).on('error', falha).end();
  });
  try {
    const grande = await pedir('/grande');
    expect(grande['content-encoding']).toBe('gzip');
    expect(grande['x-content-type-options']).toBe('nosniff');
    const pequeno = await pedir('/pequeno');
    expect(pequeno['content-encoding']).toBeUndefined();
    expect(pequeno['x-content-type-options']).toBe('nosniff');
  } finally {
    await new Promise<void>((fim) => servidor.close(() => fim()));
  }
});
