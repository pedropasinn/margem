/**
 * Confere a CSP da página na interface construída, no Chromium headless, sem produção nem rede.
 *
 * Sobe uma API local de teste (os cabeçalhos de segurança de verdade + `web/dist` + respostas falsas
 * da API), abre o leitor de um PDF real gerado pelo fixture do motor (PDF.js e o worker dele), com um
 * exercício em LaTeX (KaTeX) e um fluxograma (Mermaid) no caderno, toca áudio e vídeo de mesma origem
 * e de `blob:`, e falha se o navegador registrar qualquer violação de CSP ou erro de página.
 *
 *   npm run build -w web   (na worktree, nunca na árvore principal)
 *   node --import tsx tools/conferir-csp.mjs [cópia-de-um-pdf-real.pdf]
 *
 * Com um PDF real (uma cópia, nunca o arquivo de ~/dados), o leitor abre esse PDF canonizado pelo
 * motor numa pasta temporária. Em todo caso, a página 1 precisa ter tinta: um PDF escaneado em JBIG2
 * sem os decodificadores wasm sai em branco, só com o fundo.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { chromium } from 'playwright';
import { cabecalhosDeSeguranca, CSP_DA_PAGINA } from '../servico/src/http/seguranca.js';
import { servirWeb } from '../servico/src/http/estatico.js';

const raiz = resolve(import.meta.dirname, '..');
const temporario = mkdtempSync(join(tmpdir(), 'margem-csp-'));
const pdfReal = process.argv[2] === undefined ? undefined : resolve(process.argv[2]);
execFileSync(join(raiz, 'motor/.venv/bin/python'), ['-c', `
from pathlib import Path
import shutil, sys
sys.path.insert(0, 'motor/tests')
from conftest import sintetico
from margem_motor.ingest import canonizar
p = Path(sys.argv[1])
if len(sys.argv) > 2:
    original = p / 'fixtures/sintetico.pdf'
    original.parent.mkdir()
    shutil.copyfile(sys.argv[2], original)
else:
    original = sintetico.__wrapped__(p)
canonizar(original, 'pdf', p / 'versao')
`, temporario, ...(pdfReal === undefined ? [] : [pdfReal])], { cwd: raiz, env: { ...process.env, PYTHONPATH: join(raiz, 'motor') }, stdio: 'pipe' });
const canonico = JSON.parse(readFileSync(join(temporario, 'versao/canonico.json'), 'utf8'));
const geometria = JSON.parse(readFileSync(join(temporario, 'versao/geometria.json'), 'utf8'));
const pdf = readFileSync(join(temporario, 'fixtures/sintetico.pdf'));

const documentoId = '00000000000000000000000C5P';
const versaoId = geometria.versao_id;
const secao = canonico.secoes[0];
const bloco = canonico.blocos.find((b) => b.texto.includes('O primeiro paragrafo'))
  ?? canonico.blocos.find((b) => b.texto.length >= 40);
const ancora = { versao_id: versaoId, bloco_id: bloco.id, inicio_utf16: 2, fim_utf16: 10, citacao: bloco.texto.slice(2, 10), prefixo: bloco.texto.slice(0, 2), sufixo: bloco.texto.slice(10, 40) };
const agora = '2026-10-01T12:00:00.000Z';
const snapshot = { documento_id: documentoId, versao_id: versaoId, formato: 'pdf', paginas: { inicio: 1, fim: 3 }, geometria_disponivel: true, secao, blocos: canonico.blocos, assets: {}, camadas: [], camada: 'todas', anotacoes: [], conversas: [], conexoes: [], marcas: [], recuperacao: [], anterior: null, proxima: null };
const resolucao = {
  versao: 1, id: '00000000000000000000000R01', documento_id: documentoId, versao_id: versaoId,
  origem: { tipo: 'trecho', ancora }, texto_extraido: bloco.texto, mensagens: [], criada_em: agora, execucao: { modelo: 'm', esforco: 'medio' },
  resolucao: { enunciado: 'Prove que $1+2+\\cdots+n=\\frac{n(n+1)}{2}$.', legibilidade: 'boa', conceitos: ['indução'], observacao: null,
    itens: [{ rotulo: '', enunciado: 'A soma $\\sum_{k=1}^n k$.', estrategia: 'Indução em $n$.', resposta: '$\\frac{n(n+1)}{2}$', verificacao: '$n=1$ dá $1$.',
      passos: [{ texto: 'Caso inicial $n=1$.', calculo: '$$\\frac{1\\cdot 2}{2}=1$$' }] }] },
};
const visual = {
  versao: 1, id: '00000000000000000000000V01', versao_id: versaoId, secao_id: secao.id, tipo: 'diagrama', alvo: { tipo: 'capitulo' }, estado: 'pronto', diagnosticos: [],
  artefato: { tipo: 'mermaid', titulo: 'Argumento', codigo: 'flowchart TD\n  A["Tese"] --> B["Prova"]\n  B --> C["Conclusão"]', nos: [{ id: 'A', rotulo: 'Tese' }, { id: 'B', rotulo: 'Prova' }, { id: 'C', rotulo: 'Conclusão' }] },
  criado_em: agora, atualizado_em: agora,
};

/** Um segundo de silêncio em WAV (PCM 8 kHz): mídia de mesma origem para o `<audio>` e o `<video>`. */
function wav() {
  const amostras = 8000;
  const cabecalho = Buffer.alloc(44);
  cabecalho.write('RIFF', 0); cabecalho.writeUInt32LE(36 + amostras, 4); cabecalho.write('WAVEfmt ', 8);
  cabecalho.writeUInt32LE(16, 16); cabecalho.writeUInt16LE(1, 20); cabecalho.writeUInt16LE(1, 22);
  cabecalho.writeUInt32LE(8000, 24); cabecalho.writeUInt32LE(8000, 28); cabecalho.writeUInt16LE(1, 32); cabecalho.writeUInt16LE(8, 34);
  cabecalho.write('data', 36); cabecalho.writeUInt32LE(amostras, 40);
  return Buffer.concat([cabecalho, Buffer.alloc(amostras, 128)]);
}

