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
  const docs = ['instalacao', 'primeiros-passos', 'importar', 'relacoes', 'videos', 'questoes', 'quadros', 'extensao', 'obsidian', 'audio', 'atualizacoes', 'backup', 'desinstalar', 'perguntas', 'problemas', 'contribuir'];
  const todas = [['inicio', '/'], ['download', '/download/'], ['privacidade', '/privacidade/'], ['termos', '/termos/'], ['novidades', '/novidades/'], ['docs', '/docs/'],
    ...docs.map((d) => [`docs-${d}`, `/docs/${d}/`])];
  // CAPTURAR_SO=inicio,download limita às páginas citadas (as demonstrações e o og.png só com a inicial).
  const so = process.env['CAPTURAR_SO']?.split(',');
  const paginas = so ? todas.filter(([nome]) => so.includes(nome)) : todas;
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
        // As demonstrações do app carregam quando a seção se aproxima: desce a página antes da foto inteira.
        await pagina.evaluate(async () => {
          for (let y = 0; y < document.documentElement.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
          window.scrollTo(0, 0);
        });
        await pagina.waitForLoadState('networkidle');
        if (nome === 'inicio') await pagina.locator('.palco-do-quadro[data-carregada]').waitFor({ timeout: 15000 }).catch(() => problemas.push(`inicio ${esquema} ${largura}: o quadro não carregou`));
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

  // As demonstrações em uso. O recorte do leitor: a nota aberta pelo trecho, uma relação acesa pelo círculo
  // e o sublinhado. O leitor de quadro do app: uma região escolhida, o Percorrer e a análise
  // curta. O painel de resolução com os passos e a conversa. A nota do Obsidian. A lista de formatos aberta.
  const fotografar = async (local, arquivo) => { await local.screenshot({ path: resolve(saida, arquivo) }); };
  for (const [esquema, largura] of (so && !so.includes('inicio')) ? [] : [['light', 1680], ['dark', 1680], ['light', 390], ['dark', 390]]) {
    const contexto = await navegador.newContext({ viewport: { width: largura, height: largura > 1000 ? 1000 : 844 }, colorScheme: esquema });
    const pagina = await contexto.newPage();
    pagina.on('pageerror', (e) => problemas.push(`demo ${esquema} ${largura}: ${e.message}`));
    const tema = `${esquema === 'light' ? 'claro' : 'escuro'}${largura === 390 ? '-390' : ''}`;
    await pagina.goto(base, { waitUntil: 'networkidle' });
    const recorte = pagina.locator('.demo').first();
    await recorte.scrollIntoViewIfNeeded();
    await pagina.waitForTimeout(5000);
    if (largura > 1000) {
      await pagina.locator('[data-marcas~="m4"]').first().hover();
      await pagina.waitForTimeout(400);
      await fotografar(recorte, `demo-${tema}-nota.png`);
      await pagina.locator('.alvo-braquete').first().hover();
      await pagina.waitForTimeout(500);
      await fotografar(recorte, `demo-${tema}-relacao.png`);
      await pagina.mouse.move(0, 0);
      await pagina.getByRole('radio', { name: 'Sublinhado' }).click();
      await pagina.waitForTimeout(600);
      await fotografar(recorte, `demo-${tema}-sublinhado.png`);
    }

    try {
      const estudar = pagina.locator('#estudar');
      await estudar.scrollIntoViewIfNeeded();
      await pagina.locator('.palco-do-quadro[data-carregada]').waitFor();
      await pagina.waitForTimeout(400);
      await fotografar(estudar, `quadro-${tema}.png`);
      await pagina.locator('.regiao-do-quadro').nth(1).click();
      await pagina.waitForTimeout(700);
      await fotografar(estudar, `quadro-${tema}-regiao.png`);
      await pagina.getByRole('button', { name: 'Percorrer as afirmações' }).first().click();
      await pagina.getByRole('button', { name: 'Próxima afirmação' }).click();
      await pagina.waitForTimeout(700);
      await fotografar(estudar, `quadro-${tema}-percorrer.png`);
      await pagina.getByRole('button', { name: 'Fechar o percorrer' }).click();
      await pagina.getByRole('button', { name: 'Análise curta' }).first().click();
      await pagina.waitForTimeout(2500);
      await fotografar(estudar, `quadro-${tema}-analise-curta.png`);
      await pagina.getByRole('button', { name: 'Fechar a análise curta' }).first().click();

      await pagina.getByRole('tab', { name: 'Exercícios' }).click();
      await pagina.locator('.sessao-de-resolucao .item-da-resolucao').first().waitFor();
      for (let i = 0; i < 4; i++) { await pagina.locator('.sessao-de-resolucao .proximo-passo').click(); await pagina.waitForTimeout(250); }
      await pagina.waitForTimeout(800);
      await fotografar(estudar, `exercicio-${tema}.png`);

      await pagina.getByRole('tab', { name: 'Obsidian' }).click();
      await pagina.locator('.demo-obsidian').waitFor();
      await fotografar(estudar, `obsidian-${tema}.png`);

      const biblioteca = pagina.locator('#biblioteca');
      await biblioteca.scrollIntoViewIfNeeded();
      await pagina.locator('.todos-os-formatos > summary').click();
      await pagina.waitForTimeout(300);
      await fotografar(biblioteca, `biblioteca-${tema}-todos.png`);
      const transborda = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (transborda > 0) problemas.push(`demos ${tema}: transbordo horizontal de ${transborda}px`);
    } catch (erro) {
      problemas.push(`demos ${tema}: ${erro instanceof Error ? erro.message.split('\n')[0] : String(erro)}`);
      await pagina.screenshot({ path: resolve(saida, `falha-${tema}.png`) });
    }
    await contexto.close();
  }

  // Imagem Open Graph (1200 × 630): a captura real do app ao lado da assinatura (docs/identidade/) e da frase (do config).
  // Só com a página inicial na lista (o og.png é dela).
  if (!so || so.includes('inicio')) {
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce' });
    const pagina = await contexto.newPage();
    const demo = await readFile(resolve(raiz, 'public/app/nota-aberta-claro.png'));
    const assinatura = await readFile(resolve(raiz, '../docs/identidade/assinatura-curta-claro.svg'));
    await pagina.setViewportSize({ width: 1200, height: 630 });
    await pagina.setContent(`<!doctype html><html><head>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400..700&display=swap">
      <style>
        html { overflow: hidden; } body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #f8f8f8; font-family: Figtree, sans-serif; }
        .texto { position: absolute; left: 64px; top: 72px; width: 420px; }
        .marca { display: block; height: 96px; width: auto; margin-left: -6px; }
        h1 { margin: 32px 0 0; font-size: 50px; line-height: 1.06; letter-spacing: -.03em; }
        p { margin: 22px 0 0; font-size: 22px; line-height: 1.45; color: #000a; }
        .selo { display: inline-block; margin-top: 28px; padding: 8px 16px; border-radius: 999px; background: #e6ecff; color: #2f4fd6; font-weight: 700; font-size: 17px; }
        .folha { position: absolute; left: 524px; top: 64px; width: 900px; height: 640px; border: 2px solid #e5e5e5; border-radius: 24px; background: #fff; overflow: hidden; box-shadow: 0 12px 40px #0001; }
        .folha img { display: block; width: 100%; }
      </style></head><body>
      <div class="texto">
        <img class="marca" src="data:image/svg+xml;base64,${assinatura.toString('base64')}" alt="${CONFIG.nome}">
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
  }
} finally {
  await navegador.close();
  servidor.kill();
}

if (problemas.length > 0) {
  console.error('Problemas encontrados:\n' + problemas.join('\n'));
  process.exitCode = 1;
} else console.log(`Capturas em ${saida}`);
