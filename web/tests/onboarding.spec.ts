/**
 * Capturas dos primeiros passos (onboarding) sobre `dist`. Toda rota /api é interceptada: não há
 * serviço, banco nem Codex. O exemplo é canonizado pelo motor de verdade (o mesmo Markdown que o app
 * envia); as três marcas do tour "com marcas" são ilustrativas, escritas aqui.
 * Saída: docs/ui-revisao/onboarding/<tema>-<tela>-<nn>-<nome>.png
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { preview } from 'vite';
import { INSTALACAO_PRONTA } from './estado-instalacao.ts';
import type { Bloco, ModoDeLeituraV1, Secao } from '@margem/contratos';
import type { SnapshotDoCapitulo } from '../src/biblioteca/tipos.ts';

const raiz = resolve('..');
const temporario = mkdtempSync(join(tmpdir(), 'margem-onboarding-'));
execFileSync(join(raiz, 'motor/.venv/bin/python'), ['-c', `
import sys
from pathlib import Path
from margem_motor.ingest import canonizar
canonizar(Path(sys.argv[1]), 'md', Path(sys.argv[2]), titulo='Um apólogo', autor='Machado de Assis', idioma='pt')
`, join(raiz, 'web/src/onboarding/exemplo/um-apologo.md'), join(temporario, 'versao')], { cwd: raiz, env: { ...process.env, PYTHONPATH: join(raiz, 'motor') }, stdio: 'pipe' });
const canonico = JSON.parse(readFileSync(join(temporario, 'versao/canonico.json'), 'utf8')) as { blocos: Bloco[]; secoes: Secao[] };
const j18 = JSON.parse(readFileSync(new URL('./fixtures/j18.json', import.meta.url), 'utf8')) as { snapshot: SnapshotDoCapitulo; modos: ModoDeLeituraV1[] };

const DOC = '0000000000000000000000EX01';
const VERSAO = j18.snapshot.versao_id;
const secao = canonico.secoes[0]!;
function marca(id: string, bloco: string, citacao: string, funcao: string, rotulo: string, texto: string) {
  const b = canonico.blocos.find((x) => x.id === bloco)!;
  const inicio = b.texto.indexOf(citacao);
  assert.ok(inicio >= 0, citacao);
  return { ...j18.snapshot.marcas[0]!, id, funcao, saliencia: 1,
    ancora: { versao_id: VERSAO, bloco_id: bloco, inicio_utf16: inicio, fim_utf16: inicio + citacao.length, citacao, prefixo: b.texto.slice(Math.max(0, inicio - 32), inicio), sufixo: b.texto.slice(inicio + citacao.length, inicio + citacao.length + 32) },
    comentario: { tipo: 'LEITURA', rotulo, texto } };
}
const MARCAS = [
  marca('0000000000000000000000MK01', '6YV4J9DYQ0SNRB5BGX3BRE7CKX', 'toda cheia de si, toda enrolada', 'imagem', 'O novelo vira vaidade', 'A forma do novelo dá corpo ao orgulho que a agulha acusa.'),
  marca('0000000000000000000000MK02', '577JG0QK2244W275R3443RZSH1', 'Agulha não tem cabeça.', 'voz', 'A linha devolve o golpe', 'O trocadilho com a cabeça do alfinete mostra quem domina a conversa.'),
  marca('0000000000000000000000MK03', '0VAHSM8GY6XF1BZZW8X8TFYRTG', 'obedecendo ao que eu faço e mando', 'virada', 'Quem manda em quem', 'A agulha inverte a hierarquia: abrir caminho seria mandar.'),
];
const snapshotDe = (marcas: unknown[]): SnapshotDoCapitulo => ({ ...j18.snapshot, documento_id: DOC, versao_id: VERSAO,
  secao: { id: secao.id, titulo: secao.titulo, ordem: 0, nivel: 1, bloco_inicio: secao.bloco_inicio, bloco_fim: secao.bloco_fim },
  blocos: canonico.blocos, marcas, anotacoes: [], conversas: [], conexoes: [] } as SnapshotDoCapitulo);

const pasta = resolve('../docs/ui-revisao/onboarding');
mkdirSync(pasta, { recursive: true });
const PORTA = 5202;
const servidor = await preview({ configLoader: 'runner', preview: { host: '127.0.0.1', port: PORTA, strictPort: true } });
const base = `http://127.0.0.1:${String(PORTA)}`;
const erros: string[] = [];

interface Cena { documentos: boolean; marcas: unknown[]; pronto: boolean; estadoDoc: string }
function item(cena: Cena) {
  return { id: DOC, titulo: 'Um apólogo', autor: 'Machado de Assis', formato: 'md', criado_em: '2026-10-01T12:00:00Z', arquivado_em: null,
    versao_id: cena.pronto ? VERSAO : null, texto_disponivel: cena.pronto, estado: cena.pronto ? cena.estadoDoc : 'canonizando', detalhe: null, partes_prontas: 0, partes_total: 0,
    marcas: { tese: 0, conceito: 0, justificativa: 0, nenhuma: 0, total: cena.marcas.length }, progresso: null, jobs_em_curso: cena.pronto ? 0 : 1, midia: null };
}
async function simular(pagina: Page, cena: Cena): Promise<void> {
  await pagina.route('**/*', async (rota) => {
    const url = new URL(rota.request().url());
    if (url.origin !== base) return rota.abort();
    if (!url.pathname.startsWith('/api/')) return rota.continue();
    const caminho = url.pathname; const metodo = rota.request().method();
    const responder = (json: unknown, status = 200) => rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
    if (caminho === '/api/documentos' && metodo === 'POST') { cena.documentos = true; return responder({ documento_id: DOC, job_id: '0000000000000000000000JB01' }, 201); }
    if (caminho === '/api/documentos') return responder({ documentos: cena.documentos && url.searchParams.get('arquivados') !== '1' ? [item(cena)] : [] });
    if (caminho === `/api/documentos/${DOC}`) return responder({ ...item(cena), versoes: [], execucoes: [], jobs: [], exportacoes: [] });
    if (caminho === '/api/modos') return responder({ modos: j18.modos });
    if (caminho.endsWith('/progresso')) return responder({ progresso: null });
    if (caminho.endsWith('/secoes')) return responder({ versao_id: VERSAO, documento_id: DOC, titulo: 'Um apólogo', secoes: [], capitulos: [{ id: secao.id, titulo: secao.titulo }], limites: [] });
    if (caminho.endsWith('/midias')) return responder({ midias: [] });
    if (caminho.endsWith('/audios')) return responder({ audios: [] });
    if (caminho.endsWith('/visuais')) return responder({ visuais: [] });
    if (caminho.includes('/capitulos/')) return responder(snapshotDe(cena.marcas));
    if (caminho.endsWith('/camadas')) return responder({ camadas: [], preferencias: { primeiro_eu: false, camada_padrao: null } });
    if (caminho.endsWith('/compreensoes')) return responder({ versao_id: VERSAO, compreensoes: [] });
    if (caminho.endsWith('/etiquetas')) return responder({ etiquetas: [], sugestoes: [] });
    if (caminho.endsWith('/resolucoes')) return responder({ resolucoes: [] });
    if (caminho === '/api/perfil') return responder({ perfil: null, hash: '' });
    if (caminho === '/api/eventos') return rota.fulfill({ contentType: 'text/event-stream', body: 'retry: 600000\n\n' });
    if (caminho === '/api/estado-instalacao') return responder(INSTALACAO_PRONTA);
    erros.push(`Rota não simulada: ${metodo} ${caminho}`);
    return responder({});
  });
}
async function captura(pagina: Page, prefixo: string, nome: string): Promise<void> {
  await pagina.evaluate(() => document.fonts.ready);
  await pagina.waitForTimeout(150);
  assert.equal(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `sem rolagem horizontal em ${nome}`);
  await pagina.screenshot({ path: join(pasta, `${prefixo}-${nome}.png`) });
  console.log(`captura: ${prefixo}-${nome}.png`);
}
const estadoGuardado = (parcial: Record<string, unknown>) => JSON.stringify({ versao: 1, boas_vindas: 'pendente', tela: 0,
  primeiro_documento: { estado: 'pendente', origem: null, documento_id: null }, exemplo_id: null, tour: 'pendente', dica: 0, levar: 'pendente',
  atualizado_em: '2026-10-01T12:00:00.000Z', ...parcial });

