// Capturas da questão por imagem (J119) contra uma API de teste (banco margem_test_*, executor falso;
// nunca a produção). Uso: node tools/capturar-questao.mjs <base> <imagem.png> <pasta>
//
// Para cada esquema (claro, escuro) e largura (1680, 390): abre a biblioteca, cola o print com um
// evento de colar de verdade (ClipboardEvent com DataTransfer, como o Ctrl/Cmd+V do sistema), fotografa
// a fila em Adicionar, espera o leitor abrir sozinho na resolução e fotografa o painel com a resolução
// pronta e a página original (a imagem) com a caixa do exercício. O mesmo print nas rodadas seguintes
// exercita o caminho do duplicado: abre a questão que já estava na biblioteca.
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [base = 'http://127.0.0.1:8799', imagem, pasta = 'docs/jobs/J119-evidencias'] = process.argv.slice(2);
if (!imagem) { console.error('uso: capturar-questao.mjs <base> <imagem.png> <pasta>'); process.exit(2); }
mkdirSync(pasta, { recursive: true });
const bytes = readFileSync(imagem).toString('base64');
const TAMANHOS = [[1680, 1050], [390, 844]];
const problemas = [];

const navegador = await chromium.launch();
for (const esquema of ['light', 'dark']) for (const [largura, altura] of TAMANHOS) {
  const rotulo = `${esquema === 'dark' ? 'escuro' : 'claro'}-${largura}`;
  const contexto = await navegador.newContext({ viewport: { width: largura, height: altura }, colorScheme: esquema, deviceScaleFactor: 1 });
  const pagina = await contexto.newPage();
  pagina.on('pageerror', (erro) => problemas.push(`${rotulo}: ${String(erro)}`));
  await pagina.goto(`${base}/biblioteca`, { waitUntil: 'networkidle' });
  await pagina.keyboard.press('Escape');
  await pagina.evaluate((b64) => {
    const dados = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const transferencia = new DataTransfer();
    transferencia.items.add(new File([dados], 'image.png', { type: 'image/png' }));
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transferencia, bubbles: true, cancelable: true }));
  }, bytes);
  await pagina.waitForURL(/\/adicionar/, { timeout: 10_000 });
  await pagina.waitForSelector('.fila-lista .item-fila', { timeout: 10_000 });
  await pagina.screenshot({ path: `${pasta}/colar-${rotulo}.png` });
  await pagina.waitForURL(/\/ler\//, { timeout: 60_000 });
  // O painel da resolução abre sozinho; espera a resolução pronta (o executor falso demora 2,5 s).
  const todos = pagina.getByRole('button', { name: 'Mostrar todos os passos' });
  await pagina.waitForFunction(() => {
    const botao = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Mostrar todos os passos');
    return botao !== undefined && !botao.disabled;
  }, null, { timeout: 60_000 }).catch(() => problemas.push(`${rotulo}: a resolução não ficou pronta`));
  // As dicas do leitor (onboarding) não fazem parte da questão: fechadas para a foto.
  const dicas = pagina.getByRole('button', { name: 'Fechar as dicas' });
  if (await dicas.count() > 0) await dicas.first().click();
  await pagina.waitForTimeout(1200);
  await pagina.screenshot({ path: `${pasta}/resolucao-${rotulo}.png` });
  await todos.click();
  await pagina.waitForTimeout(1200);
  await pagina.screenshot({ path: `${pasta}/resolucao-passos-${rotulo}.png` });
  const transborda = await pagina.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (transborda) problemas.push(`${rotulo}: transbordo horizontal`);
  await contexto.close();
}
await navegador.close();
if (problemas.length > 0) { console.error(problemas.join('\n')); process.exit(1); }
console.log('ok');
