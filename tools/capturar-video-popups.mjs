// Capturas das camadas sobre o vídeo (noite2/video-popups): a legenda dos grifos no modo "só o vídeo"
// e o cartão de conceito quadro a quadro (bolinha → cartão, anel correndo, aberto, de volta à bolinha),
// mais o movimento reduzido. Os relógios da página são falsos (`page.clock`: o React só anda quando o
// script manda) e as animações CSS são congeladas pela Web Animations API e avançadas à mão, então
// cada quadro é exato, mesmo com a máquina carregada.
//
//   node tools/capturar-video-popups.mjs <base-do-vite> <documento-id> <conceitos.json> <pasta>
//
// Leitura pela API (só GET); `/api/midias/:id/conceitos` vem do arquivo (a saída do teste real com o
// Codex num banco de teste); qualquer escrita é bloqueada no navegador. Firefox: o Chromium do
// Playwright não decodifica H.264.
import { mkdirSync, readFileSync } from 'node:fs';
import { firefox } from 'playwright';

const [base, documento, arquivo, pasta = 'docs/jobs/video-popups-evidencias'] = process.argv.slice(2);
if (!base || !documento || !arquivo) { console.error('uso: capturar-video-popups.mjs <base> <documento-id> <conceitos.json> <pasta>'); process.exit(2); }
mkdirSync(pasta, { recursive: true });
const conceitos = JSON.parse(readFileSync(arquivo, 'utf8'));
const primeiro = conceitos.conceitos[0];
const problemas = [];
const fotos = [];

async function abrir(navegador, opcoes) {
  const pagina = await navegador.newPage({ viewport: { width: 1440, height: 900 }, ...opcoes });
  pagina.on('pageerror', (erro) => problemas.push(String(erro)));
  await pagina.clock.install();
  await pagina.route('**/api/**', (rota) => {
    const pedido = rota.request();
    if (/\/api\/midias\/[^/]+\/conceitos$/.test(new URL(pedido.url()).pathname)) {
      return rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ estado: 'pronto', conceitos }) });
    }
    return pedido.method() === 'GET' ? rota.continue() : rota.fulfill({ status: 503, contentType: 'application/json', body: '{"erro":"somente_leitura"}' });
  });
  await pagina.goto(`${base}/ler/${documento}`, { waitUntil: 'networkidle' });
  await pagina.waitForSelector('video', { timeout: 60_000 });
  await pagina.evaluate(async () => {
    const v = document.querySelector('video');
    v.muted = true;
    await new Promise((r) => { if (v.readyState >= 1) r(); else v.addEventListener('loadedmetadata', r, { once: true }); });
  });
  // Daqui em diante, o tempo da página só anda pelo `andar`.
  await pagina.clock.pauseAt(Date.now() + 1000);
  return pagina;
}

async function foto(pagina, nome, recorte) {
  const caminho = `${pasta}/${nome}.jpg`;
  await pagina.screenshot({ path: caminho, type: 'jpeg', quality: 70, ...(recorte ? { clip: recorte } : {}) });
  fotos.push(caminho);
}
const avancar = (pagina, ms) => pagina.evaluate((t) => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; } }, ms);
/** Anda o relógio falso em passos de um quadro até a condição valer (ou desiste). */
async function andarAte(pagina, seletor, maximoMs = 8000) {
  for (let ms = 0; ms <= maximoMs; ms += 50) {
    if (await pagina.locator(seletor).count()) return true;
    await pagina.clock.runFor(50);
  }
  problemas.push(`não apareceu: ${seletor}`);
  return false;
}
const fase = (pagina, valor) => andarAte(pagina, `.conceito-no-video[data-fase=${valor}]`);
const irPara = (pagina, t) => pagina.evaluate((s) => { document.querySelector('video').currentTime = s; }, t);
const tocar = (pagina, sim) => pagina.evaluate((s) => { const v = document.querySelector('video'); if (s) void v.play(); else v.pause(); }, sim);
async function recorteDoQuadro(pagina) {
  const caixa = await pagina.locator('.painel-video').boundingBox();
  return caixa ? { x: caixa.x, y: caixa.y, width: caixa.width, height: caixa.height } : undefined;
}

