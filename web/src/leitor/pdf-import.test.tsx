import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { capituloExemplo } from './fixtures/capitulo-exemplo';

// I-08: o import dinâmico do PDF falha na primeira vez (rede caiu, app atualizado no meio) e funciona na segunda.
const estado = vi.hoisted(() => ({ falhar: true }));
vi.mock('./PdfReader', () => {
  if (estado.falhar) throw new Error('Failed to fetch dynamically imported module');
  return { PdfReader: () => <article aria-label="PDF original" /> };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test('I-08: a falha do import do PDF mostra recuperação, sem derrubar a página', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const { DocumentReader } = await import('./DocumentReader');
  render(<main><p>Biblioteca</p><DocumentReader documento_id="documento" snapshot={{ ...capituloExemplo, formato: 'pdf', geometria_disponivel: true }} /></main>);
  expect(await screen.findByRole('alert')).toBeDefined();
  expect(screen.getByText('Não foi possível abrir o PDF.')).toBeDefined();
  expect(screen.getByText('Biblioteca')).toBeDefined();
  expect(screen.getByRole('alert').textContent).not.toMatch(/Failed to fetch/);
  expect(screen.getByRole('link', { name: 'Voltar à biblioteca' }).getAttribute('href')).toBe('/');
  // Tentar novamente cria outro import (o `lazy` guardaria a rejeição): com a rede de volta, o PDF abre.
  estado.falhar = false;
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(await screen.findByRole('article', { name: 'PDF original' })).toBeDefined();
  expect(screen.queryByRole('alert')).toBeNull();
});
