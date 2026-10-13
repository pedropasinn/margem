// Capturas do app real (web/dist) para a página comercial: o leitor com marcas e a barra de seleção,
// em claro e escuro. Toda rota /api é interceptada (como em web/tests/onboarding.spec.ts): não há
// serviço, banco nem Codex, e nada toca a instalação da porta 8730. O texto é "Um apólogo", de
// Machado de Assis (domínio público), canonizado pelo motor de verdade; as marcas são ilustrativas.
//
// Pré-requisitos: dependências da raiz instaladas, `npm run build --workspace web` e motor/.venv
// (ou MOTOR_PYTHON apontando para um Python com as dependências do motor).
// Uso (da pasta web/):  node ../site/scripts/capturar-app.mjs
// Saída: site/public/app/<cena>-<tema>.png (versionadas; o site não depende de rodar isto).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const web = join(raiz, 'web');
const saida = join(raiz, 'site/public/app');
mkdirSync(saida, { recursive: true });

const temporario = mkdtempSync(join(tmpdir(), 'site-capturas-app-'));
execFileSync(process.env['MOTOR_PYTHON'] ?? join(raiz, 'motor/.venv/bin/python'), ['-c', `
import sys
from pathlib import Path
from margem_motor.ingest import canonizar
canonizar(Path(sys.argv[1]), 'md', Path(sys.argv[2]), titulo='Um apólogo', autor='Machado de Assis', idioma='pt')
`, join(web, 'src/onboarding/exemplo/um-apologo.md'), join(temporario, 'versao')], { cwd: raiz, env: { ...process.env, PYTHONPATH: join(raiz, 'motor') }, stdio: 'pipe' });
const canonico = JSON.parse(readFileSync(join(temporario, 'versao/canonico.json'), 'utf8'));
const j18 = JSON.parse(readFileSync(join(web, 'tests/fixtures/j18.json'), 'utf8'));

const DOC = '0000000000000000000000EX01';
const VERSAO = j18.snapshot.versao_id;
const secao = canonico.secoes[0];
function marca(id, citacao, funcao, rotulo, texto) {
  const b = canonico.blocos.find((x) => x.texto.includes(citacao));
  assert.ok(b, citacao);
  const inicio = b.texto.indexOf(citacao);
  return { ...j18.snapshot.marcas[0], id, funcao, saliencia: 1,
    ancora: { versao_id: VERSAO, bloco_id: b.id, inicio_utf16: inicio, fim_utf16: inicio + citacao.length, citacao, prefixo: b.texto.slice(Math.max(0, inicio - 32), inicio), sufixo: b.texto.slice(inicio + citacao.length, inicio + citacao.length + 32) },
    comentario: { tipo: 'LEITURA', rotulo, texto } };
}
const MARCAS = [
  marca('0000000000000000000000MK01', 'toda cheia de si, toda enrolada', 'imagem', 'O novelo vira vaidade', 'A forma do novelo dá corpo ao orgulho que a agulha acusa.'),
  marca('0000000000000000000000MK02', 'Agulha não tem cabeça.', 'voz', 'A linha devolve o golpe', 'O trocadilho com a cabeça do alfinete mostra quem domina a conversa.'),
  marca('0000000000000000000000MK03', 'obedecendo ao que eu faço e mando', 'virada', 'Quem manda em quem', 'A agulha inverte a hierarquia: abrir caminho seria mandar.'),
  marca('0000000000000000000000MK04', 'Cada qual tem o ar que Deus lhe deu.', 'forma', 'Provérbio como escudo', 'A linha responde com um ditado: encerra a discussão sem argumentar.'),
];
const snapshot = { ...j18.snapshot, documento_id: DOC, versao_id: VERSAO,
  secao: { id: secao.id, titulo: secao.titulo, ordem: 0, nivel: 1, bloco_inicio: secao.bloco_inicio, bloco_fim: secao.bloco_fim },
  blocos: canonico.blocos, marcas: MARCAS, anotacoes: [], conversas: [], conexoes: [] };
const item = { id: DOC, titulo: 'Um apólogo', autor: 'Machado de Assis', formato: 'md', criado_em: '2026-10-01T12:00:00Z', arquivado_em: null,
  versao_id: VERSAO, texto_disponivel: true, estado: 'pronto', detalhe: null, partes_prontas: 0, partes_total: 0,
  marcas: { tese: 0, conceito: 0, justificativa: 0, nenhuma: 0, total: MARCAS.length }, progresso: null, jobs_em_curso: 0, midia: null };

const PORTA = 5203;
const servidor = await preview({ root: web, configLoader: 'runner', preview: { host: '127.0.0.1', port: PORTA, strictPort: true } });
const base = `http://127.0.0.1:${String(PORTA)}`;

