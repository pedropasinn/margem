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
import { confinamentoPadrao, montarConfinamento, modeloDoUsuario, MOTOR_PADRAO, type Confinamento } from './confinamento.js';
import { pngDeTeste } from './fake.js';

const SESSAO = '01a0eac1-3876-75e2-ab56-b4081137959f';
const CAPACIDADES: Capacidades = {
  versao: 'codex-cli 0.159.2',
  flags: { ...Object.fromEntries(FLAGS_NECESSARIAS.map((flag) => [flag, true])), '--json': true },
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
  const resultado = await executarCodex(await pedido(), {
    capacidades: CAPACIDADES, confinamento,
    gerar: spawnEncenado(registro, async (ambiente) => {
      const { readdir } = await import('node:fs/promises');
      vistoNaCasa = await readdir(ambiente.CODEX_HOME ?? '');
    }),
  });
  expect(resultado.estado).toBe('ok');
  const chamada = registro[0];
  expect(chamada?.arquivo).toBe(bwrap);
  const argumentos = chamada?.argumentos ?? [];
  const posicaoDoMotor = argumentos.indexOf(motor);
  expect(posicaoDoMotor).toBeGreaterThan(0);
  expect(argumentos[posicaoDoMotor + 1]).toBe('exec');
  expect(argumentos).toContain('--sandbox');
  expect(argumentos.join(' ')).toContain('cli_auth_credentials_store="file"');
  const ambiente = chamada?.opcoes.env as Record<string, string>;
  expect(ambiente.HOME).toMatch(/margem-casa-/u);
  expect(ambiente.CODEX_HOME).toBe(join(ambiente.HOME ?? '', '.codex'));
  expect(JSON.stringify(ambiente)).not.toContain('senha');
  expect(JSON.stringify(ambiente)).not.toContain(codexDoUsuario);
  // A casa só tem a credencial e a linha do modelo; nada das sessões do usuário.
  expect(vistoNaCasa.sort()).toEqual(['auth.json', 'config.toml']);
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
