/**
 * Resolução dos programas externos (J114): padrão de antes sem variáveis, contrato do app de desktop
 * com elas, e as formas do motor (venv e congelado) nos três sistemas, simulados.
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  CODEX_DA_IMAGEM, FONTE_DA_IMAGEM, codexCli, codexMotor, comExtensao, comandoDoMotor, conferirExecutavel, conferirFerramentas,
  ffmpeg, ffprobe, fonteDosRotulos, noAppDeDesktop, procurarNoPath, pythonDoVenv, ytDlp,
} from './executaveis.js';

let base = '';
beforeEach(async () => { base = await mkdtemp(join(tmpdir(), 'margem-teste-executaveis-')); });
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

test('sem variáveis, tudo como antes do J114 (Docker e o servidor de desenvolvimento)', () => {
  const ambiente = {};
  expect(ffmpeg({ ambiente })).toBe('ffmpeg');
  expect(ffprobe({ ambiente })).toBe('ffprobe');
  expect(ytDlp({ ambiente })).toBe('yt-dlp');
  expect(codexMotor({ ambiente, plataforma: 'linux' })).toBe(CODEX_DA_IMAGEM);
  expect(codexCli({ ambiente })).toBe('codex');
  expect(fonteDosRotulos({ ambiente })).toBe(FONTE_DA_IMAGEM);
  expect(noAppDeDesktop(ambiente)).toBe(false);
});

test('as variáveis do contrato mandam; vazias ou só espaço valem como ausentes', () => {
  const ambiente = {
    MARGEM_FFMPEG: '/r/bin/ffmpeg', MARGEM_FFPROBE: '/r/bin/ffprobe', MARGEM_YT_DLP: '/r/bin/yt-dlp',
    MARGEM_CODEX_MOTOR: '/r/bin/codex', MARGEM_FONTE: '/r/fontes/DejaVuSans.ttf',
  };
  expect(ffmpeg({ ambiente })).toBe('/r/bin/ffmpeg');
  expect(ffprobe({ ambiente })).toBe('/r/bin/ffprobe');
  expect(ytDlp({ ambiente })).toBe('/r/bin/yt-dlp');
  expect(codexMotor({ ambiente })).toBe('/r/bin/codex');
  expect(fonteDosRotulos({ ambiente })).toBe('/r/fontes/DejaVuSans.ttf');
  expect(ffmpeg({ ambiente: { MARGEM_FFMPEG: '  ' } })).toBe('ffmpeg');
  // Fora do app, a CLI das consultas continua a do PATH (numa instalação de servidor, pode ser um embrulho do login).
  expect(codexCli({ ambiente })).toBe('codex');
});

test('no app de desktop a CLI do Codex é o binário dos recursos; MARGEM_CODEX vence', () => {
  expect(codexCli({ ambiente: { MARGEM_APP_DESKTOP: '1', MARGEM_CODEX_MOTOR: 'C:\\r\\bin\\codex.exe' } })).toBe('C:\\r\\bin\\codex.exe');
  expect(codexCli({ ambiente: { MARGEM_APP_DESKTOP: '1', MARGEM_CODEX_MOTOR: '/a', MARGEM_CODEX: '/b' } })).toBe('/b');
  expect(codexCli({ ambiente: { MARGEM_APP_DESKTOP: '1' } })).toBe('codex');
  // Fora do Linux não há a imagem Docker: o padrão do motor é o `codex` do PATH.
  expect(codexMotor({ ambiente: {}, plataforma: 'darwin' })).toBe('codex');
  expect(codexMotor({ ambiente: {}, plataforma: 'win32' })).toBe('codex');
});

test('venv do motor por sistema e extensão .exe só no Windows', () => {
  expect(pythonDoVenv('/app', 'linux')).toBe(join('/app', 'motor', '.venv', 'bin', 'python'));
  expect(pythonDoVenv('/app', 'win32')).toBe(join('/app', 'motor', '.venv', 'Scripts', 'python.exe'));
  expect(comExtensao('ffmpeg', 'win32')).toBe('ffmpeg.exe');
  expect(comExtensao('ffmpeg.EXE', 'win32')).toBe('ffmpeg.EXE');
  expect(comExtensao('ffmpeg', 'darwin')).toBe('ffmpeg');
});

test('motor no venv: os mesmos módulos e scripts de antes', () => {
  const ctx = { ambiente: {}, raiz: '/app', plataforma: 'linux' as const };
  const python = join('/app', 'motor', '.venv', 'bin', 'python');
  expect(comandoDoMotor('ingest', ['--entrada', 'a.pdf'], ctx)).toEqual({ programa: python, argumentos: ['-m', 'margem_motor.ingest', '--entrada', 'a.pdf'], cwd: join('/app', 'motor'), congelado: false });
  expect(comandoDoMotor('pdf-anotado', [], ctx).argumentos).toEqual(['-m', 'margem_motor.pdf_anotado']);
  expect(comandoDoMotor('renderizar-paginas', ['x'], ctx)).toMatchObject({ argumentos: [join('/app', 'tools', 'renderizar-paginas.py'), 'x'], cwd: '/app' });
  expect(comandoDoMotor('exercicios', ['descobrir'], ctx).argumentos[0]).toBe(join('/app', 'tools', 'exercicios-do-pdf.py'));
  expect(comandoDoMotor('verificar', [], ctx).argumentos).toEqual(['-c', 'import margem_motor.ingest']);
  expect(comandoDoMotor('miniatura', ['a', 'b', '640'], ctx).argumentos.slice(-3)).toEqual(['a', 'b', '640']);
  // Pythons alternativos de antes continuam valendo sem o motor congelado.
  expect(comandoDoMotor('camada-da-transcricao', [], { ...ctx, ambiente: { MARGEM_PYTHON_CAMADA: '/opt/py' } }).programa).toBe('/opt/py');
  expect(comandoDoMotor('exercicios', [], { ...ctx, ambiente: { MARGEM_PYTHON_EXERCICIOS: '/opt/py2' } }).programa).toBe('/opt/py2');
});

test('motor congelado: margem-motor <subcomando>, que vence os Pythons alternativos', () => {
  const ambiente = { MARGEM_MOTOR: 'C:\\r\\motor\\margem-motor.exe', MARGEM_PYTHON_CAMADA: '/opt/py' };
  const comando = comandoDoMotor('camada-da-transcricao', ['o.pdf', 't', 's.pdf'], { ambiente, raiz: '/app', plataforma: 'win32' });
  expect(comando).toEqual({ programa: 'C:\\r\\motor\\margem-motor.exe', argumentos: ['camada-da-transcricao', 'o.pdf', 't', 's.pdf'], cwd: '/app', congelado: true });
  // Um Python explícito (os testes) volta para a forma do venv.
  expect(comandoDoMotor('ingest', [], { ambiente, raiz: '/app', python: '/py' }).programa).toBe('/py');
});

async function executavelFalso(caminho: string): Promise<void> {
  await mkdir(join(caminho, '..'), { recursive: true });
  await writeFile(caminho, '#!/bin/sh\n');
  await chmod(caminho, 0o755);
}

test('conferência: caminho absoluto, PATH e mensagens que dizem qual variável corrigir', async () => {
  const ffmpegFalso = join(base, 'bin', 'ffmpeg');
  await executavelFalso(ffmpegFalso);
  await writeFile(join(base, 'bin', 'sem-x'), 'x');
  expect(await conferirExecutavel(ffmpegFalso, 'MARGEM_FFMPEG', { ambiente: { MARGEM_FFMPEG: ffmpegFalso } })).toEqual({ ok: true, caminho: ffmpegFalso, origem: 'MARGEM_FFMPEG' });
  const errado = await conferirExecutavel(join(base, 'nada'), 'MARGEM_FFMPEG', { ambiente: { MARGEM_FFMPEG: join(base, 'nada') } });
  expect(errado.ok).toBe(false);
  expect(errado.mensagem).toContain('MARGEM_FFMPEG aponta para');
  if (process.platform !== 'win32') expect((await conferirExecutavel(join(base, 'bin', 'sem-x'), 'MARGEM_FFMPEG', { ambiente: {} })).ok).toBe(false);
  expect(await conferirExecutavel('ffmpeg', 'MARGEM_FFMPEG', { ambiente: { PATH: `/inexistente:${join(base, 'bin')}` } }))
    .toEqual({ ok: true, caminho: ffmpegFalso, origem: 'padrão' });
  const ausente = await conferirExecutavel('yt-dlp', 'MARGEM_YT_DLP', { ambiente: { PATH: join(base, 'bin') } });
  expect(ausente).toMatchObject({ ok: false, origem: 'padrão' });
  expect(ausente.mensagem).toContain('MARGEM_YT_DLP');
});

test('Windows simulado: PATH com ";" e .exe; script .cmd recusado (o spawn sem shell não roda .cmd)', async () => {
  await writeFile(join(base, 'ffprobe.exe'), 'MZ');
  const ambiente = { PATH: `C:\\nada;${base}` };
  expect(await procurarNoPath('ffprobe', { ambiente, plataforma: 'win32' })).toBe(join(base, 'ffprobe.exe'));
  const cmd = await conferirExecutavel('C:\\npm\\codex.cmd', 'MARGEM_CODEX_MOTOR', { ambiente: {}, plataforma: 'win32' });
  expect(cmd.ok).toBe(false);
  expect(cmd.mensagem).toContain('.exe');
});

test('as ferramentas de uma vez: o congelado é conferido quando MARGEM_MOTOR existe', async () => {
  const motor = join(base, 'motor', 'margem-motor');
  await executavelFalso(motor);
  const ferramentas = await conferirFerramentas({ ambiente: { MARGEM_MOTOR: motor, PATH: join(base, 'vazio') }, raiz: base, plataforma: 'linux' });
  expect(ferramentas.motor).toEqual({ ok: true, caminho: motor, origem: 'MARGEM_MOTOR' });
  expect(ferramentas.ffmpeg.ok).toBe(false);
  expect(ferramentas.codex).toMatchObject({ ok: false, caminho: CODEX_DA_IMAGEM });
});
