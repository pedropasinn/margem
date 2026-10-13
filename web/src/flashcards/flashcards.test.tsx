import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { caminhoDaRota, rotaDoCaminho } from '../biblioteca/rotas';
import type { ApiDosFlashcards, Flashcard, ListaDeCartoes } from './api';
import { Flashcards } from './Flashcards';
import { FormularioDeFlashcard } from './FormularioDeFlashcard';

beforeEach(() => { vi.stubGlobal('innerWidth', 1440); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const DOC = '0'.repeat(25) + '1';
const SECAO = '0'.repeat(25) + 'S';
const BLOCO = '0'.repeat(25) + 'B';
function cartao(n: number, parcial: Partial<Flashcard> = {}): Flashcard {
  return {
    id: `${'0'.repeat(24)}C${String(n)}`, documento: { id: DOC, titulo: 'Tratado', autor: 'Tomás' }, versao_id: '0'.repeat(25) + 'V',
    capitulo: { id: SECAO, titulo: 'Da vontade' },
    ancora: { versao_id: '0'.repeat(25) + 'V', bloco_id: BLOCO, inicio_utf16: 0, fim_utf16: 10, citacao: `trecho ${String(n)}`, prefixo: '', sufixo: '' },
    frente: `Pergunta ${String(n)}?`, verso: `Resposta ${String(n)}.`, origem: 'ia', criado_em: '2026-10-02T12:00:00.000Z', atualizado_em: '2026-10-02T12:00:00.000Z',
    agenda: { facilidade: 2.5, intervalo_dias: 0, repeticoes: 0, proxima_revisao: null, revisoes: 0 },
    link: `/ler/${DOC}/${SECAO}?bloco=${BLOCO}`, ...parcial,
  };
}

function apiFalsa(todos: Flashcard[], hoje: Flashcard[] = todos, em_curso: string[] = []) {
  const chamadas: string[] = [];
  const api: ApiDosFlashcards = {
    listar: vi.fn((filtro: { documento?: string; hoje?: boolean }): Promise<ListaDeCartoes> => {
      chamadas.push(`listar:${filtro.hoje ? 'hoje' : 'todos'}`);
      return Promise.resolve({ cartoes: filtro.hoje ? hoje : todos, em_curso });
    }),
    revisar: vi.fn((id: string, nota: number) => { chamadas.push(`revisar:${id}:${String(nota)}`); return Promise.resolve({ agenda: cartao(0).agenda }); }),
    editar: vi.fn((id: string, mudanca: { frente?: string }) => { chamadas.push(`editar:${id}:${mudanca.frente ?? ''}`); return Promise.resolve({ cartao: cartao(0) }); }),
    apagar: vi.fn((id: string) => { chamadas.push(`apagar:${id}`); return Promise.resolve(null); }),
  };
  return { api, chamadas };
}

test('rotas dos flashcards: da biblioteca e do documento, com a aba da lista', () => {
  expect(rotaDoCaminho('/flashcards')).toEqual({ nome: 'flashcards' });
  expect(rotaDoCaminho('/flashcards?aba=todos')).toEqual({ nome: 'flashcards', aba: 'todos' });
  expect(rotaDoCaminho(`/documentos/${DOC}/flashcards`)).toEqual({ nome: 'flashcards', documento_id: DOC });
  expect(caminhoDaRota({ nome: 'flashcards', documento_id: DOC, aba: 'todos' })).toBe(`/documentos/${DOC}/flashcards?aba=todos`);
  expect(caminhoDaRota({ nome: 'flashcards' })).toBe('/flashcards');
});

test('estudar: vira com clique e Espaço, responde com 1–4, Errei volta para o fim, contador e fim da sessão', async () => {
  const { api, chamadas } = apiFalsa([cartao(1), cartao(2)]);
  const { container } = render(<Flashcards documento_id={DOC} ir={() => undefined} api={api} />);
  await screen.findByText('Pergunta 1?');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Tratado');
  expect(screen.getByText('de 2', { exact: false }).textContent).toBe('1 de 2');
  const raiz = () => container.querySelector('.cartao-que-vira')!;
  expect(raiz().hasAttribute('data-virado')).toBe(false);
  expect(screen.getByText('Ver no texto').closest('a')!.getAttribute('href')).toBe(`/ler/${DOC}/${SECAO}?bloco=${BLOCO}`);
  // Antes de virar, as teclas de resposta não fazem nada.
  fireEvent.keyDown(window, { key: '3' });
  expect(chamadas.filter((c) => c.startsWith('revisar'))).toEqual([]);
  fireEvent.click(screen.getByRole('button', { pressed: false }));
  expect(raiz().hasAttribute('data-virado')).toBe(true);
  expect(raiz().hasAttribute('data-girou')).toBe(true);
  // Errei: o cartão 1 vai para o fim; vem o 2.
  fireEvent.click(screen.getByRole('button', { name: /Errei/ }));
  await screen.findByText('Pergunta 2?');
  expect(chamadas).toContain(`revisar:${cartao(1).id}:1`);
  expect(container.querySelector('.cartao-que-vira')!.hasAttribute('data-girou')).toBe(false);
  fireEvent.keyDown(window, { key: ' ' });
  fireEvent.keyDown(window, { key: '3' });
  await waitFor(() => expect(chamadas).toContain(`revisar:${cartao(2).id}:3`));
  await screen.findByText('Pergunta 1?');
  expect(screen.getByText('de 2', { exact: false }).textContent).toBe('2 de 2');
  fireEvent.keyDown(window, { key: 'Enter' });
  fireEvent.keyDown(window, { key: '4' });
  expect(await screen.findByText('Pronto por hoje')).toBeTruthy();
  expect(screen.getByText('2 cartões revisados.')).toBeTruthy();
});

test('todos: lista por capítulo com o trecho, edita e apaga; exportação para o Anki e aviso do Codex', async () => {
  const ir = vi.fn();
  const { api, chamadas } = apiFalsa([cartao(1), cartao(2, { origem: 'manual', agenda: { ...cartao(2).agenda, proxima_revisao: new Date(Date.now() + 3 * 86_400_000).toISOString(), revisoes: 2 } })], [], [SECAO]);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<Flashcards documento_id={DOC} aba="todos" ir={ir} api={api} />);
  const lista = await screen.findByRole('region', { name: 'Da vontade' });
  expect(within(lista).getAllByRole('listitem')).toHaveLength(2);
  expect(within(lista).getByText('Criado por você')).toBeTruthy();
  expect(within(lista).getByText('Volta em 3 dias')).toBeTruthy();
  expect(within(lista).getByRole('link', { name: 'Ver no texto: trecho 1' }).getAttribute('href')).toBe(`/ler/${DOC}/${SECAO}?bloco=${BLOCO}`);
  expect(screen.getByRole('link', { name: /Anki/ }).getAttribute('href')).toBe(`/api/flashcards/exportacao.csv?documento=${DOC}`);
  expect(screen.getByRole('status').textContent).toContain('O Codex está criando flashcards de 1 capítulo');
  fireEvent.click(within(lista).getAllByRole('button', { name: 'Editar' })[0]!);
  fireEvent.change(screen.getByRole('textbox', { name: 'Frente' }), { target: { value: 'Nova pergunta?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
  await waitFor(() => expect(chamadas).toContain(`editar:${cartao(1).id}:Nova pergunta?`));
  fireEvent.click(within(lista).getAllByRole('button', { name: 'Apagar' })[1]!);
  await waitFor(() => expect(chamadas).toContain(`apagar:${cartao(2).id}`));
  fireEvent.click(screen.getByRole('radio', { name: /Estudar/ }));
  expect(ir).toHaveBeenCalledWith({ nome: 'flashcards', documento_id: DOC });
});

test('vazio: convida a criar no leitor', async () => {
  const { api } = apiFalsa([]);
  render(<Flashcards ir={() => undefined} api={api} />);
  expect(await screen.findByText(/Nenhum flashcard ainda/)).toBeTruthy();
});

test('criar flashcard à mão: verso começa com o trecho, frente obrigatória', async () => {
  const ancora = cartao(1).ancora;
  const criar = vi.fn(() => Promise.resolve({ cartao: cartao(1) }));
  const fechar = vi.fn();
  render(<FormularioDeFlashcard ancora={ancora} aoFechar={fechar} criar={criar} />);
  const salvar = screen.getByRole('button', { name: 'Criar flashcard' });
  expect(salvar.hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('textbox', { name: /Verso/ })).toHaveProperty('value', 'trecho 1');
  fireEvent.change(screen.getByRole('textbox', { name: /Frente/ }), { target: { value: 'O que diz?' } });
  fireEvent.click(salvar);
  expect(await screen.findByText(/Flashcard criado/)).toBeTruthy();
  expect(criar).toHaveBeenCalledWith(ancora, 'O que diz?', 'trecho 1');
  fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
  expect(fechar).toHaveBeenCalled();
});
