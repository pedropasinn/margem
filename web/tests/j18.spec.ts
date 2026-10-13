import { escolherOpcao, abrirOpcoes } from './controles.ts';
import { INSTALACAO_PRONTA } from './estado-instalacao.ts';
/** J18 sobre dist. Toda rota /api é interceptada; não há serviço nem banco de teste. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { preview } from 'vite';
import type { AncoraV1, AnotacaoV1, ConexaoV2, ConversaV2, ModoDeLeituraV1 } from '@margem/contratos';
import type { SnapshotDoCapitulo } from '../src/biblioteca/tipos.ts';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/j18.json', import.meta.url), 'utf8')) as { snapshot: SnapshotDoCapitulo; modos: ModoDeLeituraV1[] };
const pasta = new URL('./capturas/', import.meta.url);
mkdirSync(pasta, { recursive: true });
const servidor = await preview({ configLoader: 'runner', preview: { host: '127.0.0.1', port: 5192, strictPort: true } });
let navegador: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const base = 'http://127.0.0.1:5192';
const erros: string[] = [];
async function selecionar(pagina: Page, bloco: string, inicio: number, fim: number): Promise<void> {
  await pagina.locator(`[data-bloco="${bloco}"]`).scrollIntoViewIfNeeded();
  await pagina.evaluate(({ bloco, inicio, fim }) => {
    const elemento = document.querySelector(`[data-bloco="${bloco}"]`)!;
    const nos = document.createTreeWalker(elemento, NodeFilter.SHOW_TEXT);
    const pontos: { no: Node; inicio: number; fim: number }[] = [];
    let offset = 0;
    for (let no = nos.nextNode(); no; no = nos.nextNode()) {
      pontos.push({ no, inicio: offset, fim: offset + (no.textContent?.length ?? 0) });
      offset += no.textContent?.length ?? 0;
    }
    const a = pontos.find((p) => p.inicio <= inicio && inicio < p.fim)!;
    const b = pontos.find((p) => p.inicio < fim && fim <= p.fim)!;
    const range = document.createRange(); range.setStart(a.no, inicio - a.inicio); range.setEnd(b.no, fim - b.inicio);
    const selecao = window.getSelection()!; selecao.removeAllRanges(); selecao.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, { bloco, inicio, fim });
  await pagina.getByRole('toolbar', { name: 'Ações da seleção' }).waitFor();
}
async function captura(pagina: Page, nome: string): Promise<void> {
  await pagina.evaluate(() => document.fonts.ready);
  assert.equal(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'sem rolagem horizontal');
  await pagina.screenshot({ path: new URL(`j18-${nome}.png`, pasta).pathname });
  console.log(`captura: j18-${nome}.png`);
}
try {
  navegador = await chromium.launch();
  for (const [tela, width, height] of [['desktop', 1440, 900], ['celular', 412, 915]] as const) {
    const pagina = await navegador.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    pagina.setDefaultTimeout(10000);
    pagina.on('pageerror', (e) => erros.push(e.message));
    const snapshot = structuredClone(fixture.snapshot);
    const { documento_id: d, versao_id: v, secao } = snapshot;
    const anotacoes: AnotacaoV1[] = [];
    const conexoes: ConexaoV2[] = [];
    let conversa: ConversaV2 | null = null;
    let respondida = false;
    let primeiroEu = false;
    let camada = snapshot.camada;
    let escritas = 0;
    let consultasConversa = 0;
    let liberarEvento: () => void = () => {};
    const evento = new Promise<void>((resolver) => { liberarEvento = resolver; });
    const uid = (n: number) => String(n).padStart(26, '0');
    await pagina.route('**/*', async (rota) => {
      const url = new URL(rota.request().url());
      if (url.origin !== base) { await rota.abort(); return; }
      if (!url.pathname.startsWith('/api/')) { await rota.continue(); return; }
      const caminho = url.pathname;
      const metodo = rota.request().method();
      const corpo = metodo === 'GET' || metodo === 'DELETE' ? {} : rota.request().postDataJSON() as Record<string, unknown>;
      if (metodo !== 'GET') { escritas++; assert.equal(rota.request().headers()['x-margem'], '1'); }
      const responder = (json: unknown, status = 200) => rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
      if (caminho === '/api/modos') return responder({ modos: fixture.modos });
      if (caminho === `/api/documentos/${d}`) return responder({ id: d, titulo: secao.titulo, autor: 'Machado de Assis', formato: 'md', criado_em: '2026-09-24T12:00:00Z', versao_id: v, texto_disponivel: true, estado: 'pronto', detalhe: null, partes_prontas: 1, partes_total: 1, marcas: { tese: 0, conceito: 0, justificativa: 0, nenhuma: 0, total: 4 }, progresso: null, jobs_em_curso: 0, versoes: [], execucoes: [], jobs: [], exportacoes: [] });
      if (caminho.endsWith('/progresso')) return responder({ progresso: metodo === 'GET' ? null : { ...corpo, revisao: Number(corpo['revisao_esperada'] ?? 0) + 1 } });
      if (caminho.endsWith('/secoes')) return responder({ versao_id: v, documento_id: d, titulo: secao.titulo, secoes: [], capitulos: [{ id: secao.id, titulo: secao.titulo }], limites: [] });
      if (caminho.includes('/capitulos/')) {
        const solicitada = url.searchParams.get('camada') ?? camada;
        return responder({ ...snapshot, camada: solicitada, marcas: primeiroEu && !anotacoes.length ? [] : solicitada === snapshot.camadas?.[1]?.id ? [] : snapshot.marcas, anotacoes, conexoes, primeiro_eu: { ativo: primeiroEu, liberado: !primeiroEu || anotacoes.length > 0 }, conversas: conversa ? [{ ...conversa, mensagens: conversa.mensagens.length, ultima: conversa.mensagens.at(-1) }] : [] });
      }
      if (caminho.endsWith('/preferencias')) {
        if (typeof corpo['primeiro_eu'] === 'boolean') primeiroEu = corpo['primeiro_eu'];
        if (typeof corpo['camada_padrao'] === 'string') camada = corpo['camada_padrao'];
        return responder({ preferencias: { primeiro_eu: primeiroEu, camada_padrao: camada } });
      }
      if (caminho === '/api/anotacoes' && metodo === 'POST') {
        const a = { ...corpo, versao: 1, versao_id: v, id: uid(201), criada_em: '2026-09-24T12:00:00Z', atualizada_em: '2026-09-24T12:00:00Z' } as AnotacaoV1;
        anotacoes.push(a); return responder({ anotacao: a }, 201);
      }
      if (caminho.startsWith('/api/anotacoes/') && metodo === 'PATCH') {
        Object.assign(anotacoes[0]!, corpo); return responder({ anotacao: anotacoes[0] });
      }
      if (caminho.startsWith('/api/anotacoes/') && metodo === 'DELETE') { anotacoes.length = 0; return responder({ apagada: true }); }
      if (caminho === '/api/conversas' && metodo === 'POST') {
        conversa = { versao: 2, id: uid(301), versao_id: v, ancora: corpo['ancora'] as AncoraV1, criada_em: '2026-09-24T12:00:00Z', estado: 'aberta', mensagens: [{ id: uid(302), autor: 'leitor', texto: typeof corpo['pergunta'] === 'string' ? corpo['pergunta'] : '', criada_em: '2026-09-24T12:00:00Z' }] };
        return responder({ conversa, job_id: uid(303) }, 201);
      }
      if (caminho.startsWith('/api/conversas/') && metodo === 'GET') {
        consultasConversa++;
        return responder({ conversa, pendentes: respondida ? [] : [{ mensagem_id: uid(302), job_id: uid(303), estado: 'reservado' }] });
      }
      if (caminho === '/api/eventos') {
        await evento;
        return rota.fulfill({ contentType: 'text/event-stream', body: `retry: 60000\nevent: resposta_publicada\ndata: ${JSON.stringify({ documento_id: d, job_tipo: 'responder' })}\n\n` });
      }
      if (caminho === '/api/conexoes' && metodo === 'POST') {
        const c = { ...corpo, id: uid(500 + conexoes.length), versao: 2, autor: 'leitor', estado: 'aceita', criada_em: '2026-09-24T12:00:00Z', decidida_em: '2026-09-24T12:00:00Z' } as ConexaoV2;
        conexoes.push(c); return responder({ conexao: c }, 201);
      }
      if (caminho.endsWith('/decidir')) {
        const c = conexoes.find((c) => caminho.includes(c.id))!;
        Object.assign(c, { estado: corpo['estado'], decidida_em: '2026-09-24T12:01:00Z' });
        return responder({ conexao: c });
      }
      if (caminho === '/api/estado-instalacao') return responder(INSTALACAO_PRONTA);
      erros.push(`Rota não simulada: ${metodo} ${caminho}`);
      return responder({ erro: 'rota_nao_simulada' }, 500);
    });
    await pagina.goto(`${base}/ler/${d}/${secao.id}`);
    await pagina.locator('.bloco-estrofe').first().waitFor();
    assert.equal(await pagina.locator('.bloco-estrofe').count(), 4);
    for (const bloco of snapshot.blocos) assert.equal(await pagina.locator(`[data-bloco="${bloco.id}"]`).textContent(), bloco.texto);
    assert.ok(await pagina.locator('.camada-de-marcas path').count() > 0);
    await captura(pagina, `soneto-${tela}`);
    const a = snapshot.marcas[0]!.ancora;
    const antes = escritas;
    await selecionar(pagina, a.bloco_id, a.inicio_utf16, a.fim_utf16);
    assert.equal(escritas, antes, 'selecionar não grava anotação');
    await captura(pagina, `selecao-${tela}`);
    await pagina.keyboard.press('Escape');
    await abrirOpcoes(pagina);
    await pagina.getByRole('switch', { name: 'Primeiro eu' }).check();
    await pagina.getByRole('button', { name: 'Fechar opções' }).click();
    await pagina.getByText('As marcas da IA aparecem depois da sua primeira anotação neste capítulo').waitFor();
    assert.equal(await pagina.locator('span[data-marcas]').count(), 0);
    await selecionar(pagina, a.bloco_id, a.inicio_utf16, a.fim_utf16);
    await pagina.keyboard.press('a');
    await pagina.getByRole('textbox', { name: 'Sua anotação', exact: true }).fill('O desejo passa de uma luz a outra.');
    await pagina.getByRole('button', { name: 'Salvar anotação' }).click();
    await pagina.getByText('P · Impressão').waitFor();
    await pagina.waitForFunction(() => document.querySelector('span[data-marcas]') !== null);
    assert.equal(anotacoes[0]!.ancora.citacao, a.citacao);
    assert.equal(await pagina.locator('[data-pessoal] .nota-numero').count(), 0);
    if (tela === 'celular') await pagina.locator('[data-pessoal]').first().scrollIntoViewIfNeeded();
    else await pagina.evaluate(() => window.scrollTo(0, 0));
    await captura(pagina, `anotacao-${tela}`);
    await selecionar(pagina, a.bloco_id, a.inicio_utf16, a.fim_utf16);
    await pagina.keyboard.press('p');
    if (tela === 'desktop') await pagina.getByRole('button', { name: 'Ampliar conversa' }).click();
    await pagina.getByLabel('Sua pergunta').fill('Por que o vaga-lume fecha o círculo?');
    await pagina.getByRole('button', { name: 'Enviar pergunta' }).click();
    await pagina.getByText('lendo o capítulo…').waitFor();
    const ultima = snapshot.marcas[3]!.ancora;
    assert.ok(conversa);
    const fio = conversa as ConversaV2;
    fio.mensagens.push({ id: uid(304), autor: 'ia', texto: 'O sol deseja a condição do vaga-lume; o último verso retoma o primeiro.', citacoes: [ultima], criada_em: '2026-09-24T12:01:00Z' });
    conexoes.push({ versao: 2, id: uid(401), origem: a, destino: { tipo: 'trecho', ancora: ultima }, relacao: 'contraste', justificativa: 'O astro mais luminoso deseja a luz mais frágil.', autor: 'ia', estado: 'sugerida', conversa_id: fio.id, criada_em: '2026-09-24T12:01:00Z' });
    respondida = true; liberarEvento();
    await pagina.getByText('O sol deseja a condição do vaga-lume; o último verso retoma o primeiro.').waitFor();
    assert.ok(consultasConversa >= 2, 'evento releu a conversa');
    await pagina.getByRole('button', { name: `“${ultima.citacao}”` }).click();
    await pagina.locator('[data-desenho="citacao-temporaria"] path').first().waitFor();
    await captura(pagina, `conversa-citacao-${tela}`);
    await pagina.getByRole('dialog').getByRole('button', { name: 'Aceitar', exact: true }).click();
    await pagina.waitForFunction(() => !document.querySelector('.ui-drawer')?.textContent?.includes('sugerida pela IA'));
    assert.equal(conexoes[0]!.estado, 'aceita');
    await pagina.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).click();
    if (tela === 'celular') await abrirOpcoes(pagina);
    await pagina.getByRole('radio', { name: '1', exact: true }).click();
    if (tela === 'celular') await pagina.getByRole('button', { name: 'Fechar opções' }).click();
    await pagina.evaluate(() => window.scrollTo(0, 0));
    await captura(pagina, `camada-nivel1-${tela}`);
    assert.equal(await pagina.locator('.marca-voz').count(), 0);
    assert.ok(await pagina.locator('.marca-imagem').count() > 0);
    await pagina.reload();
    if (tela === 'celular') await abrirOpcoes(pagina);
    assert.equal(await pagina.getByRole('radio', { name: '1', exact: true }).getAttribute('aria-checked'), 'true');
    // A camada mora em "•••" (pedido de produto, 24/09): abrir o menu se o seletor não estiver à vista.
    const garantirCamada = async () => { if (!(await pagina.getByRole('combobox', { name: 'Camada de marcas' }).isVisible())) await abrirOpcoes(pagina); };
    await garantirCamada();
    await pagina.getByRole('combobox', { name: 'Camada de marcas' }).click();
    await pagina.getByRole('option').last().click();
    await pagina.waitForFunction(() => document.querySelectorAll('span[data-marcas]').length === 0);
    assert.equal(camada, snapshot.camadas![1]!.id);
    await garantirCamada();
    await escolherOpcao(pagina, 'Camada de marcas', 'Todas');
    await pagina.waitForFunction(() => document.querySelector('span[data-marcas]') !== null);
    await pagina.close();
  }
  assert.deepEqual(erros, []);
  console.log('J18: seleção, UTF-16, primeiro eu, anotação, SSE, citação SVG, sugestão, camadas, atenção e persistência conferidos.');
} finally {
  await navegador?.close();
  await servidor.close();
}
