/**
 * Confinamento do motor (bwrap externo + casa temporária). Sem CLI real: o `spawn` é
 * encenado e o `bwrap`/motor são arquivos executáveis de mentira. A prova com o Codex
 * real fica em `confinamento.real.test.ts` (só com MARGEM_CODEX_REAL=1).
 */
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { ChildProcess, SpawnOptions, spawn } from 'node:child_process';
import { executarCodex } from './codex.js';
import { FLAGS_NECESSARIAS, type Capacidades } from './capacidades.js';
import {
  ambienteConfinado, ambienteNativo, argumentosNativos, confinamentoPadrao, montarConfinamento, modeloDoUsuario, modeloSemFerramentas, MOTOR_PADRAO, PERFIL_DO_MARGEM, politicaNativa, type Confinamento,
} from './confinamento.js';
import { pngDeTeste } from './fake.js';

const SESSAO = '01a0eac1-3876-75e2-ab56-b4081137959f';
const CAPACIDADES: Capacidades = {
  versao: 'codex-cli 0.159.2',
  flags: { ...Object.fromEntries(FLAGS_NECESSARIAS.map((flag) => [flag, true])), '--json': true, '--disable': true },
  faltando: [],
};

let base = '';
let bwrap = '';
let motor = '';
let codexDoUsuario = '';
const restaurar: Record<string, string | undefined> = {};

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'margem-teste-confinamento-'));
  bwrap = join(base, 'bwrap');
  motor = join(base, 'versao', 'bin', 'codex');
  await mkdir(join(base, 'versao', 'bin'), { recursive: true });
  for (const arquivo of [bwrap, motor]) { await writeFile(arquivo, '#!/bin/sh\n'); await chmod(arquivo, 0o755); }
  codexDoUsuario = join(base, 'codex-do-usuario');
  await mkdir(join(codexDoUsuario, 'sessions'), { recursive: true });
  await writeFile(join(codexDoUsuario, 'config.toml'), 'model = "gpt-6-astra"\nnotify = ["/x"]\n[projects."/home"]\ntrust_level = "trusted"\n');
  await writeFile(join(codexDoUsuario, 'sessions', 'livro-antigo.jsonl'), 'texto de outro livro');
  for (const nome of ['CODEX_HOME', 'DATABASE_URL']) restaurar[nome] = process.env[nome];
  process.env.CODEX_HOME = codexDoUsuario;
  process.env.DATABASE_URL = 'postgres://u:senha@127.0.0.1:5435/margem';
});
afterEach(async () => {
  for (const [nome, valor] of Object.entries(restaurar)) { if (valor === undefined) delete process.env[nome]; else process.env[nome] = valor; }
  await rm(base, { recursive: true, force: true });
});

interface Chamada { arquivo: string; argumentos: string[]; opcoes: SpawnOptions }

/** Encena o motor: grava a resposta, opcionalmente uma imagem na casa e um token renovado. */
function spawnEncenado(registro: Chamada[], encenar: (ambiente: Record<string, string>) => Promise<void> = () => Promise.resolve()): typeof spawn {
  return ((arquivo: string, argumentos: readonly string[], opcoes: SpawnOptions) => {
    registro.push({ arquivo, argumentos: [...argumentos], opcoes });
    const filho = new EventEmitter() as unknown as ChildProcess & { stderr: Readable; stdout: Readable };
    filho.stderr = Readable.from([Buffer.from('model: gpt-6-astra\n')]);
    filho.stdout = Readable.from([Buffer.from(`{"type":"thread.started","thread_id":"${SESSAO}"}\n`)]);
    Object.defineProperty(filho, 'pid', { value: undefined });
    Object.defineProperty(filho, 'exitCode', { value: null, configurable: true, writable: true });
    filho.kill = () => true;
    setTimeout(() => {
      const alvo = argumentos.at(argumentos.indexOf('--output-last-message') + 1) ?? '';
      void encenar(opcoes.env as Record<string, string>)
        .then(() => writeFile(alvo, JSON.stringify({ descricao: 'ok' })))
        .then(() => { filho.emit('close', 0); });
    }, 2);
    return filho;
  }) as unknown as typeof spawn;
}

