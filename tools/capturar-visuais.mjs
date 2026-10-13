// Capturas dos visuais ancorados (J70) contra uma API viva, SÓ LEITURA: toda escrita é bloqueada.
// Uso: node tools/capturar-visuais.mjs <base> <pasta-de-saída>
// ESQUEMA=escuro captura no tema escuro do sistema (sufixo -escuro). Em 1440×900 e 412×915.
// Documentos: o soneto com o quadro do poema, o conto em PDF com a imagem de um trecho, o texto com o
// fluxograma do capítulo e o livro em PDF com o fluxograma de uma seleção. Os estados "gerando" e
// "falhou" são encenados reescrevendo a resposta GET dos visuais no navegador.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [base = 'http://127.0.0.1:8740', pasta = 'docs/jobs/J70-evidencias/capturas'] = process.argv.slice(2);
mkdirSync(pasta, { recursive: true });
const json = async (caminho) => (await fetch(base + caminho)).json();
const { documentos } = await json('/api/documentos');
const achar = (texto) => documentos.find((d) => d.titulo.includes(texto));
const alvos = {
  soneto: achar('Soneto de Natal'), espelho: achar('o espelho'), texto: achar('Poder agir e poder querer'),
  livro: achar('Projetando Aplicações'),
};
const capituloDoLivro = alvos.livro ? (await json(`/api/versoes/${(await json(`/api/documentos/${alvos.livro.id}`)).versao_id}/secoes`)).capitulos.find((c) => c.titulo.startsWith('CAPÍTULO 1'))?.id : undefined;

const navegador = await chromium.launch();
const problemas = [];
const esquema = process.env.ESQUEMA === 'escuro' ? 'dark' : 'light';
for (const [largura, altura, tela] of [[1440, 900, 'pc'], [412, 915, 'cel']]) {
  const pagina = await navegador.newPage({ viewport: { width: largura, height: altura }, reducedMotion: 'reduce', colorScheme: esquema });
  pagina.on('pageerror', (erro) => problemas.push(`${tela}: ${String(erro)}`));
  // O 503 é o bloqueio de escrita desta própria ferramenta (progresso da leitura), não um problema da tela.
  pagina.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('status of 503')) problemas.push(`${tela}: ${m.text().slice(0, 160)}`); });
  let encenar = null;
  await pagina.route('**/api/**', async (rota) => {
    const pedido = rota.request();
    if (pedido.method() !== 'GET') return rota.fulfill({ status: 503, contentType: 'application/json', body: '{"erro":"somente_leitura"}' });
    if (encenar && pedido.url().endsWith('/visuais')) {
      const resposta = await rota.fetch();
      const corpo = await resposta.json();
      return rota.fulfill({ response: resposta, json: { visuais: corpo.visuais.map(encenar) } });
    }
    return rota.continue();
  });
  const sufixo = `${tela}${esquema === 'dark' ? '-escuro' : ''}`;
  const foto = async (nome) => { await pagina.waitForTimeout(900); await pagina.screenshot({ path: `${pasta}/${nome}-${sufixo}.png` }); };
  const abrir = async (caminho) => { await pagina.goto(base + caminho, { waitUntil: 'networkidle' }); await pagina.waitForTimeout(2500); };
  const verNota = async (seletor) => {
    for (let i = 0; i < 40; i += 1) {
      const achou = await pagina.evaluate((s) => {
        const alvo = document.querySelector(s);
        if (!alvo) return false;
        alvo.scrollIntoView({ block: 'center' });
        return true;
      }, seletor);
      if (achou) { await pagina.waitForTimeout(1500); return true; }
      await pagina.mouse.wheel(0, 700); await pagina.waitForTimeout(400);
    }
    return false;
  };
  const ampliar = async (seletor, nome) => {
    const botao = pagina.locator(seletor).first();
    if (!(await botao.count())) return;
    await botao.click();
    await pagina.waitForTimeout(2500);
    await foto(nome);
    await pagina.keyboard.press('Escape');
  };

  if (alvos.soneto) {
    await abrir(`/ler/${alvos.soneto.id}`);
    await pagina.evaluate(() => window.scrollTo(0, 0));
    await foto('01-soneto-quadro-do-poema');
    await ampliar('.visuais-do-capitulo .miniatura-do-visual, .nota-do-visual .miniatura-do-visual', '02-soneto-quadro-ampliado');
    // Barra da seleção com Imagem e Fluxograma, e o pedido aberto sobre uma estrofe.
    const selecionou = await pagina.evaluate(() => {
      const alvo = document.querySelector('.bloco-estrofe .segmento') ?? document.querySelector('[data-bloco] .segmento');
      const texto = alvo?.firstChild;
      if (!texto || texto.nodeType !== 3) return false;
      const faixa = document.createRange(); faixa.setStart(texto, 0); faixa.setEnd(texto, Math.min(24, texto.textContent.length));
      const s = getSelection(); s.removeAllRanges(); s.addRange(faixa);
      document.dispatchEvent(new Event('selectionchange'));
      alvo.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      return true;
    });
    if (selecionou) {
      await foto('03-selecao-com-imagem-e-fluxograma');
      const imagem = pagina.getByRole('toolbar', { name: 'Ações da seleção' }).getByRole('button', { name: 'Imagem' });
      if (await imagem.count()) { await imagem.click(); await foto('04-pedido-de-imagem'); await pagina.keyboard.press('Escape'); }
    }
  }
  if (alvos.espelho) {
    await abrir(`/ler/${alvos.espelho.id}`);
    if (await verNota('.nota-do-visual, .pessoais-moveis .nota-do-visual')) await foto('05-pdf-imagem-do-trecho-na-margem');
    await ampliar('.nota-do-visual .miniatura-do-visual', '06-pdf-imagem-ampliada');
    // Estados encenados: gerando e falhou, na mesma nota.
    encenar = (v) => ({ ...v, estado: 'executando', artefato: undefined, execucao: undefined });
    await abrir(`/ler/${alvos.espelho.id}`);
    if (await verNota('.nota-do-visual')) await foto('07-pdf-imagem-gerando');
    encenar = (v) => ({ ...v, estado: 'falhou', motivo: 'O Codex terminou sem gerar imagem.', artefato: undefined, execucao: undefined });
    await abrir(`/ler/${alvos.espelho.id}`);
    if (await verNota('.nota-do-visual')) await foto('08-pdf-imagem-falhou');
    encenar = null;
  }
  if (alvos.texto) {
    await abrir(`/ler/${alvos.texto.id}`);
    await pagina.evaluate(() => window.scrollTo(0, 0));
    await foto('09-texto-fluxograma-do-capitulo');
    await ampliar('.visuais-do-capitulo .miniatura-do-diagrama, .nota-do-visual .miniatura-do-diagrama', '10-fluxograma-ampliado');
  }
  if (alvos.livro && capituloDoLivro) {
    await abrir(`/ler/${alvos.livro.id}/${capituloDoLivro}`);
    if (await verNota('.nota-do-visual')) await foto('11-pdf-fluxograma-da-selecao-na-margem');
    await ampliar('.nota-do-visual .miniatura-do-diagrama', '12-pdf-fluxograma-da-selecao-ampliado');
  }
  await pagina.close();
}
await navegador.close();
console.log(JSON.stringify({ pasta, problemas: [...new Set(problemas)] }, null, 2));
