#!/usr/bin/env node
/**
 * Monta os binários que o app de desktop leva (J114), por plataforma, a partir de `versoes.json`.
 *
 *   node desktop/recursos/preparar.mjs --plataforma linux-x64 [--plataforma ...|todas]
 *        [--conferir] [--motor PASTA | --sem-motor] [--cache PASTA] [--destino PASTA]
 *
 * - Baixa cada arquivo da fonte oficial (versão e sha256 FIXADOS em versoes.json) para o cache e recusa
 *   qualquer byte diferente. Arquivo já no cache com o hash certo não é baixado de novo.
 * - `--conferir`: só baixa (se faltar) e confere os hashes; não monta nada.
 * - Sem `--conferir`, monta `<destino>/<plataforma>/` no layout do contrato com o J113:
 *     postgres/{bin,lib,share}   motor/margem-motor[.exe]   bin/codex[.exe]   bin/yt-dlp[.exe]
 *     bin/ffmpeg[.exe]   bin/ffprobe[.exe]   fontes/DejaVuSans.ttf   licencas/   TERCEIROS.md   recursos.json
 *     lib/ (só no Linux: as bibliotecas do FFmpeg shared, achadas pelo RPATH `$ORIGIN/../lib`)
 *   O Postgres sai enxuto (enxugarPostgres): só o que o servidor embutido usa.
 *   (mais `codex-path/` e `codex-resources/`, que o Codex procura ao lado de `bin/`).
 * - O motor congelado não é baixado: com `--motor PASTA` copia o onedir já construído; sem ele, e se a
 *   plataforma for a desta máquina, constrói com `motor/empacotar/construir.py` (Python 3.12 no PATH ou
 *   em MARGEM_PYTHON_CONSTRUCAO); noutra plataforma, monta sem o motor e avisa (cada CI constrói o seu).
 *
 * Extração: `.gz` pelo zlib do Node; `.tar.gz`, `.txz` e `.zip` pelo `tar` do sistema (bsdtar no macOS e
 * no Windows; GNU tar + xz no Linux, com `unzip` ou `python3 -m zipfile` para zip).
 * Rede só aqui; os testes (tools/tests/recursos-desktop.test.mjs) não baixam nada.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..');
export const PLATAFORMAS = ['win32-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64'];

export async function lerVersoes(caminho = join(AQUI, 'versoes.json')) {
  return JSON.parse(await readFile(caminho, 'utf8'));
}

/** Plataforma desta máquina no formato do contrato (`linux-x64`), ou null se não for uma das quatro. */
export function plataformaDaMaquina(p = platform(), a = arch()) {
  const nome = `${p}-${a}`;
  return PLATAFORMAS.includes(nome) ? nome : null;
}

export const ehWindows = (plataforma) => plataforma.startsWith('win32');
const exe = (plataforma, nome) => (ehWindows(plataforma) ? `${nome}.exe` : nome);

/** Os arquivos de uma plataforma: os dela e os comuns (`*`), de cada componente. */
export function arquivosDaPlataforma(versoes, plataforma) {
  if (!versoes.plataformas.includes(plataforma)) throw new Error(`Plataforma desconhecida: ${plataforma}`);
  const lista = [];
  for (const [componente, dados] of Object.entries(versoes.componentes)) {
    for (const arquivo of [...(dados.arquivos[plataforma] ?? []), ...(dados.arquivos['*'] ?? [])]) lista.push({ componente, ...arquivo });
  }
  return lista;
}