async function pedido(gerarImagem = false) {
  const entrada = join(base, 'entrada');
  await mkdir(entrada, { recursive: true });
  await writeFile(join(entrada, 'parte.txt'), 'texto da parte\n');
  const schema = join(base, 'schema.json');
  await writeFile(schema, JSON.stringify({ type: 'object', additionalProperties: false, required: ['descricao'], properties: { descricao: { type: 'string' } } }));
  return { diretorioEntrada: entrada, prompt: 'leia', schema, prazoMs: 5_000, diretorioArtefatos: join(base, 'artefatos'), ...(gerarImagem ? { gerarImagem: true } : {}) };
}

test('o bwrap monta só /usr, o mínimo de /etc, a pasta do motor, a casa e o diretório da execução', () => {
  const lista = montarConfinamento({ motor: '/opt/codex/0.1/bin/codex', pastaDoMotor: '/opt/codex/0.1', diretorio: '/tmp/margem-job-x', casa: '/tmp/margem-casa-y' });
  expect(lista.at(-1)).toBe('/opt/codex/0.1/bin/codex');
  for (const flag of ['--unshare-pid', '--die-with-parent', '--new-session']) expect(lista).toContain(flag);
  expect(lista).not.toContain('--share-net');
  // Tudo que é montado do sistema, em pares origem/destino.
  const montados: string[] = [];
  lista.forEach((item, indice) => { if (['--ro-bind', '--bind', '--ro-bind-try'].includes(item)) montados.push(lista[indice + 1] ?? ''); });
  expect(montados).toContain('/tmp/margem-job-x');
  expect(montados).toContain('/tmp/margem-casa-y');
  expect(montados).toContain('/opt/codex/0.1');
  for (const montado of montados) {
    expect(montado === '/usr' || montado.startsWith('/etc/') || montado.startsWith('/tmp/margem-') || montado === '/opt/codex/0.1').toBe(true);
  }
  expect(montados.some((montado) => montado.startsWith('/home') || montado === '/' || montado === '/etc' || montado === '/run' || montado === '/proc')).toBe(false);
  // Gravável só a casa e o diretório da execução.
  const gravaveis = lista.flatMap((item, indice) => (item === '--bind' ? [lista[indice + 1]] : []));
  expect(gravaveis).toEqual(['/tmp/margem-casa-y', '/tmp/margem-job-x']);
  expect(lista.slice(lista.indexOf('--chdir'), lista.indexOf('--chdir') + 2)).toEqual(['--chdir', '/tmp/margem-job-x']);
});

test('o confinamento padrão usa o bwrap do sistema e aceita outro motor por MARGEM_CODEX_MOTOR', () => {
  expect(confinamentoPadrao({})).toMatchObject({ bwrap: '/usr/bin/bwrap', motor: MOTOR_PADRAO });
  expect(confinamentoPadrao({ MARGEM_CODEX_MOTOR: '/opt/codex' }).motor).toBe('/opt/codex');
});

test('do config.toml do usuário só passa a linha do modelo', async () => {
  expect(await modeloDoUsuario(join(codexDoUsuario, 'config.toml'))).toBe('model = "gpt-6-astra"');
  await writeFile(join(base, 'c.toml'), '[perfil]\nmodel = "x"\n');
  expect(await modeloDoUsuario(join(base, 'c.toml'))).toBeNull();
  expect(await modeloDoUsuario(join(base, 'nada.toml'))).toBeNull();
});

