/** U-04 na biblioteca, na importação e nas configurações: nada de código interno nem inglês na tela. */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ErroDaApi } from './api';
import { FALHA_DO_SERVICO, SEM_CONEXAO } from './erros';
import { motivoDaFalha } from './importacao';
import { Lista } from './Lista';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const TECNICO = /falha_interna|Failed to fetch|Internal Server Error|\(500\)/;

describe('importação', () => {
  test('500 sem detalhe, conexão recusada e JSON quebrado viram frases', () => {
    expect(motivoDaFalha(new ErroDaApi(500, 'falha_interna'))).toBe(FALHA_DO_SERVICO);
    expect(motivoDaFalha(new ErroDaApi(502, 'Bad Gateway'))).not.toMatch(TECNICO);
    expect(motivoDaFalha(new TypeError('Failed to fetch'))).toBe(SEM_CONEXAO);
    expect(motivoDaFalha(new SyntaxError('Unexpected token < in JSON'))).toBe('Não foi possível adicionar.');
    // O que o serviço escreveu para quem lê continua.
    expect(motivoDaFalha(new ErroDaApi(400, 'formato_nao_suportado', 'Formato não aceito.'))).toBe('Formato não aceito.');
    expect(motivoDaFalha(new ErroDaApi(400, 'formato_nao_suportado'))).toBe('O Margem não aceitou este arquivo.');
  });
});

describe('biblioteca', () => {
  test('a lista que não carrega diz isso em português e tenta de novo', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ capitulos: [] })))));
    const carregar = vi.fn()
      .mockRejectedValueOnce(new ErroDaApi(500, 'falha_interna'))
      .mockResolvedValue({ documentos: [] });
    render(<Lista ir={() => {}} carregar={carregar} buscarTexto={() => Promise.reject(new Error('x'))} />);
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).not.toMatch(TECNICO);
    expect(alerta.textContent).toContain(FALHA_DO_SERVICO);
    // Sem a lista, nada de "Nada nesta aba": não se sabe se está vazia.
    expect(screen.queryByText('Nada nesta aba.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(carregar).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Nenhum item ainda.')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
