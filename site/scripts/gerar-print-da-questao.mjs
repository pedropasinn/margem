// Gera public/demo/questao.png: o "print" da questão que a demonstração de exercícios cola no app.
// A questão é original (escrita para a página, como as resoluções em src/demo/exercicio.ts), com a
// matemática desenhada pelo KaTeX das dependências da raiz do repositório.
// Uso: node scripts/gerar-print-da-questao.mjs   (precisa de `npm ci` na raiz)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const daRaiz = createRequire(resolve(raiz, '../package.json'));
const katex = daRaiz('katex');
const css = pathToFileURL(daRaiz.resolve('katex/dist/katex.min.css')).href;
const f = (tex, display = false) => katex.renderToString(tex, { displayMode: display, throwOnError: true });

const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${css}">
<style>
  body { margin: 0; background: #fff; color: #111; font: 17px/1.55 "Source Serif 4", Georgia, serif; }
  .folha { width: 560px; padding: 22px 28px 20px; }
  .cabeca { display: flex; justify-content: space-between; font: 600 12px/1 system-ui, sans-serif; letter-spacing: .06em; text-transform: uppercase; color: #666; border-bottom: 1px solid #ddd; padding-bottom: 8px; margin-bottom: 14px; }
  p { margin: 0 0 8px; }
  ol { margin: 6px 0 0; padding-left: 30px; list-style: lower-alpha; }
  li { margin: 6px 0; }
</style></head><body><div class="folha">
  <div class="cabeca"><span>Lista 4 · Técnicas de integração</span><span>Cálculo I</span></div>
  <p><b>7.</b> Calcule as integrais.</p>
  <ol><li>${f('\\displaystyle\\int_0^1 x\\,e^x\\,dx')}</li><li>${f('\\displaystyle\\int x\\ln x\\,dx')}, para ${f('x > 0')}.</li></ol>
</div></body></html>`;

const arquivo = join(tmpdir(), `margem-print-${process.pid}.html`);
await writeFile(arquivo, html);
const navegador = await chromium.launch();
try {
  const pagina = await navegador.newPage({ deviceScaleFactor: 2, viewport: { width: 560, height: 400 } });
  await pagina.goto(pathToFileURL(arquivo).href, { waitUntil: 'networkidle' });
  await pagina.evaluate(() => document.fonts.ready);
  await mkdir(resolve(raiz, 'public/demo'), { recursive: true });
  const png = await pagina.locator('.folha').screenshot({ type: 'png' });
  await writeFile(resolve(raiz, 'public/demo/questao.png'), png);
  console.log(`public/demo/questao.png (${png.length} bytes)`);
} finally {
  await navegador.close();
  await readFile(arquivo).then(() => import('node:fs/promises')).then((fs) => fs.rm(arquivo)).catch(() => undefined);
}