/** Problemas de forma do versoes.json (os testes chamam; a montagem recusa se houver). */
export function problemasDasVersoes(versoes) {
  const problemas = [];
  for (const plataforma of PLATAFORMAS) {
    if (!versoes.plataformas.includes(plataforma)) problemas.push(`falta a plataforma ${plataforma}`);
    for (const componente of ['postgres', 'codex', 'yt-dlp', 'ffmpeg', 'fonte']) {
      const dados = versoes.componentes[componente];
      if (dados === undefined) { problemas.push(`falta o componente ${componente}`); continue; }
      if ((dados.arquivos[plataforma] ?? dados.arquivos['*'] ?? []).length === 0) problemas.push(`${componente} sem arquivo para ${plataforma}`);
      if (typeof dados.versao !== 'string' || typeof dados.licenca !== 'string') problemas.push(`${componente} sem versão ou licença`);
    }
  }
  for (const plataforma of versoes.plataformas) {
    for (const arquivo of arquivosDaPlataforma(versoes, plataforma)) {
      if (!/^[0-9a-f]{64}$/u.test(arquivo.sha256)) problemas.push(`${arquivo.nome}: sha256 inválido`);
      if (!arquivo.url.startsWith('https://')) problemas.push(`${arquivo.nome}: url sem https`);
      if (!Number.isSafeInteger(arquivo.tamanho) || arquivo.tamanho <= 0) problemas.push(`${arquivo.nome}: tamanho inválido`);
      if (basename(arquivo.nome) !== arquivo.nome) problemas.push(`${arquivo.nome}: nome com pasta`);
    }
  }
  return problemas;
}

export async function sha256DoArquivo(caminho) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(caminho), hash);
  return hash.digest('hex');
}

/** O arquivo do cache tem o tamanho e o hash fixados? */
export async function conferido(caminho, arquivo) {
  try {
    if ((await stat(caminho)).size !== arquivo.tamanho) return false;
  } catch {
    return false;
  }
  return (await sha256DoArquivo(caminho)) === arquivo.sha256;
}

/** Baixa para `<cache>/<nome>` (por um `.parcial`) e confere; tenta de novo até três vezes. */
export async function obter(arquivo, cache, { baixar = baixarPorFetch, log = console.log } = {}) {
  const destino = join(cache, arquivo.nome);
  if (await conferido(destino, arquivo)) { log(`  ok (cache)  ${arquivo.nome}`); return destino; }
  await mkdir(cache, { recursive: true });
  let ultimo;
  for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
    const parcial = `${destino}.parcial`;
    try {
      await baixar(arquivo.url, parcial);
      const tamanho = (await stat(parcial)).size;
      const hash = await sha256DoArquivo(parcial);
      if (tamanho !== arquivo.tamanho || hash !== arquivo.sha256) {
        await rm(parcial, { force: true });
        throw new Error(`${arquivo.nome}: esperado ${arquivo.sha256} (${arquivo.tamanho} B), veio ${hash} (${tamanho} B)`);
      }
      await rename(parcial, destino);
      log(`  baixado     ${arquivo.nome} (${(tamanho / 1048576).toFixed(1)} MiB) sha256 ok`);
      return destino;
    } catch (erro) {
      ultimo = erro;
      // Hash errado não melhora tentando de novo: é outro arquivo na fonte.
      if (String(erro.message).includes('esperado')) break;
      log(`  tentativa ${tentativa} falhou: ${erro.message}`);
    }
  }
  throw ultimo;
}

async function baixarPorFetch(url, destino) {
  const resposta = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'margem-preparar-recursos' } });
  if (!resposta.ok || resposta.body === null) throw new Error(`${url}: HTTP ${resposta.status}`);
  await pipeline(Readable.fromWeb(resposta.body), createWriteStream(destino));
}

// ------------------------------------------------------------------ extração

function rodar(programa, argumentos, opcoes = {}) {
  const r = spawnSync(programa, argumentos, { stdio: ['ignore', 'inherit', 'inherit'], ...opcoes });
  if (r.error) throw new Error(`${programa}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${programa} ${argumentos.join(' ')} saiu com ${r.status}`);
}

/** O `tar` do sistema; no Windows o bsdtar do System32 (o do Git Bash não entende C:\). */
function tarDoSistema() {
  return platform() === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
}

export function extrairTar(arquivo, pasta) {
  rodar(tarDoSistema(), ['-xf', arquivo, '-C', pasta]);
}

export function extrairZip(arquivo, pasta) {
  if (platform() !== 'linux') { rodar(tarDoSistema(), ['-xf', arquivo, '-C', pasta]); return; }
  const unzip = spawnSync('unzip', ['-q', '-o', arquivo, '-d', pasta], { stdio: 'inherit' });
  if (!unzip.error && unzip.status === 0) return;
  rodar('python3', ['-m', 'zipfile', '-e', arquivo, pasta]);
}

