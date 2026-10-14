// Mede a página inicial do build: altura total (claro, 1680 e 390) e o JS/CSS que ela carrega de saída.
// Uso: npm run build && node scripts/medir-inicio.mjs
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = 'http://localhost:5201';
const servidor = spawn(resolve(raiz, 'node_modules/.bin/vite'), ['preview', '--port', '5201', '--strictPort'], { cwd: raiz, stdio: 'ignore' });
const navegador = await chromium.launch();
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base)).ok) break; } catch { /* subindo */ } await new Promise((r) => setTimeout(r, 200)); }
  for (const largura of [1680, 390]) {
    const contexto = await navegador.newContext({ viewport: { width: largura, height: largura > 1000 ? 1000 : 844 }, reducedMotion: 'reduce' });
    const pagina = await contexto.newPage();
    const bytes = { js: 0, css: 0 };
    const pendentes = [];
    pagina.on('response', (r) => {
      const url = r.url();
      if (!url.startsWith(base)) return;
      const tipo = url.endsWith('.js') ? 'js' : url.endsWith('.css') ? 'css' : null;
      if (tipo) pendentes.push(r.body().then((b) => { bytes[tipo] += b.length; }, () => undefined));
    });
    await pagina.goto(base, { waitUntil: 'networkidle' });
    await pagina.evaluate(() => document.fonts.ready);
    await pagina.waitForTimeout(400);
    const altura = await pagina.evaluate(() => document.documentElement.scrollHeight);
    await Promise.all(pendentes);
    console.log(`${largura}px: altura ${altura}px; JS de saída ${(bytes.js / 1024).toFixed(1)} kB; CSS ${(bytes.css / 1024).toFixed(1)} kB`);
    await contexto.close();
  }
} finally { await navegador.close(); servidor.kill(); }
