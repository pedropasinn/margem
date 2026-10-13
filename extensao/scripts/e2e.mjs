/**
 * Ponta a ponta da extensão: Chromium de verdade com a extensão desempacotada, contra uma API
 * e um worker do Margem próprios deste teste, num banco `margem_test_extensao_*` criado e
 * destruído aqui. Nunca toca o banco de produção nem as portas da instalação em uso (8730, 8740, 5180, 5190).
 *
 *   npm run e2e   (dentro de extensao/)
 *
 * Portas: API 8753, páginas de teste 8754. Capturas de tela em docs/jobs/EXTENSAO-evidencias/.
 */
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { chromium } from 'playwright';

const EXTENSAO = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAIZ = join(EXTENSAO, '..');
const PORTA_API = 8753;
const PORTA_PAGINAS = 8754;
const API = `http://127.0.0.1:${PORTA_API}`;
const PAGINAS = `http://127.0.0.1:${PORTA_PAGINAS}`;
const ID_ESPERADO = 'gbgnmhhgfmdgchhfhabdaneaehcamcma';
const EVIDENCIAS = join(RAIZ, 'docs/jobs/EXTENSAO-evidencias');
const BANCO = `margem_test_extensao_${randomUUID().replaceAll('-', '').slice(0, 16)}`;

const falhas = [];
const processos = [];
const temporarios = [];

function anotar(texto) { console.log(`· ${texto}`); }
function conferir(condicao, texto) {
  if (condicao) anotar(`ok · ${texto}`);
  else { falhas.push(texto); console.log(`✗ ${texto}`); }
}
const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
async function ateQue(descricao, prazoMs, teste) {
  const limite = Date.now() + prazoMs;
  for (;;) {
    const valor = await teste().catch(() => null);
    if (valor) return valor;
    if (Date.now() > limite) throw new Error(`tempo esgotado esperando ${descricao}`);
    await esperar(300);
  }
}

/** URL do Postgres local sem imprimir nada dela; recusa outro host/porta que não o do container. */
function urlDoBanco(nome) {
  const bruto = process.env.DATABASE_URL
    ?? parseEnv(readFileSync(join(homedir(), '.config/margem/postgres.env'), 'utf8')).DATABASE_URL;
  const url = new URL(bruto);
  if (url.hostname !== '127.0.0.1' || url.port !== '5435') throw new Error('banco fora de 127.0.0.1:5435');
  url.pathname = `/${nome}`;
  return url.toString();
}

async function administrar(sql) {
  const cliente = new pg.Client({ connectionString: urlDoBanco('postgres') });
  await cliente.connect();
  try { await cliente.query(sql); } finally { await cliente.end(); }
}

