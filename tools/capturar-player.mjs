// Capturas do player (J71): o player "The Rest Is History" do books (referência) e o player do
// Margem, nos mesmos tamanhos, claro e escuro, tocando no mesmo ponto; depois, pranchas lado a lado.
// Somente leitura na API do Margem (escritas bloqueadas no navegador).
//
//   node tools/capturar-player.mjs <base-do-margem> <documento-id> <pasta> [<url-do-karaoke-do-books>]
//
// O Margem é capturado no Firefox do Playwright: o Chromium do Playwright não decodifica H.264/AAC
// (o Chrome de verdade decodifica). A referência toca MP3 e é capturada no Chromium.
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium, firefox } from 'playwright';

const [base = 'http://127.0.0.1:5180', documento, pasta = 'docs/jobs/J71-evidencias', referencia] = process.argv.slice(2);
if (!documento) { console.error('uso: capturar-player.mjs <base> <documento-id> <pasta> [<url-karaoke-books>]'); process.exit(2); }
mkdirSync(pasta, { recursive: true });
const TAMANHOS = [[1440, 900, 'pc'], [412, 915, 'cel']];
const INSTANTE = Number(process.env.INSTANTE ?? 95);
const problemas = [];

async function tocarAte(pagina, seletor) {
  return pagina.evaluate(async ({ seletor, instante }) => {
    const m = document.querySelector(seletor);
    if (!m) return 'sem mídia';
    m.muted = true;
    await new Promise((r) => { if (m.readyState >= 1) r(); else m.addEventListener('loadedmetadata', r, { once: true }); });
    m.currentTime = instante;
    try { await m.play(); } catch (e) { return `play: ${e}`; }
    await new Promise((r) => setTimeout(r, 2600));
    return { t: m.currentTime, erro: m.error?.code ?? null };
  }, { seletor, instante: INSTANTE });
}

const fotos = [];
async function foto(pagina, nome) {
  const caminho = `${pasta}/${nome}.jpg`;
  await pagina.screenshot({ path: caminho, type: 'jpeg', quality: 62 });
  fotos.push(caminho);
  return caminho;
}

// ----------------------------------------------------------------- referência (books)
if (referencia) {
  const navegador = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const tema of ['dark', 'light']) for (const [largura, altura, tela] of TAMANHOS) {
    const pagina = await navegador.newPage({ viewport: { width: largura, height: altura } });
    await pagina.addInitScript((t) => localStorage.setItem('trih_settings', JSON.stringify({ theme: t })), tema);
    await pagina.goto(referencia, { waitUntil: 'networkidle' });
    await pagina.waitForTimeout(800);
    await tocarAte(pagina, '#audio');
    await pagina.mouse.move(largura / 2, altura - 40);
    await pagina.waitForTimeout(300);
    await foto(pagina, `ref-books-${tela}-${tema === 'dark' ? 'escuro' : 'claro'}`);
    await pagina.close();
  }
  await navegador.close();
}

// ----------------------------------------------------------------- Margem
const navegador = await firefox.launch();
for (const esquema of ['dark', 'light']) for (const [largura, altura, tela] of TAMANHOS) {
  const pagina = await navegador.newPage({ viewport: { width: largura, height: altura }, colorScheme: esquema });
  pagina.on('pageerror', (erro) => problemas.push(`${tela}: ${String(erro)}`));
  await pagina.route('**/api/**', (rota) => rota.request().method() === 'GET'
    ? rota.continue() : rota.fulfill({ status: 503, contentType: 'application/json', body: '{"erro":"somente_leitura"}' }));
  await pagina.goto(`${base}/ler/${documento}`, { waitUntil: 'networkidle' });
  await pagina.waitForTimeout(1500);
  const estado = await tocarAte(pagina, 'video, audio');
  if (typeof estado === 'string' || estado.erro) problemas.push(`${tela}/${esquema}: ${JSON.stringify(estado)}`);
  await pagina.mouse.move(largura / 2, altura - 40);
  await pagina.waitForTimeout(300);
  const sufixo = esquema === 'dark' ? 'escuro' : 'claro';
  await foto(pagina, `margem-${tela}-${sufixo}`);
  if (tela === 'pc' && esquema === 'light') {
    // Velocidade e destaque abertos; depois a pílula "Voltar ao trecho atual" após rolar à mão.
    await pagina.getByRole('button', { name: /^Velocidade/ }).click();
    await pagina.waitForTimeout(300);
    await foto(pagina, `margem-${tela}-velocidade`);
    await pagina.keyboard.press('Escape');
    await pagina.mouse.move(400, 400);
    await pagina.mouse.wheel(0, -1400);
    await pagina.waitForTimeout(700);
    await foto(pagina, `margem-${tela}-voltar-ao-trecho`);
  }
  if (tela === 'cel' && esquema === 'light') {
    await pagina.getByRole('button', { name: 'Capítulos' }).click();
    await pagina.waitForTimeout(300);
    await foto(pagina, `margem-${tela}-capitulos`);
  }
  await pagina.close();
}
await navegador.close();

// ----------------------------------------------------------------- pranchas lado a lado
if (referencia) {
  const compositor = await chromium.launch();
  for (const [largura, altura, tela] of TAMANHOS) for (const tema of ['escuro', 'claro']) {
    const escala = tela === 'pc' ? 0.5 : 0.8;
    const w = Math.round(largura * escala), h = Math.round(altura * escala);
    const pagina = await compositor.newPage({ viewport: { width: w * 2 + 36, height: h + 44 } });
    const img = (nome) => `data:image/jpeg;base64,${readFileSync(`${pasta}/${nome}.jpg`).toString('base64')}`;
    await pagina.setContent(`<body style="margin:0;display:flex;gap:12px;padding:32px 12px 12px;background:#888;font:600 13px system-ui;color:#fff">
      <figure style="margin:0;position:relative"><figcaption style="position:absolute;top:-22px">books · The Rest Is History</figcaption><img src="${img(`ref-books-${tela}-${tema}`)}" width="${w}" height="${h}"></figure>
      <figure style="margin:0;position:relative"><figcaption style="position:absolute;top:-22px">Margem · J71</figcaption><img src="${img(`margem-${tela}-${tema}`)}" width="${w}" height="${h}"></figure></body>`);
    await pagina.waitForTimeout(300);
    await pagina.screenshot({ path: `${pasta}/comparacao-${tela}-${tema}.jpg`, type: 'jpeg', quality: 72 });
    await pagina.close();
  }
  await compositor.close();
}
console.log(JSON.stringify({ fotos: fotos.length, problemas }, null, 1));
if (problemas.length) process.exitCode = 1;