const app = new Hono();
app.use('*', cabecalhosDeSeguranca());
const naoSimuladas = [];
app.all('/api/*', (c) => {
  const caminho = new URL(c.req.url).pathname;
  if (c.req.method !== 'GET') return c.json({}, 200);
  if (caminho.endsWith('/original')) return c.body(new Uint8Array(pdf), 200, { 'Content-Type': 'application/pdf' });
  if (caminho === '/api/midia-de-teste.wav') return c.body(new Uint8Array(wav()), 200, { 'Content-Type': 'audio/wav' });
  if (caminho.includes('/geometria')) return c.json(JSON.parse(readFileSync(join(temporario, 'versao/geometria.json'), 'utf8')));
  if (caminho.endsWith('/visuais')) return c.json({ visuais: [visual] });
  if (caminho.endsWith('/resolucoes')) return c.json({ resolucoes: [{ resolucao, estado: 'pronta' }] });
  if (caminho === `/api/resolucoes/${resolucao.id}`) return c.json({ resolucao, estado: 'pronta' });
  if (caminho.endsWith('/modos')) return c.json({ modos: [] });
  if (caminho.endsWith('/midias')) return c.json({ midias: [] });
  if (caminho.endsWith('/audios')) return c.json({ audios: [] });
  if (caminho.includes('/capitulos/') && caminho.split('/').length === 6) return c.json(snapshot);
  if (caminho.endsWith('/secoes')) return c.json({ documento_id: documentoId, versao_id: versaoId, titulo: 'PDF sintético', capitulos: [secao], secoes: [], limites: [] });
  if (caminho.endsWith('/progresso')) return c.json({ progresso: null });
  if (caminho === `/api/documentos/${documentoId}`) return c.json({ id: documentoId, versao_id: versaoId, titulo: 'PDF sintético', formato: 'pdf', versoes: [], jobs: [] });
  if (caminho === '/api/documentos') return c.json({ documentos: [] });
  if (caminho === '/api/eventos') return c.body('', 200, { 'Content-Type': 'text/event-stream' });
  naoSimuladas.push(caminho);
  return c.json({}, 200);
});
servirWeb(app, join(raiz, 'web/dist'));
const porta = 5297;
const servidor = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: porta });
const base = `http://127.0.0.1:${String(porta)}`;

