#!/usr/bin/env node
/**
 * Build do app de computador (J113).
 *
 *   node scripts/construir.mjs          processo principal, janela de boas-vindas e a raiz do serviço
 *   node scripts/construir.mjs --dev    o mesmo (o `npm run dev` só não empacota)
 *   node scripts/construir.mjs --com-web   reconstrói também web/dist (os scripts de empacotamento usam)
 *
 * Saídas em `desktop/dist/`:
 *   principal/main.cjs, boas-vindas/{preload.cjs,janela.js,index.html,…}
 *   raiz/  a "raiz do repositório" que o serviço enxerga em tempo de execução: os bundles da API e do
 *          worker (servico/api.mjs, servico/worker.mjs) e só os arquivos que eles leem do disco (o mesmo
 *          que a imagem Docker copiava): web/dist, prompts, contratos/{schemas,modos}, fixtures,
 *          migrações e o exemplo da primeira execução. O motor (com os scripts de tools/) é o
 *          congelado de desktop/recursos (J114), apontado por MARGEM_MOTOR.
 *
 * O `import.meta.url` de cada módulo do serviço vira o caminho que o arquivo teria na raiz, para que
 * `new URL('../../prompts/', import.meta.url)` continue achando os arquivos dentro do bundle único.
 */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(DESKTOP, '..');
const DIST = join(DESKTOP, 'dist');
const RAIZ = join(DIST, 'raiz');

async function existe(caminho) {
  try { await stat(caminho); return true; } catch { return false; }
}

/** Troca `import.meta.url` dos módulos do repositório pelo endereço que eles teriam na raiz. */
const urlDoModulo = {
  name: 'url-do-modulo',
  setup(construcao) {
    construcao.onLoad({ filter: /\.(ts|tsx|mts|js|mjs)$/ }, async (argumentos) => {
      const caminho = argumentos.path;
      if (caminho.includes(`${sep}node_modules${sep}`) || !caminho.startsWith(REPO + sep)) return undefined;
      const texto = await readFile(caminho, 'utf8');
      if (!texto.includes('import.meta.url')) return undefined;
      const relativo = relative(REPO, caminho).split(sep).join('/');
      return {
        contents: texto.replaceAll('import.meta.url', `__margemUrlDe(${JSON.stringify(relativo)})`),
        loader: caminho.endsWith('.ts') || caminho.endsWith('.mts') ? 'ts' : caminho.endsWith('.tsx') ? 'tsx' : 'js',
      };
    });
  },
};

const BANNER_DO_SERVICO = [
  "import { createRequire as __margemCriarRequire } from 'node:module';",
  "import { fileURLToPath as __margemCaminhoDe, pathToFileURL as __margemUrlDoCaminho } from 'node:url';",
  "import { dirname as __margemPasta, join as __margemJuntar } from 'node:path';",
  'const require = __margemCriarRequire(import.meta.url);',
  'const __filename = __margemCaminhoDe(import.meta.url);',
  'const __dirname = __margemPasta(__filename);',
  // MARGEM_RAIZ (a mesma variável de servico/src/dados.ts) ganha da posição do bundle.
  "const __margemRaiz = process.env.MARGEM_RAIZ || __margemJuntar(__dirname, '..');",
  'const __margemUrlDe = (relativo) => __margemUrlDoCaminho(__margemJuntar(__margemRaiz, relativo)).href;',
].join('\n');

async function construirServico() {
  await build({
    entryPoints: {
      api: join(DESKTOP, 'servico/entrada-api.ts'),
      worker: join(DESKTOP, 'servico/entrada-worker.ts'),
    },
    outdir: join(RAIZ, 'servico'),
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    // pg-native é opcional no `pg` e não é usado.
    external: ['pg-native'],
    banner: { js: BANNER_DO_SERVICO },
    plugins: [urlDoModulo],
    sourcemap: 'linked',
    logLevel: 'warning',
    legalComments: 'none',
  });
}

