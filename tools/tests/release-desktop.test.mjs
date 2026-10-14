// Release do app de desktop (J116): junção dos latest-mac.yml, notas pelo CHANGELOG e o enxugamento do
// Postgres, sem rede e sem empacotar nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INSTALADORES, arquivosDoRelease, juntarLatestMac, lerLatest, lerSistemas, secaoDoChangelog, textoDasNotas } from '../../desktop/scripts/release.mjs';
import { enxugarPostgres } from '../../desktop/recursos/preparar.mjs';

const latest = (arch, data) => [
  'version: 0.2.0',
  'files:',
  `  - url: Margem-mac-${arch}.dmg`,
  `    sha512: sha-${arch}==`,
  '    size: 123',
  '    blockMapSize: 45',
  `path: Margem-mac-${arch}.dmg`,
  `sha512: sha-${arch}==`,
  `releaseDate: '${data}'`,
  '',
].join('\n');

test('latest-mac.yml: os dois .dmg num arquivo só, com a versão e o resto do arm64', () => {
  const junto = juntarLatestMac(latest('arm64', '2026-10-13T10:00:00.000Z'), latest('x64', '2026-10-13T10:05:00.000Z'));
  const lido = lerLatest(junto);
  assert.deepEqual(lido.cabecalho, ['version: 0.2.0']);
  assert.equal(lido.itens.filter((l) => l.startsWith('  - url:')).length, 2);
  assert.match(junto, /url: Margem-mac-arm64\.dmg[\s\S]*url: Margem-mac-x64\.dmg/u);
  assert.match(junto, /\npath: Margem-mac-arm64\.dmg\n/u);
  assert.equal((junto.match(/releaseDate/gu) ?? []).length, 1);
  assert.throws(() => juntarLatestMac(latest('arm64', 'x'), latest('x64', 'y').replace('0.2.0', '0.2.1')), /versões diferentes/u);
});

test('nomes fixos dos instaladores', () => {
  assert.deepEqual(Object.values(INSTALADORES).flat().sort(), [
    'Margem-Setup.exe', 'Margem-linux-x86_64.AppImage', 'Margem-mac-arm64.dmg', 'Margem-mac-x64.dmg', 'margem_amd64.deb',
  ]);
});

test('release de Windows e Linux (J146): instaladores, latest*.yml, .blockmap e complementos; notas com "macOS em breve"', () => {
  assert.deepEqual(lerSistemas('windows,linux'), ['windows', 'linux']);
  assert.deepEqual(lerSistemas(undefined), ['windows', 'macos', 'linux']);
  assert.deepEqual(lerSistemas('todos'), ['windows', 'macos', 'linux']);
  assert.throws(() => lerSistemas('windows,beos'), /--sistemas/u);
  const arquivos = arquivosDoRelease(['windows', 'linux']);
  for (const nome of ['Margem-Setup.exe', 'Margem-Setup.exe.blockmap', 'latest.yml', 'latest-linux.yml', 'Margem-linux-x86_64.AppImage', 'margem_amd64.deb', 'margem-chrome.zip']) {
    assert.ok(arquivos.includes(nome), nome);
  }
  assert.ok(!arquivos.some((nome) => nome.includes('mac')));
  assert.ok(arquivosDoRelease(['macos']).includes('latest-mac.yml'));
  const notas = textoDasNotas('Novo.', ['windows', 'linux']);
  assert.match(notas, /\| macOS \| em breve \|/u);
  assert.doesNotMatch(notas, /\.dmg/u);
  assert.doesNotMatch(textoDasNotas('Novo.', ['windows', 'macos', 'linux']), /em breve/u);
});

