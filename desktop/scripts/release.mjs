#!/usr/bin/env node
/**
 * Artefatos do release do app de computador (J116). Usado pelo `.github/workflows/app.yml`; só Node,
 * sem dependências, para rodar igual no Windows, no macOS e no Linux.
 *
 *   node scripts/release.mjs coletar --plataforma <p> --destino <pasta>
 *       copia da saída do electron-builder ($MARGEM_DESKTOP_SAIDA ou desktop/saida) os instaladores com
 *       os nomes fixos, os .blockmap e os latest*.yml; falha se faltar um instalador. No macOS o
 *       latest-mac.yml vira latest-mac-<arch>.yml (os dois .dmg saem de runners diferentes).
 *   node scripts/release.mjs juntar --pasta <pasta> [--sistemas windows,linux]
 *       junta latest-mac-arm64.yml e latest-mac-x64.yml num latest-mac.yml só e confere se os
 *       instaladores dos sistemas do release, os arquivos da atualização automática (latest*.yml e o
 *       .blockmap do Windows) e os complementos (extensão, plugin do Obsidian) estão na pasta (o job
 *       `release`). Sem --sistemas, os três.
 *   node scripts/release.mjs notas --versao <vX.Y.Z> [--sistemas windows,linux] --saida <arquivo>
 *       notas do release: a seção da versão no CHANGELOG.md da raiz, os instaladores dos sistemas do
 *       release ("macOS em breve" quando ele fica de fora) e o aviso da falta de assinatura.
 */