async function construirPrincipal() {
  await build({
    entryPoints: { 'principal/main': join(DESKTOP, 'src/principal/main.ts') },
    outdir: DIST,
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    // Ficam em node_modules (dentro do app.asar): o Electron e as dependências de produção do app.
    external: ['electron', 'electron-updater', 'pg', 'pg-native'],
    // Módulos do serviço importados aqui (login do Codex, encerramento) usam import.meta.url só dentro
    // de funções que o processo principal não chama; em CJS ele vira o endereço do próprio bundle.
    define: { 'import.meta.url': '__margemUrlDoPrincipal' },
    banner: { js: "const __margemUrlDoPrincipal = require('node:url').pathToFileURL(__filename).href;" },
    sourcemap: 'linked',
    logLevel: 'warning',
  });
  // A ponte da janela da biblioteca (só "Exportar para o Obsidian…").
  await build({
    entryPoints: { 'principal/preload': join(DESKTOP, 'src/principal/preload.ts') },
    outdir: DIST,
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    logLevel: 'warning',
  });
  await build({
    entryPoints: { 'boas-vindas/preload': join(DESKTOP, 'src/boas-vindas/preload.ts') },
    outdir: DIST,
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    logLevel: 'warning',
  });
  await build({
    entryPoints: { 'boas-vindas/janela': join(DESKTOP, 'src/boas-vindas/janela.ts') },
    outdir: DIST,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome140',
    logLevel: 'warning',
  });
  const boasVindas = join(DIST, 'boas-vindas');
  await cp(join(DESKTOP, 'src/boas-vindas/index.html'), join(boasVindas, 'index.html'));
  await cp(join(DESKTOP, 'src/boas-vindas/boas-vindas.css'), join(boasVindas, 'boas-vindas.css'));
  // Mesmas fontes e tokens de cor do web (claro e escuro).
  await cp(join(REPO, 'web/src/ui/tokens.css'), join(boasVindas, 'tokens.css'));
  await cp(join(REPO, 'web/src/ui/fontes'), join(boasVindas, 'fontes'), { recursive: true });
  // Identidade (docs/identidade/, J120): a assinatura da janela de abertura e os ícones do app.
  await copiarIcones(join(boasVindas, 'icones'));
}

/**
 * Ícones do app a partir de docs/identidade/ (gerados por tools/identidade/rasterizar.mjs):
 * icone.icns (macOS), icone.ico (Windows), linux/<n>x<n>.png (AppImage e .deb), icone-512.png
 * (janela no Linux e no Windows), a bandeja (Template monocromático no macOS; colorido nos outros)
 * e a assinatura clara e escura da janela de abertura.
 */
async function copiarIcones(destino) {
  const ident = join(REPO, 'docs/identidade');
  await mkdir(join(destino, 'linux'), { recursive: true });
  for (const arquivo of ['icone.icns', 'icone.ico', 'assinatura-claro.svg', 'assinatura-escuro.svg']) await cp(join(ident, arquivo), join(destino, arquivo));
  await cp(join(ident, 'png/icone-escuro-512.png'), join(destino, 'icone-512.png'));
  for (const arquivo of ['bandejaTemplate.png', 'bandejaTemplate@2x.png', 'bandeja-16.png', 'bandeja-32.png']) await cp(join(ident, 'bandeja', arquivo), join(destino, arquivo));
  for (const lado of [16, 32, 48, 64, 128, 256, 512]) await cp(join(ident, `png/icone-escuro-${String(lado)}.png`), join(destino, 'linux', `${String(lado)}x${String(lado)}.png`));
}

/** O que o serviço lê do disco em tempo de execução (o mesmo que o Dockerfile copiava). */
const ARQUIVOS_DA_RAIZ = [
  'LICENSE',
  'web/dist',
  'prompts',
  'contratos/schemas',
  'contratos/modos',
  'fixtures',
  'servico/src/db/migrations',
  'servico/src/primeira-execucao/exemplo',
];

async function montarRaiz() {
  // `--com-web` (empacotamento) sempre reconstrói o web; sem ele, só quando falta.
  if (process.argv.includes('--com-web') || !(await existe(join(REPO, 'web/dist/index.html')))) {
    console.log('construindo o web (npm run build --workspace @margem/web)');
    const resultado = spawnSync('npm', ['run', 'build', '--workspace', '@margem/web'], { cwd: REPO, stdio: 'inherit', shell: process.platform === 'win32' });
    if (resultado.status !== 0) throw new Error('O build do web falhou.');
  }
  for (const item of ARQUIVOS_DA_RAIZ) {
    await cp(join(REPO, item), join(RAIZ, item), {
      recursive: true,
      filter: (origem) => !/(^|[\\/])(__pycache__|\.pytest_cache|saida)([\\/]|$)/.test(relative(REPO, origem)),
    });
  }
  // MARGEM_VERSAO (a tag do release, J116) vale sobre o package.json, como no empacotar.mjs.
  const versao = (process.env.MARGEM_VERSAO ?? '').trim().replace(/^v/u, '') || JSON.parse(await readFile(join(DESKTOP, 'package.json'), 'utf8')).version;
  await writeFile(join(RAIZ, 'versao.json'), `${JSON.stringify({ versao, construido_em: new Date().toISOString() }, null, 2)}\n`);
}

const inicio = Date.now();
await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
const soServico = process.argv.includes('--so-servico');
await Promise.all([construirServico(), ...(soServico ? [] : [construirPrincipal()]), montarRaiz()]);
console.log(`desktop/dist pronto em ${String(Date.now() - inicio)} ms`);