test('confinado: roda o motor dentro do bwrap, com a casa temporária como HOME e CODEX_HOME', async () => {
  const registro: Chamada[] = [];
  const sincronizadas: string[] = [];
  const confinamento: Confinamento = {
    bwrap, motor,
    sincronizar: async (casaCodex) => { sincronizadas.push(casaCodex); await writeFile(join(casaCodex, 'auth.json'), '{"t":1}'); },
  };
  let vistoNaCasa: string[] = [];
  let configuracaoNaCasa = '';
  const resultado = await executarCodex(await pedido(), {
    capacidades: CAPACIDADES, confinamento,
    gerar: spawnEncenado(registro, async (ambiente) => {
      const { readdir } = await import('node:fs/promises');
      vistoNaCasa = await readdir(ambiente.CODEX_HOME ?? '');
      configuracaoNaCasa = await readFile(join(ambiente.CODEX_HOME ?? '', 'config.toml'), 'utf8');
    }),
  });
  expect(resultado.estado).toBe('ok');
  const chamada = registro[0];
  expect(chamada?.arquivo).toBe(bwrap);
  const argumentos = chamada?.argumentos ?? [];
  const posicaoDoMotor = argumentos.indexOf(motor);
  expect(posicaoDoMotor).toBeGreaterThan(0);
  expect(argumentos[posicaoDoMotor + 1]).toBe('exec');
  // S-05: dentro do bwrap vale o perfil (que tira o --sandbox da linha), não o read-only.
  expect(argumentos).not.toContain('--sandbox');
  expect(argumentos.join(' ')).toContain('cli_auth_credentials_store="file"');
  const ambiente = chamada?.opcoes.env as Record<string, string>;
  expect(ambiente.HOME).toMatch(/margem-casa-/u);
  expect(ambiente.CODEX_HOME).toBe(join(ambiente.HOME ?? '', '.codex'));
  expect(JSON.stringify(ambiente)).not.toContain('senha');
  expect(JSON.stringify(ambiente)).not.toContain(codexDoUsuario);
  // A casa só tem a credencial e o config (modelo e perfil); nada das sessões do usuário.
  expect(vistoNaCasa.sort()).toEqual(['auth.json', 'config.toml']);
  expect(configuracaoNaCasa.split('\n').slice(0, 2)).toEqual([`default_permissions = "${PERFIL_DO_MARGEM}"`, 'model = "gpt-6-astra"']);
  expect(configuracaoNaCasa).toContain('":root" = "deny"');
  // Só o diretório da execução e a pasta da versão do Codex; a casa (com o auth.json) não.
  const diretorioDaExecucao = argumentos.at(argumentos.indexOf('-C') + 1) ?? '';
  expect(configuracaoNaCasa).toContain(`${JSON.stringify(diretorioDaExecucao)} = "read"`);
  expect(configuracaoNaCasa).toContain(`${JSON.stringify(join(base, 'versao'))} = "read"`);
  expect(configuracaoNaCasa).not.toContain(ambiente.HOME ?? '?');
  expect(sincronizadas).toHaveLength(1);
  // Casa e diretório da execução somem no fim.
  expect(existsSync(ambiente.HOME ?? '')).toBe(false);
  expect(existsSync(argumentos.at(argumentos.indexOf('-C') + 1) ?? '')).toBe(false);
});

test('confinado: token renovado durante a execução volta ao login comum', async () => {
  const sincronizadas: string[] = [];
  const confinamento: Confinamento = {
    bwrap, motor,
    sincronizar: async (casaCodex) => { sincronizadas.push(casaCodex); if (sincronizadas.length === 1) await writeFile(join(casaCodex, 'auth.json'), '{"t":1}'); },
  };
  await executarCodex(await pedido(), {
    capacidades: CAPACIDADES, confinamento,
    gerar: spawnEncenado([], async (ambiente) => { await writeFile(join(ambiente.CODEX_HOME ?? '', 'auth.json'), '{"t":2}'); }),
  });
  expect(sincronizadas).toHaveLength(2);
});

test('confinado sem o embrulho: a credencial vem do CODEX_HOME do usuário', async () => {
  await writeFile(join(codexDoUsuario, 'auth.json'), '{"direto":true}');
  let credencial = '';
  await executarCodex(await pedido(), {
    capacidades: CAPACIDADES, confinamento: { bwrap, motor },
    gerar: spawnEncenado([], async (ambiente) => { credencial = await readFile(join(ambiente.CODEX_HOME ?? '', 'auth.json'), 'utf8'); }),
  });
  expect(credencial).toBe('{"direto":true}');
});

test('confinado: as imagens geradas saem da casa temporária antes de ela sumir (J70)', async () => {
  const resultado = await executarCodex(await pedido(true), {
    capacidades: CAPACIDADES, confinamento: { bwrap, motor },
    gerar: spawnEncenado([], async (ambiente) => {
      const pasta = join(ambiente.CODEX_HOME ?? '', 'generated_images', SESSAO);
      await mkdir(pasta, { recursive: true });
      await writeFile(join(pasta, 'exec-a.png'), pngDeTeste(3, 2));
    }),
  });
  expect(resultado.estado).toBe('ok');
  const imagens = resultado.estado === 'ok' ? resultado.imagens ?? [] : [];
  expect(imagens).toHaveLength(1);
  expect(imagens[0]).toContain(join(base, 'artefatos'));
  expect(existsSync(imagens[0] ?? '')).toBe(true);
});

