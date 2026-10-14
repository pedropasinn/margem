#!/usr/bin/env node
/**
 * Capturas da janela de abertura (claro e escuro, 1680 e 390), com o Playwright da raiz e a ponte
 * `window.margem` simulada. Sem rede.   node scripts/capturar-abertura.mjs [pasta-de-saida]
 */
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DESKTOP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(join(DESKTOP, '..', 'package.json'))('playwright');
const saida = resolve(process.argv[2] ?? join(DESKTOP, 'saida', 'capturas'));
await mkdir(saida, { recursive: true });

const ponte = () => {
  const ouvintes = { login: [], progresso: [] };
  window.margem = {
    pastaPadrao: async () => '/home/ana/Documentos/Margem',
    escolherPasta: async () => null,
    avaliarPasta: async (caminho) => ({ caminho, existe: false, temBiblioteca: false, temOutrosArquivos: false }),
    estadoDoLogin: async () => ({ encontrado: true, logado: false, conta: null }),
    entrar: async () => {
      setTimeout(() => {
        ouvintes.login.forEach((f) => f({ tipo: 'link', valor: 'https://auth.openai.com/codex/device' }));
        ouvintes.login.forEach((f) => f({ tipo: 'codigo', valor: 'ABCD-12EF' }));
      }, 50);
      return new Promise(() => {});
    },
    cancelarLogin: async () => {},
    abrirLink: async () => {},
    concluir: async () => new Promise(() => {}),
    aoLogin: (f) => { ouvintes.login.push(f); },
    aoProgresso: (f) => { ouvintes.progresso.push(f); },
  };
};

const navegador = await chromium.launch();
const pagina = pathToFileURL(join(DESKTOP, 'dist', 'boas-vindas', 'index.html')).href;
for (const tema of ['light', 'dark']) {
  for (const [rotulo, largura, altura] of [['1680', 1680, 1000], ['390', 390, 844]]) {
    const contexto = await navegador.newContext({ viewport: { width: largura, height: altura }, colorScheme: tema });
    const aba = await contexto.newPage();
    await aba.addInitScript(ponte);
    await aba.goto(pagina);
    await aba.waitForTimeout(300);
    await aba.screenshot({ path: join(saida, `1-pasta-${tema}-${rotulo}.png`) });
    await aba.click('#continuar-pasta');
    await aba.waitForTimeout(200);
    await aba.click('#entrar-dispositivo');
    await aba.waitForTimeout(300);
    await aba.screenshot({ path: join(saida, `2-login-${tema}-${rotulo}.png`) });
    await aba.click('#pular-login');
    await aba.waitForTimeout(200);
    await aba.screenshot({ path: join(saida, `3-fim-${tema}-${rotulo}.png`) });
    await aba.goto(`${pagina}?modo=carregando`);
    await aba.waitForTimeout(300);
    await aba.screenshot({ path: join(saida, `4-carregando-${tema}-${rotulo}.png`) });
    await contexto.close();
  }
}
await navegador.close();
console.log(`capturas em ${saida}`);