const navegador = await chromium.launch();
try {
  for (const colorScheme of ['dark', 'light'] as const) for (const [tela, width, height] of [['1680', 1680, 1050], ['390', 390, 844]] as const) {
    const prefixo = `${colorScheme === 'dark' ? 'escuro' : 'claro'}-${tela}`;
    const contexto = await navegador.newContext({ viewport: { width, height }, colorScheme, reducedMotion: 'reduce' });

    // 1. Primeira abertura: boas-vindas, exemplo sendo preparado, tour com marcas, primeiros passos.
    const pagina = await contexto.newPage();
    pagina.setDefaultTimeout(15000);
    pagina.on('pageerror', (e) => erros.push(`${prefixo}: ${e.stack ?? e.message}`));
    const cena: Cena = { documentos: false, marcas: MARCAS, pronto: false, estadoDoc: 'pronto' };
    await simular(pagina, cena);
    await pagina.goto(`${base}/`);
    const dialogo = pagina.locator('.boas-vindas[role=dialog]');
    await dialogo.waitFor();
    await captura(pagina, prefixo, '01-boas-vindas');
    await dialogo.getByRole('button', { name: /Continuar/ }).click();
    await captura(pagina, prefixo, '02-como-se-le');
    await dialogo.getByRole('button', { name: /Continuar/ }).click();
    await captura(pagina, prefixo, '03-primeiro-texto');
    await dialogo.getByRole('button', { name: /Abrir um texto de exemplo/ }).click();
    await pagina.getByText('Preparando o texto… leva alguns segundos.').first().waitFor();
    await captura(pagina, prefixo, '04-preparando-exemplo');
    cena.pronto = true;
    await pagina.waitForURL(/\/ler\//);
    await pagina.locator('.camada-de-marcas path').first().waitFor();
    const dica = pagina.locator('.dica-ancorada');
    for (const [indice, nome] of ['marcas', 'margem', 'aparencia', 'perguntar', 'retomada'].entries()) {
      await dica.waitFor();
      assert.equal(await dica.getAttribute('role'), 'dialog');
      assert.equal(await pagina.evaluate(() => document.activeElement?.closest('.dica-ancorada') !== null), true, 'foco dentro da dica');
      const caixa = await dica.boundingBox(); assert.ok(caixa);
      assert.ok(caixa.x >= 0 && caixa.x + caixa.width <= width && caixa.y >= 0 && caixa.y + caixa.height <= height, `dica ${nome} dentro da janela`);
      await captura(pagina, prefixo, `${String(5 + indice).padStart(2, '0')}-dica-${nome}`);
      await pagina.getByRole('button', { name: indice === 4 ? 'Concluir' : 'Próxima' }).click();
    }
    assert.equal(await dica.count(), 0);
    await pagina.goto(`${base}/primeiros-passos`);
    await pagina.getByRole('heading', { name: 'Primeiros passos' }).waitFor();
    await captura(pagina, prefixo, '10-primeiros-passos');
    await pagina.locator('#levar').scrollIntoViewIfNeeded();
    await captura(pagina, prefixo, '11-leve-com-voce');
    await pagina.goto(`${base}/ajuda/extensao`);
    await pagina.getByRole('heading', { name: 'Extensão de navegador' }).waitFor();
    await captura(pagina, prefixo, '12-ajuda-extensao');
    await pagina.close();

    // 2. Boas-vindas puladas, biblioteca vazia: o estado vazio conduz ao primeiro texto.
    const vazia = await contexto.newPage();
    vazia.on('pageerror', (e) => erros.push(`${prefixo}: ${e.stack ?? e.message}`));
    await simular(vazia, { documentos: false, marcas: [], pronto: false, estadoDoc: 'pronto' });
    await vazia.addInitScript((valor) => { localStorage.setItem('margem:onboarding:v1:local', valor); }, estadoGuardado({ boas_vindas: 'pulada' }));
    await vazia.goto(`${base}/`);
    await vazia.getByRole('heading', { name: 'Nenhum texto ainda.' }).waitFor();
    assert.equal(await vazia.getByRole('dialog').count(), 0);
    await captura(vazia, prefixo, '13-inicio-vazio');
    await vazia.goto(`${base}/biblioteca`);
    await vazia.getByRole('heading', { name: 'Nenhum texto ainda.' }).waitFor();
    await captura(vazia, prefixo, '14-biblioteca-vazia');
    await vazia.close();

    // 3. Tour num texto ainda sem marcas: a primeira dica diz como pedi-las.
    const semMarcas = await contexto.newPage();
    semMarcas.on('pageerror', (e) => erros.push(`${prefixo}: ${e.stack ?? e.message}`));
    await simular(semMarcas, { documentos: true, marcas: [], pronto: true, estadoDoc: 'pronto' });
    await semMarcas.addInitScript((valor) => { localStorage.setItem('margem:onboarding:v1:local', valor); }, estadoGuardado({ boas_vindas: 'concluida' }));
    await semMarcas.goto(`${base}/ler/${DOC}/${secao.id}`);
    await semMarcas.getByText(/ainda não tem marcas/).waitFor();
    await captura(semMarcas, prefixo, '15-dica-sem-marcas');
    await semMarcas.keyboard.press('Escape');
    assert.equal(await semMarcas.locator('.dica-ancorada').count(), 0, 'Esc fecha o tour');
    assert.equal(await semMarcas.evaluate(() => (JSON.parse(localStorage.getItem('margem:onboarding:v1:local') ?? '{}') as { tour?: string }).tour), 'pulada');
    await semMarcas.close();
    await contexto.close();
  }
  assert.deepEqual(erros, []);
  console.log('onboarding: capturas conferidas');
} finally {
  await navegador.close();
  await new Promise<void>((resolver) => { servidor.httpServer.close(() => resolver()); });
}