async function gunzipPara(arquivo, destino) {
  await mkdir(dirname(destino), { recursive: true });
  await pipeline(createReadStream(arquivo), createGunzip(), createWriteStream(destino));
}

async function executavel(caminho, plataforma) {
  if (!ehWindows(plataforma)) await chmod(caminho, 0o755);
}

// ------------------------------------------------------------------ montagem por componente

async function montarPostgres(arquivo, alvo, plataforma, temporario) {
  const pasta = join(temporario, 'postgres');
  await mkdir(pasta, { recursive: true });
  const destino = join(alvo, 'postgres');
  if (arquivo.formato === 'zonky') {
    extrairZip(arquivo.caminho, pasta);
    const txz = (await readdir(pasta)).find((nome) => nome.endsWith('.txz'));
    if (txz === undefined) throw new Error(`${arquivo.nome}: o jar não tem .txz`);
    await mkdir(destino, { recursive: true });
    extrairTar(join(pasta, txz), destino);
  } else if (arquivo.formato === 'edb') {
    extrairZip(arquivo.caminho, pasta);
    for (const sub of ['bin', 'lib', 'share']) await cp(join(pasta, 'pgsql', sub), join(destino, sub), { recursive: true });
    await copyFile(join(pasta, 'pgsql', 'server_license.txt'), join(alvo, 'licencas', 'postgres-edb-server_license.txt'));
  } else {
    throw new Error(`Formato do Postgres desconhecido: ${arquivo.formato}`);
  }
  await enxugarPostgres(destino, plataforma);
  if (ehWindows(plataforma)) await copiarRuntimeDoVisualC(join(destino, 'bin'));
  for (const nome of ['initdb', 'pg_ctl', 'postgres']) {
    const binario = join(destino, 'bin', exe(plataforma, nome));
    if (!existsSync(binario)) throw new Error(`Postgres sem ${binario}`);
    await executavel(binario, plataforma);
  }
}

async function montarCodex(arquivo, alvo, plataforma, temporario) {
  const pasta = join(temporario, 'codex');
  await mkdir(pasta, { recursive: true });
  extrairTar(arquivo.caminho, pasta);
  // bin/, codex-path/ e codex-resources/ lado a lado: o Codex acha os recursos a partir do próprio binário.
  await cp(join(pasta, 'bin'), join(alvo, 'bin'), { recursive: true });
  for (const sub of ['codex-path', 'codex-resources']) {
    if (existsSync(join(pasta, sub))) {
      await cp(join(pasta, sub), join(alvo, sub), { recursive: true, filter: (origem) => !origem.split(/[\\/]/u).includes('voice') });
    }
  }
  if (existsSync(join(pasta, 'codex-package.json'))) await copyFile(join(pasta, 'codex-package.json'), join(alvo, 'codex-package.json'));
  const binario = join(alvo, 'bin', exe(plataforma, 'codex'));
  if (!existsSync(binario)) throw new Error(`Pacote do Codex sem ${binario}`);
}

/** Build do BtbN (`ffmpeg-<versão>-<alvo>-gpl-<ramo>.tar.xz`/`.zip`): só `bin/ffmpeg`, `bin/ffprobe` e a licença. */
async function montarFfmpegBtbn(arquivo, alvo, plataforma, temporario) {
  const pasta = join(temporario, 'ffmpeg');
  await mkdir(pasta, { recursive: true });
  if (arquivo.nome.endsWith('.zip')) extrairZip(arquivo.caminho, pasta); else extrairTar(arquivo.caminho, pasta);
  const raiz = join(pasta, arquivo.nome.replace(/\.(tar\.xz|zip)$/u, ''));
  for (const nome of ['ffmpeg', 'ffprobe']) {
    await copyFile(join(raiz, 'bin', exe(plataforma, nome)), join(alvo, 'bin', exe(plataforma, nome)));
    await executavel(join(alvo, 'bin', exe(plataforma, nome)), plataforma);
  }
  // Variante shared (J116): as bibliotecas libav* vão para `lib/`, onde o RPATH dos dois binários
  // (`$ORIGIN/../lib`) as procura. Só os nomes do SONAME (`libavcodec.so.62`), como arquivos de verdade:
  // nada de links simbólicos, que nem todo empacotador preserva.
  if (existsSync(join(raiz, 'lib'))) {
    await mkdir(join(alvo, 'lib'), { recursive: true });
    for (const nome of await readdir(join(raiz, 'lib'))) {
      if (/^lib[a-z0-9_]+\.so\.\d+$/u.test(nome)) await copyFile(join(raiz, 'lib', nome), join(alvo, 'lib', nome));
    }
  }
  await copyFile(join(raiz, 'LICENSE.txt'), join(alvo, 'licencas', 'ffmpeg.LICENSE'));
}

