import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { abrirSessaoDoDesktop, ponteDaChave } from './chave-local';
import { ChaveParaIntegracoes } from './ChaveParaIntegracoes';

const CHAVE = 'abcdefghijklmnopqrstuvwxyz0123456789_-ABCDw';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); delete (window as { margemDesktop?: unknown }).margemDesktop; });

test('S-01: no app, a página troca a chave do preload pelo cookie da sessão; no navegador, nada', async () => {
  const buscar = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response(null, { status: 204 })));
  vi.stubGlobal('fetch', buscar);
  await abrirSessaoDoDesktop();
  expect(ponteDaChave()).toBeNull();
  expect(buscar).not.toHaveBeenCalled();
  (window as { margemDesktop?: unknown }).margemDesktop = { chaveLocal: () => Promise.resolve(CHAVE) };
  await abrirSessaoDoDesktop();
  expect(buscar).toHaveBeenCalledTimes(1);
  const [url, init] = buscar.mock.calls[0]!;
  expect(url).toBe('/api/sessao');
  expect(init?.method).toBe('POST');
  const cabecalhos = new Headers(init?.headers);
  expect(cabecalhos.get('authorization')).toBe(`Bearer ${CHAVE}`);
  expect(cabecalhos.get('x-margem')).toBe('1');
  // Falha não impede a página de abrir.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
  await expect(abrirSessaoDoDesktop()).resolves.toBeUndefined();
});

test('Configurações: a chave aparece só pelo final e "Copiar" leva a chave inteira', async () => {
  const escrever = vi.fn<(texto: string) => Promise<void>>(() => Promise.resolve());
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: escrever } });
  render(<ChaveParaIntegracoes ponte={() => Promise.resolve(CHAVE)} />);
  expect(screen.getByRole('heading', { name: 'Chave para a extensão e o Obsidian' })).toBeTruthy();
  await waitFor(() => { expect(screen.getByText('ABCDw'.slice(-4))).toBeTruthy(); });
  expect(document.body.textContent).not.toContain(CHAVE);
  fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
  await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('Chave copiada.'); });
  expect(escrever).toHaveBeenCalledWith(CHAVE);
});

test('no navegador a seção não existe', () => {
  const { container } = render(<ChaveParaIntegracoes ponte={null} />);
  expect(container.innerHTML).toBe('');
});
