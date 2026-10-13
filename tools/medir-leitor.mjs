/** Com o Vite desta worktree aberto: node tools/medir-leitor.mjs [URL local]. */
import { chromium } from 'playwright';
const url = new URL(process.argv[2] ?? 'http://127.0.0.1:8766/benchmark/');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('O benchmark só acessa localhost.');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/*', route => new URL(route.request().url()).origin === url.origin ? route.continue() : route.abort());
  page.on('pageerror', e => { console.error(e.message); process.exitCode = 1; });
  await page.goto(url.href);
  await page.waitForFunction(() => document.body.dataset.resultado, undefined, { timeout: 120000 });
  const resultado = JSON.parse(await page.getAttribute('body', 'data-resultado'));
  if (!resultado.texto.texto_preservado || !resultado.pdf.quads_iguais) throw new Error('Projeção divergente no benchmark.');
  console.log(JSON.stringify(resultado, null, 2));
} finally { await browser.close(); }
