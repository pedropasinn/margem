/**
 * Build da extensão: um código só, dois pacotes.
 *
 *   node scripts/construir.mjs        → dist/chrome e dist/firefox (desempacotadas)
 *   node scripts/construir.mjs --zip  → também dist/margem-chrome.zip e dist/margem-firefox.zip
 *
 * Sem rede: esbuild empacota o TypeScript; tokens e fontes vêm de web/src/ui (fonte única do visual).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(raiz, '..', 'web', 'src', 'ui');
const dist = join(raiz, 'dist');
const pacote = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8'));
const chavePublica = readFileSync(join(raiz, 'chave-publica.txt'), 'utf8').trim();

const ENTRADAS = {
  background: 'src/fundo.ts',
  conteudo: 'src/conteudo.ts',
  'popup/popup': 'src/popup/popup.ts',
  'opcoes/opcoes': 'src/opcoes/opcoes.ts',
};

function manifesto(navegador) {
  const base = {
    manifest_version: 3,
    name: 'Margem',
    short_name: 'Margem',
    version: pacote.version,
    description: 'Envia a página aberta (artigo, post, notícia, e-mail ou PDF) para a biblioteca do Margem.',
    default_locale: undefined,
    icons: { 16: 'icones/icone-16.png', 32: 'icones/icone-32.png', 48: 'icones/icone-48.png', 128: 'icones/icone-128.png' },
    action: {
      default_title: 'Enviar para o Margem',
      default_popup: 'popup/popup.html',
      default_icon: { 16: 'icones/icone-16.png', 32: 'icones/icone-32.png' },
    },
    options_ui: { page: 'opcoes/opcoes.html', open_in_tab: true },
    permissions: ['activeTab', 'scripting', 'contextMenus', 'storage', 'notifications'],
    // Só o Margem local (qualquer porta). Um servidor em outro endereço é pedido em tempo de
    // execução pela página de opções, só para aquele host; nada de acesso a todos os sites.
    host_permissions: ['http://localhost/*', 'http://127.0.0.1/*'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    commands: {
      _execute_action: { suggested_key: { default: 'Alt+Shift+M' }, description: 'Abrir o envio para o Margem' },
    },
  };
  delete base.default_locale;
  if (navegador === 'chrome') {
    return {
      ...base,
      // Chave pública: fixa o id da extensão desempacotada (gbgnmhhgfmdgchhfhabdaneaehcamcma),
      // para a origem caber em MARGEM_EXTENSOES. A Chrome Web Store ignora e atribui o dela.
      key: chavePublica,
      minimum_chrome_version: '120',
      background: { service_worker: 'background.js' },
    };
  }
  return {
    ...base,
    background: { scripts: ['background.js'] },
    browser_specific_settings: {
      gecko: { id: 'extensao@margem.dev', strict_min_version: '128.0', data_collection_permissions: { required: ['none'] } },
    },
  };
}

async function construir(navegador, extras = {}) {
  const saida = join(dist, extras.pasta ?? navegador);
  rmSync(saida, { recursive: true, force: true });
  mkdirSync(saida, { recursive: true });
  await build({
    absWorkingDir: raiz,
    entryPoints: ENTRADAS,
    outdir: saida,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome120', 'firefox128'],
    minify: false,
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'warning',
  });
  for (const tela of ['popup/popup.html', 'opcoes/opcoes.html']) cpSync(join(raiz, 'src', tela), join(saida, tela));
  cpSync(join(raiz, 'src', 'ui', 'extensao.css'), join(saida, 'ui', 'extensao.css'));
  cpSync(join(web, 'tokens.css'), join(saida, 'ui', 'tokens.css'));
  cpSync(join(web, 'fontes'), join(saida, 'ui', 'fontes'), { recursive: true });
  cpSync(join(raiz, 'icones'), join(saida, 'icones'), { recursive: true });
  writeFileSync(join(saida, 'manifest.json'), `${JSON.stringify({ ...manifesto(navegador), ...(extras.manifesto ?? {}) }, null, 2)}\n`);
  return saida;
}

if (process.argv.includes('--e2e')) {
  // Só para o teste de ponta a ponta: sem clique no ícone não há `activeTab`, então o pacote de
  // teste ganha permissão de host para o servidor local das páginas de teste — e nada mais
  // (127.0.0.1 já está no manifesto; a entrada com porta só deixa a intenção explícita).
  const porta = process.env.MARGEM_E2E_PORTA_PAGINAS ?? '8754';
  const base = manifesto('chrome').host_permissions;
  await construir('chrome', { pasta: 'chrome-e2e', manifesto: { host_permissions: [...base, `http://127.0.0.1:${porta}/*`] } });
  console.log('dist/chrome-e2e');
  process.exit(0);
}

const empacotar = process.argv.includes('--zip');
for (const navegador of ['chrome', 'firefox']) {
  const saida = await construir(navegador);
  if (empacotar) {
    const zip = join(dist, `margem-${navegador}.zip`);
    rmSync(zip, { force: true });
    execFileSync('zip', ['-q', '-X', '-r', zip, '.'], { cwd: saida });
    console.log(`dist/margem-${navegador}.zip`);
  } else {
    console.log(`dist/${navegador}`);
  }
}
