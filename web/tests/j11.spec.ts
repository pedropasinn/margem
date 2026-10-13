import { escolherOpcao, abrirOpcoes } from './controles.ts';
/** J11: navegação local sobre dist, sem API ou recursos externos. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { preview } from 'vite';

const pasta = new URL('./capturas/', import.meta.url);
mkdirSync(pasta, { recursive: true });
const servidor = await preview({ configLoader: 'runner', preview: { host: '127.0.0.1', port: 5191, strictPort: true } });
const base = 'http://127.0.0.1:5191';
const navegador = await chromium.launch();
const erros: string[] = [];
async function conferir(pagina: Page): Promise<void> {
  await pagina.evaluate(() => document.fonts.ready);
  const overflow = await pagina.evaluate(() => ({
    pagina: location.pathname, largura: innerWidth, documento: document.documentElement.scrollWidth,
    elementos: [...document.querySelectorAll('main,section,.leitor,.margem,.filtros')].flatMap((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1) ? [{ classe: e.className, left: r.left, right: r.right }] : [];
    }),
  }));
  assert.ok(overflow.documento <= overflow.largura + 1, `sem rolagem horizontal: ${JSON.stringify(overflow)}`);
  if (pagina.viewportSize()!.width >= 1440) {
    const artigo = await pagina.locator('.capitulo').boundingBox();
    assert.ok(artigo && Math.abs(artigo.x + artigo.width / 2 - pagina.viewportSize()!.width / 2) <= 4, `texto centrado em ${pagina.url()}`);
  }
  assert.equal(await pagina.locator('.capitulo > .camada-de-marcas').count(), 1);
  const caminhos = await pagina.locator('svg path').evaluateAll((elementos) => elementos.every((e) => Number.isFinite((e as SVGPathElement).getTotalLength())));
  assert.equal(caminhos, true, 'caminhos SVG válidos no Chromium');
}
async function capturar(pagina: Page, nome: string): Promise<void> {
  await pagina.screenshot({ path: new URL(`j11-${nome}.png`, pasta).pathname });
  console.log(`captura: j11-${nome}.png`);
}
try {
  for (const [tela, width, height] of [['desktop', 1440, 900], ['celular', 412, 915]] as const) {
    const pagina = await navegador.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    pagina.on('pageerror', (erro) => erros.push(erro.message));
    await pagina.route('**/*', (rota) => {
      const url = new URL(rota.request().url());
      return url.hostname === '127.0.0.1' || url.protocol === 'data:' ? rota.continue() : rota.abort();
    });
    await pagina.goto(`${base}/dev/componentes`, { waitUntil: 'networkidle' });
    await conferir(pagina);
    await capturar(pagina, `galeria-${tela}`);
    // Todos os gestos respondem aos controles, inclusive multilinha e colchete à direita.
    await pagina.getByRole('button', { name: 'Fechar', exact: true }).click();
    const antes = await pagina.locator('.amostra-traco path').first().getAttribute('d');
    await pagina.getByLabel('Semente', { exact: true }).fill('83');
    assert.notEqual(await pagina.locator('.amostra-traco path').first().getAttribute('d'), antes);
    await pagina.getByRole('checkbox', { name: 'Texto em várias linhas' }).check();
    await escolherOpcao(pagina, 'Lado do colchete', 'Direita');
    assert.ok(await pagina.locator('.amostra-traco').first().locator('path').count() > 1, 'multilinha');
    await conferir(pagina);

    for (const tema of ['claro', 'escuro', 'sepia'] as const) {
      await pagina.evaluate((tema) => {
        localStorage.clear();
        localStorage.setItem('margem:aparencia', JSON.stringify({ tema, animacao: false }));
      }, tema);
      await pagina.goto(`${base}/dev/margem`, { waitUntil: 'networkidle' });
      await conferir(pagina);
      const conteudo = await pagina.locator('.capitulo').textContent();
      assert.ok(await pagina.locator('.camada-de-marcas path').count() > 5);
      assert.equal(await pagina.locator('.camada-de-marcas').evaluate((svg) => getComputedStyle(svg).mixBlendMode), tema === 'escuro' ? 'screen' : 'multiply');
      assert.equal(await pagina.locator('.camada-de-marcas').evaluate((svg) => getComputedStyle(svg).pointerEvents), 'none');
      const desenho = await pagina.locator('.camada-de-marcas path').first().getAttribute('d');
      await pagina.reload({ waitUntil: 'networkidle' });
      assert.equal(await pagina.locator('.camada-de-marcas path').first().getAttribute('d'), desenho, 'mesma semente após reload');
      assert.equal(await pagina.locator('.capitulo').textContent(), conteudo);
      await capturar(pagina, `leitor-${tema}-${tela}`);
    }
    await pagina.getByRole('button', { name: 'Aparência', exact: true }).click();
    await escolherOpcao(pagina, 'Tema', 'Claro');
    await escolherOpcao(pagina, 'Estilo das marcas', 'Sublinhado');
    assert.equal(await pagina.locator('.camada-de-marcas .traco-faixa').count(), 0);
    await capturar(pagina, `sublinhado-aparencia-${tela}`);
    const texto = await pagina.locator('.capitulo').textContent();
    await escolherOpcao(pagina, 'Estilo das marcas', 'Só na margem');
    assert.equal(await pagina.locator('.camada-de-marcas path').count(), 0);
    await pagina.getByLabel('Tamanho', { exact: true }).fill('21');
    await escolherOpcao(pagina, 'Entrelinha', 'Ampla');
    await escolherOpcao(pagina, 'Medida', 'Ampla');
    await pagina.getByRole('button', { name: 'Fechar', exact: true }).click();
    await abrirOpcoes(pagina);
    await escolherOpcao(pagina, 'Margem', 'Recolher em números');
    await pagina.getByRole('button', { name: 'Fechar opções' }).click();
    assert.equal(await pagina.locator('.capitulo').textContent(), texto, 'aparência não muda o texto');
    await conferir(pagina);
    await pagina.reload({ waitUntil: 'networkidle' });
    assert.equal(await pagina.locator('.leitor').evaluate((e) => getComputedStyle(e).fontSize), '21px');
    if (tela === 'desktop') {
      const numero = pagina.locator('.margem .nota-numero').first();
      await numero.focus();
      await numero.press('Enter');
      assert.equal(await pagina.locator('.nota.ativa').count(), 1, 'margem recolhida acessível por teclado');
      await pagina.keyboard.press('Escape');
    }
    await pagina.evaluate(() => window.scrollTo(0, 500));
    await pagina.waitForTimeout(100);
    assert.ok(Number(await pagina.getByRole('progressbar', { name: 'Rolagem do capítulo' }).getAttribute('aria-valuenow')) > 0);
    await pagina.close();
  }
  // Storage bloqueado e preferência de movimento: renderizar e alterar continuam possíveis.
  const pagina = await navegador.newPage({ reducedMotion: 'reduce' });
  pagina.on('pageerror', (erro) => erros.push(erro.message));
  await pagina.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('indisponível'); } });
  });
  await pagina.goto(`${base}/dev/margem`, { waitUntil: 'networkidle' });
  await pagina.getByRole('button', { name: 'Aparência', exact: true }).click();
  await escolherOpcao(pagina, 'Tema', 'Sépia');
  assert.equal(await pagina.locator('html').getAttribute('data-tema'), 'sepia');
  assert.equal(await pagina.locator('[data-animacao="desenhando"]').count(), 0);
  await pagina.close();
  assert.deepEqual(erros, [], 'sem erros de página');
  console.log('J11: galeria, geometria, estilos e temas, persistência, teclado, storage bloqueado e movimento reduzido conferidos.');
} finally {
  await navegador.close();
  await servidor.close();
}