test('notas: a seção da versão no CHANGELOG.md, com ou sem o v', async () => {
  const texto = '# Novidades\n\n## v0.2.0\n\nNovo.\n\n- item\n\n## v0.1.0\n\nPrimeira.\n';
  assert.equal(secaoDoChangelog(texto, 'v0.2.0'), 'Novo.\n\n- item');
  assert.equal(secaoDoChangelog(texto, '0.1.0'), 'Primeira.');
  assert.equal(secaoDoChangelog(texto, 'v0.3.0'), null);
  const real = await readFile(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
  const doPacote = JSON.parse(await readFile(new URL('../../desktop/package.json', import.meta.url), 'utf8')).version;
  assert.ok(secaoDoChangelog(real, doPacote), `CHANGELOG.md sem a seção da versão do desktop/package.json (${doPacote})`);
});

test('enxugarPostgres: tira o que o servidor não usa e mantém initdb, pg_ctl, postgres, DLLs e módulos', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'margem-pg-'));
  try {
    const criar = async (relativo) => { await mkdir(join(pasta, relativo, '..'), { recursive: true }); await writeFile(join(pasta, relativo), 'x'); };
    for (const arquivo of [
      'bin/initdb.exe', 'bin/pg_ctl.exe', 'bin/postgres.exe', 'bin/psql.exe', 'bin/stackbuilder.exe', 'bin/libpq.dll', 'bin/icudt77.dll',
      'bin/wxbase3211u_vc_x64_custom.dll', 'bin/libcurl.dll', 'bin/libecpg.dll', 'bin/libcurl.lib',
      'lib/plpgsql.dll', 'lib/libpq.lib', 'lib/libpgport.a', 'lib/pkgconfig/libpq.pc', 'lib/libecpg.so.6',
      'share/postgres.bki', 'share/locale/pt_BR/LC_MESSAGES/postgres-18.mo', 'include/libpq-fe.h', 'doc/README',
    ]) await criar(arquivo);
    await enxugarPostgres(pasta, 'win32-x64');
    assert.deepEqual((await readdir(join(pasta, 'bin'))).sort(), ['icudt77.dll', 'initdb.exe', 'libpq.dll', 'pg_ctl.exe', 'postgres.exe']);
    assert.deepEqual((await readdir(join(pasta, 'lib'))).sort(), ['plpgsql.dll']);
    assert.deepEqual((await readdir(pasta)).sort(), ['bin', 'lib', 'share']);
    assert.deepEqual(await readdir(join(pasta, 'share')), ['postgres.bki']);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});

test('feed da atualização (J146): o CI grava margem.dev/atualizacoes e o site redireciona para o release do repositório público', async () => {
  const vercel = JSON.parse(await readFile(new URL('../../site/vercel.json', import.meta.url), 'utf8'));
  const config = await readFile(new URL('../../site/src/config.ts', import.meta.url), 'utf8');
  const workflow = await readFile(new URL('../../.github/workflows/app.yml', import.meta.url), 'utf8');
  const release = /urlDoRelease:\s*'([^']+)'/u.exec(config)?.[1];
  assert.ok(release, 'CONFIG.urlDoRelease');
  const redirect = vercel.redirects.find((r) => r.source === '/atualizacoes/:arquivo*');
  assert.ok(redirect, 'redirect de /atualizacoes/');
  // O mesmo lugar dos botões de download do site: trocar o repositório é trocar os dois.
  assert.equal(redirect.destination, `${release}/download/:arquivo*`);
  assert.equal(redirect.statusCode, 302);
  assert.ok(JSON.stringify(vercel).includes('pedropasinn/margem/releases'));
  // Nenhuma reescrita que engula as páginas do site (cada uma é um index.html).
  assert.equal(vercel.rewrites, undefined);
  assert.match(workflow, /MARGEM_FEED_ATUALIZACAO: \$\{\{ vars\.MARGEM_FEED_ATUALIZACAO \|\| 'https:\/\/margem\.dev\/atualizacoes' \}\}/u);
  assert.match(workflow, /vars\.MARGEM_SISTEMAS_DO_RELEASE \|\| 'windows,linux'/u);
});
