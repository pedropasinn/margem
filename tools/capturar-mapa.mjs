// Capturas do mapa esquemático do capítulo na prévia (Firefox do Playwright), sem escrever na API:
// o banco da prévia é o de produção, então toda escrita é interceptada (o progresso responde como gravado).
// uso: node tools/capturar-mapa.mjs <pasta> [--largura 1440] [--escuro] [--documento ID] [--secao ID] [--prefixo x-]
//        [--base http://127.0.0.1:5190] [--estado nenhum|pendente|falhou] [--cenas mapa,zoom,hover,clique,texto]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { firefox } from 'playwright';

const args = process.argv.slice(2);
const opcao = (nome, padrao) => { const i = args.indexOf(nome); return i === -1 ? padrao : args[i + 1]; };
const pasta = args[0] ?? 'docs/ui-revisao/mapa-esquematico';
const largura = Number(opcao('--largura', '1440'));
const escuro = args.includes('--escuro');
const documento = opcao('--documento', '01M3JEKK3D9Q8BE1HGYF4QWZKG');
const secao = opcao('--secao', '18WG3SP23QS7R3HG0WRW5J7CE0');
const prefixo = opcao('--prefixo', '');
const base = opcao('--base', 'http://127.0.0.1:5190');
const estado = opcao('--estado', null);
const cenas = new Set(opcao('--cenas', 'mapa,zoom,hover,clique,texto').split(','));
mkdirSync(pasta, { recursive: true });

const navegador = await firefox.launch();
const pagina = await navegador.newPage({ viewport: { width: largura, height: largura < 600 ? 915 : 900 }, colorScheme: escuro ? 'dark' : 'light' });
const problemas = [];
pagina.on('pageerror', (e) => problemas.push(String(e)));
pagina.on('console', (m) => { if (m.type() === 'error') problemas.push('console: ' + m.text().slice(0, 200)); });
await pagina.route('**/api/**', (rota) => {
  const pedido = rota.request();
  if (estado && pedido.method() === 'GET' && /\/esquema$/u.test(pedido.url())) {
    const corpo = estado === 'nenhum' ? { estado: 'nenhum', pedido_id: null, pronto: null, esquema: null }
      : estado === 'pendente' ? { estado: 'executando', pedido_id: '01M3SRS5Z5N89HN9XP6JDG990G', pronto: null, esquema: null }
        : { estado: 'falhou', pedido_id: '01M3SRS5Z5N89HN9XP6JDG990G', pronto: null, esquema: null, motivo: 'O Codex passou do prazo.' };
    return rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) });
  }
  if (pedido.method() === 'GET') return rota.continue();
  if (pedido.method() === 'PUT' && pedido.url().endsWith('/progresso')) {
    return rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ progresso: { ...JSON.parse(pedido.postData() ?? '{}'), atualizado_em: new Date().toISOString() } }) });
  }
  if (/\/esquema$/u.test(pedido.url())) {
    return rota.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ estado: 'pendente', pedido_id: '01M3SRS5Z5N89HN9XP6JDG990G', pronto: null, esquema: null }) });
  }
  return rota.fulfill({ status: 503, contentType: 'application/json', body: '{"erro":"somente_leitura"}' });
});
const foto = async (nome) => { await pagina.waitForTimeout(600); await pagina.screenshot({ path: join(pasta, `${prefixo}${nome}.png`) }); };

await pagina.goto(`${base}/ler/${documento}/${secao}`, { waitUntil: 'networkidle' });
await pagina.waitForTimeout(2500);
// Abre o mapa pela paleta de comandos (o mesmo comando da aba Estudo).
await pagina.keyboard.press('Control+k');
await pagina.waitForTimeout(400);
await pagina.keyboard.type('Mapa do');
await pagina.waitForTimeout(300);
await pagina.keyboard.press('Enter');
await pagina.locator('.mapa-capitulo').waitFor({ timeout: 10000 });
await pagina.waitForTimeout(1500);
if (cenas.has('mapa')) await foto('01-mapa');
if (!estado) {
  const tela = pagina.locator('.esquema-tela');
  if (cenas.has('hover')) {
    const no = pagina.locator('.no-do-esquema.com-trecho').nth(1);
    await no.hover();
    await foto('02-hover');
  }
  if (cenas.has('zoom')) {
    await pagina.locator('button[aria-label="Aproximar"]').click();
    await pagina.locator('button[aria-label="Aproximar"]').click();
    const caixa = await tela.boundingBox();
    await pagina.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
    await pagina.mouse.down(); await pagina.mouse.move(caixa.x + caixa.width / 2 - 60, caixa.y + caixa.height / 2 - 380, { steps: 8 }); await pagina.mouse.up();
    await foto('03-zoom-e-arrasto');
    await pagina.locator('.escala-do-esquema').click();
  }
  if (cenas.has('texto')) {
    await pagina.locator('.vista-do-mapa [role=radio]').nth(1).click();
    await foto('04-em-texto');
    await pagina.locator('.vista-do-mapa [role=radio]').nth(0).click();
    await pagina.waitForTimeout(800);
  }
  if (cenas.has('clique')) {
    const no = pagina.locator('.no-do-esquema.com-trecho').nth(3);
    const nome = await no.getAttribute('aria-label');
    await no.click();
    await pagina.waitForTimeout(1500);
    console.log('clicado:', nome);
    await foto('05-clique-leva-ao-trecho');
  }
}
if (problemas.length) console.log('PROBLEMAS:', problemas.slice(0, 8).join('\n'));
await navegador.close();
