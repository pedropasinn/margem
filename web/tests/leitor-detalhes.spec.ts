/** Verificação visual local, com todas as chamadas de API interceptadas. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { capituloExemplo } from '../src/leitor/fixtures/capitulo-exemplo.ts';

const base = 'http://127.0.0.1:5198';
const servidor = await createServer({ root: new URL('../', import.meta.url).pathname, configLoader: 'runner', cacheDir: '/tmp/leitor-detalhes-vite', server: { host: '127.0.0.1', port: 5198, strictPort: true } });
await servidor.listen();
const navegador = await chromium.launch();
mkdirSync('/tmp/leitor-detalhes-capturas', { recursive: true });
try {
  for (const [width, height] of [[1440, 900], [412, 915]]) {
    const pagina = await navegador.newPage({ viewport: { width: width!, height: height! } });
    const documento = '00000000000000000000000001';
    const snapshot = { ...capituloExemplo, documento_id: documento, recuperacao: [], anterior: null, proxima: 'seguinte', revisao_marcas: 'a'.repeat(64), palavras_no_livro: { antes: 460, total: 1380 } };
    await pagina.route('**/*', async (rota) => {
      const url = new URL(rota.request().url());
      if (url.origin !== base) return rota.abort();
      if (!url.pathname.startsWith('/api/')) return rota.continue();
      let dados: unknown = {};
      if (url.pathname === `/api/documentos/${documento}`) dados = { id: documento, versao_id: snapshot.versao_id, titulo: 'Livro de teste', autor: 'Machado de Assis', formato: 'md' };
      else if (url.pathname.endsWith('/secoes')) dados = { documento_id: documento, versao_id: snapshot.versao_id, titulo: 'Livro de teste', secoes: [], capitulos: [{ id: snapshot.secao.id, titulo: snapshot.secao.titulo }, { id: 'seguinte', titulo: 'Segundo capítulo' }] };
      else if (url.pathname.includes('/capitulos/')) dados = snapshot;
      else if (url.pathname.endsWith('/progresso')) dados = { progresso: null };
      await rota.fulfill({ contentType: 'application/json', body: JSON.stringify(dados) });
    });
    await pagina.goto(`${base}/ler/${documento}/${snapshot.secao.id}`, { timeout: 120_000, waitUntil: 'domcontentloaded' });
    await pagina.getByText('33% do livro').waitFor({ timeout: 120_000 });
    await pagina.evaluate(() => document.fonts.ready);
    assert.equal(await pagina.title(), `${snapshot.secao.titulo} · Livro de teste — Margem`);
    assert.equal(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const centro = await pagina.locator('.progresso-no-livro').boundingBox();
    const direita = await pagina.locator('.barra-direita').boundingBox();
    assert.ok(centro && direita);
    assert.ok(centro.y >= direita.y + direita.height || centro.x + centro.width <= direita.x, 'progresso não sobrepõe controles');
    await pagina.screenshot({ path: `/tmp/leitor-detalhes-capturas/${width}.png` });
    await pagina.close();
  }
} finally { await navegador.close(); await servidor.close(); }
