import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AncoraV1 } from '@margem/contratos';
import { AlvosDoPdf } from './AlvosDoPdf';
import { capituloExemplo } from './fixtures/capitulo-exemplo';
import type { PropsDoLeitor } from './ReaderViewport';

const M01 = '0'.repeat(23) + 'M01';
const linhas = [{ x: 0, y: 0, largura: 100, altura: 10 }, { x: 0, y: 12, largura: 100, altura: 10 }, { x: 0, y: 24, largura: 60, altura: 10 }];
// O leitor do PDF de verdade precisa do pdf.js; aqui, só os alvos sobre uma página, como ele os desenha.
vi.mock('./PdfReader', () => ({
  PdfReader: (props: PropsDoLeitor) => <article className="capitulo capitulo-pdf"><div className="pdf-pagina" data-pagina={1}>
    <AlvosDoPdf pagina={1} marcas={props.snapshot.marcas.filter((m) => m.id === M01)} linhas={() => linhas} paginasDaAncora={() => [1]} />
  </div>{props.margem}</article>,
}));
beforeEach(() => { vi.stubGlobal('innerWidth', 1440); vi.stubGlobal('scrollBy', () => undefined); window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });

const ancora = (citacao: string): AncoraV1 => ({ versao_id: 'V', bloco_id: 'B', inicio_utf16: 0, fim_utf16: citacao.length, citacao, prefixo: '', sufixo: '' });

test('U-09: grifo de três linhas é um só alvo de teclado; numa página seguinte, nenhum', () => {
  const { container, rerender } = render(<AlvosDoPdf pagina={1} marcas={[{ id: 'A', ancora: ancora('Um trecho longo') }]} linhas={() => linhas} paginasDaAncora={() => [1, 2]} />);
  expect(container.querySelectorAll('span[data-marcas="A"]')).toHaveLength(3);
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Um trecho longo' }).getAttribute('tabindex')).toBe('0');
  expect(container.querySelectorAll('span[aria-hidden="true"]:not([tabindex])')).toHaveLength(2);
  // A continuação do mesmo grifo na página 2 só serve ao clique.
  rerender(<AlvosDoPdf pagina={2} marcas={[{ id: 'A', ancora: ancora('Um trecho longo') }]} linhas={() => linhas} paginasDaAncora={() => [1, 2]} />);
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(container.querySelectorAll('[tabindex]')).toHaveLength(0);
});

test.each([[' ', 'Espaço'], ['Enter', 'Enter']])('U-09: no leitor, %j (%s) ativa o alvo do grifo no PDF', async (tecla) => {
  const { ReaderController } = await import('./ReaderController');
  const { container } = render(<ReaderController snapshot={{ ...capituloExemplo, formato: 'pdf', geometria_disponivel: true }} documento_id={'0'.repeat(22) + 'D001'} />);
  await waitFor(() => expect(container.querySelector('.pdf-alvos')).not.toBeNull());
  const focaveis = container.querySelectorAll<HTMLElement>('.pdf-alvos [tabindex="0"]');
  expect(focaveis).toHaveLength(1);
  const nota = () => container.querySelector<HTMLElement>(`[data-nota="${M01}"]`)!;
  expect(within(nota()).queryByRole('button', { name: 'Confirmar' })).toBeNull();
  expect(fireEvent.keyDown(focaveis[0]!, { key: tecla })).toBe(false);
  expect(within(nota()).getByRole('button', { name: 'Confirmar' })).toBeDefined();
});
