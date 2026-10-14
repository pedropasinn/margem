#!/usr/bin/env node
/**
 * Empacota o app com o electron-builder (J113). Antes: `node scripts/construir.mjs` (os scripts
 * `empacotar:*` do package.json já fazem os dois).
 *
 *   node scripts/empacotar.mjs --linux    AppImage + .deb (x64)
 *   node scripts/empacotar.mjs --win      instalador NSIS por usuário, sem admin (x64)
 *   node scripts/empacotar.mjs --mac      .dmg arm64 e x64
 *   --arch arm64|x64                      só esta arquitetura (o CI gera cada .dmg no runner da própria)
 *   --publicar                            publica no GitHub Releases (CI, com GH_TOKEN)
 *   --sem-recursos                        não exige desktop/recursos/<plataforma> (só para testar o build)
 *
 * Saída em $MARGEM_DESKTOP_SAIDA (padrão desktop/saida). Caches do Electron e do electron-builder
 * respeitam ELECTRON_CACHE e ELECTRON_BUILDER_CACHE. MARGEM_VERSAO (ex.: `v0.2.0` da tag) troca a versão
 * do package.json no app gerado (e nos latest*.yml do electron-updater).
 *
 * Atualização automática (V-W6, J146), por MARGEM_FEED_ATUALIZACAO:
 *   https://…/atualizacoes/   provedor `generic`. O padrão do CI é https://margem.dev/atualizacoes: o site
 *                             (site/vercel.json) redireciona cada arquivo para
 *                             github.com/pedropasinn/margem/releases/latest/download/<arquivo>, então o
 *                             endereço gravado no app não muda se os instaladores mudarem de lugar
 *   github                    os releases publicados de pedropasinn/margem direto pela API do GitHub
 *   (vazia)                   o app sai com a atualização desligada (empacotamento local). Os latest*.yml
 *                             continuam sendo gerados.
 *
 * Assinatura, só por variável de ambiente (nada é exigido agora):
 *   CSC_LINK + CSC_KEY_PASSWORD           certificado (.p12/.pfx) para macOS ou Windows
 *   WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD   certificado só do Windows (quando o CI assina os dois)
 *   APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID (ou APPLE_API_KEY/APPLE_API_KEY_ID/APPLE_API_ISSUER)
 *                                         notarização do macOS
 * Sem certificado, o macOS sai com assinatura ad hoc (`identity: '-'`: o Apple Silicon não roda binário
 * arm64 sem assinatura nenhuma, e sem ela o Gatekeeper diz "danificado"); não se atualiza sozinho (o
 * Squirrel.Mac exige Developer ID) e o Windows mostra o aviso do SmartScreen na primeira vez.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import builder from 'electron-builder';

const { build, Platform, Arch } = builder;
const DESKTOP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAIDA = resolve(process.env.MARGEM_DESKTOP_SAIDA || join(DESKTOP, 'saida'));
const argv = process.argv.slice(2);

const indiceDaArch = argv.indexOf('--arch');
const archPedida = indiceDaArch >= 0 ? argv[indiceDaArch + 1] : undefined;
if (archPedida !== undefined && archPedida !== 'arm64' && archPedida !== 'x64') {
  console.error(`--arch: use arm64 ou x64 (veio ${String(archPedida)}).`);
  process.exit(2);
}
const archsDoMac = archPedida === undefined ? ['arm64', 'x64'] : [archPedida];

const alvos = [];
if (argv.includes('--linux')) alvos.push({ alvo: Platform.LINUX.createTarget(['AppImage', 'deb'], Arch.x64), plataformas: ['linux-x64'] });
if (argv.includes('--win')) alvos.push({ alvo: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), plataformas: ['win32-x64'] });
if (argv.includes('--mac')) {
  alvos.push({ alvo: Platform.MAC.createTarget(['dmg'], ...archsDoMac.map((a) => Arch[a])), plataformas: archsDoMac.map((a) => `darwin-${a}`) });
}
if (alvos.length === 0) {
  console.error('Diga a plataforma: --linux, --win ou --mac.');
  process.exit(2);
}

if (!existsSync(join(DESKTOP, 'dist', 'principal', 'main.cjs')) || !existsSync(join(DESKTOP, 'dist', 'raiz', 'servico', 'api.mjs'))) {
  console.error('desktop/dist incompleto: rode node scripts/construir.mjs antes.');
  process.exit(2);
}
if (!argv.includes('--sem-recursos')) {
  for (const { plataformas } of alvos) {
    for (const plataforma of plataformas) {
      const postgres = join(DESKTOP, 'recursos', plataforma, 'postgres', 'bin');
      if (!existsSync(postgres)) {
        console.error(`Faltam os recursos de ${plataforma} (${postgres}). Rode node recursos/preparar.mjs --plataforma ${plataforma}.`);
        process.exit(2);
      }
    }
  }
}

/** Versão do app: a da tag (MARGEM_VERSAO=v0.2.0 ou 0.2.0) ou a do package.json. */
function versaoDoApp(ambiente = process.env.MARGEM_VERSAO, doPacote = JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8')).version) {
  const bruta = (ambiente ?? '').trim().replace(/^v/u, '');
  if (bruta === '') return doPacote;
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/u.test(bruta)) throw new Error(`MARGEM_VERSAO inválida: ${String(ambiente)} (use vX.Y.Z)`);
  return bruta;
}
const versao = versaoDoApp();
console.log(`versão do app: ${versao}`);