test('sem bwrap ou sem motor a leitura não roda (falha fechada)', async () => {
  const registro: Chamada[] = [];
  const semBwrap = await executarCodex(await pedido(), {
    capacidades: CAPACIDADES, confinamento: { bwrap: join(base, 'nao-existe'), motor }, gerar: spawnEncenado(registro),
  });
  expect(semBwrap).toMatchObject({ estado: 'falhou', codigo: 'cli_incompativel' });
  const semMotor = await executarCodex(await pedido(), {
    capacidades: CAPACIDADES, confinamento: { bwrap, motor: join(base, 'nao-existe') }, gerar: spawnEncenado(registro),
  });
  expect(semMotor).toMatchObject({ estado: 'falhou', codigo: 'cli_incompativel' });
  expect(registro).toEqual([]);
});

test('anexos só de leitura (a biblioteca do agente) entram como --ro-bind dentro do diretório da execução', () => {
  const lista = montarConfinamento({
    motor: '/opt/codex/0.1/bin/codex', pastaDoMotor: '/opt/codex/0.1', diretorio: '/tmp/margem-job-x', casa: '/tmp/margem-casa-y',
    somenteLeitura: [{ origem: '/dados/biblioteca', destino: '/tmp/margem-job-x/biblioteca' }],
  });
  const indice = lista.indexOf('/dados/biblioteca');
  expect(lista.slice(indice - 1, indice + 2)).toEqual(['--ro-bind', '/dados/biblioteca', '/tmp/margem-job-x/biblioteca']);
  // Depois do diretório gravável (senão o bind dele cobriria o anexo) e antes do motor.
  expect(indice).toBeGreaterThan(lista.findIndex((item, i) => item === '--bind' && lista[i + 1] === '/tmp/margem-job-x'));
  expect(indice).toBeLessThan(lista.indexOf('--chdir'));
  const gravaveis = lista.flatMap((item, i) => (item === '--bind' ? [lista[i + 1]] : []));
  expect(gravaveis).toEqual(['/tmp/margem-casa-y', '/tmp/margem-job-x']);
  expect(lista.at(-1)).toBe('/opt/codex/0.1/bin/codex');
});

// ------------------------------------------------------------------ J114: modo nativo (macOS, Windows)

test('confinamento padrão por sistema: bwrap no Linux, sandbox do próprio Codex no macOS e no Windows', () => {
  expect(confinamentoPadrao({}, 'codex', 'linux')).toMatchObject({ tipo: 'bwrap', bwrap: '/usr/bin/bwrap', motor: MOTOR_PADRAO });
  expect(confinamentoPadrao({ MARGEM_CODEX_MOTOR: '/r/codex' }, 'codex', 'darwin')).toMatchObject({ tipo: 'nativo', motor: '/r/codex', politica: 'perfil' });
  // S-04: no Windows o read-only não nega leitura; o padrão é o modelo sem ferramentas.
  expect(confinamentoPadrao({ MARGEM_CODEX_MOTOR: 'C:\\r\\codex.exe' }, 'codex', 'win32')).toMatchObject({ tipo: 'nativo', politica: 'sem-ferramentas', sandboxDoWindows: 'unelevated' });
  expect(confinamentoPadrao({ MARGEM_CODEX_SANDBOX: 'somente-leitura' }, 'codex', 'win32')).toMatchObject({ politica: 'somente-leitura' });
  expect(confinamentoPadrao({ MARGEM_CODEX_SANDBOX: 'sem-ferramentas' }, 'codex', 'darwin')).toMatchObject({ politica: 'sem-ferramentas' });
  // Escolhas explícitas; valor desconhecido é erro, nunca um isolamento mais fraco em silêncio.
  expect(confinamentoPadrao({ MARGEM_CONFINAMENTO: 'nativo', MARGEM_BWRAP: '/opt/bwrap' }, 'codex', 'linux')).toMatchObject({ tipo: 'nativo', bwrap: '/opt/bwrap', politica: 'perfil' });
  expect(confinamentoPadrao({ MARGEM_CODEX_SANDBOX: 'perfil', MARGEM_WINDOWS_SANDBOX: 'mxc' }, 'codex', 'win32')).toMatchObject({ politica: 'perfil', sandboxDoWindows: 'mxc' });
  expect(() => confinamentoPadrao({ MARGEM_CONFINAMENTO: 'nenhum' }, 'codex', 'linux')).toThrow(/MARGEM_CONFINAMENTO/u);
  expect(() => confinamentoPadrao({ MARGEM_WINDOWS_SANDBOX: 'desligado' }, 'codex', 'win32')).toThrow(/MARGEM_WINDOWS_SANDBOX/u);
});

