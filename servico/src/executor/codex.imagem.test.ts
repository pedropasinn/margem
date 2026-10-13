/**
 * J70: imagem gerada pela ferramenta `image_gen` do Codex. O executor lê a sessão do evento
 * `thread.started` (`--json`) e recolhe os PNGs de `$CODEX_HOME/generated_images/<sessão>/` —
 * da própria sessão, nunca "o mais recente" da pasta. Sem CLI real: o `spawn` é encenado.
 */
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { ChildProcess, spawn } from 'node:child_process';
import { executarCodex, imagensDaSessao, pastaDasImagensDaSessao, sessaoDoEvento } from './codex.js';
import { FLAGS_NECESSARIAS, type Capacidades } from './capacidades.js';
import { pngDeTeste } from './fake.js';

const SESSAO = '01a0eac1-3876-75e2-ab56-b4081137959f';
const OUTRA = '01a0eac1-0000-75e2-ab56-b4081137959f';
const CAPACIDADES: Capacidades = {
  versao: 'codex-cli 0.154.0',
  flags: { ...Object.fromEntries(FLAGS_NECESSARIAS.map((flag) => [flag, true])), '--json': true },
  faltando: [],
};
let base = '';
let casa = '';
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'margem-teste-imagem-'));
  casa = join(base, 'codex-home');
  process.env.CODEX_HOME = casa;
});
afterEach(async () => { delete process.env.CODEX_HOME; await rm(base, { recursive: true, force: true }); });

function spawnComSessao(linhas: string[], registro: string[][], aoRodar?: () => Promise<void>): typeof spawn {
  return ((_arquivo: string, argumentos: readonly string[]) => {
    registro.push([...argumentos]);
    const filho = new EventEmitter() as unknown as ChildProcess & { stderr: Readable; stdout: Readable };
    filho.stderr = Readable.from([Buffer.from('reasoning effort: medium\n')]);
    // Eventos quebrados em pedaços arbitrários, como chegam pelo tubo.
    const texto = linhas.join('\n') + '\n';
    filho.stdout = Readable.from([Buffer.from(texto.slice(0, 20)), Buffer.from(texto.slice(20))]);
    Object.defineProperty(filho, 'pid', { value: undefined });
    Object.defineProperty(filho, 'exitCode', { value: null, configurable: true, writable: true });
    filho.kill = () => true;
    setTimeout(() => {
      const alvo = argumentos.at(argumentos.indexOf('--output-last-message') + 1)!;
      void (aoRodar ?? (() => Promise.resolve()))()
        .then(() => writeFile(alvo, JSON.stringify({ descricao: 'Um farol ao entardecer.' })))
        .then(() => { filho.emit('close', 0); });
    }, 5);
    return filho;
  }) as unknown as typeof spawn;
}

async function pedido() {
  const entrada = join(base, 'entrada');
  await mkdir(entrada, { recursive: true });
  const schema = join(base, 'schema.json');
  await writeFile(schema, JSON.stringify({ type: 'object', additionalProperties: false, required: ['descricao'], properties: { descricao: { type: 'string' } } }));
  return { diretorioEntrada: entrada, prompt: 'gere', schema, prazoMs: 5_000, esforco: 'medium', gerarImagem: true, diretorioArtefatos: join(base, 'artefatos') };
}

test('lê o thread_id só do evento thread.started e com formato de sessão', () => {
  expect(sessaoDoEvento(`{"type":"thread.started","thread_id":"${SESSAO}"}`)).toBe(SESSAO);
  expect(sessaoDoEvento('{"type":"turn.started"}')).toBeUndefined();
  expect(sessaoDoEvento('{"type":"thread.started","thread_id":"../../etc"}')).toBeUndefined();
  expect(sessaoDoEvento('thread.started lixo')).toBeUndefined();
  expect(pastaDasImagensDaSessao(SESSAO, { HOME: '/home/x' })).toBe(`/home/x/.codex/generated_images/${SESSAO}`);
  expect(pastaDasImagensDaSessao(SESSAO, { HOME: '/home/x', CODEX_HOME: '/c' })).toBe(`/c/generated_images/${SESSAO}`);
  expect(() => pastaDasImagensDaSessao('../x')).toThrow();
});

test('recolhe os PNGs da sessão da própria execução, não os de outra sessão mais nova', async () => {
  const registro: string[][] = [];
  const minha = join(casa, 'generated_images', SESSAO);
  const alheia = join(casa, 'generated_images', OUTRA);
  const resultado = await executarCodex(await pedido(), {
    capacidades: CAPACIDADES,
    gerar: spawnComSessao([`{"type":"thread.started","thread_id":"${SESSAO}"}`, '{"type":"turn.started"}'], registro, async () => {
      await mkdir(minha, { recursive: true }); await mkdir(alheia, { recursive: true });
      await writeFile(join(minha, 'exec-b.png'), pngDeTeste(4, 3));
      await writeFile(join(minha, 'exec-a.png'), pngDeTeste(5, 3));
      await utimes(join(minha, 'exec-b.png'), 1000, 1000);
      await utimes(join(minha, 'exec-a.png'), 2000, 2000);
      await writeFile(join(alheia, 'exec-z.png'), pngDeTeste(2, 2));
    }),
  });
  expect(registro[0]).toContain('--json');
  expect(registro[0]?.join(' ')).toContain('model_reasoning_effort="medium"');
  expect(resultado.estado).toBe('ok');
  if (resultado.estado === 'ok') expect(resultado.imagens).toEqual([join(minha, 'exec-b.png'), join(minha, 'exec-a.png')]);
  expect(await imagensDaSessao(join(casa, 'nada'))).toEqual([]);
});

test('sem sessão anunciada ou sem PNG na pasta da sessão, a tentativa falha com motivo', async () => {
  const semSessao = await executarCodex(await pedido(), { capacidades: CAPACIDADES, gerar: spawnComSessao(['{"type":"turn.started"}'], []) });
  expect(semSessao).toMatchObject({ estado: 'falhou', codigo: 'sem_imagem' });
  const semPng = await executarCodex(await pedido(), { capacidades: CAPACIDADES, gerar: spawnComSessao([`{"type":"thread.started","thread_id":"${SESSAO}"}`], []) });
  expect(semPng).toMatchObject({ estado: 'falhou', codigo: 'sem_imagem', mensagem: 'O Codex terminou sem gerar imagem.' });
  const semJson = await executarCodex(await pedido(), { capacidades: { ...CAPACIDADES, flags: { ...CAPACIDADES.flags, '--json': false } }, gerar: spawnComSessao([], []) });
  expect(semJson).toMatchObject({ estado: 'falhou', codigo: 'cli_incompativel' });
});
