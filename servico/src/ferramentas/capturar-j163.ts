/**
 * Capturas do J163 (nota de rodapé aberta, tabela e figura do EPUB) com o serviço de verdade num
 * Postgres descartável (`margem_test_*`, criado e apagado aqui). O EPUB é o sintético de
 * `web/src/leitor/fixtures/epub_sintetico.py`, importado pelo motor como qualquer livro. A produção
 * nunca é tocada; o Codex nunca é chamado.
 *
 * Uso (da raiz, depois de `npm run build --workspace web`):
 *   node --import tsx servico/src/ferramentas/capturar-j163.ts <pasta de saída>
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { chromium, type Page } from 'playwright';
import type pg from 'pg';

const raiz = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const pasta = resolve(process.argv.at(-1) ?? join(raiz, 'docs/ui-revisao/j163'));
mkdirSync(pasta, { recursive: true });
const dados = mkdtempSync(join(tmpdir(), 'margem-j163-capturas-'));
process.env.MARGEM_DADOS = dados;
const PORTA = 8769;
const API = `http://127.0.0.1:${String(PORTA)}`;
process.env.MARGEM_PORTA = String(PORTA);

const epub = join(dados, 'caderno.epub');
execFileSync(join(raiz, 'motor/.venv/bin/python'), [join(raiz, 'web/src/leitor/fixtures/epub_sintetico.py'), epub], { stdio: 'pipe' });

const { comBancoDeTeste } = await import('../db/conexao.js');
const { migrar } = await import('../db/migrar.js');

await comBancoDeTeste('capturas_j163', async (banco: pg.Pool) => {
  await migrar(banco);
  const { criarApi } = await import('../http/app.js');
  const { servirWeb } = await import('../http/estatico.js');
  const { raizDoRepositorio } = await import('../dados.js');
  const { manipuladorCanonizar, TIPO_CANONIZAR } = await import('../worker/canonizar.js');
  const { FilaPostgres } = await import('../worker/fila-postgres.js');
  const { Worker } = await import('../worker/worker.js');
  const api = criarApi({ banco, leitura: () => { throw new Error('As capturas não iniciam leituras.'); } });
  servirWeb(api, join(raiz, 'web/dist'));
  // Sem o preparo automático: nada de Codex na importação.
  await api.request('/api/configuracoes/preparacao', { method: 'PUT', headers: { 'X-Margem': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ ao_importar: false, itens: ['grifos_relacoes'] }) });

  const formulario = new FormData();
  formulario.set('titulo', 'Caderno de leitura');
  formulario.set('formato', 'epub');
  formulario.set('arquivo', new File([readFileSync(epub)], 'caderno.epub', { type: 'application/epub+zip' }));
  const envio = await api.request('/api/documentos', { method: 'POST', headers: { 'X-Margem': '1' }, body: formulario });
  assert.equal(envio.status, 202, await envio.clone().text());
  const { documento_id: livro } = await envio.json() as { documento_id: string };
  await new Worker({
    fila: new FilaPostgres(banco), manipuladores: { [TIPO_CANONIZAR]: manipuladorCanonizar({ banco, raiz: raizDoRepositorio(), prazoMs: 120_000 }) },
    diretorioSlots: mkdtempSync(join(tmpdir(), 'margem-j163-vagas-')), slots: 1, intervaloMs: 5, maximoCiclos: 1,
  }).rodar();
  assert.ok((await banco.query('SELECT 1 FROM versao_texto WHERE documento_id=$1', [livro])).rowCount === 1, 'o EPUB não virou versão');
  assert.ok((await api.request('/api/estado-instalacao/concluir', { method: 'POST', headers: { 'X-Margem': '1' } })).ok);
  await new Promise<void>((pronto) => { serve({ fetch: api.fetch, hostname: '127.0.0.1', port: PORTA }, (info: AddressInfo) => { console.log(`no ar: ${String(info.port)}`); pronto(); }); });

  const navegador = await chromium.launch();
  const foto = (pagina: Page, nome: string) => pagina.screenshot({ path: join(pasta, `${nome}.png`) });
  const falhas: string[] = [];
  try {
    for (const [tema, esquema] of [['claro', 'light'], ['escuro', 'dark']] as const) for (const largura of [1680, 390]) {
      const contexto = await navegador.newContext({ viewport: { width: largura, height: largura > 600 ? 1000 : 844 }, colorScheme: esquema, reducedMotion: 'reduce', deviceScaleFactor: largura > 600 ? 1 : 2 });
      await contexto.addInitScript(() => {
        try {
          localStorage.setItem('margem:onboarding:v2:local', JSON.stringify({ versao: 2, boas_vindas: 'concluida', tela: 0,
            primeiro_documento: { estado: 'concluida', origem: 'importado', documento_id: null }, exemplo_id: null,
            tours: { texto: 'concluida', video: 'concluida', quadro: 'concluida' }, dicas: { texto: 0, video: 0, quadro: 0 }, levar: 'concluida',
            atualizado_em: '2026-10-01T12:00:00.000Z' }));
        } catch { /* sem storage */ }
      });
      const pagina = await contexto.newPage();
      pagina.on('pageerror', (erro) => falhas.push(`${tema}/${String(largura)}: ${erro.message}`));
      const sufixo = `${String(largura)}-${tema}`;
      await pagina.goto(`${API}/ler/${livro}`);
      await pagina.waitForSelector('.capitulo .bloco-paragrafo'); await pagina.waitForTimeout(1200);

      // 1. A nota do mesmo capítulo, aberta pelo teclado (foco na chamada + Enter).
      const primeira = pagina.getByRole('link', { name: 'Nota 1' });
      await primeira.scrollIntoViewIfNeeded();
      await pagina.evaluate('window.scrollBy(0, -160)');
      await primeira.focus(); await pagina.keyboard.press('Enter');
      await pagina.getByRole('dialog', { name: 'Nota 1' }).waitFor(); await pagina.waitForTimeout(300);
      if (!await pagina.evaluate<boolean>("document.activeElement?.getAttribute('role') === 'dialog'")) falhas.push(`${sufixo}: a nota aberta não recebeu o foco`);
      await foto(pagina, `01-nota-aberta-${sufixo}`);
      await pagina.keyboard.press('Escape');
      if (await pagina.getByRole('dialog').count() !== 0) falhas.push(`${sufixo}: o Esc não fechou a nota`);
      if (!await pagina.evaluate<boolean>("document.activeElement?.getAttribute('aria-label') === 'Nota 1'")) falhas.push(`${sufixo}: o Esc não devolveu o foco à chamada`);

      // 2. A nota que está no capítulo "Notas" (outro XHTML), aberta pelo clique.
      const segunda = pagina.getByRole('link', { name: 'Nota 2' });
      await segunda.click();
      await pagina.getByRole('dialog', { name: 'Nota 2' }).getByText(/lugares-comuns foram comuns/).waitFor(); await pagina.waitForTimeout(300);
      await foto(pagina, `02-nota-de-outro-capitulo-${sufixo}`);
      await pagina.keyboard.press('Escape');
      if (await pagina.getByRole('dialog').count() !== 0) falhas.push(`${sufixo}: o Esc não fechou a nota`);

      // 3. A tabela e 4. as figuras.
      const tabela = pagina.locator('.bloco-tabela');
      await tabela.scrollIntoViewIfNeeded(); await pagina.evaluate('window.scrollBy(0, -140)'); await pagina.waitForTimeout(300);
      await foto(pagina, `03-tabela-${sufixo}`);
      // Do fim do gráfico à figura sem imagem (o marcador "[Imagem: …]" visível só nela).
      const figura = pagina.locator('.bloco-figura').last();
      await figura.scrollIntoViewIfNeeded(); await pagina.evaluate(`window.scrollBy(0, ${largura > 600 ? 360 : 300} - window.innerHeight / 2)`); await pagina.waitForTimeout(400);
      await foto(pagina, `04-figuras-${sufixo}`);

      const larguras = await pagina.evaluate<{ conteudo: number; janela: number }>('({ conteudo: document.documentElement.scrollWidth, janela: document.documentElement.clientWidth })');
      if (larguras.conteudo > larguras.janela + 1) falhas.push(`${sufixo}: rolagem horizontal (${String(larguras.conteudo)} > ${String(larguras.janela)})`);
      if (await pagina.locator('.bloco-figura figcaption:visible', { hasText: '[Imagem' }).count() !== 1) falhas.push(`${sufixo}: só a figura sem imagem deve mostrar o marcador`);
      await contexto.close();
    }
  } finally {
    await navegador.close();
  }
  for (const falha of falhas) console.error(`FALHA ${falha}`);
  console.log(`capturas em ${pasta}`);
  process.exit(falhas.length > 0 ? 1 : 0);
});
