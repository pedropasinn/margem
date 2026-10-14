/** Régua editorial J21, somente dist + fixtures locais. Nenhuma rota alcança a API real. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { preview } from 'vite';
import type { ModoDeLeituraV1 } from '@margem/contratos';
import type { DetalheDoDocumento, SnapshotDoCapitulo } from '../src/biblioteca/tipos.ts';
import { abrirOpcoes, escolherOpcao } from './controles.ts';
import { INSTALACAO_PRONTA } from './estado-instalacao.ts';
const dados = JSON.parse(readFileSync(new URL('./fixtures/j20.json', import.meta.url), 'utf8')) as { poema: SnapshotDoCapitulo; prosa: SnapshotDoCapitulo; modos: ModoDeLeituraV1[] };
const pasta = new URL('../../docs/ui-revisao/j21/', import.meta.url);
mkdirSync(pasta, { recursive: true });
const base = 'http://127.0.0.1:5194';
const servidor = await preview({ configLoader: 'runner', preview: { host: '127.0.0.1', port: 5194, strictPort: true } });
let navegador: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const erros: string[] = []; const geradas: string[] = [];
function documento(s: SnapshotDoCapitulo, livro: boolean): DetalheDoDocumento {
  return { id: s.documento_id, titulo: livro ? 'A Field Guide to Maps' : s.secao.titulo, autor: livro ? 'Autora de Teste' : 'Machado de Assis', formato: livro ? 'pdf' : 'md', criado_em: '2026-09-24T12:00:00Z', versao_id: s.versao_id, texto_disponivel: true, estado: 'pronto', detalhe: 'processo', partes_prontas: 1, partes_total: 1, marcas: { tese: livro ? 1 : 0, conceito: livro ? 1 : 0, justificativa: livro ? 1 : 0, nenhuma: 0, total: s.marcas.length }, progresso: livro ? { capitulos_concluidos: 1, atualizado_em: '2026-09-24T12:00:00Z' } : null, jobs_em_curso: 0,
    versoes: [{ id: s.versao_id, numero: 1, criado_em: '2026-09-24T12:00:00Z', motor: 'margem-ingest/1', hash_estrutural: 'a'.repeat(64), blocos: s.blocos.length, secoes: livro ? 21 : 1, assets: 0, limites: ['Figura na página PDF 1; consultar o original.'] }],
    execucoes: [{ id: 'execucao', versao_id: s.versao_id, modelo: 'executor-falso', esforco: 'high', criada_em: '2026-09-24T12:00:00Z', partes_total: 1, partes_prontas: 1 }], jobs: [{ id: 'job', tipo: 'revisar_consistencia', estado: 'falhou', attempt: 1, error_code: 'processo', not_before: null, atualizado_em: '2026-09-24T12:00:00Z' }], exportacoes: [] };
}
async function simular(pagina: Page) {
  await pagina.route('**/*', async (rota) => {
    const url = new URL(rota.request().url());
    if (url.origin !== base) return rota.abort();
    if (!url.pathname.startsWith('/api/')) return rota.continue();
    const responder = (json: unknown, status = 200) => rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
    const caminho = url.pathname;
    if (rota.request().method() !== 'GET') {
      if (caminho.endsWith('/progresso')) { const corpo = rota.request().postDataJSON() as { revisao_esperada: number }; return responder({ progresso: { ...corpo, revisao: corpo.revisao_esperada + 1 } }); }
      erros.push(`Escrita inesperada: ${caminho}`); return responder({ erro: 'escrita_nao_simulada' }, 500);
    }
    if (caminho === '/api/modos') return responder({ modos: dados.modos });
    if (caminho === '/api/documentos') return responder({ documentos: [documento(dados.poema, false), documento(dados.prosa, true)] });
    const s = caminho.includes(dados.prosa.documento_id) || caminho.includes(dados.prosa.versao_id) ? dados.prosa : dados.poema;
    const livro = s === dados.prosa;
    if (caminho === `/api/documentos/${s.documento_id}`) return responder(documento(s, livro));
    if (caminho.endsWith('/camadas')) return responder({ camadas: s.camadas, preferencias: { primeiro_eu: false, camada_padrao: s.camada } });
    if (caminho.endsWith('/progresso')) return responder({ progresso: null });
    if (caminho.endsWith('/secoes')) return responder({ versao_id: s.versao_id, documento_id: s.documento_id, titulo: s.secao.titulo, secoes: [], limites: [], capitulos: Array.from({ length: livro ? 21 : 1 }, (_, i) => ({ id: i === 0 ? s.secao.id : String(800 + i).padStart(26, '0'), titulo: i === 0 ? s.secao.titulo : `Capítulo ${i + 1}` })) });
    if (caminho.includes('/capitulos/')) return responder(s);
    if (caminho === '/api/estado-instalacao') return responder(INSTALACAO_PRONTA);
    erros.push(`Rota não simulada: ${caminho}`); return responder({ erro: 'rota_nao_simulada' }, 500);
  });
}
async function regua(pagina: Page) {
  await pagina.evaluate(async () => { await document.fonts.ready; await new Promise<void>((resolver) => requestAnimationFrame(() => requestAnimationFrame(() => resolver()))); });
  const falhas = await pagina.evaluate(() => {
    const lista: string[] = [];
    const visivel = (e: Element) => { const r = e.getBoundingClientRect(); const css = getComputedStyle(e); return r.width > 0 && r.height > 0 && css.visibility !== 'hidden' && css.display !== 'none'; };
    if (document.documentElement.scrollWidth > innerWidth + 1) lista.push('rolagem horizontal');
    for (const e of document.querySelectorAll('select,input[type=file],input[type=checkbox],button:not(.ui-button)')) if (visivel(e)) lista.push(`controle nativo/ad hoc: ${e.outerHTML.slice(0, 100)}`);
    for (const e of document.querySelectorAll('.card .card,.hero-card .card')) if (visivel(e)) lista.push('card dentro de card');
    for (const e of document.querySelectorAll('button')) if (visivel(e) && innerWidth < 900 && (e.getBoundingClientRect().height < 40 || e.getBoundingClientRect().width < 40)) lista.push(`alvo menor que 40 px: ${e.textContent}`);
    const artigo = document.querySelector('.capitulo');
    if (artigo && innerWidth >= 1440) {
      const texto = artigo.getBoundingClientRect(); const margem = document.querySelector('.margem')?.getBoundingClientRect();
      // 850 px por padrão (pedido de produto, 24/09), limitado a 100vw − 48 px.
      if (texto.width < 840 || texto.width > 860) lista.push(`coluna: ${texto.width}px`);
      if (Math.abs(texto.left + texto.width / 2 - innerWidth / 2) > 4) lista.push('texto fora do centro da viewport');
      const documento = document.querySelector('.documento-na-barra')?.getBoundingClientRect();
      const acoes = document.querySelector('.filtros > button[aria-label="Marcas e opções"]')?.getBoundingClientRect();
      // Decisão de produto (24/09, tarde): a barra se divide nos extremos da página (voltar e capítulos
      // à esquerda; camada, atenção, aparência e opções à direita) e a casca some com um texto aberto.
      if (documento && Math.abs(documento.left - 24) > 4) lista.push('voltar não está no extremo esquerdo');
      if (acoes && Math.abs(innerWidth - acoes.right - 24) > 6) lista.push('opções não estão no extremo direito');
      const header = document.querySelector('.app-shell > .topbar');
      if (header && visivel(header)) lista.push('header da casca aparece com um texto aberto');
      if (margem && (margem.right > innerWidth || margem.width < 220 || margem.width > 340 || margem.left - texto.right < 36 || margem.left - texto.right > 44)) lista.push('largura/intervalo da margem');
    }
    if (artigo && getComputedStyle(artigo).color === 'rgb(255, 255, 255)') {
      const rgb = (cor: string) => cor.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const fundo = rgb(getComputedStyle(artigo).backgroundColor);
      const luminancia = (cor: number[]) => cor.reduce((soma, c, i) => {
        const s = c / 255;
        return soma + (s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4) * [ .2126, .7152, .0722 ][i]!;
      }, 0);
      for (const faixa of artigo.querySelectorAll('.traco-faixa')) {
        const css = getComputedStyle(faixa); const cor = rgb(css.fill); const alfa = Number(css.opacity);
        const composto = fundo.map((b, i) => b + alfa * cor[i]! * (1 - b / 255));
        const contraste = 1.05 / (luminancia(composto) + .05);
        if (contraste < 4.5) lista.push(`contraste da faixa: ${contraste.toFixed(2)}:1`);
      }
    }
    if (artigo && innerWidth < 900) {
      for (const verso of artigo.querySelectorAll('.verso')) {
        const caixa = verso.getBoundingClientRect(); const fonte = parseFloat(getComputedStyle(verso).fontSize);
        const nos = document.createTreeWalker(verso, NodeFilter.SHOW_TEXT); let topo: number | undefined;
        for (let no = nos.nextNode(); no; no = nos.nextNode()) for (let i = 0; i < no.textContent!.length; i++) {
          if (/\s/.test(no.textContent![i]!)) continue;
          const r = document.createRange(); r.setStart(no, i); r.setEnd(no, i + 1); const letra = r.getBoundingClientRect();
          topo ??= letra.top;
          if (letra.top > topo + 2 && letra.left < caixa.left + fonte - 1) lista.push('continuação de verso sem recuo');
        }
      }
      if (artigo.querySelector('.bloco-estrofe')) {
        const titulo = artigo.querySelector('.titulo-da-secao');
        if (titulo && parseFloat(getComputedStyle(titulo).fontSize) > 30) lista.push('título do poema grande demais');
      }
    }
    const notas = [...document.querySelectorAll<HTMLElement>('[data-nota]')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    for (let i = 0; i < notas.length; i++) {
      const n = notas[i]!; const id = n.dataset['nota']; const trecho = document.querySelector(`[data-marcas~="${id}"]`);
      if (trecho) { const r = document.createRange(); r.selectNodeContents(trecho); if (n.getBoundingClientRect().top + 1 < r.getBoundingClientRect().top) lista.push(`nota acima da âncora: ${id}`); }
      const anterior = notas[i - 1]; if (anterior && n.getBoundingClientRect().top - anterior.getBoundingClientRect().bottom < 20) lista.push('notas sem intervalo mínimo');
    }
    const prosa = document.querySelector('.bloco-paragrafo');
    if (prosa && innerWidth >= 1200) {
      const nos = document.createTreeWalker(prosa, NodeFilter.SHOW_TEXT); let topo: number | null = null; let primeiraLinha = ''; let terminou = false;
      for (let no = nos.nextNode(); no && !terminou; no = nos.nextNode()) for (let i = 0; i < (no.textContent?.length ?? 0); i++) {
        const r = document.createRange(); r.setStart(no, i); r.setEnd(no, i + 1); const caixa = r.getBoundingClientRect(); topo ??= caixa.top;
        if (Math.abs(caixa.top - topo) > 2) { terminou = true; break; } primeiraLinha += no.textContent![i];
      }
      // Espaços depois da última palavra não ocupam a linha impressa.
      const caracteres = primeiraLinha.trimEnd().length;
      // Com 850 px e serifa de 22 px, ~85 caracteres (escolha de produto, 24/09, no lugar de 62–72).
      if (caracteres < 80 || caracteres > 96) lista.push(`prosa: ${caracteres} caracteres na primeira linha, esperado 80–96 (justificado e hifenizado)`);
    }
    return lista;
  });
  assert.deepEqual(falhas, []);
}
/** Todas as combinações: notas visíveis/recolhidas/ausentes e rail aberta/fechada. */
async function conferirGeometria(pagina: Page) {
  const medir = async () => {
    const caixa = await pagina.locator('.capitulo').boundingBox();
    assert.ok(caixa);
    assert.ok(Math.abs(caixa.x + caixa.width / 2 - pagina.viewportSize()!.width / 2) <= 4, JSON.stringify(caixa));
    return caixa;
  };
  const inicial = await medir();
  for (const notas of ['Mostrar notas', 'Recolher em números']) {
    await abrirOpcoes(pagina); await escolherOpcao(pagina, 'Margem', notas);
    await pagina.getByRole('button', { name: 'Fechar opções' }).click();
    for (const rail of [false, true]) {
      if (rail) await pagina.getByRole('button', { name: 'Capítulos', exact: true }).click();
      const atual = await medir(); assert.equal(atual.x, inicial.x); assert.equal(atual.width, inicial.width);
      if (rail) await pagina.getByRole('dialog', { name: 'Capítulos' }).getByRole('button', { name: 'Fechar', exact: true }).click();
    }
  }
  // Ausência efetiva de margem também não pode participar do cálculo do artigo.
  await pagina.locator('.margem').evaluate((e) => { e.setAttribute('hidden', ''); });
  await medir();
  await pagina.getByRole('button', { name: 'Capítulos', exact: true }).click(); await medir();
  await pagina.getByRole('dialog', { name: 'Capítulos' }).getByRole('button', { name: 'Fechar', exact: true }).click();
  await pagina.locator('.margem').evaluate((e) => { e.removeAttribute('hidden'); });
  await abrirOpcoes(pagina); await escolherOpcao(pagina, 'Margem', 'Mostrar notas');
  await pagina.getByRole('button', { name: 'Fechar opções' }).click();
  console.log(`Geometria ${pagina.viewportSize()!.width}: left=${inicial.x}, largura=${inicial.width}, centro=${inicial.x + inicial.width / 2}`);
}
async function captura(pagina: Page, nome: string) {
  await regua(pagina); await pagina.screenshot({ path: new URL(nome, pasta).pathname }); geradas.push(nome);
}
async function conferirGaleria(pagina: Page, tema: string, tela: string) {
  await pagina.route('**/api/**', (rota) => { erros.push('A galeria acessou a API'); return rota.abort(); });
  await pagina.goto(`${base}/dev/ui`);
  await pagina.getByRole('radio', { name: tema, exact: true }).click();
  await pagina.evaluate(() => document.fonts.ready);
  const destino = new URL('primitives/', pasta); mkdirSync(destino, { recursive: true });
  const salvar = (estado: string, inteira = false) => pagina.screenshot({ path: new URL(`${tela}-${tema}-${estado}.png`, destino).pathname, fullPage: inteira });
  const dentro = async (seletor: string) => {
    const caixa = await pagina.locator(seletor).boundingBox(); assert.ok(caixa);
    assert.ok(caixa.x >= 0 && caixa.y >= 0 && caixa.x + caixa.width <= pagina.viewportSize()!.width + 1 && caixa.y + caixa.height <= pagina.viewportSize()!.height + 1, `${seletor}: ${JSON.stringify(caixa)}`);
  };
  await regua(pagina); await salvar('fechados', true);
  const combo = pagina.getByRole('combobox', { name: 'Select fechado', exact: true });
  await combo.click(); await dentro('.ui-listbox'); await salvar('select-aberto');
  await pagina.keyboard.press('End'); await pagina.keyboard.press('Enter');
  assert.ok((await combo.textContent())?.includes('Uma opção com texto longo'));
  for (const tipo of ['normal', 'overflow', 'borda']) {
    await pagina.getByRole('button', { name: `Popover ${tipo}`, exact: true }).click();
    await dentro('.ui-popover');
    await pagina.getByRole('combobox', { name: `Select no popover ${tipo}` }).click();
    await dentro('.ui-listbox');
    assert.equal(await pagina.locator('.ui-listbox').evaluate((e) => e.parentElement === document.body), true);
    await salvar(`popover-${tipo}`);
    await pagina.getByRole('option').first().click();
    assert.equal(await pagina.getByRole('dialog').count(), 1, 'escolher não fecha o popover');
    await pagina.keyboard.press('Escape');
  }
  await pagina.getByRole('button', { name: 'Abrir Drawer' }).click();
  await dentro('.ui-drawer');
  await pagina.getByRole('combobox', { name: 'Select no drawer' }).click(); await dentro('.ui-listbox');
  await salvar('drawer-aberto');
  await pagina.keyboard.press('Escape'); await pagina.keyboard.press('Escape');
  assert.equal(await pagina.getByRole('dialog').count(), 0);
}
try {
  navegador = await chromium.launch();
  for (const tema of ['escuro', 'claro', 'sepia']) for (const [tela, width, height] of [['pc', 1440, 900], ['cel', 412, 915]] as const) {
    const pagina = await navegador.newPage({ viewport: { width, height }, colorScheme: 'dark', reducedMotion: 'reduce' });
    pagina.on('pageerror', (e) => erros.push(e.message)); await simular(pagina);
    await conferirGaleria(pagina, tema, tela); await pagina.close();
  }
  for (const colorScheme of ['dark', 'light'] as const) for (const [tela, width, height] of [['pc', 1440, 900], ['largo', 1680, 1050], ['cel', 412, 915]] as const) {
    const sufixo = `${tela}${colorScheme === 'dark' ? '-escuro' : ''}`;
    const pagina = await navegador.newPage({ viewport: { width, height }, reducedMotion: 'reduce', colorScheme });
    pagina.setDefaultTimeout(10000); pagina.on('pageerror', (e) => erros.push(e.message)); await simular(pagina);
    await pagina.goto(`${base}/biblioteca`); await pagina.getByRole('heading', { name: 'Todos os textos' }).waitFor();
    await captura(pagina, `01-biblioteca-${sufixo}.png`);
    for (const [s, nome] of [[dados.poema, '02-detalhe'], [dados.prosa, '03-detalhe-livro']] as const) {
      await pagina.goto(`${base}/documentos/${s.documento_id}`); await pagina.getByRole('region', { name: 'Capítulos' }).waitFor();
      assert.equal(await pagina.getByText('executor-falso', { exact: false }).count(), 0);
      await captura(pagina, `${nome}-${sufixo}.png`);
      await pagina.getByRole('button', { name: 'Opções do documento' }).click(); await pagina.getByRole('button', { name: 'Diagnóstico' }).click();
      await pagina.getByRole('button', { name: 'Reenfileirar' }).waitFor(); await regua(pagina); await pagina.getByRole('button', { name: 'Fechar', exact: true }).click();
    }
    await pagina.goto(`${base}/adicionar`); await pagina.getByRole('button', { name: 'Escolher arquivo' }).waitFor();
    await captura(pagina, `04-adicionar-${sufixo}.png`);
    await pagina.goto(`${base}/ler/${dados.poema.documento_id}/${dados.poema.secao.id}`); await pagina.locator('.bloco-estrofe').first().waitFor();
    assert.equal(await pagina.getByRole('button', { name: 'Capítulos', exact: true }).count(), 0);
    await captura(pagina, `05-leitor-poema-${sufixo}.png`);
    if (tela === 'cel') {
      await abrirOpcoes(pagina);
      await pagina.getByRole('combobox', { name: 'Camada de marcas' }).waitFor({ state: 'visible' });
    }
    // V-T3: sem níveis de atenção; "Marcas" esconde e mostra todas.
    const marcas = pagina.getByRole('button', { name: 'Marcas' });
    await marcas.click(); assert.equal(await marcas.getAttribute('aria-pressed'), 'false');
    await marcas.click(); assert.equal(await marcas.getAttribute('aria-pressed'), 'true');
    if (tela === 'cel') await pagina.getByRole('button', { name: 'Fechar opções' }).click();
    await pagina.getByRole('button', { name: 'Aparência' }).click(); await captura(pagina, `06-aparencia-${sufixo}.png`);
    for (const [rotulo, tema] of [['Escuro', 'escuro'], ['Sépia', 'sepia'], ['Claro', 'claro']] as const) { await escolherOpcao(pagina, 'Tema', rotulo); assert.equal(await pagina.locator('html').getAttribute('data-tema'), tema); await regua(pagina); }
    await escolherOpcao(pagina, 'Tema', 'Sistema');
    await pagina.getByRole('button', { name: 'Fechar', exact: true }).click(); await abrirOpcoes(pagina); await captura(pagina, `07-filtros-${sufixo}.png`);
    await pagina.getByRole('button', { name: 'Fechar opções' }).click();
    await pagina.evaluate(() => { const trecho = document.querySelector('.bloco-estrofe .segmento')!; const intervalo = document.createRange(); intervalo.selectNodeContents(trecho); const selecao = window.getSelection()!; selecao.removeAllRanges(); selecao.addRange(intervalo); document.dispatchEvent(new Event('selectionchange')); });
    await pagina.getByRole('toolbar', { name: 'Ações da seleção' }).waitFor(); await captura(pagina, `08-selecao-${sufixo}.png`);
    await pagina.keyboard.press('p');
    await pagina.getByRole('textbox', { name: 'Sua pergunta' }).fill('O que muda neste verso?');
    const antes = await pagina.locator('.capitulo').boundingBox();
    if (tela !== 'cel') { await pagina.getByRole('region', { name: 'Conversa no trecho' }).waitFor(); await pagina.getByRole('button', { name: 'Ampliar conversa' }).click(); }
    await pagina.getByRole('dialog', { name: 'Conversa no trecho' }).waitFor();
    assert.equal(await pagina.getByRole('textbox', { name: 'Sua pergunta' }).inputValue(), 'O que muda neste verso?');
    const depois = await pagina.locator('.capitulo').boundingBox(); assert.equal(depois?.x, antes?.x); assert.equal(depois?.width, antes?.width);
    await pagina.keyboard.press('Escape');
    await pagina.goto(`${base}/ler/${dados.prosa.documento_id}/${dados.prosa.secao.id}`); await pagina.locator('.bloco-paragrafo').first().waitFor();
    await captura(pagina, `09-leitor-prosa-${sufixo}.png`);
    if (tela !== 'cel') await conferirGeometria(pagina);
    await pagina.getByRole('button', { name: 'Capítulos', exact: true }).click(); await pagina.getByRole('dialog', { name: 'Capítulos' }).waitFor(); await regua(pagina);
    await pagina.close();
  }
  assert.deepEqual(erros, []);
  assert.deepEqual(geradas.sort(), (JSON.parse(readFileSync(new URL('./fixtures/j21-capturas.json', import.meta.url), 'utf8')) as string[]).sort());
  console.log('J21: 54 capturas; controles, geometria, temas, seleção, conversa, índice e diagnóstico verificados.');
} finally { await navegador?.close(); await servidor.close(); }