/** Feed da atualização automática: `null` = cópia sem atualização; `github`; ou a URL do provedor generic. */
function feedDaAtualizacao(bruto = process.env.MARGEM_FEED_ATUALIZACAO) {
  const valor = (bruto ?? '').trim();
  if (valor === '') return null;
  if (valor === 'github') return valor;
  if (!/^https:\/\/\S+$/u.test(valor)) throw new Error(`MARGEM_FEED_ATUALIZACAO: use github ou uma URL https:// (veio ${valor})`);
  return valor.endsWith('/') ? valor : `${valor}/`;
}
const feed = feedDaAtualizacao();
console.log(feed === null ? 'atualização automática: desligada (sem MARGEM_FEED_ATUALIZACAO)' : `atualização automática: ${feed}`);

const temNotarizacao = Boolean(process.env.APPLE_ID || process.env.APPLE_API_KEY || process.env.APPLE_KEYCHAIN_PROFILE);

/** @type {import('electron-builder').Configuration} */
const configuracao = {
  appId: 'dev.margem.app',
  productName: 'Margem',
  executableName: 'margem',
  copyright: 'Copyright © 2026 Pedro Pasin',
  directories: { output: SAIDA, buildResources: 'construcao' },
  // Só o processo principal e a janela de abertura vão no app.asar; o serviço vai nos recursos.
  files: ['package.json', 'dist/principal/**', 'dist/boas-vindas/**', '!**/*.map'],
  extraResources: [
    { from: 'dist/raiz', to: 'margem', filter: ['**/*', '!**/*.map'] },
    // ${platform}-${arch}: linux-x64, win32-x64, darwin-arm64, darwin-x64 (o layout do J114).
    { from: 'recursos/${platform}-${arch}', to: 'recursos', filter: ['**/*'] },
  ],
  // `margem.atualizacao` é lido pelo app (desktop/src/nucleo/atualizacao.ts): a URL do feed, 'github' ou 'desligada'.
  extraMetadata: { version: versao, margem: { atualizacao: feed ?? 'desligada' } },
  asar: true,
  // Traduções do Chromium: só as que a interface usa (o resto são ~40 MB de .pak no app aberto).
  electronLanguages: ['pt-BR', 'en-US'],
  npmRebuild: false,
  icon: 'dist/boas-vindas/icones/icone-512.png',
  // Com URL, o app procura nela. Sem feed, a configuração do GitHub só serve para gerar os latest*.yml do
  // release (o app sai com a atualização desligada e não a usa).
  publish: feed === null || feed === 'github'
    ? [{ provider: 'github', owner: 'pedropasinn', repo: 'margem', releaseType: 'release' }]
    // Um pedaço por pedido no download diferencial: o CDN dos releases do GitHub, atrás do redirect, não
    // responde a vários intervalos num pedido só (multipart/byteranges).
    : [{ provider: 'generic', url: feed, useMultipleRangeRequest: false }],
  linux: {
    category: 'Office',
    synopsis: 'Leitor de textos marcados',
    description: 'Biblioteca e leitor com marcas e notas na margem, feitas pelo Codex com a sua conta do ChatGPT.',
    maintainer: 'Pedro Pasin <pedropasinn@users.noreply.github.com>',
    vendor: 'Margem',
    // Pasta com <n>x<n>.png (16 a 512): o electron-builder põe cada tamanho no hicolor do .deb e do AppImage.
    icon: 'dist/boas-vindas/icones/linux',
    executableArgs: [],
    syncDesktopName: true,
  },
  appImage: { artifactName: 'Margem-linux-x86_64.AppImage' },
  deb: { artifactName: 'margem_amd64.deb', packageName: 'margem' },
  win: {
    icon: 'dist/boas-vindas/icones/icone.ico',
    // Assinatura: CSC_LINK/WIN_CSC_LINK no ambiente; sem eles o instalador sai sem assinatura.
    signAndEditExecutable: true,
  },
  nsis: {
    artifactName: 'Margem-Setup.exe',
    oneClick: true,
    perMachine: false,
    allowElevation: false,
    deleteAppDataOnUninstall: false,
    shortcutName: 'Margem',
  },
  mac: {
    category: 'public.app-category.productivity',
    icon: 'dist/boas-vindas/icones/icone.icns',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'construcao/entitlements.mac.plist',
    entitlementsInherit: 'construcao/entitlements.mac.plist',
    // Sem certificado no ambiente, nada de procurar identidade no chaveiro: assinatura ad hoc ('-'),
    // com o disable-library-validation dos entitlements (o electron-builder avisa que é preciso).
    ...(process.env.CSC_LINK || process.env.CSC_NAME ? {} : { identity: '-' }),
    notarize: temNotarizacao,
  },
  dmg: { artifactName: 'Margem-mac-${arch}.dmg' },
};

const resultado = [];
for (const { alvo } of alvos) {
  resultado.push(...await build({
    targets: alvo,
    config: configuracao,
    projectDir: DESKTOP,
    publish: argv.includes('--publicar') ? 'always' : 'never',
  }));
}
console.log(resultado.filter((caminho) => !caminho.endsWith('.blockmap')).map((caminho) => `gerado: ${caminho}`).join('\n'));
