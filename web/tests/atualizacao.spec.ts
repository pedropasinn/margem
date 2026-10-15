/**
 * Capturas do aviso de versão nova (J151) sobre `dist`, com a ponte do app de computador simulada
 * (`window.margemDesktop.atualizacao`) e toda rota /api interceptada: sem serviço, banco nem Codex.
 * Estados: disponível (baixando em segundo plano), baixando (a pessoa pediu), pronta, erro e macOS.
 * Saída: $MARGEM_CAPTURAS ou docs/ui-revisao/atualizacao/<estado>-<tema>-<largura>.png
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { preview } from 'vite';
import { INSTALACAO_PRONTA } from './estado-instalacao.ts';
import type { EstadoDaAtualizacao } from '../src/atualizacao/ponte.ts';

const pasta = resolve(process.env.MARGEM_CAPTURAS ?? '../docs/ui-revisao/atualizacao');
mkdirSync(pasta, { recursive: true });
const PORTA = 5211;
const servidor = await preview({ configLoader: 'runner', preview: { host: '127.0.0.1', port: PORTA, strictPort: true } });
const base = `http://127.0.0.1:${String(PORTA)}`;
const erros: string[] = [];

const CENAS: [string, EstadoDaAtualizacao, string][] = [
  ['disponivel', { estado: 'baixando', versao: '0.1.3', porcentagem: 18, notas: null, pedida: false }, 'Versão 0.1.3 disponível'],
  ['disponivel-com-notas', { estado: 'baixando', versao: '0.1.3', porcentagem: 18, notas: 'Aviso de atualização ao abrir o app e notificação quando a versão nova fica pronta.', pedida: false }, 'Versão 0.1.3 disponível'],
  ['baixando', { estado: 'baixando', versao: '0.1.3', porcentagem: 64, notas: null, pedida: true }, 'Atualizando para a versão 0.1.3'],
  ['pronta', { estado: 'pronta', versao: '0.1.3', notas: null }, 'Versão 0.1.3 pronta para instalar'],
  ['erro', { estado: 'indisponivel', motivo: 'Sem conexão com a internet.', versao: '0.1.3', pedida: true }, 'Não deu para atualizar o Margem'],
  ['macos', { estado: 'manual', versao: '0.1.3', notas: null }, 'Versão 0.1.3 disponível'],
];

const onboardingVisto = JSON.stringify({ versao: 1, boas_vindas: 'concluida', tela: 0,
  primeiro_documento: { estado: 'concluida', origem: 'exemplo', documento_id: null }, exemplo_id: null, tour: 'concluida', dica: 0, levar: 'pendente',
  atualizado_em: '2026-10-12T12:00:00.000Z' });

async function simular(pagina: Page, atualizacao: EstadoDaAtualizacao): Promise<void> {
  pagina.on('pageerror', (e) => erros.push(e.stack ?? e.message));
  await pagina.addInitScript(([visto, estado]) => {
    localStorage.setItem('margem:onboarding:v1:local', visto);
    const situacao = { versao: '0.1.2', atualizacao: estado };
    (window as unknown as { margemDesktop: unknown }).margemDesktop = {
      atualizacao: {
        situacao: () => Promise.resolve(situacao), procurar: () => Promise.resolve(situacao),
        reiniciar: () => undefined, abrirDownload: () => undefined, atualizarAgora: () => undefined, adiar: () => undefined,
        abrirNovidades: () => undefined, aoMudar: () => () => undefined,
      },
    };
  }, [onboardingVisto, atualizacao] as const);
  await pagina.route('**/*', async (rota) => {
    const url = new URL(rota.request().url());
    if (url.origin !== base) return rota.abort();
    if (!url.pathname.startsWith('/api/')) return rota.continue();
    const caminho = url.pathname;
    const responder = (json: unknown) => rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
    if (caminho === '/api/estado-instalacao') return responder(INSTALACAO_PRONTA);
    if (caminho === '/api/documentos') return responder({ documentos: [] });
    if (caminho === '/api/modos') return responder({ modos: [] });
    if (caminho === '/api/perfil') return responder({ perfil: null, hash: '' });
    if (caminho === '/api/execucoes/ativas') return responder({ versao: 1, gerado_em: new Date().toISOString(), execucoes: [], omitidas: 0 });
    if (caminho === '/api/eventos' || caminho === '/api/execucoes/eventos') return rota.fulfill({ contentType: 'text/event-stream', body: 'retry: 600000\n\n' });
    if (caminho.startsWith('/api/noticias')) return responder({ edicoes: [] });
    if (caminho === '/api/arte') return responder({ obras: [] });
    return responder({});
  });
}

const navegador = await chromium.launch();
try {
  for (const colorScheme of ['light', 'dark'] as const) for (const [tela, width, height] of [['1680', 1680, 1050], ['390', 390, 844]] as const) {
    const contexto = await navegador.newContext({ viewport: { width, height }, colorScheme, reducedMotion: 'reduce' });
    for (const [nome, estado, titulo] of CENAS) {
      const pagina = await contexto.newPage();
      await simular(pagina, estado);
      await pagina.goto(`${base}/`);
      const aviso = pagina.locator('.aviso-de-atualizacao');
      await aviso.getByText(titulo).waitFor();
      await pagina.evaluate(() => document.fonts.ready);
      await pagina.waitForTimeout(200);
      assert.equal(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `sem rolagem horizontal em ${nome}`);
      const lateral = await aviso.evaluate((no) => {
        const s = getComputedStyle(no);
        return s.borderLeftWidth !== s.borderRightWidth || s.borderLeftColor !== s.borderRightColor ? 1 : 0;
      });
      assert.equal(lateral, 0, `sem borda só à esquerda em ${nome}`);
      const caixa = await aviso.boundingBox();
      assert.ok(caixa !== null && caixa.x >= 15 && caixa.x + caixa.width <= width - 15, `aviso dentro da tela em ${nome}`);
      const arquivo = `${nome}-${colorScheme === 'dark' ? 'escuro' : 'claro'}-${tela}.png`;
      await pagina.screenshot({ path: join(pasta, arquivo) });
      console.log(`captura: ${arquivo}`);
      await pagina.close();
    }
    await contexto.close();
  }
} finally {
  await navegador.close();
  await new Promise<void>((pronto) => { servidor.httpServer.close(() => { pronto(); }); });
}
assert.deepEqual(erros, []);
