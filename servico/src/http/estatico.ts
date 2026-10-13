/**
 * Serve `web/dist` na mesma origem da API.
 *
 * Mesma origem por decisão: assim o leitor não precisa de CORS e o cabeçalho
 * `X-Margem` basta como proteção contra escrita de terceiros. Nenhum caminho vem
 * do cliente sem passar por `dentroDaRaiz`.
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { dentroDaRaiz, raizDoRepositorio } from '../dados.js';

const TIPOS: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
  map: 'application/json; charset=utf-8',
  wasm: 'application/wasm',
};

function tipo(caminho: string): string {
  return TIPOS[caminho.slice(caminho.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';
}

async function ler(caminho: string): Promise<Buffer | null> {
  try {
    if (!(await stat(caminho)).isFile()) return null;
    return await readFile(caminho);
  } catch {
    return null;
  }
}

export function servirWeb(app: Hono, raiz = join(raizDoRepositorio(), 'web/dist')): void {
  app.get('*', async (c) => {
    const caminho = decodeURIComponent(new URL(c.req.url).pathname);
    if (caminho.startsWith('/api/')) return c.notFound();
    const alvo = caminho === '/' ? join(raiz, 'index.html') : dentroDaRaiz(raiz, caminho.slice(1));
    const bytes = alvo === null ? null : await ler(alvo);
    if (bytes !== null && alvo !== null) {
      c.header('Content-Type', tipo(alvo));
      // Os nomes do Vite já carregam hash; o index nunca é cacheado.
      c.header('Cache-Control', alvo.endsWith('index.html') ? 'no-store' : 'private, max-age=604800');
      return c.body(new Uint8Array(bytes));
    }
    // Rota do navegador (`/documentos/…`, `/ler/…`): quem resolve é o roteador da web.
    const indice = await ler(join(raiz, 'index.html'));
    if (indice === null) return c.text('A interface ainda não foi construída (npm run build --workspace web).', 404);
    c.header('Content-Type', 'text/html; charset=utf-8');
    c.header('Cache-Control', 'no-store');
    return c.body(new Uint8Array(indice));
  });
}
