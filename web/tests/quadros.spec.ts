/**
 * Capturas e interação dos Quadros no Firefox (Playwright), contra uma vite temporária desta worktree e o
 * harness das rotas de arte sem banco (`servico/src/ferramentas/previa-arte.ts`), lendo o acervo real.
 * As rotas de documentos são interceptadas com uma biblioteca falsa; nada além de GET sai do navegador.
 *
 *   node --import tsx web/tests/quadros.spec.ts
 *
 * Variáveis: QUADRO (slug, padrão `educacao`), PORTA_WEB (5196), PORTA_API (8746), MARGEM_ARTE_DIR.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as esperar } from 'node:timers/promises';
import { firefox, type Page } from 'playwright';
import { createServer } from 'vite';

const raiz = new URL('../../', import.meta.url).pathname;
const pasta = new URL('../../docs/arte/capturas-ui/', import.meta.url).pathname;
await mkdir(pasta, { recursive: true });
const PORTA_WEB = Number(process.env.PORTA_WEB ?? 5196);
const PORTA_API = Number(process.env.PORTA_API ?? 8746);
const QUADRO = process.env.QUADRO ?? 'educacao';

const api = spawn(process.execPath, ['--import', 'tsx', 'servico/src/ferramentas/previa-arte.ts'], { cwd: raiz, env: { ...process.env, MARGEM_ARTE_PORTA: String(PORTA_API) }, stdio: ['ignore', 'inherit', 'inherit'] });
process.env.MARGEM_PORTA = String(PORTA_API);
const vite = await createServer({ root: `${raiz}web`, configLoader: 'runner', server: { host: '127.0.0.1', port: PORTA_WEB, strictPort: true } });
await vite.listen();
for (let i = 0; i < 40; i += 1) { try { if ((await fetch(`http://127.0.0.1:${String(PORTA_API)}/api/arte`)).ok) break; } catch { /* subindo */ } await esperar(250); }

const documentos = [
  { id: '01JZ00000000000000000DOC01', titulo: 'Modos de ver', autor: 'John Berger', formato: 'pdf', criado_em: '2026-09-28T12:00:00.000Z', versao_id: null, texto_disponivel: false, estado: 'pronto', detalhe: null, partes_prontas: 0, partes_total: 0, marcas: { tese: 0, conceito: 0, justificativa: 0, nenhuma: 0, total: 0 }, progresso: null, jobs_em_curso: 0 },
  { id: '01JZ00000000000000000DOC02', titulo: 'A história da arte', autor: 'E. H. Gombrich', formato: 'md', criado_em: '2026-09-20T12:00:00.000Z', versao_id: null, texto_disponivel: false, estado: 'pronto', detalhe: null, partes_prontas: 0, partes_total: 0, marcas: { tese: 0, conceito: 0, justificativa: 0, nenhuma: 0, total: 0 }, progresso: null, jobs_em_curso: 0 },
];

async function preparar(pagina: Page, erros: string[]): Promise<void> {
  pagina.on('pageerror', (e) => erros.push(e.message));
  await pagina.route('**/*', async (rota) => {
    const pedido = rota.request();
    const url = new URL(pedido.url());
    if (url.hostname !== '127.0.0.1') return rota.abort();
    // Nunca escrever: qualquer método além de GET para a API é recusado aqui.
    if (url.pathname.startsWith('/api/') && pedido.method() !== 'GET') return rota.fulfill({ status: 405, json: { erro: 'somente_leitura_nas_capturas' } });
    if (url.pathname === '/api/documentos') return rota.fulfill({ json: { documentos } });
    if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/arte')) return rota.fulfill({ status: 404, json: { erro: 'fora_das_capturas' } });
    return rota.continue();
  });
}
/** As imagens visíveis (as capas abaixo da dobra carregam sob demanda). */
const imagensProntas = (pagina: Page) => pagina.waitForFunction(() => [...document.images].filter((i) => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; }).every((i) => i.complete && i.naturalWidth > 0), undefined, { timeout: 30_000 });