test('política nativa: perfil nega a raiz e só lê o diretório e os anexos, sem rede; Windows escolhe o sandbox', () => {
  const perfil = politicaNativa({ politica: 'perfil', plataforma: 'darwin', sandboxDoWindows: 'unelevated', diretorio: '/private/var/margem-job-x', leituras: ['/dados/biblioteca'] });
  expect(perfil.topo).toEqual([`default_permissions = "${PERFIL_DO_MARGEM}"`]);
  const texto = perfil.tabelas.join('\n');
  expect(texto).toContain('":root" = "deny"');
  expect(texto).toContain('":minimal" = "read"');
  expect(texto).toContain('"/private/var/margem-job-x" = "read"');
  expect(texto).toContain('"/dados/biblioteca" = "read"');
  expect(texto).toMatch(/\[permissions\.margem-leitura\.network\]\nenabled = false/u);
  expect(texto).not.toMatch(/= "write"/u);
  expect(texto).not.toContain('[windows]');
  const windows = politicaNativa({ politica: 'somente-leitura', plataforma: 'win32', sandboxDoWindows: 'unelevated', diretorio: 'C:\\T\\margem-job-x', leituras: [] });
  expect(windows).toEqual({ topo: [], tabelas: ['[windows]', 'sandbox = "unelevated"'] });
  // Caminho do Windows escapado como cadeia TOML.
  const comBarra = politicaNativa({ politica: 'perfil', plataforma: 'win32', sandboxDoWindows: 'elevated', diretorio: 'C:\\T\\job', leituras: [] });
  expect(comBarra.tabelas).toContain('"C:\\\\T\\\\job" = "read"');
});

test('com o perfil o --sandbox sai da linha; o prompt depois de -- fica intacto', () => {
  const linha = ['exec', '--sandbox', 'read-only', '-C', '/d', '--', 'leia --sandbox'];
  expect(argumentosNativos(linha, 'perfil')).toEqual(['exec', '-C', '/d', '--', 'leia --sandbox']);
  expect(argumentosNativos(linha, 'somente-leitura')).toEqual(linha);
  // S-04: sem ferramentas, o read-only fica e os recursos que dão ferramentas ao modelo saem, antes do --.
  expect(argumentosNativos(linha, 'sem-ferramentas')).toEqual([
    'exec', '--sandbox', 'read-only', '-C', '/d',
    '--disable', 'shell_tool', '--disable', 'unified_exec', '--disable', 'code_mode_host', '--', 'leia --sandbox',
  ]);
});

test('S-04 · sem ferramentas: o prompt vai pela entrada padrão, com o prompt.md e os arquivos de texto embutidos', async () => {
  const registro: Chamada[] = [];
  const entradas: string[] = [];
  const gerar = spawnEncenado(registro);
  const comEntrada = ((arquivo: string, argumentos: readonly string[], opcoes: SpawnOptions) => {
    const filho = (gerar as unknown as (a: string, b: readonly string[], c: SpawnOptions) => ChildProcess)(arquivo, argumentos, opcoes);
    const pedacos: string[] = [];
    Object.defineProperty(filho, 'stdin', { value: { on: () => undefined, end: (texto: string) => { pedacos.push(texto); entradas.push(pedacos.join('')); } } });
    return filho;
  }) as unknown as typeof spawn;
  const base0 = await pedido();
  await writeFile(join(base0.diretorioEntrada, 'prompt.md'), 'INSTRUCOES LONGAS DA TAREFA\n');
  await writeFile(join(base0.diretorioEntrada, 'figura.png'), pngDeTeste(2, 2));
  await writeFile(join(base0.diretorioEntrada, 'binario.dat'), Buffer.from([0, 1, 2, 255]));
  const confinamento: Confinamento = { tipo: 'nativo', bwrap: '', motor, plataforma: 'win32', politica: 'sem-ferramentas' };
  const { PONTEIRO_DO_PROMPT } = await import('./entrada.js');
  const resultado = await executarCodex({ ...base0, prompt: PONTEIRO_DO_PROMPT }, { capacidades: CAPACIDADES, confinamento, gerar: comEntrada });
  expect(resultado.estado).toBe('ok');
  const argumentos = registro[0]?.argumentos ?? [];
  expect(argumentos.at(-1)).toBe('-');
  expect(argumentos.slice(argumentos.indexOf('--sandbox'), argumentos.indexOf('--sandbox') + 2)).toEqual(['--sandbox', 'read-only']);
  for (const recurso of ['shell_tool', 'unified_exec', 'code_mode_host']) expect(argumentos.join(' ')).toContain(`--disable ${recurso}`);
  const texto = entradas[0] ?? '';
  expect(texto.startsWith('INSTRUCOES LONGAS DA TAREFA')).toBe(true);
  expect(texto).toContain('<<<arquivo parte.txt>>>\ntexto da parte\n<<<fim de parte.txt>>>');
  expect(texto).not.toContain('<<<arquivo prompt.md>>>');
  expect(texto).not.toMatch(/figura\.png|binario\.dat|schema\.json/u);
});