import { appendFile, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(DESKTOP, '..');

/** Instaladores por plataforma, com os nomes fixos que o site e o electron-updater esperam. */
export const INSTALADORES = {
  'win32-x64': ['Margem-Setup.exe'],
  'darwin-arm64': ['Margem-mac-arm64.dmg'],
  'darwin-x64': ['Margem-mac-x64.dmg'],
  'linux-x64': ['Margem-linux-x86_64.AppImage', 'margem_amd64.deb'],
};

/** Sistemas do workflow (`windows`, `macos`, `linux`) → plataformas de INSTALADORES. */
export const PLATAFORMAS_DO_SISTEMA = {
  windows: ['win32-x64'],
  macos: ['darwin-arm64', 'darwin-x64'],
  linux: ['linux-x64'],
};

/**
 * O que a atualização automática lê de cada sistema (J146): o latest*.yml e, no Windows, o .blockmap do
 * instalador (download diferencial; o do AppImage vai dentro dele). O site redireciona
 * margem.dev/atualizacoes/<arquivo> para releases/latest/download/<arquivo>, então tudo isto precisa
 * estar no release.
 */
export const ARQUIVOS_DA_ATUALIZACAO = {
  windows: ['latest.yml', 'Margem-Setup.exe.blockmap'],
  macos: ['latest-mac.yml'],
  linux: ['latest-linux.yml'],
};

/** `--sistemas windows,linux` (ou nada: os três), validado. */
export function lerSistemas(bruto) {
  const lista = (bruto ?? 'windows,macos,linux').split(',').map((x) => x.trim()).filter((x) => x !== '');
  const sistemas = lista.includes('todos') ? ['windows', 'macos', 'linux'] : lista;
  const estranhos = sistemas.filter((x) => !(x in PLATAFORMAS_DO_SISTEMA));
  if (sistemas.length === 0 || estranhos.length > 0) throw new Error(`--sistemas: use windows, macos e/ou linux (veio ${String(bruto)})`);
  return [...new Set(sistemas)];
}

/** Os arquivos que o release dos `sistemas` precisa ter: instaladores, atualização e complementos. */
export function arquivosDoRelease(sistemas) {
  return [
    ...sistemas.flatMap((s) => PLATAFORMAS_DO_SISTEMA[s].flatMap((p) => INSTALADORES[p])),
    ...sistemas.flatMap((s) => ARQUIVOS_DA_ATUALIZACAO[s]),
    ...COMPLEMENTOS,
  ];
}

/** Extensão do navegador e plugin do Obsidian (job `complementos`), que o site manda baixar no release. */
export const COMPLEMENTOS = ['margem-chrome.zip', 'margem-firefox.zip', 'main.js', 'manifest.json'];

function opcional(argv, nome) {
  const i = argv.indexOf(nome);
  return i >= 0 ? argv[i + 1] : undefined;
}

function opcao(argv, nome) {
  const i = argv.indexOf(nome);
  const valor = i >= 0 ? argv[i + 1] : undefined;
  if (valor === undefined) throw new Error(`falta ${nome}`);
  return valor;
}

async function coletar(argv) {
  const plataforma = opcao(argv, '--plataforma');
  const destino = resolve(opcao(argv, '--destino'));
  const instaladores = INSTALADORES[plataforma];
  if (instaladores === undefined) throw new Error(`plataforma desconhecida: ${plataforma}`);
  const saida = resolve(process.env.MARGEM_DESKTOP_SAIDA || join(DESKTOP, 'saida'));
  await mkdir(destino, { recursive: true });
  const copiados = [];
  for (const nome of instaladores) {
    if (!existsSync(join(saida, nome))) throw new Error(`o electron-builder não gerou ${nome} em ${saida}`);
    await copyFile(join(saida, nome), join(destino, nome));
    copiados.push(nome);
    if (existsSync(join(saida, `${nome}.blockmap`))) {
      await copyFile(join(saida, `${nome}.blockmap`), join(destino, `${nome}.blockmap`));
      copiados.push(`${nome}.blockmap`);
    }
  }
  for (const nome of await readdir(saida)) {
    if (!/^latest.*\.yml$/u.test(nome)) continue;
    const final = nome === 'latest-mac.yml' ? `latest-mac-${plataforma.split('-')[1]}.yml` : nome;
    await copyFile(join(saida, nome), join(destino, final));
    copiados.push(final);
  }
  console.log(`${plataforma}: ${copiados.join(', ')}`);
  // Tamanhos no resumo do job do Actions.
  if (process.env.GITHUB_STEP_SUMMARY) {
    const linhas = [`### ${plataforma}`, '', '| arquivo | MB |', '|---|---|'];
    for (const nome of copiados) linhas.push(`| ${nome} | ${((await stat(join(destino, nome))).size / 1048576).toFixed(1)} |`);
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${linhas.join('\n')}\n\n`);
  }
}

/** Separa um latest*.yml do electron-builder em cabeçalho (version), itens de `files:` e o resto. */
export function lerLatest(texto) {
  const linhas = texto.replaceAll('\r\n', '\n').split('\n');
  const cabecalho = [];
  const itens = [];
  const resto = [];
  let estado = 'cabecalho';
  for (const linha of linhas) {
    if (linha === 'files:') { estado = 'files'; continue; }
    if (estado === 'files' && linha.startsWith('  ')) { itens.push(linha); continue; }
    if (estado === 'files') estado = 'resto';
    if (linha === '') continue;
    (estado === 'cabecalho' ? cabecalho : resto).push(linha);
  }
  return { cabecalho, itens, resto };
}

/** Um latest-mac.yml com os arquivos das duas arquiteturas (o electron-updater escolhe pelo nome). */
export function juntarLatestMac(arm64, x64) {
  const a = lerLatest(arm64);
  const b = lerLatest(x64);
  const versao = (l) => l.cabecalho.find((x) => x.startsWith('version:'));
  if (versao(a) !== versao(b)) throw new Error(`versões diferentes nos latest-mac: ${String(versao(a))} e ${String(versao(b))}`);
  return `${[...a.cabecalho, 'files:', ...a.itens, ...b.itens, ...a.resto].join('\n')}\n`;
}

async function juntar(argv) {
  const pasta = resolve(opcao(argv, '--pasta'));
  const arm64 = join(pasta, 'latest-mac-arm64.yml');
  const x64 = join(pasta, 'latest-mac-x64.yml');
  if (existsSync(arm64) && existsSync(x64)) {
    await writeFile(join(pasta, 'latest-mac.yml'), juntarLatestMac(await readFile(arm64, 'utf8'), await readFile(x64, 'utf8')));
  } else if (existsSync(arm64) || existsSync(x64)) {
    await copyFile(existsSync(arm64) ? arm64 : x64, join(pasta, 'latest-mac.yml'));
  }
  await rm(arm64, { force: true });
  await rm(x64, { force: true });
  const faltam = arquivosDoRelease(lerSistemas(opcional(argv, '--sistemas'))).filter((nome) => !existsSync(join(pasta, nome)));
  if (faltam.length > 0) throw new Error(`faltam arquivos do release: ${faltam.join(', ')}`);
  console.log((await readdir(pasta)).sort().join('\n'));
}

/** A seção `## vX.Y.Z` (ou `## X.Y.Z`) do CHANGELOG.md, sem o título. */
export function secaoDoChangelog(texto, versao) {
  const limpa = versao.replace(/^v/u, '');
  const linhas = texto.replaceAll('\r\n', '\n').split('\n');
  const inicio = linhas.findIndex((l) => new RegExp(`^##\\s+v?${limpa.replaceAll('.', '\\.')}(\\s|$)`, 'u').test(l));
  if (inicio < 0) return null;
  const fim = linhas.findIndex((l, i) => i > inicio && /^##\s/u.test(l));
  return linhas.slice(inicio + 1, fim < 0 ? undefined : fim).join('\n').trim();
}

/** O texto das notas do release: a seção do CHANGELOG (ou o link das novidades) e como instalar. */
export function textoDasNotas(secao, sistemas) {
  const tem = (s) => sistemas.includes(s);
  return [
    secao,
    '',
    '## Instalar',
    '',
    '| Sistema | Arquivo |',
    '|---|---|',
    ...(tem('windows') ? ['| Windows 10 e 11 (x64) | `Margem-Setup.exe` |'] : []),
    ...(tem('macos') ? ['| macOS com Apple Silicon (M1 em diante) | `Margem-mac-arm64.dmg` |', '| macOS com Intel | `Margem-mac-x64.dmg` |'] : []),
    ...(tem('linux') ? ['| Linux (x64) | `Margem-linux-x86_64.AppImage` ou `margem_amd64.deb` |'] : []),
    ...(tem('macos') ? [] : ['| macOS | em breve |']),
    '',
    'Quem já tem o Margem instalado não precisa baixar de novo: o app baixa a versão nova sozinho e instala',
    'ao fechar (ou em Configurações → Sobre e atualizações → "Reiniciar e atualizar"). A biblioteca, as notas',
    'e as configurações continuam onde estão.',
    '',
    'Os instaladores ainda **não têm assinatura de código**. No Windows, o SmartScreen avisa na primeira vez',
    tem('macos')
      ? '("Mais informações" → "Executar assim mesmo"). No macOS, abra com o botão direito → "Abrir", ou\nlibere em Ajustes do Sistema → Privacidade e Segurança. Passo a passo em https://margem.dev/docs/.'
      : '("Mais informações" → "Executar assim mesmo"). Passo a passo em https://margem.dev/docs/.',
    '',
  ].join('\n');
}

async function notas(argv) {
  const versao = opcao(argv, '--versao');
  const saida = resolve(opcao(argv, '--saida'));
  const sistemas = lerSistemas(opcional(argv, '--sistemas'));
  const changelog = existsSync(join(REPO, 'CHANGELOG.md')) ? await readFile(join(REPO, 'CHANGELOG.md'), 'utf8') : '';
  const secao = secaoDoChangelog(changelog, versao)
    ?? `Veja as novidades em https://margem.dev/novidades/.`;
  const texto = textoDasNotas(secao, sistemas);
  await mkdir(dirname(saida), { recursive: true });
  await writeFile(saida, texto);
  console.log(texto);
}

const comandos = { coletar, juntar, notas };
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [comando, ...resto] = process.argv.slice(2);
  const funcao = comandos[comando ?? ''];
  if (funcao === undefined) {
    console.error('use: release.mjs coletar|juntar|notas …');
    process.exitCode = 2;
  } else {
    funcao(resto).catch((erro) => { console.error(`erro: ${erro instanceof Error ? erro.message : String(erro)}`); process.exitCode = 1; });
  }
}
