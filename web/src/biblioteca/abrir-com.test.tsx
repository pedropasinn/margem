/** U-08: "Abrir com" o Margem leva o PDF/EPUB à tela Adicionar, na fila, esperando a confirmação. */
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { App } from './App';
import type { ArquivoAberto, PonteDosArquivos } from './abrir-com';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); localStorage.clear(); delete (window as { margemDesktop?: unknown }).margemDesktop; });

const json = (corpo: unknown) => new Response(JSON.stringify(corpo), { status: 200 });
const aberto = (nome: string): ArquivoAberto => ({ nome, tipo: nome.endsWith('.pdf') ? 'application/pdf' : 'application/epub+zip', dados: new Uint8Array([37, 80, 68, 70]) });

function ponteFalsa(iniciais: ArquivoAberto[]) {
  let fila = [...iniciais];
  let avisar: () => void = () => {};
  const ponte = {
    pegar: vi.fn(() => { const entregues = fila; fila = []; return Promise.resolve(entregues); }),
    aoChegar: vi.fn((ouvir: () => void) => { avisar = ouvir; return () => { avisar = () => {}; }; }),
  } satisfies PonteDosArquivos;
  (window as { margemDesktop?: unknown }).margemDesktop = { arquivos: ponte };
  return { ponte, chegar: async (novos: ArquivoAberto[]) => { fila.push(...novos); await act(async () => { avisar(); await Promise.resolve(); }); } };
}

test('o app aberto por um arquivo mostra Adicionar com ele na fila, sem enviar', async () => {
  const fetch = vi.fn(() => Promise.resolve(json({ documentos: [] })));
  vi.stubGlobal('fetch', fetch);
  ponteFalsa([aberto('Meu livro com acentuação.epub'), aberto('artigo.pdf')]);
  render(<App />);
  const lista = await screen.findByRole('list', { name: 'Fila' }, { timeout: 5000 });
  expect(window.location.pathname).toBe('/adicionar/documento');
  expect(within(lista).getByText('Meu livro com acentuação.epub')).toBeDefined();
  expect(within(lista).getByText('artigo.pdf')).toBeDefined();
  expect(screen.getByRole('button', { name: 'Adicionar 2 arquivos' })).toBeDefined();
  expect(fetch.mock.calls.some((chamada) => (chamada as unknown[])[1] !== undefined && ((chamada as unknown[])[1] as RequestInit).method === 'POST')).toBe(false);
});

test('com Adicionar já aberta, o que chega entra na mesma fila', async () => {
  window.history.replaceState(null, '', '/adicionar/video');
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ documentos: [] }))));
  const { chegar } = ponteFalsa([]);
  render(<App />);
  await screen.findByRole('heading', { name: 'Adicionar à biblioteca' }, { timeout: 5000 });
  await chegar([aberto('um.pdf')]);
  expect(window.location.pathname).toBe('/adicionar/documento');
  expect(within(await screen.findByRole('list', { name: 'Fila' }, { timeout: 5000 })).getByText('um.pdf')).toBeDefined();
  await chegar([aberto('dois.pdf')]);
  expect(within(screen.getByRole('list', { name: 'Fila' })).getByText('dois.pdf')).toBeDefined();
  expect(screen.getByRole('button', { name: 'Adicionar 2 arquivos' })).toBeDefined();
});
