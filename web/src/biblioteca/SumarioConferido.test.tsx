/** Conferência do sumário (J164): o aviso na página do documento e o interruptor das Configurações. */
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConferenciaDoSumarioNasConfiguracoes, SumarioConferido, type SituacaoDoSumario } from './SumarioConferido';
afterEach(cleanup);

const SUSPEITO: SituacaoDoSumario = {
  versao_id: 'v', estado: 'suspeito', problemas: ['O número de cada capítulo virou um capítulo vazio.', 'Há um capítulo repetido.'],
  antes: [{ titulo: '1', nivel: 1 }, { titulo: 'THE CHALLENGE OF THE FUTURE', nivel: 1 }, { titulo: 'STARTUP THINKING', nivel: 2 }],
  depois: [{ titulo: '1. The Challenge of the Future', nivel: 1 }, { titulo: 'Startup Thinking', nivel: 2 }],
};

test('suspeito: aviso discreto, sugestão antes e depois, e usar a sugestão avisa a página', async () => {
  const decidir = vi.fn(() => Promise.resolve({ situacao: { ...SUSPEITO, estado: 'aplicada' as const } }));
  const aoMudar = vi.fn();
  render(<SumarioConferido documentoId="d" aoMudar={aoMudar} fontes={{ ler: () => Promise.resolve({ situacao: SUSPEITO }), decidir }} />);
  expect(await screen.findByText('O sumário deste livro pode estar errado.')).toBeTruthy();
  expect(screen.queryByText('Agora')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Ver sugestão' }));
  expect(screen.getByText('Agora')).toBeTruthy();
  expect(screen.getByText('1. The Challenge of the Future')).toBeTruthy();
  expect(screen.getByText('Há um capítulo repetido.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Usar o sumário sugerido' }));
  await waitFor(() => expect(aoMudar).toHaveBeenCalledOnce());
  expect(decidir).toHaveBeenCalledWith('d', 'usar');
  expect(await screen.findByText(/O sumário sugerido está em uso/u)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Voltar ao original' })).toBeTruthy();
});

test('sem sugestão só "Manter"; conferindo, ok ou mantido não mostram nada', async () => {
  const decidir = vi.fn(() => Promise.resolve({ situacao: { ...SUSPEITO, estado: 'mantida' as const } }));
  const { container } = render(<SumarioConferido documentoId="d" fontes={{ ler: () => Promise.resolve({ situacao: { ...SUSPEITO, depois: null } }), decidir }} />);
  expect(await screen.findByText('O sumário deste livro pode estar errado.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Ver sugestão' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Manter' }));
  await waitFor(() => expect(container.textContent).toBe(''));
  expect(decidir).toHaveBeenCalledWith('d', 'manter');
  cleanup();
  for (const estado of ['conferindo', 'ok', 'mantida'] as const) {
    const ler = vi.fn(() => Promise.resolve({ situacao: { ...SUSPEITO, estado } }));
    const { container: vazio } = render(<SumarioConferido documentoId="d" fontes={{ ler, decidir }} />);
    await waitFor(() => expect(ler).toHaveBeenCalled());
    expect(vazio.textContent).toBe('');
    cleanup();
  }
});

test('R3-6: com a tela aberta, a sugestão aparece quando a conferência termina', async () => {
  const respostas = [{ ...SUSPEITO, estado: 'conferindo' as const }, { ...SUSPEITO, estado: 'conferindo' as const }, SUSPEITO];
  const ler = vi.fn(() => Promise.resolve({ situacao: respostas.shift() ?? SUSPEITO }));
  render(<SumarioConferido documentoId="d" intervalo={5} fontes={{ ler, decidir: vi.fn() }} />);
  expect(await screen.findByText('O sumário deste livro pode estar errado.')).toBeTruthy();
  expect(ler).toHaveBeenCalledTimes(3);
  // Terminada a conferência, para de perguntar.
  await new Promise((resolver) => setTimeout(resolver, 40));
  expect(ler).toHaveBeenCalledTimes(3);
});

test('Configurações: o interruptor vem ligado e grava a escolha', async () => {
  const gravar = vi.fn((valor: boolean) => Promise.resolve({ conferir_ao_importar: valor }));
  render(<ConferenciaDoSumarioNasConfiguracoes fontes={{ ler: () => Promise.resolve({ conferir_ao_importar: true }), gravar }} />);
  const interruptor = await screen.findByRole('switch', { name: 'Conferir o sumário com o ChatGPT ao importar' });
  expect(interruptor.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(interruptor);
  await waitFor(() => expect(gravar).toHaveBeenCalledWith(false));
  expect(await screen.findByText('Salvo.')).toBeTruthy();
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
});
