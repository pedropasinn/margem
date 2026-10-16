import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createRef } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ApiDoLeitor } from './tipos';
import { capituloExemplo } from './fixtures/capitulo-exemplo';

// O pdf.js de verdade não roda no jsdom: um documento falso cujas páginas nunca terminam de desenhar.
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {}, version: 'teste', TextLayer: class {},
  getDocument: () => ({ promise: Promise.resolve({ numPages: 130, getPage: () => new Promise(() => undefined) }), destroy: () => Promise.resolve() }),
}));
vi.mock('./pdf-worker?worker&url', () => ({ default: '' }));
vi.mock('pdfjs-dist/web/pdf_viewer.css', () => ({}));

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('scrollBy', () => undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function lote(inicio: number, fim: number) {
  const paginas = Array.from({ length: fim - inicio + 1 }, (_, i) => ({ numero: inicio + i, largura: 600, altura: 800, rotacao: 0 }));
  return { versao_id: capituloExemplo.versao_id, fonte: 'pdf_texto', motor: 'teste/1', paginas, palavras: [] };
}

test('I-06: o PDF abre com o primeiro lote de geometria; os outros chegam depois, sem esconder as páginas', async () => {
  const pendentes = new Map<string, (corpo: unknown) => void>();
  const pedidos: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    pedidos.push(url);
    const faixa = /paginas=(\d+)-(\d+)/.exec(url)!;
    const corpo = lote(Number(faixa[1]), Number(faixa[2]));
    if (faixa[1] === '1') return Promise.resolve(new Response(JSON.stringify(corpo)));
    return new Promise((resolver) => pendentes.set(faixa[1]!, () => resolver(new Response(JSON.stringify(corpo)))));
  });
  const { PdfReader } = await import('./PdfReader');
  const { container } = render(<PdfReader documento_id="D" snapshot={{ ...capituloExemplo, formato: 'pdf', geometria_disponivel: true, paginas: { inicio: 1, fim: 130 } }} />);
  // O primeiro lote basta para a leitura começar: as 60 páginas aparecem e o resto segue carregando.
  await waitFor(() => expect(container.querySelectorAll('.pdf-pagina')).toHaveLength(60));
  expect(screen.queryByText('Abrindo PDF…')).toBeNull();
  expect(screen.getByText('Carregando as próximas páginas…')).toBeDefined();
  expect(pedidos.map((url) => /paginas=([\d-]+)/.exec(url)![1])).toEqual(['1-60', '61-120']);
  pendentes.get('61')!({});
  await waitFor(() => expect(container.querySelectorAll('.pdf-pagina')).toHaveLength(120));
  await waitFor(() => expect(pendentes.has('121')).toBe(true));
  pendentes.get('121')!({});
  await waitFor(() => expect(container.querySelectorAll('.pdf-pagina')).toHaveLength(130));
  expect(screen.queryByText('Carregando as próximas páginas…')).toBeNull();
  expect([...container.querySelectorAll<HTMLElement>('.pdf-pagina')].map((p) => Number(p.dataset['pagina']))).toEqual(Array.from({ length: 130 }, (_, i) => i + 1));
});

test('R3-4: a posição na página 61 de um parágrafo que começa na 60 não se resolve antes do lote que a cobre', async () => {
  const bloco = capituloExemplo.blocos.find((b) => b.texto.split(' ').length >= 6)!;
  const palavras = [...bloco.texto.matchAll(/\S+/gu)].map((m) => ({ inicio: m.index, fim: m.index + m[0].length }));
  const metade = Math.floor(palavras.length / 2);
  const naPagina = (pagina: number, lista: typeof palavras) => lista.map((p) => ({ bloco_id: bloco.id, inicio_utf16: p.inicio, fim_utf16: p.fim, pagina, quad: [10, 10, 40, 10, 40, 20, 10, 20] }));
  const pendentes = new Map<string, () => void>();
  vi.stubGlobal('fetch', (url: string) => {
    const faixa = /paginas=(\d+)-(\d+)/.exec(url)!;
    const corpo = { ...lote(Number(faixa[1]), Number(faixa[2])),
      palavras: faixa[1] === '1' ? naPagina(60, palavras.slice(0, metade)) : faixa[1] === '61' ? naPagina(61, palavras.slice(metade)) : [] };
    if (faixa[1] === '1') return Promise.resolve(new Response(JSON.stringify(corpo)));
    return new Promise((resolver) => pendentes.set(faixa[1]!, () => resolver(new Response(JSON.stringify(corpo)))));
  });
  const { PdfReader } = await import('./PdfReader');
  const ref = createRef<ApiDoLeitor>();
  const { container } = render(<PdfReader ref={ref} documento_id="D" snapshot={{ ...capituloExemplo, formato: 'pdf', geometria_disponivel: true, paginas: { inicio: 1, fim: 130 } }} />);
  await waitFor(() => expect(container.querySelectorAll('.pdf-pagina')).toHaveLength(60));
  const salvo = palavras[metade + 1]!.inicio;
  expect(ref.current?.localizar(bloco.id, salvo)).toBeNull();
  // O começo do bloco, já carregado, continua achável.
  expect(ref.current?.localizar(bloco.id, 0)).not.toBeNull();
  pendentes.get('61')!();
  await waitFor(() => expect(container.querySelectorAll('.pdf-pagina')).toHaveLength(120));
  await waitFor(() => expect(ref.current?.localizar(bloco.id, salvo)).not.toBeNull());
});
