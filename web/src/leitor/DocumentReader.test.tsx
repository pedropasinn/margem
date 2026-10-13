import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DocumentReader, usaPdf } from './DocumentReader';
import { capituloExemplo } from './fixtures/capitulo-exemplo';
vi.mock('./PdfReader', () => ({ PdfReader: () => <article aria-label="PDF original" /> }));
afterEach(cleanup);
test('seleciona PDF apenas quando o snapshot tem geometria', async () => {
  expect(usaPdf(capituloExemplo)).toBe(false);
  expect(usaPdf({ ...capituloExemplo, formato: 'pdf', geometria_disponivel: false })).toBe(false);
  expect(usaPdf({ ...capituloExemplo, formato: 'md', geometria_disponivel: true })).toBe(false);
  render(<DocumentReader documento_id="documento" snapshot={{ ...capituloExemplo, formato: 'pdf', geometria_disponivel: true }} />);
  expect(await screen.findByRole('article', { name: 'PDF original' })).toBeTruthy();
});
test('Markdown mantém o leitor de texto', () => {
  const { container } = render(<DocumentReader documento_id="documento" snapshot={{ ...capituloExemplo, formato: 'md' }} />);
  expect(container.querySelectorAll('[data-bloco]')).toHaveLength(capituloExemplo.blocos.length);
});
