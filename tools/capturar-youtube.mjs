// Capturas do leitor com vídeo do YouTube no player oficial embutido (J109). Somente leitura na API do
// Margem (escritas bloqueadas no navegador). Usa a rede para carregar o embed do YouTube.
//
//   node tools/capturar-youtube.mjs <base-do-margem> <documento-id> <pasta>
//
// Para cada tamanho e esquema: abre o leitor, toca pelo transporte do Margem (a moldura do YouTube
// recebe o comando pela IFrame API), espera o karaokê andar e fotografa. Confere que a moldura é a de
// `youtube.com/embed/<id>?enablejsapi=1&origin=…`, tem ao menos 200×200 px, nada a cobre, a CSP
// não registrou violação e o tempo andou. Por fim, com a IFrame API bloqueada, fotografa o aviso.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [base = 'http://127.0.0.1:8791', documento, pasta = 'docs/jobs/J109-evidencias'] = process.argv.slice(2);
if (!documento) { console.error('uso: capturar-youtube.mjs <base> <documento-id> <pasta>'); process.exit(2); }
mkdirSync(pasta, { recursive: true });
const TAMANHOS = [[1680, 1050, 'pc'], [412, 915, 'cel']];
const problemas = [];
const fotos = [];

async function abrir(navegador, largura, altura, esquema, { bloquearApi = false } = {}) {
  const pagina = await navegador.newPage({ viewport: { width: largura, height: altura }, colorScheme: esquema });
  pagina.on('pageerror', (erro) => problemas.push(`${largura}/${esquema}: ${String(erro)}`));
  pagina.on('console', (m) => { if (/Content Security Policy|Refused to/.test(m.text())) problemas.push(`${largura}/${esquema} CSP: ${m.text().slice(0, 200)}`); });
  await pagina.route('**/api/**', (rota) => rota.request().method() === 'GET'
    ? rota.continue() : rota.fulfill({ status: 503, contentType: 'application/json', body: '{"erro":"somente_leitura"}' }));
  if (bloquearApi) await pagina.route('https://www.youtube.com/iframe_api', (rota) => rota.abort());
  await pagina.goto(`${base}/ler/${documento}`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('iframe.moldura-do-youtube', { timeout: 20_000 });
  return pagina;
}

async function conferirMoldura(pagina, rotulo) {
  const info = await pagina.evaluate(() => {
    const m = document.querySelector('iframe.moldura-do-youtube');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    // Nada por cima da moldura: o elemento no centro e nos quatro cantos (2 px para dentro) é a própria moldura.
    const pontos = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 2, r.top + 2], [r.right - 2, r.top + 2], [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2]];
    const cobertos = pontos.filter(([x, y]) => document.elementFromPoint(x, y) !== m).length;
    return { src: m.src, largura: Math.round(r.width), altura: Math.round(r.height), referrer: m.referrerPolicy, cobertos };
  });
  if (!info) { problemas.push(`${rotulo}: sem moldura`); return null; }
  const url = new URL(info.src);
  if (!url.pathname.startsWith('/embed/') || url.searchParams.get('enablejsapi') !== '1' || url.searchParams.get('origin') !== new URL(base).origin) problemas.push(`${rotulo}: embed ${info.src}`);
  if (info.largura < 200 || info.altura < 200) problemas.push(`${rotulo}: moldura ${info.largura}×${info.altura} < 200×200`);
  if (info.cobertos > 0) problemas.push(`${rotulo}: ${info.cobertos} ponto(s) da moldura cobertos`);
  return info;
}

async function foto(pagina, nome) {
  const caminho = `${pasta}/${nome}.jpg`;
  await pagina.screenshot({ path: caminho, type: 'jpeg', quality: 70 });
  fotos.push(caminho);
}

const navegador = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const medidas = [];
for (const esquema of ['light', 'dark']) for (const [largura, altura, tela] of TAMANHOS) {
  const rotulo = `${tela}-${esquema === 'dark' ? 'escuro' : 'claro'}`;
  const pagina = await abrir(navegador, largura, altura, esquema);
  await pagina.waitForTimeout(4000);
  const tocar = pagina.getByRole('button', { name: 'Tocar', exact: true });
  await tocar.click();
  // O tempo do transporte vem do getCurrentTime do YouTube: se andou, a IFrame API comanda a moldura.
  const andou = await pagina.waitForFunction(() => {
    const t = document.querySelector('.transporte .tempo')?.textContent ?? '0:00';
    return t !== '0:00' && t !== '0:01';
  }, null, { timeout: 30_000 }).then(() => true, () => false);
  if (!andou) problemas.push(`${rotulo}: o tempo não andou depois de tocar`);
  await pagina.waitForTimeout(1500);
  const info = await conferirMoldura(pagina, rotulo);
  const palavra = await pagina.evaluate(() => (globalThis.CSS?.highlights?.get?.('margem-karaoke-palavra') ? 'com destaque' : 'sem destaque'));
  medidas.push({ rotulo, andou, ...info, palavra, tempo: await pagina.locator('.transporte .tempo').first().textContent() });
  await pagina.mouse.move(largura / 2, altura - 40);
  await pagina.waitForTimeout(300);
  await foto(pagina, `leitor-youtube-${rotulo}`);
  if (tela === 'pc' && esquema === 'light') {
    await pagina.getByRole('button', { name: /^Velocidade/ }).click();
    await pagina.waitForTimeout(400);
    await foto(pagina, 'leitor-youtube-pc-velocidade');
    await pagina.keyboard.press('Escape');
  }
  await pagina.getByRole('button', { name: 'Pausar' }).click().catch(() => undefined);
  await pagina.close();
}

// Aviso quando o player do YouTube não pode ser usado (aqui: a IFrame API bloqueada), com a alternativa local.
const pagina = await abrir(navegador, 1680, 1050, 'light', { bloquearApi: true });
await pagina.getByText('O player do YouTube não carregou aqui.').waitFor({ timeout: 25_000 }).catch(() => problemas.push('aviso: não apareceu'));
await foto(pagina, 'leitor-youtube-aviso-claro');
await pagina.getByRole('button', { name: /local/ }).click().catch(() => problemas.push('aviso: sem botão local'));
await pagina.waitForTimeout(800);
if (await pagina.locator('iframe.moldura-do-youtube').count() !== 0) problemas.push('aviso: a moldura continuou depois de escolher o local');
if (await pagina.locator('audio').count() !== 1) problemas.push('aviso: o áudio local não apareceu');
await foto(pagina, 'leitor-youtube-local-claro');
await pagina.close();
await navegador.close();

console.log(JSON.stringify({ fotos, medidas, problemas }, null, 1));
process.exitCode = problemas.length > 0 ? 1 : 0;
