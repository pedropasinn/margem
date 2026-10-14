/** PDF real gerado pelo fixture do motor; APIs falsas, sem produção nem rede externa. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { INSTALACAO_PRONTA } from './estado-instalacao.ts';
import type { CanonicoV1, GeometriaV1 } from '@margem/contratos';
const temporario = mkdtempSync(join(tmpdir(), 'margem-j24-'));
const raiz = process.env.MARGEM_MOTOR_RAIZ ?? resolve('..');
execFileSync(join(raiz, 'motor/.venv/bin/python'), ['-c', `
from pathlib import Path
import sys
sys.path.insert(0, 'motor/tests')
from conftest import sintetico
from margem_motor.ingest import canonizar
p = Path(sys.argv[1])
original = sintetico.__wrapped__(p)
canonizar(original, 'pdf', p / 'versao')
`, temporario], { cwd: raiz, env: { ...process.env, PYTHONPATH: join(raiz, 'motor') }, stdio: 'pipe' });
const canonico = JSON.parse(readFileSync(join(temporario, 'versao/canonico.json'), 'utf8')) as CanonicoV1;
const geometria = JSON.parse(readFileSync(join(temporario, 'versao/geometria.json'), 'utf8')) as GeometriaV1;
const documentoId = '00000000000000000000000D24';
const versaoId = geometria.versao_id;
const bloco = canonico.blocos.find((b) => b.texto.includes('O primeiro paragrafo'))!;
assert.ok(bloco);
const palavra = geometria.palavras.find((p) => p.bloco_id === bloco.id && bloco.texto.slice(p.inicio_utf16, p.fim_utf16) === 'primeiro')!;
assert.ok(palavra);
const marcaId = '00000000000000000000000M24';
const ancora = { versao_id: versaoId, bloco_id: bloco.id, inicio_utf16: palavra.inicio_utf16, fim_utf16: palavra.fim_utf16, citacao: 'primeiro', prefixo: bloco.texto.slice(0, palavra.inicio_utf16), sufixo: bloco.texto.slice(palavra.fim_utf16, palavra.fim_utf16 + 32) };
const snapshot = { documento_id: documentoId, versao_id: versaoId, formato: 'pdf', paginas: { inicio: 1, fim: 3 }, geometria_disponivel: true, secao: canonico.secoes[0]!, blocos: canonico.blocos, assets: {}, camadas: [], camada: 'todas', anotacoes: [], conversas: [], conexoes: [], marcas: [{ id: marcaId, ancora, funcao: 'tese', subfaixas: [], comentario: { tipo: 'leitura', rotulo: 'Abertura', texto: 'A passagem apresenta o tema do capítulo.' }, origem: 'ia', validade: 'resolvida', visivel: true, avaliacao: 'nao_avaliada' }], recuperacao: [], anterior: null, proxima: null };
const pasta = resolve('tests/capturas'); mkdirSync(pasta, { recursive: true });
const servidor = await preview({ configLoader: 'runner', preview: { host: '127.0.0.1', port: 5194, strictPort: true } });
const base = servidor.resolvedUrls!.local[0]!.replace(/\/$/, '');
const navegador = await chromium.launch();
const erros: string[] = [];
try {
  for (const colorScheme of ['dark', 'light'] as const) for (const [width, height] of [[1440, 900], [1680, 1050], [412, 915]]) {
    const pagina = await navegador.newPage({ viewport: { width: width!, height: height! }, colorScheme, reducedMotion: 'reduce' });
    pagina.on('pageerror', (e) => { erros.push(e.message); console.log('erro no navegador', e.message); });
    await pagina.route('**/*', async (rota) => {
      const url = new URL(rota.request().url());
      if (url.origin !== base) return rota.abort();
      if (!url.pathname.startsWith('/api/')) return rota.continue();
      const responder = (json: unknown) => rota.fulfill({ contentType: 'application/json', body: JSON.stringify(json) });
      const caminho = url.pathname;
      if (caminho.endsWith('/original')) return rota.fulfill({ contentType: 'application/pdf', body: readFileSync(join(temporario, 'fixtures/sintetico.pdf')) });
      if (caminho.includes('/geometria')) return responder(geometria);
      if (caminho.endsWith('/modos')) return responder({ modos: [] });
      if (caminho.includes('/capitulos/')) return responder(snapshot);
      if (caminho.endsWith('/secoes')) return responder({ documento_id: documentoId, versao_id: versaoId, titulo: 'PDF sintético', capitulos: [snapshot.secao], secoes: [], limites: [] });
      if (caminho.endsWith('/progresso')) {
        if (rota.request().method() === 'GET') return responder({ progresso: null });
        const corpo = rota.request().postDataJSON() as { revisao_esperada: number };
        return responder({ progresso: { ...corpo, revisao: corpo.revisao_esperada + 1 } });
      }
      if (caminho === `/api/documentos/${documentoId}`) return responder({ id: documentoId, versao_id: versaoId });
      if (caminho === '/api/estado-instalacao') return responder(INSTALACAO_PRONTA);
      erros.push(`API não simulada: ${caminho}`); return responder({});
    });
    await pagina.goto(`${base}/ler/${documentoId}/${snapshot.secao.id}`);
    await pagina.locator('[data-pagina="1"] [data-pronta="true"]').waitFor();
    assert.ok(await pagina.locator('[data-pagina="1"] canvas').count());
    assert.ok(await pagina.locator('[data-pagina="1"] .textLayer span').count());
    const caixa = await pagina.locator('[data-pagina="1"]').boundingBox(); assert.ok(caixa);
    assert.ok(Math.abs(caixa.x + caixa.width / 2 - width! / 2) <= 4);
    const medirMarca = async () => pagina.evaluate((id) => {
      const alvo = document.querySelector<HTMLElement>(`[data-pagina="1"] [data-marcas="${id}"]`)!.getBoundingClientRect();
      const span = [...document.querySelectorAll('[data-pagina="1"] .textLayer span')].find((s) => s.textContent?.includes('O primeiro paragrafo'))!;
      const r = document.createRange(); const texto = span.firstChild!; const inicio = texto.textContent!.indexOf('primeiro'); r.setStart(texto, inicio); r.setEnd(texto, inicio + 8);
      const palavra = r.getBoundingClientRect();
      return { alvo: alvo.toJSON() as { x: number; y: number; width: number; height: number }, palavra: palavra.toJSON() as { x: number; y: number; width: number; height: number }, nota: document.querySelector(`[data-nota="${id}"]`)?.getBoundingClientRect().top };
    }, marcaId);
    const conferir = async () => {
      const m = await medirMarca();
      assert.ok(Math.abs(m.alvo.x - m.palavra.x) <= 2, JSON.stringify(m));
      assert.ok(Math.abs(m.alvo.width - m.palavra.width) <= 2, JSON.stringify(m));
      assert.ok(Math.abs(m.alvo.y + m.alvo.height / 2 - m.palavra.y - m.palavra.height / 2) <= 4, JSON.stringify(m));
      if (width! >= 1440 && m.nota !== undefined) assert.ok(Math.abs(m.nota - m.alvo.y) <= 2, JSON.stringify(m));
    };
    await conferir();
    if (width! >= 1440) {
      const alvo = await pagina.locator(`[data-pagina="1"] [data-marcas="${marcaId}"]`).boundingBox(); assert.ok(alvo);
      await pagina.mouse.move(alvo.x + alvo.width / 2, alvo.y + alvo.height / 2);
      await pagina.locator(`[data-nota="${marcaId}"].ativa`).waitFor();
      await pagina.mouse.move(0, 0);
    }
    await pagina.screenshot({ path: join(pasta, `j24-${width}-${colorScheme}.png`) });
    await pagina.evaluate(() => { const span = [...document.querySelectorAll('[data-pagina="1"] .textLayer span')].find((s) => s.textContent?.includes('O primeiro paragrafo'))!; const r = document.createRange(); r.selectNodeContents(span); const s = window.getSelection()!; s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new Event('selectionchange')); });
    await pagina.getByRole('toolbar', { name: 'Ações da seleção' }).waitFor();
    // J132: sem Anotar na seleção; a citação aparece uma vez, no topo do painel do trecho.
    await pagina.getByRole('button', { name: 'Perguntar' }).click();
    await pagina.getByRole('complementary', { name: 'Perguntar' }).waitFor();
    assert.ok((await pagina.getByRole('complementary', { name: 'Perguntar' }).textContent())?.includes('O primeiro paragrafo'));
    await pagina.keyboard.press('Escape');
    if (width === 1680) {
      // Seleção entre páginas não pode incluir a caixa inteira do canvas.
      await pagina.locator('[data-pagina="2"] [data-pronta="true"]').waitFor();
      await pagina.evaluate(() => {
        const inicio = [...document.querySelectorAll('[data-pagina="1"] .textLayer span')].find((s) => s.textContent?.startsWith('Um paragrafo continua'))!;
        const fim = [...document.querySelectorAll('[data-pagina="2"] .textLayer span')].find((s) => s.textContent?.startsWith('front sem perder'))!;
        const r = document.createRange(); r.setStart(inicio.firstChild!, 0); r.setEnd(fim.firstChild!, fim.textContent.length);
        const s = window.getSelection()!; s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new Event('selectionchange'));
      });
      await pagina.getByRole('toolbar', { name: 'Ações da seleção' }).waitFor();
      await pagina.getByRole('button', { name: 'Perguntar' }).click();
      const citacao = await pagina.getByRole('complementary', { name: 'Perguntar' }).locator('blockquote').first().textContent();
      assert.ok(citacao?.startsWith('Um paragrafo continua'), citacao ?? 'sem citação');
      assert.ok(citacao?.includes('upfront sem perder'), citacao ?? 'sem continuação');
      await pagina.keyboard.press('Escape');

      for (const zoom of [1, 1.25]) {
        await pagina.getByRole('button', { name: 'Aparência', exact: true }).click();
        if (zoom === 1) await pagina.getByRole('button', { name: '100%', exact: true }).click();
        else await pagina.getByRole('button', { name: 'Aumentar PDF' }).click();
        await pagina.getByRole('button', { name: 'Fechar', exact: true }).click();
        await pagina.locator('[data-pagina="1"] [data-pronta="true"]').waitFor(); await conferir();
        const folha = await pagina.locator('[data-pagina="1"]').boundingBox(); assert.ok(folha);
        assert.ok(Math.abs(folha.x + folha.width / 2 - width / 2) <= 4);
        if (zoom === 1.25) {
          await pagina.locator('[data-pagina="3"]').scrollIntoViewIfNeeded();
          await pagina.locator('[data-pagina="3"] [data-pronta="true"]').waitFor();
          await pagina.waitForFunction(() => !document.querySelector('[data-pagina="1"] canvas')); 
          // A página 3 do fixture é duplicada e não tem blocos canônicos; retomar pela 2.
          await pagina.locator('[data-pagina="2"]').scrollIntoViewIfNeeded();
          await pagina.waitForFunction((id) => !!localStorage.getItem(`margem:progresso:${id}`), documentoId);
          // O snapshot local salva identidade textual; reabrir deve aguardar geometria e retomar.
          await pagina.waitForTimeout(2200);
          const salvo = await pagina.evaluate((id) => (JSON.parse(localStorage.getItem(`margem:progresso:${id}`)!) as { progresso: { ancora: { bloco_id: string; inicio_utf16: number } } }).progresso.ancora, documentoId);
          assert.ok(canonico.blocos.find((b) => b.id === salvo.bloco_id)?.origens.some((o) => o.tipo === 'pdf' && o.pagina >= 2));
          await pagina.reload();
          await pagina.locator('[data-pagina="2"] [data-pronta="true"]').waitFor();
          await pagina.waitForFunction(() => scrollY > 500);
        }
      }
    }
    await pagina.close();
  }
  assert.deepEqual(erros, []);
  console.log('J24: canvas, TextLayer, seleção, marca em três zooms, margem e seis capturas verificados.');
} finally { await navegador.close(); await servidor.close(); }
