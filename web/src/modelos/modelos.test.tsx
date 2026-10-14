/**
 * Configurações → Modelos (V-T10): cada categoria mostra o padrão em uma linha, troca modelo e
 * esforço separadamente, aceita um nome digitado em "Outro…" e atualiza a lista da conta.
 */
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ErroDaApi } from '../biblioteca/api';
import type { ConfiguracaoDosModelos, EscolhaDaCategoria } from './api';
import { ModelosNasConfiguracoes, type FontesDosModelos } from './Modelos';

afterEach(() => { cleanup(); });

function configuracao(escolhas: Record<string, EscolhaDaCategoria> = {}, comLista = true): ConfiguracaoDosModelos {
  const categoria = (id: string, rotulo: string, texto: string) => ({
    id, rotulo, descricao: `Sobre ${rotulo}.`, padrao: { modelo: null, esforco: 'high', texto }, escolha: escolhas[id] ?? { modelo: null, esforco: null },
  });
  return {
    categorias: [
      categoria('analise', 'Análise de textos', 'o modelo padrão da sua conta, esforço alto (o plano do capítulo: médio)'),
      categoria('flashcards', 'Flashcards', 'o modelo padrão da sua conta, esforço baixo'),
    ],
    esforcos: [{ id: 'low', rotulo: 'baixo' }, { id: 'medium', rotulo: 'médio' }, { id: 'high', rotulo: 'alto' }],
    catalogo: comLista ? { obtido_em: '2026-10-14T15:00:00.000Z', origem: 'conta', modelos: [{ id: 'gpt-6-astra', nome: 'GPT-6-Astra', descricao: '', esforcos: ['low', 'medium', 'high'] }] } : null,
  };
}

function fontes(inicial: ConfiguracaoDosModelos): FontesDosModelos & { gravacoes: [string, EscolhaDaCategoria][] } {
  const gravacoes: [string, EscolhaDaCategoria][] = [];
  let escolhas: Record<string, EscolhaDaCategoria> = {};
  return {
    gravacoes,
    ler: vi.fn(() => Promise.resolve(inicial)),
    gravar: vi.fn((categoria: string, escolha: EscolhaDaCategoria) => {
      gravacoes.push([categoria, escolha]);
      if (escolha.modelo === 'gpt 6') return Promise.reject(new ErroDaApi(422, 'preferencia_invalida', 'Nome de modelo inválido: use letras, números, ponto ou hífen.'));
      escolhas = { ...escolhas, [categoria]: escolha };
      return Promise.resolve(configuracao(escolhas));
    }),
    atualizar: vi.fn(() => Promise.resolve(configuracao(escolhas))),
  };
}

const escolher = async (combo: string, opcao: string) => {
  fireEvent.click(await screen.findByRole('combobox', { name: combo }));
  fireEvent.click(screen.getByRole('option', { name: opcao }));
};

test('mostra o padrão de cada categoria e grava modelo e esforço separadamente', async () => {
  const f = fontes(configuracao());
  render(<ModelosNasConfiguracoes fontes={f} />);
  expect(await screen.findByText('Padrão: o modelo padrão da sua conta, esforço alto (o plano do capítulo: médio).')).toBeTruthy();
  expect(screen.getByRole('combobox', { name: 'Modelo · Flashcards' }).textContent).toContain('Padrão do Margem');

  await escolher('Modelo · Flashcards', 'GPT-6-Astra');
  await waitFor(() => expect(f.gravacoes).toEqual([['flashcards', { modelo: 'gpt-6-astra', esforco: null }]]));
  await escolher('Esforço · Flashcards', 'Médio');
  await waitFor(() => expect(f.gravacoes.at(-1)).toEqual(['flashcards', { modelo: 'gpt-6-astra', esforco: 'medium' }]));
  expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Flashcards: salvo. Vale a partir da próxima tarefa.');
  // Voltar ao padrão.
  await escolher('Modelo · Flashcards', 'Padrão do Margem');
  await waitFor(() => expect(f.gravacoes.at(-1)).toEqual(['flashcards', { modelo: null, esforco: 'medium' }]));
});

test('“Outro…” aceita um nome digitado; nome recusado mostra o motivo', async () => {
  const f = fontes(configuracao());
  render(<ModelosNasConfiguracoes fontes={f} />);
  await escolher('Modelo · Análise de textos', 'Outro…');
  const campo = screen.getByRole('textbox', { name: 'Nome do modelo · Análise de textos' });
  fireEvent.change(campo, { target: { value: 'gpt 6' } });
  fireEvent.click(screen.getByRole('button', { name: 'Usar' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Nome de modelo inválido');
  fireEvent.change(campo, { target: { value: 'gpt-7-novo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Usar' }));
  await waitFor(() => expect(f.gravacoes.at(-1)).toEqual(['analise', { modelo: 'gpt-7-novo', esforco: null }]));
  // O nome fora da lista aparece escolhido no seletor.
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Modelo · Análise de textos' }).textContent).toContain('gpt-7-novo'));
});

test('sem lista da conta, explica e oferece atualizar', async () => {
  const f = fontes(configuracao({}, false));
  render(<ModelosNasConfiguracoes fontes={f} />);
  expect(await screen.findByText(/Não foi possível ler a lista de modelos da sua conta/u)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar a lista' }));
  await waitFor(() => expect(f.atualizar).toHaveBeenCalledTimes(1));
  expect(await screen.findByText(/Modelos da sua conta, lidos em/u)).toBeTruthy();
});