const navegador = await firefox.launch({ headless: true });
const base = `http://127.0.0.1:${String(PORTA_WEB)}`;
const capturas: string[] = [];
async function capturar(pagina: Page, nome: string) { const caminho = `${pasta}${nome}.png`; await pagina.screenshot({ path: caminho }); capturas.push(caminho); }
try {
  for (const tema of ['dark', 'light'] as const) for (const [largura, altura] of [[1440, 900], [412, 915]] as const) {
    const sufixo = `${String(largura)}-${tema === 'dark' ? 'escuro' : 'claro'}`;
    const contexto = await navegador.newContext({ viewport: { width: largura, height: altura }, colorScheme: tema });
    const pagina = await contexto.newPage();
    const erros: string[] = [];
    await preparar(pagina, erros);

    // Biblioteca com o filtro Quadros.
    await pagina.goto(`${base}/biblioteca?tipo=quadros`);
    await pagina.locator('.linha-quadro').first().waitFor({ timeout: 30_000 });
    await imagensProntas(pagina);
    assert.ok(await pagina.locator('.linha-quadro').count() >= 2);
    await capturar(pagina, `biblioteca-quadros-${sufixo}`);

    // Início: os quadros nos recentes e na fileira própria.
    if (largura === 1440) {
      await pagina.goto(`${base}/`);
      await pagina.locator('.cartao-quadro').first().waitFor();
      await imagensProntas(pagina);
      await capturar(pagina, `inicio-${sufixo}`);
    }

    // O quadro aberto.
    await pagina.goto(`${base}/quadros/${QUADRO}`);
    await pagina.locator('.palco-do-quadro[data-carregada]').waitFor({ timeout: 30_000 });
    await esperar(300);
    await capturar(pagina, `quadro-${sufixo}`);

    // Painel Análise: uma afirmação ancorada escolhida acende a região e a câmera a enquadra.
    if (largura < 800) await pagina.getByRole('button', { name: 'Painel do quadro' }).click();
    const painel = pagina.getByRole('complementary', { name: 'Painel do quadro' });
    await painel.getByRole('tab', { name: /Análise/ }).click();
    // A referência tem narração: o player usa a voz e os tempos reais.
    const seletor = painel.getByRole('combobox', { name: 'Análise' });
    if (!/Referência/.test(await seletor.innerText()) && await seletor.isEnabled()) {
      await seletor.click();
      await pagina.getByRole('option', { name: /^Referência/ }).click();
      await pagina.waitForFunction(() => /Referência/.test(document.querySelector('.seletor-de-analise [role=combobox]')?.textContent ?? ''));
    }
    const ancorada = painel.locator('.afirmacoes-do-quadro .painel-leitor-trecho:has(.regioes-da-afirmacao)').nth(1);
    await ancorada.click();
    await esperar(700);
    assert.ok(await pagina.locator('.regiao-do-quadro.acesa').count() >= 1);
    await capturar(pagina, `painel-analise-${sufixo}`);
    if (largura < 800) await painel.getByRole('button', { name: 'Fechar painel do quadro' }).click();

    // O player tocando, com a câmera num detalhe e a legenda em karaokê.
    await pagina.keyboard.press('Escape');
    await pagina.keyboard.press('Space');
    const player = pagina.getByRole('region', { name: 'Análise curta' });
    await player.waitFor();
    await pagina.getByRole('button', { name: 'Próxima batida' }).click();
    await esperar(400);
    await pagina.keyboard.press('Space'); // pausa
    await esperar(150);
    await pagina.keyboard.press('Space'); // toca
    await pagina.mouse.move(8, 200); // sem dica de botão na captura
    await esperar(1800);
    const visao = await pagina.locator('.tela-do-quadro').getAttribute('viewBox');
    assert.ok(visao && Number(visao.split(' ')[2]) < Number((await pagina.locator('.tela-do-quadro image').getAttribute('width')) ?? 0), 'a câmera aproximou um detalhe');
    assert.ok(await pagina.locator('.legenda-do-quadro .atual').count() === 1, 'karaokê com a palavra em curso');
    await capturar(pagina, `player-${sufixo}`);
    const estado = await player.locator('.detalhe-do-player').innerText();
    await pagina.keyboard.press('Escape');

    // Percorrer as afirmações com P e →.
    await pagina.keyboard.press('p');
    await pagina.getByRole('region', { name: 'Percorrer as afirmações' }).waitFor();
    await pagina.keyboard.press('ArrowRight');
    await pagina.keyboard.press('ArrowRight');
    await pagina.mouse.move(8, 200);
    await esperar(700);
    assert.match((await pagina.locator('.contagem-do-percorrer').innerText()), /^3 \//);
    await capturar(pagina, `percorrer-${sufixo}`);

    assert.ok(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'sem rolagem horizontal');
    assert.deepEqual(erros, []);
    console.log(`✓ ${sufixo} · ${estado.replace(/\s+/g, ' ')}`);
    await contexto.close();
  }
} finally {
  await navegador.close();
  await vite.close();
  api.kill();
}
console.log(capturas.join('\n'));