/**
 * O Postgres da EDB importa `msvcp140.dll`, `vcruntime140.dll` e `vcruntime140_1.dll` (runtime do Visual
 * C++), que o zip não traz: num Windows sem o "Visual C++ Redistributable" o `postgres.exe` não abriria.
 * Montando no próprio Windows (o CI), as três DLLs vão ao lado dele, copiadas do System32 (distribuição
 * "app-local", permitida pelos termos do redistribuível). Noutra máquina, só avisa.
 */
const RUNTIME_DO_VISUAL_C = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'];
async function copiarRuntimeDoVisualC(pastaBin, log = console.log) {
  if (platform() !== 'win32') { log('  postgres: AVISO: runtime do Visual C++ não copiado (só montando no Windows)'); return; }
  const sistema = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  for (const nome of RUNTIME_DO_VISUAL_C) {
    if (!existsSync(join(sistema, nome))) throw new Error(`${nome} não está em ${sistema}: instale o Visual C++ Redistributable x64 na máquina que monta`);
    await copyFile(join(sistema, nome), join(pastaBin, nome));
  }
  log(`  postgres: runtime do Visual C++ (${RUNTIME_DO_VISUAL_C.join(', ')}) copiado do System32`);
}

/**
 * Tira do Postgres o que o servidor embutido não usa (J116): bibliotecas estáticas e de importação
 * (`.a`, `.lib`), `pkgconfig`, `include`, o ECPG, `pgxs`, traduções das mensagens (o cluster usa
 * `--no-locale`), documentação e, no zip da EDB, a interface do StackBuilder (wxWidgets) e os programas
 * clientes. Ficam `initdb`, `pg_ctl`, `postgres`, todas as DLLs/.so de que eles dependem, os módulos
 * de `lib/postgresql` (plpgsql, conversões de codificação, dicionários) e o `share/` que o initdb lê.
 */
export async function enxugarPostgres(destino, plataforma) {
  const removidos = [];
  const remover = async (caminho) => { if (existsSync(caminho)) { await rm(caminho, { recursive: true, force: true }); removidos.push(caminho); } };
  for (const sub of ['include', 'doc', join('share', 'doc'), join('share', 'locale'), join('share', 'man'), join('lib', 'pkgconfig'), join('lib', 'postgresql', 'pgxs')]) {
    await remover(join(destino, sub));
  }
  for (const nome of existsSync(join(destino, 'lib')) ? await readdir(join(destino, 'lib')) : []) {
    if (/\.(a|lib)$/u.test(nome) || /^lib(ecpg|pgtypes)/u.test(nome)) await remover(join(destino, 'lib', nome));
  }
  if (ehWindows(plataforma)) {
    const manter = new Set(['initdb.exe', 'pg_ctl.exe', 'postgres.exe']);
    for (const nome of await readdir(join(destino, 'bin'))) {
      const minusculo = nome.toLowerCase();
      // As DLLs que sobram são as que initdb/pg_ctl/postgres e os módulos de lib/ importam (conferido
      // com a tabela de importação do PE no J116); as de fora são do StackBuilder, do ECPG, do curl
      // (cliente) e de testes.
      const sobra = minusculo.endsWith('.exe') ? !manter.has(minusculo) : /^(wx|libecpg|libpgtypes|libcurl|testplug|icuio|icutu)|\.lib$/u.test(minusculo);
      if (sobra) await remover(join(destino, 'bin', nome));
    }
  }
  return removidos.length;
}

