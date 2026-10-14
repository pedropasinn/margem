/**
 * V-T8 na interface: a confirmação diz o que sai (com a contagem), "Apagar tudo" exige a frase, o
 * "Cancelar análise" aparece só com algo em andamento e o aviso do canto cancela o pedido.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { SituacaoDaPreparacao } from '../biblioteca/api';
import { PilhaDeAvisos } from '../avisos/AvisosDoCodex';
import { ESTADO_INICIAL, organizarPilha, reduzirAvisos } from '../avisos/execucoes';
import { listaDeExemplo } from '../avisos/exemplos';
import { ConfirmarApagar } from './ConfirmarApagar';
import { CancelarAnalise, JanelaDeApagarEmLote, MenuDeApagar, linhasDoLote, type FontesDoApagar } from './NoDocumento';
import type { Apagaveis } from './api';

afterEach(() => { cleanup(); });

const CONTA: Apagaveis = {
  codex: [
    { chave: 'grifos', rotulo: 'grifos', singular: 'grifos', total: 12 }, { chave: 'comentarios', rotulo: 'comentários nos grifos', singular: 'comentários nos grifos', total: 5 },
    { chave: 'relacoes', rotulo: 'relações', singular: 'relações', total: 3 }, { chave: 'dificuldades', rotulo: 'dificuldades apontadas', singular: 'dificuldades apontadas', total: 0 },
    { chave: 'resolucoes', rotulo: 'resoluções de exercícios', singular: 'resoluções de exercícios', total: 2 }, { chave: 'tipo', rotulo: 'tipo de texto reconhecido', singular: 'tipo de texto reconhecido', total: 1 },
  ],
  leitor: [{ chave: 'grifos', rotulo: 'grifos seus', singular: 'grifos seus', total: 4 }, { chave: 'notas', rotulo: 'notas', singular: 'nota', total: 1 }, { chave: 'conexoes', rotulo: 'conexões', singular: 'conexões', total: 0 }],
};

function fontes(): FontesDoApagar & { chamadas: unknown[][] } {
  const chamadas: unknown[][] = [];
  return {
    chamadas,
    apagaveis: vi.fn(() => Promise.resolve(CONTA)),
    apagar: vi.fn((...args: unknown[]) => { chamadas.push(['apagar', ...args]); return Promise.resolve({ apagados: {} }); }),
    cancelar: vi.fn((...args: unknown[]) => { chamadas.push(['cancelar', ...args]); return Promise.resolve({ cancelados: 2, capitulos_descartados: 1, execucoes_descartadas: 0 }); }),
  };
}

describe('apagar e cancelar', () => {
  test('as linhas do lote: só o que existe; comentários como detalhe dos grifos', () => {
    expect(linhasDoLote(CONTA.codex)).toEqual(['12 grifos (5 com comentário)', '3 relações', '2 resoluções de exercícios', 'o tipo de texto que o Codex reconheceu']);
    expect(linhasDoLote(CONTA.leitor)).toEqual(['4 grifos seus', '1 nota']);
  });

  test('apagar a análise do Codex mostra a contagem e apaga depois de confirmar', async () => {
    const f = fontes();
    const apagou = vi.fn();
    render(<JanelaDeApagarEmLote documentoId="doc" quem="codex" aoFechar={() => undefined} aoApagar={apagou} fontes={f} />);
    expect(await screen.findByText('12 grifos (5 com comentário)')).toBeTruthy();
    expect(screen.queryByText('4 grifos seus')).toBeNull();
    expect(screen.getByText('Isto não pode ser desfeito.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apagar' }));
    await waitFor(() => expect(apagou).toHaveBeenCalled());
    expect(f.chamadas).toEqual([['apagar', 'doc', 'codex', {}]]);
  });

  test('"Apagar tudo" só libera com a frase digitada e manda a confirmação', async () => {
    const f = fontes();
    render(<JanelaDeApagarEmLote documentoId="doc" quem="tudo" secaoId="cap" aoFechar={() => undefined} aoApagar={() => undefined} fontes={f} />);
    expect(await screen.findByText('12 grifos do Codex (5 com comentário)')).toBeTruthy();
    expect(screen.getByText('4 grifos seus')).toBeTruthy();
    const botao = screen.getByRole<HTMLButtonElement>('button', { name: 'Apagar tudo' });
    expect(botao.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Digite apagar tudo'), { target: { value: 'apagar' } });
    expect(botao.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Digite apagar tudo'), { target: { value: 'Apagar tudo' } });
    expect(botao.disabled).toBe(false);
    fireEvent.click(botao);
    await waitFor(() => expect(f.chamadas).toEqual([['apagar', 'doc', 'tudo', { secaoId: 'cap', confirmacao: 'apagar tudo' }]]));
  });

  test('sem nada a apagar, o botão fica desligado; erro do serviço aparece', async () => {
    const falhar = vi.fn(() => Promise.reject(new Error('Deu errado.')));
    render(<ConfirmarApagar titulo="Apagar?" itens={['1 grifo']} aoFechar={() => undefined} aoConfirmar={falhar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apagar' }));
    expect(await screen.findByText('Deu errado.')).toBeTruthy();
    cleanup();
    render(<ConfirmarApagar titulo="Apagar?" itens={[]} vazio="Nada aqui." aoFechar={() => undefined} aoConfirmar={falhar} />);
    expect(screen.getByText('Nada aqui.')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apagar' }).disabled).toBe(true);
  });

  test('o menu "…" oferece os três lotes', () => {
    const escolher = vi.fn();
    render(<MenuDeApagar aoEscolher={escolher} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apagar tudo meu…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apagar tudo…' }));
    expect(escolher.mock.calls).toEqual([['leitor'], ['tudo']]);
  });

  test('"Cancelar análise" só com algo em andamento; cancela depois de confirmar', async () => {
    const situacao = (estado: SituacaoDaPreparacao['estado']): SituacaoDaPreparacao => ({
      documento_id: 'doc', versao_id: 'v', estado, tipo: null, compreensao: null, capitulos: [], erro: null, itens: [],
    });
    const f = fontes();
    const { rerender } = render(<CancelarAnalise documentoId="doc" situacao={situacao('pronta')} aoCancelar={() => undefined} fontes={f} />);
    expect(screen.queryByRole('button', { name: /Cancelar análise/ })).toBeNull();
    const cancelou = vi.fn();
    rerender(<CancelarAnalise documentoId="doc" situacao={situacao('preparando')} aoCancelar={cancelou} fontes={f} />);
    fireEvent.click(screen.getByRole('button', { name: /Cancelar análise/ }));
    expect(screen.getByRole('alertdialog', { name: 'Cancelar a análise?' })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancelar análise' }).at(-1)!);
    await waitFor(() => expect(cancelou).toHaveBeenCalled());
    expect(f.chamadas).toEqual([['cancelar', 'doc']]);
  });

  test('o aviso do canto cancela o pedido na fila ou rodando, e some', async () => {
    const T0 = Date.parse('2026-10-01T12:00:00.000Z');
    const cancelar = vi.fn(() => Promise.resolve());
    function Pilha() {
      const [estado, definir] = useState(() => reduzirAvisos(ESTADO_INICIAL, { tipo: 'lista', lista: listaDeExemplo(T0), recebidaEm: T0 }));
      return <PilhaDeAvisos pilha={organizarPilha(estado)} agora={T0} desvioMs={0} aoAbrir={() => undefined} aoCancelar={cancelar}
        aoDispensar={(id) => definir((e) => reduzirAvisos(e, { tipo: 'dispensar', id }))} />;
    }
    render(<Pilha />);
    // Só o rodando tem "Cancelar"; o pronto e o que falhou, não.
    expect(screen.queryByRole('button', { name: 'Cancelar: Montando o mapa do capítulo 3 de Mixtape' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancelar: Revisando sua nota' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar: Lendo o capítulo 3 de Mixtape' }));
    await waitFor(() => expect(screen.queryByText('Lendo o capítulo 3 de Mixtape')).toBeNull());
    expect(cancelar).toHaveBeenCalledWith(expect.objectContaining({ id: '01K0000000000000000000J001' }));
  });
});
