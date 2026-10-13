// Capturas do karaokê palavra por palavra (Player v2) na prévia, no Firefox do Playwright, sem escrever
// nada na API (o banco da prévia é o de produção: toda escrita é interceptada).
// uso: node tools/capturar-karaoke.mjs <comentada|video> <pasta> [largura] [light|dark]
// Tira três instantes com a palavra andando dentro da faixa da frase e um com o leitor rolado para
// longe, mostrando "Voltar ao trecho atual".
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { firefox } from 'playwright';

const [modo = 'comentada', pasta = 'docs/ui-revisao/player-v2/karaoke', largura = '1440', esquema = 'light'] = process.argv.slice(2);
const URLS = {
  comentada: '/ler/01M3JEKK3D9Q8BE1HGYF4QWZKG/18WG3SP23QS7R3HG0WRW5J7CE0', // Engenharia de Software Moderna, cap. 1 (sem voz)
  video: '/ler/01M3PSCMMV3A4P89HMY0GV33S6', // Ulrich (vídeo com transcrição alinhada)
};
mkdirSync(pasta, { recursive: true });
const celular = Number(largura) < 600;
const navegador = await firefox.launch({ firefoxUserPrefs: { 'media.autoplay.default': 0 } });
const pagina = await navegador.newPage({ viewport: { width: Number(largura), height: celular ? 915 : 900 }, colorScheme: esquema });
const erros = [];
pagina.on('pageerror', (e) => erros.push(String(e)));
pagina.on('console', (m) => { if (m.type() === 'error') erros.push('console: ' + m.text().slice(0, 200)); });
await pagina.route('**/api/**', (rota) => {
  const pedido = rota.request();
  if (pedido.method() === 'GET') return rota.continue();
  if (pedido.method() === 'PUT' && pedido.url().endsWith('/progresso')) {
    return rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ progresso: { ...JSON.parse(pedido.postData() ?? '{}'), atualizado_em: new Date().toISOString() } }) });
  }
  return rota.fulfill({ status: 503, contentType: 'application/json', body: '{"erro":"somente_leitura"}' });
});
const esperar = (ms) => pagina.waitForTimeout(ms);
const nome = (sufixo) => join(pasta, `${modo}-${largura}-${esquema === 'dark' ? 'escuro' : 'claro'}-${sufixo}.png`);
const palavraAtual = () => pagina.evaluate(() => {
  const realce = CSS.highlights?.get('margem-karaoke-palavra');
  const [intervalo] = realce ? [...realce] : [];
  return intervalo ? intervalo.toString() : null;
});

await pagina.goto('http://127.0.0.1:5190' + URLS[modo], { waitUntil: 'networkidle' });
await esperar(2500);
await pagina.getByRole('button', { name: 'Ouvir' }).click();
await esperar(500);
if (modo === 'comentada') {
  await pagina.getByText('Leitura comentada', { exact: false }).first().click();
  await esperar(1500);
  // Comentários desligados: a leitura corre sem parar nos comentários (só a preferência deste navegador).
  await pagina.keyboard.press('c');
  await esperar(200);
  // Algumas frases adiante, para a faixa cair num parágrafo corrido (a primeira frase é a epígrafe).
  for (let i = 0; i < 3; i += 1) { await pagina.keyboard.press('ArrowRight'); await esperar(150); }
  await pagina.locator('.player-comentada').getByRole('button', { name: /^Tocar/ }).click();
} else {
  await esperar(1500);
  if (await pagina.locator('.player-midia .tocar').count() === 0) await pagina.getByRole('button', { name: /Assistir com a transcrição/ }).first().click();
  await pagina.locator('.player-midia .tocar').waitFor({ timeout: 15000 });
  await esperar(2500);
  await pagina.keyboard.press('Escape');
  // Um pouco adiante do começo, para a fala já estar no texto corrido.
  await pagina.evaluate(() => { const v = document.querySelector('video'); if (v) v.currentTime = 95; });
  await esperar(800);
  await pagina.locator('.player-midia .tocar').click({ force: true });
}
await esperar(modo === 'comentada' ? 2600 : 3500);
const palavras = [];
for (let i = 1; i <= 3; i += 1) {
  await pagina.screenshot({ path: nome(`instante${i}`) });
  palavras.push(await palavraAtual());
  await esperar(modo === 'comentada' ? 700 : 380);
}
// O leitor rola para longe: a frase sai da vista e aparece "Voltar ao trecho atual".
await pagina.mouse.move(Number(largura) / 2, 300);
for (let i = 0; i < 6; i += 1) { await pagina.mouse.wheel(0, 900); await esperar(120); }
await esperar(900);
const voltar = await pagina.locator('.voltar-ao-trecho').count();
await pagina.screenshot({ path: nome('voltar') });
if (voltar > 0) {
  await pagina.locator('.voltar-ao-trecho').click();
  await esperar(1400);
  await pagina.screenshot({ path: nome('de-volta') });
}
console.log(JSON.stringify({ modo, largura, esquema, palavras, voltar: voltar > 0, erros: erros.slice(0, 6) }));
await navegador.close();
