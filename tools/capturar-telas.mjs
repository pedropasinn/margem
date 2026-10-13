// Capturas de revisão visual contra uma API viva, SÓ LEITURA: toda escrita é bloqueada
// no navegador. Uso: node tools/capturar-telas.mjs <base> <pasta-de-saída>
// ESQUEMA=escuro captura no tema escuro do sistema (sufixo -escuro).
// Telas: biblioteca, detalhe, adicionar, leitor de poema e de prosa, com Aparência,
// Filtros e a barra de seleção abertos. Em 1440×900 e 412×915.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [base = 'http://127.0.0.1:5180', pasta = 'docs/ui-revisao/capturas'] = process.argv.slice(2);
mkdirSync(pasta, { recursive: true });
const json = async (caminho) => (await fetch(base + caminho)).json();
const { documentos } = await json('/api/documentos');
const achar = (texto) => documentos.find((d) => d.titulo.includes(texto));
const poema = achar('Soneto de Natal') ?? achar('Carolina');
const prosa = achar('replay') ?? documentos[0];
const curto = achar('Conclusion') ?? prosa;
const versao = (await json(`/api/documentos/${prosa.id}`)).versao_id;
const capitulos = (await json(`/api/versoes/${versao}/secoes`)).capitulos;
const capProsa = (capitulos.find((c) => c.titulo.startsWith('Directed')) ?? capitulos[Math.min(8, capitulos.length - 1)]).id;

const navegador = await chromium.launch();
const problemas = [];
const esquema = process.env.ESQUEMA === 'escuro' ? 'dark' : 'light';
for (const [largura, altura, tela] of [[1440, 900, 'pc'], [1680, 1050, 'largo'], [412, 915, 'cel']]) {
  const pagina = await navegador.newPage({ viewport: { width: largura, height: altura }, reducedMotion: 'reduce', colorScheme: esquema });
  pagina.on('pageerror', (erro) => problemas.push(`${tela}: ${String(erro)}`));
  pagina.on('console', (m) => { if (m.type() === 'error') problemas.push(`${tela}: ${m.text().slice(0, 160)}`); });
  await pagina.route('**/api/**', (rota) => rota.request().method() === 'GET'
    ? rota.continue() : rota.fulfill({ status: 503, contentType: 'application/json', body: '{"erro":"somente_leitura"}' }));
  const foto = async (nome) => { await pagina.waitForTimeout(700); await pagina.screenshot({ path: `${pasta}/${nome}-${tela}${esquema === 'dark' ? '-escuro' : ''}.png` }); };
  const abrir = async (caminho) => { await pagina.goto(base + caminho, { waitUntil: 'networkidle' }); await pagina.waitForTimeout(1200); };
  const clicar = async (nome) => {
    const alvo = pagina.getByRole('button', { name: nome }).first();
    if (await alvo.count()) { await alvo.click(); return true; }
    const resumo = pagina.locator('summary', { hasText: nome }).first();
    if (await resumo.count()) { await resumo.click(); return true; }
    return false;
  };

  await abrir('/'); await foto('01-biblioteca');
  await abrir(`/documentos/${curto.id}`); await foto('02-detalhe');
  await abrir(`/documentos/${prosa.id}`); await foto('03-detalhe-livro');
  await abrir('/adicionar'); await foto('04-adicionar');
  await abrir(`/ler/${poema.id}`); await foto('05-leitor-poema');
  if (await clicar(/Apar|^Aa$/)) { await foto('06-aparencia'); await pagina.keyboard.press('Escape'); }
  if (await clicar(/Filtros|Mais opções|•••|⋯/)) { await foto('07-filtros'); await pagina.keyboard.press('Escape'); }
  // Barra de seleção: seleciona o primeiro verso marcado.
  const selecionou = await pagina.evaluate(() => {
    const alvo = document.querySelector('[data-bloco]');
    if (!alvo) return false;
    const texto = [...alvo.querySelectorAll('*')].map((n) => n.firstChild).find((n) => n && n.nodeType === 3 && n.textContent.trim().length > 8)
      ?? alvo.firstChild;
    if (!texto) return false;
    const faixa = document.createRange(); faixa.setStart(texto, 0); faixa.setEnd(texto, Math.min(18, texto.textContent.length));
    const s = getSelection(); s.removeAllRanges(); s.addRange(faixa);
    alvo.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    document.dispatchEvent(new Event('selectionchange'));
    return true;
  });
  if (selecionou) await foto('08-selecao');
  await abrir(`/ler/${prosa.id}/${capProsa}`); await pagina.mouse.wheel(0, 700); await foto('09-leitor-prosa');
  const geometria = await pagina.evaluate(() => {
    const texto = document.querySelector('.capitulo') ?? document.querySelector('article');
    const margem = document.querySelector('.margem');
    const r = texto?.getBoundingClientRect(); const m = margem?.getBoundingClientRect();
    return r ? { viewport: innerWidth, texto_esq: Math.round(r.left), texto_larg: Math.round(r.width),
      centro_texto: Math.round(r.left + r.width / 2), desvio_do_centro: Math.round(r.left + r.width / 2 - innerWidth / 2),
      margem_esq: m ? Math.round(m.left) : null, margem_larg: m ? Math.round(m.width) : null } : null;
  });
  problemas.push(`${tela}: geometria ${JSON.stringify(geometria)}`);
  await pagina.close();
}
await navegador.close();
console.log(JSON.stringify({ pasta, poema: poema.titulo, prosa: prosa.titulo, curto: curto.titulo, problemas: problemas.filter((p) => !p.includes('503')).slice(0, 12) }));
