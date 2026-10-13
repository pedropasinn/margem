/** Modo instalado (J100): banco em qualquer endereço, escuta no container, porta publicada e login do Codex. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { lerUrlBanco } from './db/configuracao.js';
import { confinamentoPadrao, sincronizarPorCopia } from './executor/confinamento.js';
import { autorizarEscrita } from './http/autenticacao.js';
import { enderecoDeEscuta, hostsAceitos, origensAceitas, portaPublica } from './http/ambiente.js';
import { conferirOrigem } from './http/seguranca.js';
import { modoDeOperacao, modoInstalado } from './instalacao.js';

const NOMES = ['MARGEM_MODO', 'MARGEM_PORTA', 'MARGEM_PORTA_PUBLICA', 'MARGEM_ENDERECO', 'MARGEM_ORIGENS', 'MARGEM_TAILSCALE_HOST'] as const;
const originais = new Map<string, string | undefined>();
const temporarios: string[] = [];

beforeEach(() => {
  for (const nome of NOMES) {
    originais.set(nome, process.env[nome]);
    Reflect.deleteProperty(process.env, nome);
  }
});

afterEach(async () => {
  for (const nome of NOMES) {
    const valor = originais.get(nome);
    if (valor === undefined) Reflect.deleteProperty(process.env, nome);
    else process.env[nome] = valor;
  }
  for (const pasta of temporarios.splice(0)) await rm(pasta, { recursive: true, force: true });
});

test('MARGEM_MODO: vazio é o padrão, "instalado" liga o modo, outro valor derruba', () => {
  expect(modoDeOperacao({})).toBe('padrao');
  expect(modoInstalado({ MARGEM_MODO: 'instalado' })).toBe(true);
  expect(() => modoDeOperacao({ MARGEM_MODO: 'hospedado' })).toThrow('MARGEM_MODO');
});

test('banco: o padrão continua preso a 127.0.0.1:5435', () => {
  expect(() => lerUrlBanco({ DATABASE_URL: 'postgres://u:s@postgres:5432/margem' })).toThrow('127.0.0.1:5435');
  expect(lerUrlBanco({ DATABASE_URL: 'postgres://u:s@127.0.0.1:5435/margem' }).port).toBe('5435');
});

test('banco: no modo instalado aceita qualquer host e porta, mas exige DATABASE_URL e recusa parâmetros', () => {
  const instalado = { MARGEM_MODO: 'instalado' };
  expect(lerUrlBanco({ ...instalado, DATABASE_URL: 'postgres://u:s@postgres:5432/margem' }).hostname).toBe('postgres');
  expect(lerUrlBanco({ ...instalado, DATABASE_URL: 'postgresql://u:s@10.0.0.7/margem' }).hostname).toBe('10.0.0.7');
  expect(() => lerUrlBanco(instalado)).toThrow('DATABASE_URL ausente');
  expect(() => lerUrlBanco({ ...instalado, DATABASE_URL: 'postgres://u:s@postgres:5432/margem?host=/tmp' })).toThrow('sem parâmetros');
  expect(() => lerUrlBanco({ ...instalado, DATABASE_URL: 'mysql://u:s@postgres/margem' })).toThrow('postgres://');
});

test('escuta: 127.0.0.1 no padrão (MARGEM_ENDERECO ignorado); 0.0.0.0 ou MARGEM_ENDERECO no instalado', () => {
  expect(enderecoDeEscuta({ MARGEM_ENDERECO: '0.0.0.0' })).toBe('127.0.0.1');
  expect(enderecoDeEscuta({ MARGEM_MODO: 'instalado' })).toBe('0.0.0.0');
  expect(enderecoDeEscuta({ MARGEM_MODO: 'instalado', MARGEM_ENDERECO: '::' })).toBe('::');
});

test('porta publicada: só conta no modo instalado e entra em Host e Origin aceitos', () => {
  process.env.MARGEM_PORTA_PUBLICA = '18730';
  expect(portaPublica()).toBe(8730);
  expect(hostsAceitos()).not.toContain('localhost:18730');
  process.env.MARGEM_MODO = 'instalado';
  expect(portaPublica()).toBe(18730);
  expect(hostsAceitos()).toEqual(expect.arrayContaining(['localhost:18730', '127.0.0.1:18730', 'localhost:8730']));
  expect(origensAceitas()).toEqual(expect.arrayContaining(['http://localhost:18730', 'http://127.0.0.1:18730']));
  expect(() => { conferirOrigem('POST', 'http://localhost:18730', 'localhost:18730', '/api/documentos'); }).not.toThrow();
  expect(() => { conferirOrigem('POST', 'http://evil.example', 'localhost:18730', '/api/documentos'); }).toThrow('origem_recusada');
  expect(() => { conferirOrigem('GET', undefined, 'margem.lan:18730', '/api/documentos'); }).toThrow('host_recusado');
  process.env.MARGEM_PORTA_PUBLICA = 'abc';
  expect(() => portaPublica()).toThrow('MARGEM_PORTA_PUBLICA');
});

test('sem login no modo instalado: o pedido pela porta local escreve como dono', () => {
  process.env.MARGEM_MODO = 'instalado';
  process.env.MARGEM_PORTA_PUBLICA = '18730';
  expect(autorizarEscrita({ margem: '1', host: 'localhost:18730' })).toEqual({ usuario: 'dono', via: 'loopback' });
  expect(() => autorizarEscrita({ margem: undefined, host: 'localhost:18730' })).toThrow('cabecalho_ausente');
});

test('login do Codex no modo instalado: copia para a casa antes e devolve o token renovado depois', async () => {
  const usuario = await mkdtemp(join(tmpdir(), 'margem-codex-usuario-'));
  const casa = await mkdtemp(join(tmpdir(), 'margem-codex-casa-'));
  temporarios.push(usuario, casa);
  await writeFile(join(usuario, 'auth.json'), '{"token":"a"}');
  const confinamento = confinamentoPadrao({ MARGEM_MODO: 'instalado', CODEX_HOME: usuario, MARGEM_CODEX_MOTOR: '/opt/codex' });
  expect(confinamento.motor).toBe('/opt/codex');
  await confinamento.sincronizar?.(casa);
  expect(await readFile(join(casa, 'auth.json'), 'utf8')).toBe('{"token":"a"}');
  await writeFile(join(casa, 'auth.json'), '{"token":"b"}');
  await sincronizarPorCopia(casa, usuario);
  expect(await readFile(join(usuario, 'auth.json'), 'utf8')).toBe('{"token":"b"}');
});

test('login do Codex: sem auth.json do usuário, a casa fica sem credencial', async () => {
  const usuario = await mkdtemp(join(tmpdir(), 'margem-codex-usuario-'));
  const casa = await mkdtemp(join(tmpdir(), 'margem-codex-casa-'));
  temporarios.push(usuario, casa);
  await sincronizarPorCopia(casa, usuario);
  await expect(readFile(join(casa, 'auth.json'), 'utf8')).rejects.toThrow();
});