async function montarFonte(arquivo, alvo, temporario) {
  const pasta = join(temporario, 'fonte');
  await mkdir(pasta, { recursive: true });
  extrairZip(arquivo.caminho, pasta);
  const raiz = join(pasta, 'dejavu-sans-ttf-2.37');
  await mkdir(join(alvo, 'fontes'), { recursive: true });
  await copyFile(join(raiz, 'ttf', 'DejaVuSans.ttf'), join(alvo, 'fontes', 'DejaVuSans.ttf'));
  await copyFile(join(raiz, 'LICENSE'), join(alvo, 'licencas', 'DejaVu-LICENSE'));
}

async function montarMotor(alvo, plataforma, opcoes, log) {
  let origem = opcoes.motor;
  if (origem === undefined) {
    if (opcoes.semMotor) { log('  motor: pulado (--sem-motor)'); return false; }
    if (plataformaDaMaquina() !== plataforma) {
      log(`  motor: AUSENTE: o motor congelado se constrói em ${plataforma} (no CI de cada sistema) ou entra por --motor PASTA`);
      return false;
    }
    const saida = join(opcoes.cache, 'motor', plataforma);
    const python = process.env.MARGEM_PYTHON_CONSTRUCAO ?? (ehWindows(plataforma) ? 'python' : 'python3');
    rodar(python, [join(RAIZ, 'motor', 'empacotar', 'construir.py'), '--saida', saida, '--trabalho', join(opcoes.cache, 'motor-trabalho', plataforma)]);
    origem = join(saida, 'margem-motor');
  }
  const executavelDoMotor = join(origem, exe(plataforma, 'margem-motor'));
  if (!existsSync(executavelDoMotor)) throw new Error(`--motor: ${executavelDoMotor} não existe`);
  await cp(origem, join(alvo, 'motor'), { recursive: true, verbatimSymlinks: true });
  await executavel(join(alvo, 'motor', exe(plataforma, 'margem-motor')), plataforma);
  return true;
}

/** Esvazia a pasta da plataforma (seguindo o link simbólico, se for um) e devolve o caminho real. */
async function pastaLimpa(caminho) {
  if (existsSync(caminho)) {
    const real = await realpath(caminho);
    for (const nome of await readdir(real)) await rm(join(real, nome), { recursive: true, force: true });
    return real;
  }
  await mkdir(caminho, { recursive: true });
  return caminho;
}

export async function montar(versoes, plataforma, opcoes, log = console.log) {
  const arquivos = [];
  for (const arquivo of arquivosDaPlataforma(versoes, plataforma)) arquivos.push({ ...arquivo, caminho: await obter(arquivo, opcoes.cache, { log }) });
  if (opcoes.conferir) return null;
  const alvo = await pastaLimpa(join(opcoes.destino, plataforma));
  const temporario = await mkdtemp(join(opcoes.cache, `.montando-${plataforma}-`));
  try {
    await mkdir(join(alvo, 'licencas'), { recursive: true });
    await mkdir(join(alvo, 'bin'), { recursive: true });
    for (const arquivo of arquivos) {
      if (arquivo.formato === 'licenca') {
        await copyFile(arquivo.caminho, join(alvo, arquivo.destino ?? join('licencas', arquivo.nome)));
      } else if (arquivo.componente === 'postgres') {
        await montarPostgres(arquivo, alvo, plataforma, temporario);
      } else if (arquivo.componente === 'codex') {
        await montarCodex(arquivo, alvo, plataforma, temporario);
      } else if (arquivo.componente === 'fonte') {
        await montarFonte(arquivo, alvo, temporario);
      } else if (arquivo.formato === 'btbn') {
        await montarFfmpegBtbn(arquivo, alvo, plataforma, temporario);
      } else if (arquivo.formato === 'gz') {
        await gunzipPara(arquivo.caminho, join(alvo, arquivo.destino));
        await executavel(join(alvo, arquivo.destino), plataforma);
      } else if (arquivo.formato === 'executavel') {
        await copyFile(arquivo.caminho, join(alvo, arquivo.destino));
        await executavel(join(alvo, arquivo.destino), plataforma);
      } else {
        throw new Error(`Não sei montar ${arquivo.nome} (${arquivo.componente}, ${arquivo.formato})`);
      }
      log(`  montado     ${arquivo.componente}: ${arquivo.nome}`);
    }
    const comMotor = await montarMotor(alvo, plataforma, opcoes, log);
    await copyFile(join(AQUI, 'TERCEIROS.md'), join(alvo, 'TERCEIROS.md'));
    const manifesto = {
      versao: 1, plataforma, montado_em: new Date().toISOString(), motor: comMotor,
      componentes: Object.fromEntries(Object.entries(versoes.componentes).map(([nome, dados]) => [nome, { versao: dados.versao, licenca: dados.licenca }])),
      arquivos: arquivos.map(({ nome, sha256, url }) => ({ nome, sha256, url })),
      caminhos: {
        postgres: 'postgres', motor: `motor/${exe(plataforma, 'margem-motor')}`, codex: `bin/${exe(plataforma, 'codex')}`,
        yt_dlp: `bin/${exe(plataforma, 'yt-dlp')}`, ffmpeg: `bin/${exe(plataforma, 'ffmpeg')}`, ffprobe: `bin/${exe(plataforma, 'ffprobe')}`,
        fonte: 'fontes/DejaVuSans.ttf',
      },
    };
    await writeFile(join(alvo, 'recursos.json'), `${JSON.stringify(manifesto, null, 2)}\n`);
    return { alvo, motor: comMotor };
  } finally {
    await rm(temporario, { recursive: true, force: true });
  }
}

