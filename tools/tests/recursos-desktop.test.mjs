// Recursos do app de desktop (J114): versoes.json bem formado e a conferência de hash do preparar.mjs,
// sem rede (o "download" é uma função falsa que escreve bytes locais).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PLATAFORMAS, arquivosDaPlataforma, conferido, lerArgumentos, lerVersoes, obter, plataformaDaMaquina, problemasDasVersoes,
} from '../../desktop/recursos/preparar.mjs';

test('versoes.json: as quatro plataformas, cada componente com arquivo, sha256 e https', async () => {
  const versoes = await lerVersoes();
  assert.deepEqual(problemasDasVersoes(versoes), []);
  for (const plataforma of PLATAFORMAS) {
    const componentes = new Set(arquivosDaPlataforma(versoes, plataforma).map((a) => a.componente));
    for (const nome of ['postgres', 'codex', 'yt-dlp', 'ffmpeg', 'fonte']) assert.ok(componentes.has(nome), `${plataforma} sem ${nome}`);
  }
  // A mesma versão do Codex do Dockerfile e do yt-dlp de tools/midia/yt-dlp.txt.
  const dockerfile = await readFile(new URL('../../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, new RegExp(`ARG CODEX_VERSION=${versoes.componentes.codex.versao.replaceAll('.', '\\.')}\\n`));
  const ytdlp = await readFile(new URL('../midia/yt-dlp.txt', import.meta.url), 'utf8');
  const [ano, mes, dia] = versoes.componentes['yt-dlp'].versao.split('.');
  assert.match(ytdlp, new RegExp(`yt-dlp\\[default\\]==${ano}\\.${Number(mes)}\\.${Number(dia)}\\n`));
  // Executáveis do Windows com .exe; dos outros, sem.
  for (const arquivo of arquivosDaPlataforma(versoes, 'win32-x64')) if (arquivo.destino?.startsWith('bin/')) assert.match(arquivo.destino, /\.exe$/u);
  for (const arquivo of arquivosDaPlataforma(versoes, 'linux-x64')) if (arquivo.destino?.startsWith('bin/')) assert.doesNotMatch(arquivo.destino, /\.exe$/u);
});

test('versoes.json com defeito é recusado', async () => {
  const versoes = structuredClone(await lerVersoes());
  versoes.componentes.ffmpeg.arquivos['linux-x64'][0].sha256 = 'abc';
  versoes.componentes.codex.arquivos['win32-x64'][0].url = 'http://inseguro';
  delete versoes.componentes['yt-dlp'];
  const problemas = problemasDasVersoes(versoes);
  assert.ok(problemas.some((p) => p.includes('sha256 inválido')));
  assert.ok(problemas.some((p) => p.includes('url sem https')));
  assert.ok(problemas.some((p) => p.includes('falta o componente yt-dlp')));
});

test('download conferido: hash certo entra no cache; errado é recusado e não fica; cache certo não baixa', async () => {
  const cache = await mkdtemp(join(tmpdir(), 'margem-recursos-'));
  try {
    const bytes = Buffer.from('binário de mentira');
    const arquivo = { nome: 'ferramenta', url: 'https://exemplo.invalid/ferramenta', tamanho: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    let baixados = 0;
    const baixar = async (_url, destino) => { baixados += 1; await writeFile(destino, bytes); };
    const silencio = () => {};
    const caminho = await obter(arquivo, cache, { baixar, log: silencio });
    assert.equal(await conferido(caminho, arquivo), true);
    await obter(arquivo, cache, { baixar, log: silencio });
    assert.equal(baixados, 1);
    const adulterado = { ...arquivo, nome: 'outra', sha256: 'f'.repeat(64) };
    await assert.rejects(obter(adulterado, cache, { baixar, log: silencio }), /esperado f{64}/u);
    assert.equal(await conferido(join(cache, 'outra'), adulterado), false);
    await assert.rejects(readFile(join(cache, 'outra.parcial')));
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});

test('argumentos: todas, várias, desconhecida e --motor só para uma plataforma', () => {
  assert.deepEqual(lerArgumentos(['--plataforma', 'todas', '--conferir']).plataformas, PLATAFORMAS);
  assert.deepEqual(lerArgumentos(['--plataforma', 'win32-x64,linux-x64']).plataformas, ['win32-x64', 'linux-x64']);
  assert.throws(() => lerArgumentos(['--plataforma', 'linux-arm64']), /desconhecida/u);
  assert.throws(() => lerArgumentos(['--plataforma', 'todas', '--motor', '/x']), /uma plataforma só/u);
  assert.equal(plataformaDaMaquina('win32', 'x64'), 'win32-x64');
  assert.equal(plataformaDaMaquina('linux', 'arm64'), null);
});
