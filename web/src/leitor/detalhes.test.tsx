import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { SinteseDoCapitulo } from './SinteseDoCapitulo';
import { ProgressoNoLivro } from './ProgressoNoLivro';
import { capituloExemplo } from './fixtures/capitulo-exemplo';
import type { ApiDoLeitor } from './tipos';

afterEach(cleanup);

test('síntese só existe com movimento, começa recolhida e mantém texto literal seguro', () => {
  const { rerender, container } = render(<SinteseDoCapitulo movimento={null} />);
  expect(container.textContent).toBe('');
  rerender(<SinteseDoCapitulo movimento={{ texto: '<b>A hipótese conduz à conclusão.</b>', etapas: [{ unidade_ids: [], descricao: 'Estabelece a hipótese.' }] }} />);
  const resumo = screen.getByText('Síntese do capítulo · IA');
  expect(resumo.closest('details')?.open).toBe(false);
  fireEvent.click(resumo);
  expect(resumo.closest('details')?.open).toBe(true);
  expect(screen.getByText('<b>A hipótese conduz à conclusão.</b>')).toBeDefined();
  expect(container.querySelector('b')).toBeNull();
  expect(screen.getByText('Estabelece a hipótese.')).toBeDefined();
});

test.each(['md', 'pdf'])('progresso por palavras acompanha a âncora e conclusão em %s, só com o percentual', async (formato) => {
  const bloco = { ...capituloExemplo.blocos[0]!, texto: 'palavra '.repeat(460) };
  let offset = 0;
  const leitor = { current: { localizar: () => null, ancoraVisivel: () => ({ bloco_id: bloco.id, offset_utf16: offset }) } } satisfies { current: ApiDoLeitor };
  const snapshot = { ...capituloExemplo, formato, blocos: [bloco], palavras_no_livro: { antes: 460, total: 1380 } };
  const { rerender, container } = render(<ProgressoNoLivro snapshot={snapshot} leitor={leitor} concluido={false} />);
  expect(screen.getByText('33%')).toBeDefined();
  // Nada de minutos por capítulo ou por livro.
  expect(container.textContent).not.toMatch(/min/);
  offset = 230 * 8;
  fireEvent.scroll(window);
  await waitFor(() => expect(screen.getByText('50%')).toBeDefined());
  rerender(<ProgressoNoLivro snapshot={{ ...snapshot, palavras_no_livro: { antes: 920, total: 1380 } }} leitor={leitor} concluido />);
  expect(screen.getByText('100%')).toBeDefined();
  rerender(<ProgressoNoLivro snapshot={{ ...capituloExemplo, blocos: [] }} leitor={leitor} concluido={false} />);
  expect(screen.queryByText(/%/)).toBeNull();
});

test('no fim da rolagem o capítulo conta inteiro e, na última parte, o documento chega a 100%', async () => {
  const bloco = { ...capituloExemplo.blocos[0]!, texto: 'palavra '.repeat(400) };
  // A âncora visível fica no meio do bloco (o topo da tela), como no fim de um capítulo longo.
  const leitor = { current: { localizar: () => null, ancoraVisivel: () => ({ bloco_id: bloco.id, offset_utf16: 8 * 200 }) } } satisfies { current: ApiDoLeitor };
  // Um "Referências" curto depois: o fim da rolagem não é o fim do documento.
  const snapshot = { ...capituloExemplo, blocos: [bloco], palavras_no_livro: { antes: 0, total: 420 } };
  const altura = Object.getOwnPropertyDescriptor(document.documentElement, 'scrollHeight');
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 2000 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  try {
    const { rerender } = render(<ProgressoNoLivro snapshot={snapshot} leitor={leitor} concluido={false} />);
    await waitFor(() => expect(screen.getByText('47%')).toBeDefined());
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 1200 });
    fireEvent.scroll(window);
    await waitFor(() => expect(screen.getByText('95%')).toBeDefined());
    rerender(<ProgressoNoLivro snapshot={snapshot} leitor={leitor} concluido={false} ultimaParte />);
    await waitFor(() => expect(screen.getByText('100%')).toBeDefined());
  } finally {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    if (altura) Object.defineProperty(document.documentElement, 'scrollHeight', altura); else delete (document.documentElement as unknown as Record<string, unknown>)['scrollHeight'];
  }
});
