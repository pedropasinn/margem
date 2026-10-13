// Captura da prévia do Margem (Player v2), no Firefox do Playwright, sem escrever nada na API.
// uso: node tools/foto-da-previa.mjs <caminho-url> <saida.png> [largura] [esquema] [acoes-js]
import { firefox } from 'playwright';
const [caminho, saida, largura = '1440', esquema = 'light', acoes = ''] = process.argv.slice(2);
const navegador = await firefox.launch();
const pagina = await navegador.newPage({ viewport: { width: Number(largura), height: Number(largura) < 600 ? 915 : 900 }, colorScheme: esquema });
const erros = [];
pagina.on('pageerror', (e) => erros.push(String(e)));
pagina.on('console', (m) => { if (m.type() === 'error') erros.push('console: ' + m.text()); });
// Somente leitura: nenhuma escrita chega à API (o banco é o de produção). O progresso responde como gravado,
// para a página não mostrar o aviso de falha; as outras escritas recebem 503.
await pagina.route('**/api/**', (rota) => {
  const pedido = rota.request();
  if (pedido.method() === 'GET') return rota.continue();
  if (pedido.method() === 'PUT' && pedido.url().endsWith('/progresso')) {
    return rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ progresso: { ...JSON.parse(pedido.postData() ?? '{}'), atualizado_em: new Date().toISOString() } }) });
  }
  if (process.env.MOSTRAR_ESCRITAS) console.log('escrita bloqueada:', pedido.method(), pedido.url());
  return rota.fulfill({ status: 503, contentType: 'application/json', body: '{"erro":"somente_leitura"}' });
});
await pagina.goto('http://127.0.0.1:5190' + caminho, { waitUntil: 'networkidle' });
await pagina.waitForTimeout(2000);
if (acoes) { const f = new Function('pagina', `return (async () => { ${acoes} })()`); await f(pagina); await pagina.waitForTimeout(700); }
await pagina.screenshot({ path: saida });
if (erros.length) console.log('ERROS:', erros.slice(0, 8).join('\n'));
await navegador.close();