test('S-04 · sem ferramentas exige --disable na CLI, e a geração de imagem cai no read-only', async () => {
  const confinamento: Confinamento = { tipo: 'nativo', bwrap: '', motor, plataforma: 'win32', politica: 'sem-ferramentas' };
  const semDisable: Capacidades = { ...CAPACIDADES, flags: { ...CAPACIDADES.flags, '--disable': false } };
  const registro: Chamada[] = [];
  expect(await executarCodex(await pedido(), { capacidades: semDisable, confinamento, gerar: spawnEncenado(registro) }))
    .toMatchObject({ estado: 'falhou', codigo: 'cli_incompativel' });
  expect(registro).toEqual([]);
  // A imagem passa pelo modo de código: a execução vai com o prompt por argumento e sem os --disable.
  await executarCodex(await pedido(true), { capacidades: CAPACIDADES, confinamento, gerar: spawnEncenado(registro) });
  expect(registro[0]?.argumentos).not.toContain('--disable');
  expect(registro[0]?.argumentos.at(-1)).toBe('leia');
});

test('ambiente nativo: casa temporária como perfil, PATH só do sistema, nada do worker', () => {
  const origem = { PATH: '/home/u/bin:/usr/bin', HOME: '/home/u', DATABASE_URL: 'postgres://x:senha@h/b', LANG: 'pt_BR.UTF-8', TMPDIR: '/var/folders/u' };
  const mac = ambienteNativo('/T/casa', origem, 'darwin');
  expect(mac).toEqual({ HOME: '/T/casa', CODEX_HOME: join('/T/casa', '.codex'), LANG: 'pt_BR.UTF-8', PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: join('/T/casa', 'tmp') });
  const windows = ambienteNativo('C:\\T\\casa', {
    Path: 'C:\\Users\\u\\bin', SYSTEMROOT: 'C:\\Windows', USERPROFILE: 'C:\\Users\\u', APPDATA: 'C:\\Users\\u\\AppData\\Roaming',
    PATHEXT: '.COM;.EXE', DATABASE_URL: 'postgres://x:senha@h/b', GITHUB_TOKEN: 'ghp_x',
  }, 'win32');
  expect(windows.SystemRoot).toBe('C:\\Windows');
  expect(windows.USERPROFILE).toBe('C:\\T\\casa');
  expect(windows.APPDATA).toBe(join('C:\\T\\casa', 'AppData', 'Roaming'));
  expect(windows.TEMP).toBe(join('C:\\T\\casa', 'tmp'));
  expect(windows.PATH).toContain(join('C:\\Windows', 'System32'));
  expect(windows.PATH).not.toContain('Users');
  expect(windows.PATHEXT).toBe('.COM;.EXE');
  expect(JSON.stringify(windows)).not.toMatch(/senha|ghp_/u);
});

test('W-04: proxy e certificados chegam ao Codex no modo nativo (Windows e macOS) e no bwrap', () => {
  const rede = { HTTPS_PROXY: 'http://proxy:3128', NODE_EXTRA_CA_CERTS: 'C:\\ca.pem' };
  const windows = ambienteNativo('C:\\T\\casa', { SYSTEMROOT: 'C:\\Windows', ...rede, DATABASE_URL: 'postgres://x:senha@h/b' }, 'win32');
  expect(windows).toMatchObject({ ...rede, NO_PROXY: '127.0.0.1,localhost,::1' });
  expect(ambienteNativo('/T/casa', { https_proxy: 'http://proxy:3128' }, 'darwin').https_proxy).toBe('http://proxy:3128');
  const confinado = ambienteConfinado('/T/casa', { PATH: '/usr/bin', https_proxy: 'http://proxy:3128', SSL_CERT_FILE: '/etc/ssl/empresa.pem' });
  expect(confinado).toMatchObject({ https_proxy: 'http://proxy:3128', SSL_CERT_FILE: '/etc/ssl/empresa.pem', PATH: '/usr/bin:/bin', HOME: '/T/casa' });
  expect(JSON.stringify(windows)).not.toContain('senha');
});

