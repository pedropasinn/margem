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

test.each(['md', 'pdf'])('progresso por palavras acompanha a âncora e conclusão em %s', async (formato) => {
  const bloco = { ...capituloExemplo.blocos[0]!, texto: 'palavra '.repeat(460) };
  let offset = 0;
  const leitor = { current: { localizar: () => null, ancoraVisivel: () => ({ bloco_id: bloco.id, offset_utf16: offset }) } } satisfies { current: ApiDoLeitor };
  const snapshot = { ...capituloExemplo, formato, blocos: [bloco], palavras_no_livro: { antes: 460, total: 1380 } };
  const { rerender } = render(<ProgressoNoLivro snapshot={snapshot} leitor={leitor} concluido={false} />);
  expect(screen.getByText('33% do livro')).toBeDefined();
  expect(screen.getByText('~2 min no capítulo · ~4 min no livro')).toBeDefined();
  offset = 230 * 8;
  fireEvent.scroll(window);
  await waitFor(() => expect(screen.getByText('50% do livro')).toBeDefined());
  expect(screen.getByText('~1 min no capítulo · ~3 min no livro')).toBeDefined();
  rerender(<ProgressoNoLivro snapshot={{ ...snapshot, palavras_no_livro: { antes: 920, total: 1380 } }} leitor={leitor} concluido />);
  expect(screen.getByText('100% do livro')).toBeDefined();
  expect(screen.getByText('~0 min no capítulo · ~0 min no livro')).toBeDefined();
  rerender(<ProgressoNoLivro snapshot={{ ...capituloExemplo, blocos: [] }} leitor={leitor} concluido={false} />);
  expect(screen.queryByText(/% do livro/)).toBeNull();
});