const navegador = await firefox.launch();

// ----------------------------------------------------------------- legenda dos grifos (só o vídeo)
{
  const pagina = await abrir(navegador, { colorScheme: 'dark' });
  await pagina.getByRole('button', { name: 'Só o vídeo' }).click();
  // Procura um instante com grifo em fala (o vídeo parado; o quadro a quadro do player lê o tempo).
  let achado = null;
  const duracao = await pagina.evaluate(() => document.querySelector('video').duration);
  for (let t = 30; t < duracao && achado === null; t += 3) {
    await irPara(pagina, t);
    await pagina.clock.runFor(120);
    if (await pagina.locator('.legenda-dos-grifos p').count()) achado = t;
  }
  if (achado === null) problemas.push('nenhum grifo em fala achado');
  else {
    await irPara(pagina, achado + 1.2);
    await pagina.clock.runFor(120);
    await foto(pagina, 'legenda-so-video-escuro');
    await irPara(pagina, achado + 3.4);
    await pagina.clock.runFor(120);
    await foto(pagina, 'legenda-so-video-escuro-2');
  }
  await pagina.close();
}

// ----------------------------------------------------------------- cartão de conceito, quadro a quadro
for (const [esquema, sufixo, soVideo] of [['light', 'claro', false], ['dark', 'escuro', true]]) {
  const pagina = await abrir(navegador, { colorScheme: esquema });
  if (soVideo) await pagina.getByRole('button', { name: 'Só o vídeo' }).click();
  await irPara(pagina, primeiro.instante_s + 0.3);
  await fase(pagina, 'bolinha');
  const recorte = await recorteDoQuadro(pagina);
  await avancar(pagina, 0); await foto(pagina, `${sufixo}-1-bolinha-000ms`, recorte);
  await avancar(pagina, 120); await foto(pagina, `${sufixo}-1-bolinha-120ms`, recorte);
  await fase(pagina, 'cartao');
  for (const ms of [0, 60, 120, 180, 260, 340, 420]) { await avancar(pagina, ms); await foto(pagina, `${sufixo}-2-morph-${String(ms).padStart(3, '0')}ms`, recorte); }
  // O anel correndo: 5 s com o vídeo tocando (o anel só anda tocando e sem o mouse em cima).
  await pagina.mouse.move(200, 200);
  await tocar(pagina, true);
  for (let i = 0; i < 50; i++) await pagina.clock.runFor(100);
  await tocar(pagina, false);
  await avancar(pagina, 1000);
  await foto(pagina, `${sufixo}-3-anel-5s`, recorte);
  if (!soVideo) await foto(pagina, `${sufixo}-3-tela-inteira`);
  await pagina.locator('.titulo-do-conceito').click();
  await fase(pagina, 'aberto');
  for (const ms of [0, 100, 200, 320]) { await avancar(pagina, ms); await foto(pagina, `${sufixo}-4-aberto-${String(ms).padStart(3, '0')}ms`, recorte); }
  if (!soVideo) await foto(pagina, `${sufixo}-4-aberto-tela-inteira`);
  await pagina.locator('.acoes-do-conceito').getByRole('button', { name: 'Fechar', exact: true }).click();
  await fase(pagina, 'saindo');
  for (const ms of [0, 100, 200, 300, 400]) { await avancar(pagina, ms); await foto(pagina, `${sufixo}-5-saindo-${String(ms).padStart(3, '0')}ms`, recorte); }
  await pagina.clock.runFor(600);
  if (await pagina.locator('.conceito-no-video').count()) problemas.push(`${sufixo}: o cartão não saiu`);
  await pagina.close();
}

// ----------------------------------------------------------------- movimento reduzido
{
  const pagina = await abrir(navegador, { colorScheme: 'light', reducedMotion: 'reduce' });
  await irPara(pagina, primeiro.instante_s + 0.3);
  await fase(pagina, 'cartao');
  await foto(pagina, 'reduzido-cartao', await recorteDoQuadro(pagina));
  await pagina.close();
}

await navegador.close();
console.log(JSON.stringify({ fotos: fotos.length, problemas }, null, 1));
if (problemas.length) process.exitCode = 1;
