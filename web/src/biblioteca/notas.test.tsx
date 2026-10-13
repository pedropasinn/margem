import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { citacaoFormatada, Notas } from './Notas';
import { caminhoDaRota, rotaDoCaminho } from './rotas';
import type { FiltroDeNotas } from './api';
import type { ItemDeNota } from './tipos';

beforeEach(() => { vi.stubGlobal('innerWidth', 1440); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const DOC = '0'.repeat(25) + '1';
const OUTRO = '0'.repeat(25) + '2';
function nota(parcial: Partial<ItemDeNota> = {}): ItemDeNota {
  return {
    id: '0'.repeat(24) + 'N1', especie: 'anotacao', tipo: 'duvida', rotulo: 'Dúvida', cor: null,
    citacao: 'A vontade segue o bem apreendido', nota: 'Sempre, mesmo?', marca_id: null,
    documento: { id: DOC, titulo: 'Tratado', autor: 'Tomás' }, versao_id: '0'.repeat(25) + 'V', bloco_id: '0'.repeat(25) + 'B',
    capitulo: { id: '0'.repeat(25) + 'S', titulo: 'Da vontade' }, pagina: '12',
    link: `/ler/${DOC}/${'0'.repeat(25)}S?bloco=${'0'.repeat(25)}B`, criada_em: '2026-09-30T12:00:00.000Z', atualizada_em: '2026-09-30T12:00:00.000Z',
    ...parcial,
  };
}

test('rotas das notas: da biblioteca e do documento', () => {
  expect(rotaDoCaminho('/notas')).toEqual({ nome: 'notas' });
  expect(rotaDoCaminho(`/documentos/${DOC}/notas`)).toEqual({ nome: 'notas', documento_id: DOC });
  expect(rotaDoCaminho(`/documentos/${DOC}`)).toEqual({ nome: 'documento', documento_id: DOC });
  expect(caminhoDaRota({ nome: 'notas' })).toBe('/notas');
  expect(caminhoDaRota({ nome: 'notas', documento_id: DOC })).toBe(`/documentos/${DOC}/notas`);
});

test('copiar como citação: aspas, autor, título em itálico e página; sem página, o capítulo', () => {
  expect(citacaoFormatada(nota())).toBe('“A vontade segue o bem apreendido” — Tomás, *Tratado*, p. 12');
  expect(citacaoFormatada(nota({ pagina: null }))).toBe('“A vontade segue o bem apreendido” — Tomás, *Tratado*, cap. Da vontade');
  expect(citacaoFormatada(nota({ pagina: null, capitulo: { id: 'x', titulo: 'Capítulo 3' } }))).toBe('“A vontade segue o bem apreendido” — Tomás, *Tratado*, Capítulo 3');
  expect(citacaoFormatada(nota({ pagina: null, capitulo: null, documento: { id: DOC, titulo: 'Ensaio', autor: null } }))).toBe('“A vontade segue o bem apreendido” — *Ensaio*');
});

test('notas da biblioteca: agrupadas por documento, link ao trecho, cópia, filtro e exportação', async () => {
  const itens = [
    nota({ id: 'A', documento: { id: OUTRO, titulo: 'Ensaio', autor: null }, capitulo: null, pagina: null, link: `/ler/${OUTRO}?bloco=B0`, nota: 'Curto.', tipo: 'observacao', rotulo: 'Observação' }),
    nota({ id: 'B', especie: 'grifo', tipo: 'tese', rotulo: 'Tese', nota: null, cor: { claro: '#c00', escuro: '#f66' }, citacao: 'A razão comum basta' }),
    nota({ id: 'C' }),
  ];
  const pedidos: FiltroDeNotas[] = [];
  const carregar = vi.fn((filtro: FiltroDeNotas) => {
    pedidos.push(filtro);
    return Promise.resolve({ itens: filtro.tipo ? itens.filter((item) => item.tipo === filtro.tipo) : itens });
  });
  const escrever = vi.fn(() => Promise.resolve());
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: escrever } });
  const ir = vi.fn();
  render(<Notas ir={ir} carregar={carregar} />);
  expect(await screen.findByRole('heading', { level: 1, name: 'Notas' })).toBeTruthy();
  await screen.findByText('3 notas');
  const tratado = screen.getByRole('region', { name: 'Tratado' });
  expect(within(tratado).getByText('Grifo · Tese')).toBeTruthy();
  expect(within(tratado).getAllByText('Da vontade')).toHaveLength(2);
  const link = within(tratado).getAllByRole('link', { name: /^Ir ao trecho/ })[1]!;
  expect(link.getAttribute('href')).toBe(nota().link);

  // O link passa pelo roteador: o caminho muda com o ?bloco= e o popstate avisa a rota.
  const aoVoltar = vi.fn();
  window.addEventListener('popstate', aoVoltar);
  fireEvent.click(link);
  expect(window.location.pathname + window.location.search).toBe(nota().link);
  expect(aoVoltar).toHaveBeenCalled();
  window.removeEventListener('popstate', aoVoltar);

  fireEvent.click(within(tratado).getAllByRole('button', { name: /Copiar como citação/ })[1]!);
  expect(escrever).toHaveBeenCalledWith('“A vontade segue o bem apreendido” — Tomás, *Tratado*, p. 12');
  expect(await within(tratado).findByText('Citação copiada')).toBeTruthy();

  expect(screen.getByRole('link', { name: 'CSV' }).getAttribute('href')).toBe('/api/notas/exportacao.csv');
  // Filtrar por tipo pede à API o recorte e a exportação acompanha.
  fireEvent.click(screen.getByRole('combobox', { name: 'Tipo de nota' }));
  fireEvent.click(screen.getByRole('option', { name: 'Dúvida' }));
  await waitFor(() => expect(screen.getByText('1 nota')).toBeTruthy());
  expect(pedidos.at(-1)).toEqual({ tipo: 'duvida' });
  expect(screen.getByRole('link', { name: 'JSON' }).getAttribute('href')).toBe('/api/notas/exportacao.json?tipo=duvida');

  fireEvent.click(screen.getByRole('link', { name: 'Só as deste documento' }));
  expect(ir).toHaveBeenCalledWith({ nome: 'notas', documento_id: DOC });
});

test('notas de um documento: por capítulo, com o título do documento e o voltar', async () => {
  const carregar = vi.fn(() => Promise.resolve({ itens: [nota({ id: 'X', capitulo: { id: 'S1', titulo: 'Da razão' } }), nota({ id: 'Y' })] }));
  const ir = vi.fn();
  render(<Notas documento_id={DOC} ir={ir} carregar={carregar} />);
  expect(await screen.findByRole('heading', { level: 1, name: 'Tratado' })).toBeTruthy();
  expect(carregar).toHaveBeenCalledWith({ documento: DOC });
  expect(screen.getByRole('heading', { level: 2, name: 'Da razão' })).toBeTruthy();
  expect(screen.getByRole('heading', { level: 2, name: 'Da vontade' })).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: 'Documento' })).toBeNull();
  expect(screen.getByRole('link', { name: 'CSV' }).getAttribute('href')).toBe(`/api/notas/exportacao.csv?documento=${DOC}`);
  act(() => { fireEvent.click(screen.getByRole('link', { name: /Voltar ao documento/ })); });
  expect(ir).toHaveBeenCalledWith({ nome: 'documento', documento_id: DOC });
});

test('sem notas: o vazio diz o que falta', async () => {
  render(<Notas ir={vi.fn()} carregar={() => Promise.resolve({ itens: [] })} />);
  expect(await screen.findByText('Nenhuma anotação ou grifo ainda.')).toBeTruthy();
});