const navegador = await chromium.launch();
const problemas = [];
try {
  const pagina = await navegador.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  // O tsx (esbuild) embrulha funções nomeadas em `__name`; no navegador ele não existe.
  await pagina.addInitScript('window.__name = (f) => f;');
  await pagina.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window.violacoes ??= []).push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${String(e.lineNumber)}`);
    });
  });
  // Ao chegar, o leitor abre o exercício (a mesma intenção que a página do documento grava).
  await pagina.addInitScript((intencao) => { sessionStorage.setItem('margem:ao-abrir', intencao); },
    JSON.stringify({ documento_id: documentoId, secao_id: secao.id, resolucao: resolucao.id }));
  pagina.on('pageerror', (e) => problemas.push(`erro na página: ${e.message}`));
  pagina.on('console', (m) => { if (/Content.Security.Policy|Refused to/i.test(m.text())) problemas.push(`console: ${m.text().slice(0, 300)}`); });
  pagina.on('worker', (w) => { w.on('console', (m) => { if (/Content.Security.Policy|Refused/i.test(m.text())) problemas.push(`worker: ${m.text().slice(0, 300)}`); }); });

  const resposta = await pagina.goto(`${base}/ler/${documentoId}/${secao.id}`);
  assert.equal(resposta?.headers()['content-security-policy'], CSP_DA_PAGINA);
  await pagina.locator('[data-pagina="1"] [data-pronta="true"]').waitFor({ timeout: 60_000 });
  assert.ok(await pagina.locator('[data-pagina="1"] canvas').count(), 'PDF.js não desenhou a página');
  // Tinta na página: fração de pixels escuros do canvas (uma página em branco fica em ~0).
  const tinta = await pagina.locator('[data-pagina="1"] canvas').first().evaluate((canvas) => {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let escuros = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] < 384) escuros += 1;
    return escuros / (data.length / 4);
  });
  assert.ok(tinta > 0.002, `página 1 em branco (fração de pixels escuros ${String(tinta)})`);
  assert.ok(await pagina.locator('[data-pagina="1"] .textLayer span').count(), 'PDF.js sem camada de texto');
  const workers = pagina.workers().map((w) => w.url());
  assert.ok(workers.some((url) => url.startsWith(`${base}/assets/pdf-worker`)), `o worker do PDF.js não subiu: ${workers.join(', ')}`);

  // KaTeX: a sessão do exercício aberta, com os passos.
  await pagina.locator('.katex').first().waitFor({ timeout: 30_000 });
  const fonteKatex = await pagina.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some((f) => f.family.includes('KaTeX') && f.status === 'loaded');
  });
  assert.ok(fonteKatex, 'as fontes do KaTeX não carregaram');
  // Mermaid: o fluxograma do capítulo no caderno.
  await pagina.locator('svg g.node').first().waitFor({ state: 'attached', timeout: 60_000 });
  assert.ok(await pagina.locator('svg g.node').count() >= 3, 'o Mermaid não desenhou os três nós');

  // Áudio e vídeo: mesma origem e `blob:` (o leitor e-ink e a resolução usam URLs de blob).
  const midia = await pagina.evaluate(async () => {
    const tocar = (elemento, url) => new Promise((ok) => {
      elemento.addEventListener('loadedmetadata', () => { ok(`ok ${String(elemento.duration)}`); }, { once: true });
      elemento.addEventListener('error', () => { ok(`erro ${String(elemento.error?.code)}`); }, { once: true });
      elemento.src = url;
    });
    const blob = URL.createObjectURL(await (await fetch('/api/midia-de-teste.wav')).blob());
    return [
      await tocar(new Audio(), '/api/midia-de-teste.wav'),
      await tocar(document.createElement('video'), '/api/midia-de-teste.wav'),
      await tocar(new Audio(), blob),
    ];
  });
  assert.deepEqual(midia.map((m) => m.split(' ')[0]), ['ok', 'ok', 'ok'], JSON.stringify(midia));

  await pagina.screenshot({ path: join(temporario, 'csp-leitor.png') });
  const violacoes = await pagina.evaluate(() => window.violacoes ?? []);
  problemas.push(...violacoes.map((v) => `violação: ${v}`));

  // A biblioteca também abre limpa.
  const biblioteca = await navegador.newPage();
  biblioteca.on('pageerror', (e) => problemas.push(`biblioteca: ${e.message}`));
  biblioteca.on('console', (m) => { if (/Content.Security.Policy|Refused to/i.test(m.text())) problemas.push(`biblioteca: ${m.text().slice(0, 300)}`); });
  await biblioteca.goto(base);
  await biblioteca.waitForLoadState('networkidle');
} finally {
  await navegador.close();
  servidor.close();
}
if (naoSimuladas.length) console.log(`rotas sem simulação (responderam {}): ${[...new Set(naoSimuladas)].join(', ')}`);
if (problemas.length) {
  console.error(problemas.join('\n'));
  process.exit(1);
}
console.log(`CSP ok: PDF.js com worker e página com tinta, KaTeX com fontes, Mermaid, áudio e vídeo (mesma origem e blob:). Captura em ${temporario}/csp-leitor.png`);