function subir(nome, argumentos, ambiente) {
  const filho = spawn('node', ['--import', 'tsx', ...argumentos], {
    cwd: RAIZ, env: { ...process.env, ...ambiente }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let saida = '';
  filho.stdout.on('data', (d) => { saida += d; });
  filho.stderr.on('data', (d) => { saida += d; });
  filho.on('exit', (codigo) => { if (codigo !== null && codigo !== 0) console.log(`[${nome}] saiu com ${codigo}\n${saida.slice(-2000)}`); });
  processos.push(filho);
  return filho;
}

/** PDF mínimo e válido (uma página, "Olá, PDF do Margem."), com a tabela xref calculada. */
function pdfMinimo() {
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  const conteudo = 'BT /F1 18 Tf 24 72 Td (Ola, PDF do Margem.) Tj ET';
  objetos[3] = `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`;
  let corpo = '%PDF-1.4\n';
  const posicoes = [];
  objetos.forEach((objeto, indice) => { posicoes.push(corpo.length); corpo += `${indice + 1} 0 obj\n${objeto}\nendobj\n`; });
  const xref = corpo.length;
  corpo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${posicoes.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`;
  corpo += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(corpo, 'latin1');
}

function servirPaginas() {
  const noticia = readFileSync(join(EXTENSAO, 'testes/fixtures/noticia-agencia-brasil.html'));
  const pdf = pdfMinimo();
  const selecao = Buffer.from('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Carta longa</title></head>'
    + '<body><p id="alvo">Este é o <em>trecho</em> que importa.</p><p>Este outro não vai.</p></body></html>');
  const servidor = createServer((pedido, resposta) => {
    const rotas = {
      '/noticia.html': ['text/html; charset=utf-8', noticia],
      '/selecao.html': ['text/html; charset=utf-8', selecao],
      '/documento.pdf': ['application/pdf', pdf],
    };
    const achado = rotas[new URL(pedido.url ?? '/', PAGINAS).pathname];
    if (!achado) { resposta.writeHead(404).end(); return; }
    resposta.writeHead(200, { 'Content-Type': achado[0] }).end(achado[1]);
  });
  return new Promise((resolver) => servidor.listen(PORTA_PAGINAS, '127.0.0.1', () => resolver(servidor)));
}

async function api(caminho) {
  const resposta = await fetch(`${API}${caminho}`);
  if (!resposta.ok) throw new Error(`${caminho}: ${resposta.status}`);
  return resposta.json();
}

async function principal() {
  execFileSync('node', [join(EXTENSAO, 'scripts/construir.mjs'), '--e2e'], { stdio: 'inherit', env: { ...process.env, MARGEM_E2E_PORTA_PAGINAS: String(PORTA_PAGINAS) } });
  const pacote = join(EXTENSAO, 'dist/chrome-e2e');
  mkdirSync(EVIDENCIAS, { recursive: true });

  await administrar(`CREATE DATABASE "${BANCO}"`);
  anotar(`banco ${BANCO} criado`);
  const dados = mkdtempSync(join(tmpdir(), 'margem-extensao-dados-'));
  const artefatos = mkdtempSync(join(tmpdir(), 'margem-extensao-artefatos-'));
  const perfil = mkdtempSync(join(tmpdir(), 'margem-extensao-perfil-'));
  temporarios.push(dados, artefatos, perfil);
  const ambiente = {
    TSX_TSCONFIG_PATH: join(RAIZ, 'servico/tsconfig.json'),
    DATABASE_URL: urlDoBanco(BANCO),
    MARGEM_DADOS: dados,
    MARGEM_PORTA: String(PORTA_API),
    MARGEM_EXTENSOES: `chrome-extension://${ID_ESPERADO}`,
    MARGEM_ORIGENS: '',
    MARGEM_TAILSCALE_HOST: '',
    MARGEM_SLOTS: '1',
    MARGEM_EXECUTOR: 'falso',
    MARGEM_ROTEIRO: join(RAIZ, 'fixtures/codex/leitura/leitor-ok.json'),
    MARGEM_AUDITORIA: '0',
    MARGEM_ARTEFATOS: join(artefatos, 'resultados'),
  };
  subir('api', ['servico/src/api.ts'], ambiente);
  await ateQue('a API subir', 40_000, () => api('/api/importacoes/web'));
  subir('worker', ['servico/src/worker/main.ts'], ambiente);
  const paginas = await servirPaginas();
  anotar(`API em ${API}, páginas em ${PAGINAS}`);

  const contexto = await chromium.launchPersistentContext(perfil, {
    channel: 'chromium',
    headless: true,
    args: ['--headless=new', `--disable-extensions-except=${pacote}`, `--load-extension=${pacote}`],
  });
  try {
    const trabalhador = contexto.serviceWorkers()[0] ?? await contexto.waitForEvent('serviceworker');
    const id = new URL(trabalhador.url()).host;
    conferir(id === ID_ESPERADO, `id fixo da extensão (${id})`);
    const base = `chrome-extension://${id}`;

    // ---------------------------------------------------------- opções e teste de conexão
    const opcoes = await contexto.newPage();
    await opcoes.goto(`${base}/opcoes/opcoes.html`);
    conferir((await opcoes.textContent('#origem')) === base, 'opções mostram a origem para MARGEM_EXTENSOES');
    await opcoes.fill('#servidor', 'http://127.0.0.1:8759');
    await opcoes.click('#testar');
    await opcoes.waitForSelector('#aviso[data-tipo=erro]');
    conferir((await opcoes.textContent('#aviso'))?.includes('Não foi possível falar') ?? false, 'servidor errado: erro claro');
    await opcoes.fill('#servidor', `${API}/`);
    await opcoes.click('button[type=submit]');
    await opcoes.waitForSelector('#aviso[data-tipo=sucesso]');
    await opcoes.click('#testar');
    await opcoes.waitForFunction(() => document.querySelector('#aviso')?.textContent?.startsWith('Conectado'));
    conferir(true, 'teste de conexão passa pelo CORS da API');
    await opcoes.screenshot({ path: join(EVIDENCIAS, 'opcoes-claro.png'), fullPage: true });

    const idDaAba = async (url) => trabalhador.evaluate(async (alvo) => (await chrome.tabs.query({ url: alvo }))[0]?.id, url);

    // ---------------------------------------------------------- página: popup → enviar
    const noticia = await contexto.newPage();
    await noticia.goto(`${PAGINAS}/noticia.html`);
    const abaNoticia = await idDaAba(`${PAGINAS}/noticia.html`);
    const popup = await contexto.newPage();
    await popup.setViewportSize({ width: 360, height: 420 });
    await popup.goto(`${base}/popup/popup.html?aba=${abaNoticia}`);
    await popup.waitForSelector('#captura:not([hidden])', { timeout: 20_000 });
    conferir((await popup.textContent('#titulo')) === 'Eleições 2026: saiba o que pode e o que não pode no dia da votação', 'popup: título detectado');
    const meta = await popup.textContent('#meta') ?? '';
    conferir(meta.includes('Agência Brasil') && /palavras/.test(meta), `popup: site e contagem (${meta})`);
    await popup.screenshot({ path: join(EVIDENCIAS, 'popup-claro.png') });
    await popup.emulateMedia({ colorScheme: 'dark' });
    await popup.screenshot({ path: join(EVIDENCIAS, 'popup-escuro.png') });
    await popup.emulateMedia({ colorScheme: 'light' });
    await popup.click('#enviar');
    await popup.waitForSelector('#aviso[data-tipo=sucesso]', { timeout: 20_000 });
    const documentoId = await popup.getAttribute('body', 'data-enviado');
    const link = await popup.getAttribute('#aviso a', 'href');
    conferir(link === `${API}/documentos/${documentoId}`, 'popup: link para abrir no Margem');
    await popup.screenshot({ path: join(EVIDENCIAS, 'popup-enviado.png') });

    const original = readFileSync(join(dados, documentoId, 'original.md'), 'utf8');
    conferir(original.startsWith('---\ntitulo: Eleições 2026: saiba o que pode e o que não pode no dia da votação\n'), 'original: frontmatter com título');
    conferir(original.includes(`\nurl_origem: ${PAGINAS}/noticia.html\n`) && original.includes('\npublicado_em: 2026-10-01T14:28:00.000Z\n'),
      'original: url de origem e data de publicação');
    const detalhe = await ateQue('a canonização da página', 90_000, async () => {
      const corpo = await api(`/api/documentos/${documentoId}`);
      return corpo.texto_disponivel ? corpo : null;
    });
    const secoes = await api(`/api/versoes/${detalhe.versao_id}/secoes`);
    const titulos = JSON.stringify(secoes);
    conferir(titulos.includes('Posso levar uma \\"colinha\\" em papel para a cabine de votação?'), 'canonizado: intertítulos viraram seções');

    // ---------------------------------------------------------- enviar e abrir
    const popup2 = await contexto.newPage();
    await popup2.goto(`${base}/popup/popup.html?aba=${abaNoticia}`);
    await popup2.waitForSelector('#captura:not([hidden])');
    const novaAba = contexto.waitForEvent('page');
    await popup2.click('#enviar-abrir');
    const aberta = await novaAba;
    await aberta.waitForLoadState('domcontentloaded').catch(() => undefined);
    conferir(/^http:\/\/127\.0\.0\.1:8753\/documentos\/[0-9A-HJKMNP-TV-Z]{26}$/.test(aberta.url()), `"Enviar e abrir" abriu ${aberta.url()}`);

    // ---------------------------------------------------------- seleção
    const carta = await contexto.newPage();
    await carta.goto(`${PAGINAS}/selecao.html`);
    await carta.evaluate(() => {
      const faixa = document.createRange();
      faixa.selectNodeContents(document.getElementById('alvo'));
      getSelection().removeAllRanges();
      getSelection().addRange(faixa);
    });
    const abaCarta = await idDaAba(`${PAGINAS}/selecao.html`);
    const trecho = await popup2.evaluate(async (aba) => chrome.runtime.sendMessage({ tipo: 'capturar', aba, modo: 'selecao' }), abaCarta);
    conferir(trecho.ok && trecho.valor.markdown === 'Este é o *trecho* que importa.' && trecho.valor.titulo === 'Carta longa (trecho)', 'seleção: só o trecho, em Markdown');
    const envioDoTrecho = await popup2.evaluate(async ([captura, aba]) => chrome.runtime.sendMessage({ tipo: 'enviar', captura, aba, abrir: false }), [trecho.valor, abaCarta]);
    conferir(envioDoTrecho.ok, 'seleção: enviada');
    if (envioDoTrecho.ok) {
      const doTrecho = readFileSync(join(dados, envioDoTrecho.valor.documento_id, 'original.md'), 'utf8');
      conferir(doTrecho.includes('\ntrecho: sim\n') && doTrecho.endsWith('Este é o *trecho* que importa.\n'), 'seleção: original marcado como trecho');
    }

    // ---------------------------------------------------------- PDF
    const pdf = await contexto.newPage();
    await pdf.goto(`${PAGINAS}/documento.pdf`).catch(() => undefined);
    const abaPdf = await idDaAba(`${PAGINAS}/documento.pdf`);
    if (abaPdf === undefined) {
      falhas.push('PDF: o Chromium sem interface não abriu o PDF numa aba');
    } else {
      const capturaPdf = await popup2.evaluate(async (aba) => chrome.runtime.sendMessage({ tipo: 'capturar', aba }), abaPdf);
      conferir(capturaPdf.ok && capturaPdf.valor.tipo === 'pdf', `PDF: detectado como PDF (${JSON.stringify(capturaPdf).slice(0, 160)})`);
      if (capturaPdf.ok) {
        const envioPdf = await popup2.evaluate(async ([captura, aba]) => chrome.runtime.sendMessage({ tipo: 'enviar', captura, aba, abrir: false }), [capturaPdf.valor, abaPdf]);
        conferir(envioPdf.ok, `PDF: enviado ${envioPdf.ok ? '' : envioPdf.erro}`);
        if (envioPdf.ok) {
          const corpo = await api(`/api/documentos/${envioPdf.valor.documento_id}`);
          const bytes = readFileSync(join(dados, envioPdf.valor.documento_id, 'original.pdf'));
          conferir(corpo.formato === 'pdf' && bytes.equals(pdfMinimo()), 'PDF: chegou como o original, byte a byte');
        }
      }
    }
  } finally {
    await contexto.close();
    paginas.close();
  }
}

async function limpar() {
  for (const filho of processos) filho.kill('SIGTERM');
  await esperar(500);
  try { await administrar(`DROP DATABASE IF EXISTS "${BANCO}" WITH (FORCE)`); anotar(`banco ${BANCO} destruído`); } catch (erro) { console.log(`não consegui destruir ${BANCO}: ${erro.message}`); }
  for (const caminho of temporarios) rmSync(caminho, { recursive: true, force: true });
}

try {
  await principal();
} catch (erro) {
  falhas.push(erro instanceof Error ? erro.message : String(erro));
} finally {
  await limpar();
}
if (falhas.length > 0) {
  console.log(`\n${falhas.length} falha(s):\n- ${falhas.join('\n- ')}`);
  process.exit(1);
}
console.log('\nponta a ponta: tudo ok');
