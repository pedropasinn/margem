/**
 * Configuração salva sobrevive a atualizações: o padrão (`http://localhost:8730`) só vale quando
 * não há nada no `storage.local`, e nem a leitura nem a instalação/atualização gravam por cima.
 */
import { beforeEach, expect, test, vi } from 'vitest';

type Ouvinte = (...argumentos: unknown[]) => unknown;

const estado = vi.hoisted(() => ({
  armazenado: {} as Record<string, unknown>,
  gravacoes: 0,
  ouvintes: {} as Record<string, ((...argumentos: unknown[]) => unknown)[]>,
}));

vi.mock('webextension-polyfill', () => {
  const evento = (nome: string) => ({
    addListener: (ouvinte: Ouvinte) => { (estado.ouvintes[nome] ??= []).push(ouvinte); },
  });
  const browser = {
    storage: {
      local: {
        get: (chaves: string[]) => Promise.resolve(Object.fromEntries(chaves.filter((c) => c in estado.armazenado).map((c) => [c, estado.armazenado[c]]))),
        set: (valores: Record<string, unknown>) => { estado.gravacoes += 1; Object.assign(estado.armazenado, valores); return Promise.resolve(); },
        clear: () => { estado.gravacoes += 1; estado.armazenado = {}; return Promise.resolve(); },
        remove: () => { estado.gravacoes += 1; return Promise.resolve(); },
      },
    },
    runtime: { id: 'teste', onMessage: evento('onMessage'), onInstalled: evento('onInstalled'), getURL: (c: string) => `chrome-extension://teste/${c}` },
    notifications: { onClicked: evento('notifications.onClicked'), create: () => Promise.resolve('aviso') },
    contextMenus: { onClicked: evento('contextMenus.onClicked'), removeAll: () => Promise.resolve(), create: () => undefined },
    permissions: { contains: () => Promise.resolve(true) },
    action: { setBadgeText: () => Promise.resolve(), setBadgeBackgroundColor: () => Promise.resolve() },
    tabs: { get: () => Promise.resolve({}), create: () => Promise.resolve({}) },
    scripting: { executeScript: () => Promise.resolve([]) },
  };
  return { default: browser };
});

const { lerConfiguracao, gravarConfiguracao } = await import('../src/configuracao');
const { SERVIDOR_PADRAO } = await import('../src/servidor');

beforeEach(() => {
  estado.armazenado = {};
  estado.gravacoes = 0;
});

test('sem nada salvo, o padrão é o Margem local na 8730', async () => {
  expect(SERVIDOR_PADRAO).toBe('http://localhost:8730');
  expect(await lerConfiguracao()).toEqual({ servidor: 'http://localhost:8730', token: '' });
  expect(estado.gravacoes).toBe(0);
});

test('um endereço já salvo (de uma versão anterior) continua valendo', async () => {
  estado.armazenado = { servidor: 'https://margem.exemplo.ts.net', token: 'abc' };
  expect(await lerConfiguracao()).toEqual({ servidor: 'https://margem.exemplo.ts.net', token: 'abc' });
  expect(estado.armazenado.servidor).toBe('https://margem.exemplo.ts.net');
  expect(estado.gravacoes).toBe(0);
});

test('valor salvo inválido cai no padrão só na leitura, sem apagar o que está no storage', async () => {
  estado.armazenado = { servidor: 'ftp://x' };
  expect((await lerConfiguracao()).servidor).toBe(SERVIDOR_PADRAO);
  expect(estado.armazenado.servidor).toBe('ftp://x');
});

test('instalar ou atualizar a extensão não grava a configuração', async () => {
  estado.armazenado = { servidor: 'http://192.168.0.10:8730', token: '' };
  await import('../src/fundo');
  const aoInstalar = estado.ouvintes.onInstalled ?? [];
  expect(aoInstalar.length).toBeGreaterThan(0);
  for (const motivo of ['install', 'update', 'chrome_update']) for (const ouvinte of aoInstalar) ouvinte({ reason: motivo, previousVersion: '0.1.0' });
  await new Promise((resolver) => setTimeout(resolver, 0));
  expect(estado.gravacoes).toBe(0);
  expect(await lerConfiguracao()).toEqual({ servidor: 'http://192.168.0.10:8730', token: '' });
});

test('gravar e ler de volta', async () => {
  await gravarConfiguracao({ servidor: 'http://localhost:9000', token: '' });
  expect(await lerConfiguracao()).toEqual({ servidor: 'http://localhost:9000', token: '' });
});