export function lerArgumentos(argv) {
  const opcoes = { plataformas: [], conferir: false, semMotor: false, cache: join(AQUI, '.cache'), destino: AQUI, motor: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const valor = () => { const v = argv[i + 1]; if (v === undefined) throw new Error(`${argv[i]} pede um valor`); i += 1; return v; };
    switch (argv[i]) {
      case '--plataforma': { const v = valor(); opcoes.plataformas.push(...(v === 'todas' ? PLATAFORMAS : v.split(','))); break; }
      case '--conferir': opcoes.conferir = true; break;
      case '--sem-motor': opcoes.semMotor = true; break;
      case '--motor': opcoes.motor = resolve(valor()); break;
      case '--cache': opcoes.cache = resolve(valor()); break;
      case '--destino': opcoes.destino = resolve(valor()); break;
      case '-h': case '--ajuda': opcoes.ajuda = true; break;
      default: throw new Error(`Argumento desconhecido: ${argv[i]}`);
    }
  }
  if (opcoes.plataformas.length === 0 && !opcoes.ajuda) {
    const daqui = plataformaDaMaquina();
    if (daqui === null) throw new Error('Diga a plataforma: --plataforma win32-x64|darwin-arm64|darwin-x64|linux-x64|todas');
    opcoes.plataformas.push(daqui);
  }
  for (const p of opcoes.plataformas) if (!PLATAFORMAS.includes(p)) throw new Error(`Plataforma desconhecida: ${p}`);
  if (opcoes.motor !== undefined && opcoes.plataformas.length > 1) throw new Error('--motor vale para uma plataforma só');
  return opcoes;
}

async function principal() {
  const opcoes = lerArgumentos(process.argv.slice(2));
  if (opcoes.ajuda) { console.log((await readFile(fileURLToPath(import.meta.url), 'utf8')).split('*/')[0]); return; }
  const versoes = await lerVersoes();
  const problemas = problemasDasVersoes(versoes);
  if (problemas.length > 0) throw new Error(`versoes.json inválido:\n${problemas.join('\n')}`);
  for (const plataforma of opcoes.plataformas) {
    console.log(`${plataforma}: ${opcoes.conferir ? 'conferindo' : 'montando'}`);
    const resultado = await montar(versoes, plataforma, opcoes);
    if (resultado !== null) console.log(`${plataforma}: pronto em ${resultado.alvo}${resultado.motor ? '' : ' (SEM o motor congelado)'}`);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((erro) => { console.error(`erro: ${erro.message}`); process.exitCode = 1; });
}
