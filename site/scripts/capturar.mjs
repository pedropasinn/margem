// Capturas de todas as páginas (claro e escuro, 1680 e 390 px) e a imagem Open Graph.
// Uso: npm run build && npm run capturar   (sobe o `vite preview` na porta 5201 e o derruba no fim)
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { CONFIG } from '../src/config.ts';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const saida = resolve(raiz, 'capturas');
const base = 'http://localhost:5201';
await mkdir(saida, { recursive: true });

const servidor = spawn(resolve(raiz, 'node_modules/.bin/vite'), ['preview', '--port', '5201', '--strictPort'], { cwd: raiz, stdio: 'ignore' });
const pronto = async () => {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base)).ok) return; } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('vite preview não respondeu na porta 5201');
};

const problemas = [];
const navegador = await chromium.launch();
try {
  await pronto();
  const docs = ['instalacao', 'primeiros-passos', 'importar', 'quadros', 'extensao', 'obsidian', 'audio', 'manutencao', 'perguntas', 'problemas', 'contribuir'];
  const paginas = [['inicio', '/'], ['privacidade', '/privacidade/'], ['termos', '/termos/'], ['novidades', '/novidades/'], ['docs', '/docs/'],
    ...docs.map((d) => [`docs-${d}`, `/docs/${d}/`])];
  for (const esquema of ['light', 'dark']) {
    for (const largura of [1680, 390]) {
      const contexto = await navegador.newContext({
        viewport: { width: largura, height: largura > 1000 ? 1000 : 844 },
        deviceScaleFactor: 1, // 2× passaria do limite de 16 384 px do Chromium na página inteira
        colorScheme: esquema,
        reducedMotion: 'reduce',
      });
      const pagina = await contexto.newPage();
      pagina.on('pageerror', (e) => problemas.push(`${esquema} ${largura}: ${e.message}`));
      for (const [nome, caminho] of paginas) {
        await pagina.goto(base + caminho, { waitUntil: 'networkidle' });
        await pagina.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all([...document.images].map((i) => i.decode().catch(() => undefined)));
        });
        await pagina.waitForTimeout(300);
        const transborda = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (transborda > 0) problemas.push(`${nome} ${esquema} ${largura}: transbordo horizontal de ${transborda}px`);
        const tema = esquema === 'light' ? 'claro' : 'escuro';
        await pagina.screenshot({ path: resolve(saida, `${nome}-${tema}-${largura}.png`), fullPage: true });
      }
      await contexto.close();
    }
  }

  // A demonstração animada e com interação: pergunta aberta e hover numa nota.
  for (const esquema of ['light', 'dark']) {
    const contexto = await navegador.newContext({ viewport: { width: 1680, height: 1000 }, colorScheme: esquema });
    const pagina = await contexto.newPage();
    await pagina.goto(base, { waitUntil: 'networkidle' });
    await pagina.locator('.demo').scrollIntoViewIfNeeded();
    await pagina.waitForTimeout(6000);
    await pagina.locator('[data-nota="m3"]').hover();
    await pagina.waitForTimeout(400);
    const tema = esquema === 'light' ? 'claro' : 'escuro';
    await pagina.locator('.demo').screenshot({ path: resolve(saida, `demo-${tema}-hover.png`) });
    await pagina.getByRole('radio', { name: 'Sublinhado' }).click();
    await pagina.getByRole('radio', { name: 'Só as essenciais' }).click();
    await pagina.mouse.move(0, 0);
    await pagina.waitForTimeout(1200);
    await pagina.locator('.demo').screenshot({ path: resolve(saida, `demo-${tema}-sublinhado-atencao1.png`) });
    await contexto.close();
  }

  // Imagem Open Graph (1200 × 630): a captura real do app ao lado do nome e da frase (do config).
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce' });
  const pagina = await contexto.newPage();
  const demo = await readFile(resolve(raiz, 'public/app/nota-aberta-claro.png'));
  const icone = await readFile(resolve(raiz, 'public/icone-512.png'));
  await pagina.setViewportSize({ width: 1200, height: 630 });
  await pagina.setContent(`<!doctype html><html><head>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400..700&display=swap">
    <style>
      html { overflow: hidden; } body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #f8f8f8; font-family: Figtree, sans-serif; }
      .texto { position: absolute; left: 64px; top: 72px; width: 420px; }
      .marca { display: flex; align-items: center; gap: 14px; font-weight: 700; font-size: 34px; letter-spacing: -.02em; }
      .marca img { width: 56px; height: 56px; border-radius: 14px; box-shadow: 0 0 0 1px #0001; }
      h1 { margin: 44px 0 0; font-size: 50px; line-height: 1.06; letter-spacing: -.03em; }
      p { margin: 22px 0 0; font-size: 22px; line-height: 1.45; color: #000a; }
      .selo { display: inline-block; margin-top: 28px; padding: 8px 16px; border-radius: 999px; background: #e6ecff; color: #2f4fd6; font-weight: 700; font-size: 17px; }
      .folha { position: absolute; left: 524px; top: 64px; width: 900px; height: 640px; border: 2px solid #e5e5e5; border-radius: 24px; background: #fff; overflow: hidden; box-shadow: 0 12px 40px #0001; }
      .folha img { display: block; width: 100%; }
    </style></head><body>
    <div class="texto">
      <div class="marca"><img src="data:image/png;base64,${icone.toString('base64')}" alt="">${CONFIG.nome}</div>
      <h1>${CONFIG.slogan}</h1>
      <p>No seu computador, com a sua conta do ChatGPT.</p>
      <span class="selo">Código aberto · ${CONFIG.licenca}</span>
    </div>
    <div class="folha"><img src="data:image/png;base64,${demo.toString('base64')}" alt=""></div>
  </body></html>`, { waitUntil: 'networkidle' });
  await pagina.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
  const og = await pagina.screenshot({ type: 'png' });
  await writeFile(resolve(raiz, 'public/og.png'), og);
  await writeFile(resolve(saida, 'og.png'), og);
  await contexto.close();
} finally {
  await navegador.close();
  servidor.kill();
}

if (problemas.length > 0) {
  console.error('Problemas encontrados:\n' + problemas.join('\n'));
  process.exitCode = 1;
} else console.log(`Capturas em ${saida}`);
