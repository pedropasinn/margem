import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, expect, test, vi } from 'vitest';
import { MiniaturasDoPdf } from './MiniaturasDoPdf';

afterEach(cleanup);

test('usa o proxy recebido; fechar ou trocar o painel não destrói o PDF do leitor', async () => {
  const cancelar = vi.fn();
  const destruir = vi.fn();
  const pagina = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: vi.fn(() => ({ cancel: cancelar, promise: Promise.resolve() })),
  };
  const obterPagina = vi.fn(() => Promise.resolve(pagina));
  const documento = { numPages: 2, getPage: obterPagina, destroy: destruir } as unknown as PDFDocumentProxy;
  const aoIr = vi.fn();
  const { rerender, unmount } = render(<MiniaturasDoPdf documento={null} atual={1} aoIr={aoIr} />);
  expect(screen.getByRole('status').textContent).toContain('Abrindo');
  rerender(<MiniaturasDoPdf documento={documento} atual={1} aoIr={aoIr} />);
  await waitFor(() => expect(pagina.render).toHaveBeenCalledTimes(2));
  screen.getByRole('button', { name: 'Página 2' }).click();
  expect(aoIr).toHaveBeenCalledWith(2);
  rerender(<MiniaturasDoPdf documento={null} atual={null} aoIr={aoIr} />);
  expect(cancelar).toHaveBeenCalledTimes(2);
  unmount();
  expect(destruir).not.toHaveBeenCalled();
});