test('nativo: roda o motor direto, sem bwrap, cwd no diretório e a política no config.toml da casa', async () => {
  const registro: Chamada[] = [];
  let configuracao = '';
  const anexo = join(base, 'biblioteca');
  await mkdir(anexo);
  await writeFile(join(anexo, 'livro.md'), '# livro');
  const confinamento: Confinamento = { tipo: 'nativo', bwrap: join(base, 'nao-existe'), motor, plataforma: 'darwin', politica: 'perfil' };
  let anexoVisto = '';
  const resultado = await executarCodex({ ...await pedido(), anexos: [{ nome: 'biblioteca', origem: anexo }] }, {
    capacidades: CAPACIDADES, confinamento,
    gerar: spawnEncenado(registro, async (ambiente) => {
      configuracao = await readFile(join(ambiente.CODEX_HOME ?? '', 'config.toml'), 'utf8');
      anexoVisto = await readFile(join(registro[0]?.opcoes.cwd as string, 'biblioteca', 'livro.md'), 'utf8');
    }),
  });
  expect(resultado.estado).toBe('ok');
  const chamada = registro[0];
  expect(chamada?.arquivo).toBe(motor);
  expect(chamada?.argumentos[0]).toBe('exec');
  expect(chamada?.argumentos).not.toContain('--sandbox');
  expect(chamada?.argumentos.join(' ')).toContain('cli_auth_credentials_store="file"');
  const ambiente = chamada?.opcoes.env as Record<string, string>;
  expect(ambiente.HOME).toMatch(/margem-casa-/u);
  expect(ambiente.PATH).toBe('/usr/bin:/bin:/usr/sbin:/sbin');
  expect(JSON.stringify(ambiente)).not.toMatch(/senha|5435/u);
  expect(chamada?.opcoes.cwd).toMatch(/margem-job-/u);
  // A linha do modelo do usuário e a política; chaves de topo antes das tabelas.
  const linhas = configuracao.split('\n');
  expect(linhas.slice(0, 2)).toEqual([`default_permissions = "${PERFIL_DO_MARGEM}"`, 'model = "gpt-6-astra"']);
  expect(configuracao).toContain('":root" = "deny"');
  expect(configuracao).toContain(`${JSON.stringify(anexo)} = "read"`);
  // A pasta da versão do Codex (o binário se reexecuta dentro do sandbox).
  expect(configuracao).toContain(`${JSON.stringify(join(base, 'versao'))} = "read"`);
  expect(anexoVisto).toBe('# livro');
  expect(existsSync(ambiente.HOME ?? '')).toBe(false);
});

test('nativo sem o motor do Codex: falha fechada com a variável a corrigir', async () => {
  const registro: Chamada[] = [];
  const resultado = await executarCodex(await pedido(), {
    capacidades: CAPACIDADES, confinamento: { tipo: 'nativo', bwrap: '', motor: join(base, 'nao-existe'), plataforma: 'darwin' }, gerar: spawnEncenado(registro),
  });
  expect(resultado).toMatchObject({ estado: 'falhou', codigo: 'cli_incompativel' });
  expect(resultado.estado === 'falhou' ? resultado.mensagem : '').toContain('MARGEM_CODEX_MOTOR');
  expect(registro).toEqual([]);
});

test('R2-4: quem monta o prompt sabe quando o modelo roda sem ferramentas', () => {
  expect(modeloSemFerramentas({}, 'win32')).toBe(true);
  expect(modeloSemFerramentas({}, 'linux')).toBe(false);
  expect(modeloSemFerramentas({}, 'darwin')).toBe(false);
  expect(modeloSemFerramentas({ MARGEM_CODEX_SANDBOX: 'sem-ferramentas' }, 'linux')).toBe(true);
  expect(modeloSemFerramentas({ MARGEM_CODEX_SANDBOX: 'somente-leitura' }, 'win32')).toBe(false);
  expect(modeloSemFerramentas({ MARGEM_EXECUTOR: 'falso' }, 'win32')).toBe(false);
});
