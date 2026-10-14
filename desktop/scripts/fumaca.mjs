#!/usr/bin/env node
/**
 * Teste de fumaça do app de computador (J113). Sem rede e com o executor Codex FALSO.
 *
 *   node scripts/fumaca.mjs                      o app empacotado em $MARGEM_DESKTOP_SAIDA (ou desktop/saida):
 *                                                AppImage no Linux, win-unpacked\margem.exe no Windows,
 *                                                mac[-arm64]/Margem.app no macOS
 *   node scripts/fumaca.mjs --app <executável>   outro executável empacotado (o instalado pelo NSIS, o .app
 *                                                copiado do .dmg…)
 *   node scripts/fumaca.mjs --dev                o código (desktop/dist + Electron do node_modules)
 *   --parar-por-arquivo                          encerra pelo arquivo de parada também fora do Windows
 *   --acento                                     põe também um "ç" no nome da pasta de teste
 *   --manter                                     não apaga a pasta de teste
 *   --manter-se-falhar                           só não apaga se algo falhar (CI: os registros sobem como artefato)
 *   --app-anterior <executável>                  atualização (J146): a 1ª execução usa este app (uma versão
 *                                                anterior) e a 2ª, o novo, sobre o mesmo userData e a mesma
 *                                                biblioteca: o banco antigo é reaproveitado e migrado
 *
 * A pasta de teste tem espaço no nome de propósito (`margem fumaca-…/Minha Biblioteca`), como
 * `C:\Users\Maria Silva\Documents\Margem`. Encerramento: SIGTERM no Linux e no macOS; no Windows,
 * onde o kill do Node é TerminateProcess, o arquivo MARGEM_DESKTOP_ARQUIVO_PARADA (o app sai pelo mesmo
 * caminho do SIGTERM).
 *
 * Com pasta de biblioteca e userData temporários, duas execuções `--sem-janela`:
 *   1. banco criado e migrado; GET /api/estado-instalacao 200 com banco ok; um Markdown das fixtures
 *      importado e canonizado; encerramento limpo (SIGTERM), sem processo nem Postgres vivos;
 *   2. o mesmo banco reaproveitado, com o documento lá e todas as migrações do código aplicadas;
 *      encerramento limpo de novo.
 *
 * Os binários (Postgres, motor congelado, codex, ffmpeg…) são os de desktop/recursos/<plataforma>,
 * montados pelo recursos/preparar.mjs (J114): os empacotados no app, ou os da pasta em --dev.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(DESKTOP, '..');
const argv = process.argv.slice(2);
const opcao = (nome) => { const i = argv.indexOf(nome); return i >= 0 ? argv[i + 1] : undefined; };
const modoDev = argv.includes('--dev');
const manter = argv.includes('--manter');
const pararPorArquivo = process.platform === 'win32' || argv.includes('--parar-por-arquivo');

/** O app empacotado desta plataforma na pasta de saída do electron-builder. */
function acharAppEmpacotado() {
  const saida = process.env.MARGEM_DESKTOP_SAIDA || join(DESKTOP, 'saida');
  const candidatos = process.platform === 'win32'
    ? [join(saida, 'win-unpacked', 'margem.exe'), join(saida, 'win-unpacked', 'Margem.exe')]
    : process.platform === 'darwin'
      ? [join(saida, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Margem.app', 'Contents', 'MacOS', 'Margem')]
      : [join(saida, 'Margem-linux-x86_64.AppImage')];
  const achado = candidatos.find((c) => existsSync(c));
  if (achado) return achado;
  throw new Error(`App empacotado não encontrado (${candidatos.join(', ')}): rode npm run empacotar:<sistema> ou passe --app.`);
}

const comando = modoDev ? join(DESKTOP, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron') : resolve(opcao('--app') ?? acharAppEmpacotado());
const anterior = opcao('--app-anterior') === undefined ? null : resolve(opcao('--app-anterior'));
const argumentosBase = modoDev ? [DESKTOP] : [];
const semTela = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
// Sem tela: Chromium no modo headless. `--no-sandbox`: AppImage não tem o chrome-sandbox SUID e o
// Ubuntu 24+ restringe namespaces sem privilégio.
const flagsDoChromium = process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu', ...(semTela ? ['--ozone-platform=headless'] : [])] : [];

const base = process.env.MARGEM_DESKTOP_TMP || tmpdir();
await mkdir(base, { recursive: true });
// Espaço no nome, de propósito: caminhos assim quebram aspas e argumentos (pg_ctl, initdb, taskkill).
// `--acento` põe também um "ç" (usuários como C:\Users\João): no CI do Windows roda como passo extra.
const pasta = await mkdtemp(join(base, argv.includes('--acento') ? 'margem fumaça-' : 'margem fumaca-'));
const biblioteca = join(pasta, 'Minha Biblioteca');
const dadosDoApp = join(pasta, 'dados-do-app');

let falhas = 0;
function conferir(condicao, mensagem) {
  console.log(`${condicao ? 'ok  ' : 'FALHOU'} ${mensagem}`);
  if (!condicao) falhas += 1;
  return condicao;
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
// Subida do app (a 1ª inclui o initdb). Num disco rígido carregado o initdb passa de 2 min.
const PRAZO_DA_SUBIDA_MS = Number(process.env.MARGEM_FUMACA_PRAZO_S || 300) * 1000;

function processoVivo(pid) {
  try { process.kill(pid, 0); return true; } catch (erro) { return erro.code === 'EPERM'; }
}

/** Processos cuja linha de comando cita a pasta temporária (Postgres -D …, API, worker). */
function processosDaPasta() {
  if (process.platform === 'win32') {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress'], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) return [`(não deu para listar os processos: ${r.stderr.slice(0, 200)})`];
    const lista = [JSON.parse(r.stdout || '[]')].flat();
    const alvo = pasta.toLowerCase();
    return lista.filter((p) => p.ProcessId !== process.pid && typeof p.CommandLine === 'string'
      && p.CommandLine.toLowerCase().replaceAll('/', '\\').includes(alvo))
      .map((p) => `${String(p.ProcessId)}: ${p.CommandLine.slice(0, 160)}`);
  }
  if (process.platform === 'darwin') {
    const r = spawnSync('ps', ['-axww', '-o', 'pid=,command='], { encoding: 'utf8' });
    return r.stdout.split('\n').filter((l) => l.includes(pasta) && Number.parseInt(l, 10) !== process.pid).map((l) => l.trim().slice(0, 170));
  }
  const achados = [];
  for (const nome of readdirSync('/proc')) {
    if (!/^\d+$/.test(nome) || Number(nome) === process.pid) continue;
    try {
      const linha = readFileSync(`/proc/${nome}/cmdline`, 'utf8').replaceAll('\0', ' ');
      if (linha.includes(pasta)) achados.push(`${nome}: ${linha.slice(0, 160)}`);
    } catch { /* processo sumiu */ }
  }
  return achados;
}

function subirApp(rotulo, executavel = comando) {
  const arquivoDeParada = join(pasta, `parar-${rotulo}`);
  const filho = spawn(executavel, [...(executavel === comando ? argumentosBase : []), ...flagsDoChromium, '--sem-janela', `--biblioteca=${biblioteca}`], {
    env: {
      ...process.env,
      MARGEM_DESKTOP_DADOS_APP: dadosDoApp,
      ...(pararPorArquivo ? { MARGEM_DESKTOP_ARQUIVO_PARADA: arquivoDeParada } : {}),
      MARGEM_SEM_ATUALIZACAO: '1',
      MARGEM_EXECUTOR: 'falso',
      MARGEM_ROTEIRO: join(REPO, 'fixtures/codex/leitura/leitor-ok.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const eventos = [];
  let resto = '';
  const aguardando = [];
  filho.stdout.on('data', (pedaco) => {
    resto += pedaco.toString();
    const linhas = resto.split('\n');
    resto = linhas.pop() ?? '';
    for (const linha of linhas) {
      let evento;
      try { evento = JSON.parse(linha); } catch { continue; }
      if (typeof evento?.evento !== 'string') continue;
      eventos.push(evento);
      console.log(`  [${rotulo}] ${evento.evento}${evento.etapa ? `: ${evento.etapa}` : ''}${evento.mensagem ? `: ${evento.mensagem}` : ''}`);
      for (const a of [...aguardando]) if (a.nomes.includes(evento.evento)) { aguardando.splice(aguardando.indexOf(a), 1); a.resolver(evento); }
    }
  });
  let erros = '';
  filho.stderr.on('data', (pedaco) => { erros = (erros + pedaco.toString()).slice(-8000); });
  const saiu = new Promise((resolver) => filho.on('exit', (codigo, sinal) => resolver({ codigo, sinal })));
  const esperarEvento = (nomes, prazoMs) => new Promise((resolver, rejeitar) => {
    const ja = eventos.find((e) => nomes.includes(e.evento));
    if (ja) { resolver(ja); return; }
    const relogio = setTimeout(() => rejeitar(new Error(`prazo esgotado esperando ${nomes.join('/')}\n${erros}`)), prazoMs);
    aguardando.push({ nomes, resolver: (e) => { clearTimeout(relogio); resolver(e); } });
    void saiu.then(({ codigo }) => { clearTimeout(relogio); rejeitar(new Error(`o app saiu (${String(codigo)}) antes de ${nomes.join('/')}\n${erros}`)); });
  });
  return { filho, saiu, esperarEvento, eventos, erros: () => erros, arquivoDeParada };
}

async function pedir(url, inicio) {
  const resposta = await fetch(url, inicio);
  const texto = await resposta.text();
  return { status: resposta.status, corpo: texto === '' ? null : JSON.parse(texto) };
}

async function encerrar(app, rotulo, pidDoBanco) {
  const inicio = Date.now();
  if (pararPorArquivo) await writeFile(app.arquivoDeParada, 'parar\n');
  else app.filho.kill('SIGTERM');
  const saida = await Promise.race([app.saiu, esperar(420_000).then(() => null)]);
  conferir(saida !== null, `${rotulo}: o app encerrou (${saida ? `código ${String(saida.codigo)}` : 'não saiu'}) em ${String(Math.round((Date.now() - inicio) / 1000))} s`);
  if (saida === null) app.filho.kill('SIGKILL');
  conferir(app.eventos.some((e) => e.evento === 'margem_encerrada'), `${rotulo}: desligamento completo (margem_encerrada)`);
  const pronta = app.eventos.find((e) => e.evento === 'margem_pronta');
  const pids = [...Object.values(pronta?.pids ?? {}), ...(pidDoBanco ? [pidDoBanco] : [])];
  await esperar(500);
  conferir(pids.every((pid) => !processoVivo(pid)), `${rotulo}: API, worker e Postgres não ficaram vivos (${pids.join(', ')})`);
  conferir(!existsSync(join(biblioteca, '.margem', 'banco', 'postmaster.pid')), `${rotulo}: sem postmaster.pid na pasta do banco`);
  const restos = processosDaPasta();
  conferir(restos.length === 0, `${rotulo}: nenhum processo citando a pasta de teste${restos.length ? `\n    ${restos.join('\n    ')}` : ''}`);
}

async function pidDoPostgres() {
  try { return Number.parseInt((await readFile(join(biblioteca, '.margem', 'banco', 'postmaster.pid'), 'utf8')).split('\n')[0], 10); } catch { return null; }
}

console.log(`app: ${comando}${modoDev ? ' (código)' : ''}; encerramento por ${pararPorArquivo ? 'arquivo de parada' : 'SIGTERM'}`);
if (anterior !== null) console.log(`1ª execução com a versão anterior: ${anterior}`);

/** Migrações do código (servico/src/db/migrations) que o banco da biblioteca não tem (J146). */
async function migracoesQueFaltam(portaDoBanco) {
  const { createRequire } = await import('node:module');
  const pg = createRequire(join(DESKTOP, 'package.json'))('pg');
  const segredos = join(dadosDoApp, 'segredos');
  const senha = readFileSync(join(segredos, readdirSync(segredos).find((n) => n.endsWith('.senha'))), 'utf8').trim();
  const cliente = new pg.Client({ host: '127.0.0.1', port: portaDoBanco, user: 'margem', database: 'margem', password: senha });
  await cliente.connect();
  try {
    const aplicadas = new Set((await cliente.query('SELECT nome FROM migracao')).rows.map((l) => l.nome));
    return readdirSync(join(REPO, 'servico/src/db/migrations')).filter((n) => /^\d{4}_.+\.sql$/u.test(n) && !aplicadas.has(n));
  } finally {
    await cliente.end();
  }
}
console.log(`pasta de teste: ${pasta}`);
let documentoId = null;
/** Apps ainda vivos: se algo falhar no meio, são encerrados antes de apagar a pasta. */
const vivos = new Set();
try {
  // ------------------------------------------------------------ 1ª execução
  const primeira = subirApp('1', anterior ?? comando);
  vivos.add(primeira);
  const pronta = await primeira.esperarEvento(['margem_pronta', 'margem_falhou'], PRAZO_DA_SUBIDA_MS);
  if (!conferir(pronta.evento === 'margem_pronta', `1: biblioteca no ar em ${pronta.url ?? '?'}`)) throw new Error(pronta.mensagem);
  conferir(pronta.banco === 'criado', '1: banco criado (initdb) na pasta da biblioteca');
  conferir(existsSync(join(biblioteca, '.margem', 'banco', 'PG_VERSION')), '1: cluster em <biblioteca>/.margem/banco');
  const segredos = join(dadosDoApp, 'segredos');
  conferir(existsSync(segredos) && readdirSync(segredos).some((n) => n.endsWith('.senha')), '1: senha do banco no userData (segredos/)');
  conferir(!readdirSync(join(biblioteca, '.margem')).some((n) => /senha|codex/i.test(n)), '1: nenhum segredo nem CODEX_HOME na biblioteca');
  if (process.platform !== 'win32') {
    const arquivo = readdirSync(segredos).find((n) => n.endsWith('.senha'));
    const modo = (await import('node:fs')).statSync(join(segredos, arquivo)).mode & 0o777;
    conferir(modo === 0o600, `1: arquivo da senha com modo 0600 (${modo.toString(8)})`);
  }
  const pidBanco1 = await pidDoPostgres();

  const estado = await pedir(`${pronta.url}/api/estado-instalacao`);
  conferir(estado.status === 200, `1: GET /api/estado-instalacao → ${String(estado.status)}`);
  conferir(estado.corpo?.banco?.ok === true, '1: banco ok e migrado (tabela instalacao lida)');
  conferir(estado.corpo?.codex?.executor === 'falso', '1: executor Codex falso');
  conferir(estado.corpo?.motor?.ok === true && estado.corpo?.motor?.forma === 'congelado', `1: motor congelado responde (${JSON.stringify(estado.corpo?.motor ?? {})})`);
  const ferramentas = estado.corpo?.ferramentas ?? {};
  conferir(['ffmpeg', 'ffprobe', 'yt_dlp', 'codex'].every((n) => ferramentas[n]?.ok === true), `1: ffmpeg, ffprobe, yt-dlp e codex embutidos (${Object.entries(ferramentas).map(([n, f]) => `${n}:${f.origem ?? '?'}`).join(' ')})`);
  if (Array.isArray(estado.corpo?.avisos)) console.log(`     avisos da instalação: ${estado.corpo.avisos.join(' | ')}`);

  const formulario = new FormData();
  formulario.set('titulo', 'Leitura e memória');
  formulario.set('autor', 'Fixture');
  formulario.set('formato', 'md');
  formulario.set('arquivo', new File([await readFile(join(REPO, 'fixtures/unicode-dificil.md'), 'utf8')], 'unicode-dificil.md', { type: 'text/plain' }));
  const criado = await pedir(`${pronta.url}/api/documentos`, { method: 'POST', headers: { 'X-Margem': '1' }, body: formulario });
  conferir(criado.status === 202, `1: Markdown importado (${String(criado.status)})`);
  documentoId = criado.corpo?.documento_id ?? null;
  let versao = null;
  const limite = Date.now() + 180_000;
  while (documentoId && versao === null && Date.now() < limite) {
    const detalhe = await pedir(`${pronta.url}/api/documentos/${documentoId}`);
    versao = detalhe.corpo?.versao_id ?? null;
    if (versao === null) await esperar(500);
  }
  conferir(versao !== null, `1: documento canonizado pelo worker (versão ${versao ?? 'nenhuma'})`);
  conferir(documentoId !== null && existsSync(join(biblioteca, documentoId)), '1: arquivos do documento na pasta da biblioteca (MARGEM_DADOS)');

  // Questão por imagem (J119): o subcomando `imagem` do motor congelado faz o PDF, que o motor canoniza.
  const questao = new FormData();
  questao.set('arquivo', new File([await readFile(join(REPO, 'site/public/icone-512.png'))], 'questao.png', { type: 'image/png' }));
  const criada = await pedir(`${pronta.url}/api/importacoes/questao`, { method: 'POST', headers: { 'X-Margem': '1' }, body: questao });
  conferir(criada.status >= 200 && criada.status < 300, `1: print de questão importado pelo motor congelado (${String(criada.status)})`);
  let versaoDaQuestao = null;
  const limiteDaQuestao = Date.now() + 180_000;
  while (criada.corpo?.documento_id && versaoDaQuestao === null && Date.now() < limiteDaQuestao) {
    versaoDaQuestao = (await pedir(`${pronta.url}/api/documentos/${criada.corpo.documento_id}`)).corpo?.versao_id ?? null;
    if (versaoDaQuestao === null) await esperar(500);
  }
  conferir(versaoDaQuestao !== null, `1: PDF da questão canonizado (versão ${versaoDaQuestao ?? 'nenhuma'})`);
  vivos.delete(primeira);
  await encerrar(primeira, '1', pidBanco1);

  // ------------------------------------------------------------ 2ª execução
  const segunda = subirApp('2');
  vivos.add(segunda);
  const pronta2 = await segunda.esperarEvento(['margem_pronta', 'margem_falhou'], PRAZO_DA_SUBIDA_MS);
  if (!conferir(pronta2.evento === 'margem_pronta', `2: biblioteca no ar em ${pronta2.url ?? '?'}`)) throw new Error(pronta2.mensagem);
  conferir(pronta2.banco === 'reaproveitado', `2: banco ${anterior === null ? '' : 'da versão anterior '}reaproveitado (sem initdb)`);
  const faltam = await migracoesQueFaltam(pronta2.porta_banco).catch((erro) => [`(não deu para ler: ${erro instanceof Error ? erro.message : String(erro)})`]);
  conferir(faltam.length === 0, `2: todas as migrações do código aplicadas na subida${faltam.length ? ` (faltam ${faltam.join(', ')})` : ''}`);
  const pidBanco2 = await pidDoPostgres();
  const detalhe2 = documentoId ? await pedir(`${pronta2.url}/api/documentos/${documentoId}`) : { status: 0 };
  if (!conferir(detalhe2.status === 200 && detalhe2.corpo?.versao_id != null,
    `2: o documento da 1ª execução continua lá, canonizado (${String(detalhe2.status)} ${JSON.stringify(detalhe2.corpo ?? {}).slice(0, 200)})`)) {
    console.log(`     saída de erro do app:\n${segunda.erros().split('\n').filter((l) => !l.includes('inotify')).slice(-30).join('\n')}`);
  }
  vivos.delete(segunda);
  await encerrar(segunda, '2', pidBanco2);
} catch (erro) {
  conferir(false, erro instanceof Error ? erro.message : String(erro));
} finally {
  // Falha no meio (prazo, exceção): o app não pode ficar vivo, nem o Postgres dele, depois da fumaça.
  for (const app of vivos) {
    console.log('encerrando o app que ficou no ar depois da falha');
    if (pararPorArquivo) await writeFile(app.arquivoDeParada, 'parar\n').catch(() => undefined);
    else app.filho.kill('SIGTERM');
    if ((await Promise.race([app.saiu, esperar(420_000).then(() => null)])) === null) app.filho.kill('SIGKILL');
  }
  // `--manter-se-falhar` (CI): com falha, a pasta fica para o upload dos registros (dados-do-app/registros).
  if (manter || (falhas > 0 && argv.includes('--manter-se-falhar'))) console.log(`pasta mantida: ${pasta}`);
  else await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
}
console.log(falhas === 0 ? '\nfumaça: tudo certo' : `\nfumaça: ${String(falhas)} falha(s)`);
// Saída explícita: no Windows um Postgres órfão pode segurar os pipes herdados e manter o laço vivo.
process.exit(falhas === 0 ? 0 : 1);