async function simular(pagina) {
  await pagina.route('**/*', async (rota) => {
    const url = new URL(rota.request().url());
    if (url.origin !== base) return rota.abort();
    if (!url.pathname.startsWith('/api/')) return rota.continue();
    const c = url.pathname;
    const responder = (json, status = 200) => rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
    if (c === '/api/documentos') return responder({ documentos: [item] });
    if (c === `/api/documentos/${DOC}`) return responder({ ...item, versoes: [], execucoes: [], jobs: [], exportacoes: [] });
    if (c === '/api/modos') return responder({ modos: j18.modos });
    if (c.endsWith('/progresso')) return responder({ progresso: null });
    if (c.endsWith('/secoes')) return responder({ versao_id: VERSAO, documento_id: DOC, titulo: 'Um apólogo', secoes: [], capitulos: [{ id: secao.id, titulo: secao.titulo }], limites: [] });
    if (c.endsWith('/midias')) return responder({ midias: [] });
    if (c.endsWith('/audios')) return responder({ audios: [] });
    if (c.endsWith('/visuais')) return responder({ visuais: [] });
    if (c.includes('/capitulos/')) return responder(snapshot);
    if (c.endsWith('/camadas')) return responder({ camadas: [], preferencias: { primeiro_eu: false, camada_padrao: null } });
    if (c.endsWith('/compreensoes')) return responder({ versao_id: VERSAO, compreensoes: [] });
    if (c.endsWith('/etiquetas')) return responder({ etiquetas: [], sugestoes: [] });
    if (c.endsWith('/resolucoes')) return responder({ resolucoes: [] });
    if (c === '/api/perfil') return responder({ perfil: null, hash: '' });
    if (c === '/api/eventos') return rota.fulfill({ contentType: 'text/event-stream', body: 'retry: 600000\n\n' });
    return responder({});
  });
}
const onboardingConcluido = JSON.stringify({ versao: 1, boas_vindas: 'concluida', tela: 0,
  primeiro_documento: { estado: 'concluida', origem: 'exemplo', documento_id: DOC }, exemplo_id: DOC, tour: 'concluida', dica: 0, levar: 'concluida',
  atualizado_em: '2026-10-01T12:00:00.000Z' });

async function selecionar(pagina, citacao) {
  await pagina.evaluate((citacao) => {
    const bloco = [...document.querySelectorAll('[data-bloco]')].find((el) => el.textContent?.includes(citacao));
    const nos = document.createTreeWalker(bloco, NodeFilter.SHOW_TEXT);
    const texto = bloco.textContent; const inicio = texto.indexOf(citacao); const fim = inicio + citacao.length;
    const pontos = []; let offset = 0;
    for (let no = nos.nextNode(); no; no = nos.nextNode()) { pontos.push({ no, inicio: offset, fim: offset + no.textContent.length }); offset += no.textContent.length; }
    const a = pontos.find((p) => p.inicio <= inicio && inicio < p.fim); const b = pontos.find((p) => p.inicio < fim && fim <= p.fim);
    const range = document.createRange(); range.setStart(a.no, inicio - a.inicio); range.setEnd(b.no, fim - b.inicio);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, citacao);
  await pagina.getByRole('toolbar', { name: 'Ações da seleção' }).waitFor();
}

const navegador = await chromium.launch();
try {
  for (const colorScheme of ['light', 'dark']) {
    const tema = colorScheme === 'light' ? 'claro' : 'escuro';
    const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme, reducedMotion: 'reduce' });
    const pagina = await contexto.newPage();
    pagina.setDefaultTimeout(15000);
    await simular(pagina);
    await pagina.addInitScript((valor) => { localStorage.setItem('margem:onboarding:v1:local', valor); }, onboardingConcluido);
    await pagina.goto(`${base}/ler/${DOC}/${secao.id}`);
    await pagina.locator('.camada-de-marcas path').first().waitFor();
    if (await pagina.locator('.dica-ancorada').count()) await pagina.keyboard.press('Escape');
    await pagina.evaluate(() => document.fonts.ready);
    await pagina.waitForTimeout(400);

    const numero = pagina.locator('[data-nota="0000000000000000000000MK02"] .nota-numero');
    await numero.click();
    await pagina.waitForTimeout(300);
    await pagina.screenshot({ path: join(saida, `nota-aberta-${tema}.png`) });
    await pagina.keyboard.press('Escape');
    await pagina.mouse.click(5, 450);
    await pagina.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await pagina.mouse.move(0, 0);
    await pagina.waitForTimeout(200);

    await selecionar(pagina, 'Que cabeça, senhora?');
    await pagina.waitForTimeout(200);
    await pagina.screenshot({ path: join(saida, `selecao-${tema}.png`), clip: { x: 250, y: 230, width: 1000, height: 440 } });
    await contexto.close();
    console.log(`capturas do app: ${tema}`);
  }
} finally {
  await navegador.close();
  await new Promise((r) => { servidor.httpServer.close(() => r()); });
}
