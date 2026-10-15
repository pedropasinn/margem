import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AvisosDoCodex } from '../avisos/AvisosDoCodex';
import { Detalhe } from '../biblioteca/Detalhe';
import type { DetalheDoDocumento } from '../biblioteca/tipos';
import type { TrabalhosEmPausa } from './api';
import { CartaoDaPausa, quandoParou } from './TrabalhosEmPausa';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const AGORA = new Date(2026, 9, 15, 10, 0);
const ONTEM = new Date(2026, 9, 14, 14, 20).toISOString();
const PAUSA: TrabalhosEmPausa = {
  total: 3, desde: ONTEM,
  grupos: [
    { documento_id: 'D1', titulo: 'Mixtape', itens: [
      { ids: ['preparacao:D1'], rotulo: 'Análise pedida antes', quantidade: 1, desde: ONTEM },
      { ids: ['J1', 'J2'], rotulo: 'Mapa do capítulo', quantidade: 2, desde: ONTEM },
    ] },
  ],
};

describe('quando parou', () => {
  test('hoje, ontem ou a data, com a hora', () => {
    expect(quandoParou(new Date(2026, 9, 15, 8, 5).toISOString(), AGORA)).toBe('hoje às 08:05');
    expect(quandoParou(ONTEM, AGORA)).toBe('ontem às 14:20');
    expect(quandoParou(new Date(2026, 9, 2, 9, 0).toISOString(), AGORA)).toBe('02/10 às 09:00');
  });
});

describe('cartão "trabalhos esperando"', () => {
  test('diz quantos e desde quando, sem jargão; Retomar todos retoma tudo', async () => {
    const retomar = vi.fn(() => Promise.resolve());
    render(<CartaoDaPausa pausa={PAUSA} agora={AGORA} aoRetomar={retomar} aoDescartar={() => Promise.resolve()} />);
    const cartao = screen.getByRole('region', { name: '3 trabalhos do Codex esperando' });
    expect(cartao.textContent).toContain('Parados desde ontem às 14:20. Só continuam se você mandar.');
    expect(cartao.textContent).not.toMatch(/\bjob|worker|fila/iu);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retomar todos' })); await Promise.resolve(); });
    expect(retomar).toHaveBeenCalledWith({ todos: true });
  });

  test('Ver lista por documento; cada item retoma ou descarta só os dele', async () => {
    const retomar = vi.fn(() => Promise.resolve());
    const descartar = vi.fn(() => Promise.resolve());
    render(<CartaoDaPausa pausa={PAUSA} agora={AGORA} aoRetomar={retomar} aoDescartar={descartar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));
    const lista = screen.getByRole('list', { name: 'Trabalhos esperando' });
    expect(within(lista).getByText('Mixtape')).toBeTruthy();
    expect(within(lista).getByText('Mapa do capítulo · 2')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retomar: Mapa do capítulo de Mixtape' })); await Promise.resolve(); });
    expect(retomar).toHaveBeenCalledWith({ ids: ['J1', 'J2'] });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Descartar: Análise pedida antes de Mixtape' })); await Promise.resolve(); });
    expect(descartar).toHaveBeenCalledWith({ ids: ['preparacao:D1'] });
    fireEvent.click(screen.getByRole('button', { name: 'Esconder' }));
    expect(screen.queryByRole('list', { name: 'Trabalhos esperando' })).toBeNull();
  });

  test('Descartar todos pede confirmação; Voltar não descarta nada', async () => {
    const descartar = vi.fn(() => Promise.resolve());
    render(<CartaoDaPausa pausa={PAUSA} agora={AGORA} aoRetomar={() => Promise.resolve()} aoDescartar={descartar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Descartar todos' }));
    expect(screen.getByText('Descartar os 3? O Codex não vai fazer nenhum deles.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(descartar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar todos' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Descartar' })); await Promise.resolve(); });
    expect(descartar).toHaveBeenCalledWith({ todos: true });
  });

  test('um só: singular; a falha aparece no cartão; nada em pausa, nada na tela', async () => {
    const um: TrabalhosEmPausa = { total: 1, desde: ONTEM, grupos: [{ documento_id: null, titulo: null, itens: [{ ids: ['J9'], rotulo: 'Resposta na página Perguntar', quantidade: 1, desde: ONTEM }] }] };
    const { rerender } = render(<CartaoDaPausa pausa={um} agora={AGORA} aoRetomar={() => Promise.reject(new Error('Sem conexão com o Margem.'))} aoDescartar={() => Promise.resolve()} />);
    expect(screen.getByText('1 trabalho do Codex esperando')).toBeTruthy();
    expect(screen.getByText(/Parado desde ontem às 14:20\. Só continua se você mandar\./u)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retomar' })); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole('alert').textContent).toBe('Sem conexão com o Margem.');
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));
    expect(screen.getByText('Fora de um documento')).toBeTruthy();
    rerender(<CartaoDaPausa pausa={{ total: 0, desde: null, grupos: [] }} aoRetomar={() => Promise.resolve()} aoDescartar={() => Promise.resolve()} />);
    expect(screen.queryByRole('region')).toBeNull();
  });
});

describe('ligado ao serviço', () => {
  test('o cartão aparece no topo dos avisos do canto e Retomar todos chama o serviço', async () => {
    vi.stubGlobal('EventSource', undefined);
    const chamadas: [string, RequestInit | undefined][] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, inicio?: RequestInit) => {
      chamadas.push([url, inicio]);
      if (url === '/api/trabalhos-em-pausa') return Promise.resolve(new Response(JSON.stringify(PAUSA)));
      if (url === '/api/trabalhos-em-pausa/retomar') return Promise.resolve(new Response(JSON.stringify({ retomados: 3, total: 0, desde: null, grupos: [] })));
      return Promise.resolve(new Response(JSON.stringify({ versao: 2, gerado_em: new Date().toISOString(), execucoes: [], omitidas: 0 })));
    }));
    render(<AvisosDoCodex ir={() => undefined} />);
    const cartao = await screen.findByRole('region', { name: '3 trabalhos do Codex esperando' });
    expect(cartao.closest('.avisos-do-codex')?.hasAttribute('data-vazio')).toBe(false);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retomar todos' })); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    const retomada = chamadas.find(([url]) => url === '/api/trabalhos-em-pausa/retomar');
    expect(retomada?.[1]?.body).toBe(JSON.stringify({ todos: true }));
    expect(screen.queryByRole('region', { name: /esperando/u })).toBeNull();
  });

  test('Diagnóstico do documento: "em pausa, esperando você" com Retomar', async () => {
    const corpos: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, inicio?: RequestInit) => {
      if (url === '/api/trabalhos-em-pausa/retomar') { corpos.push(JSON.parse(inicio?.body as string)); return Promise.resolve(new Response(JSON.stringify({ retomados: 1, total: 0, desde: null, grupos: [] }))); }
      return Promise.resolve(new Response(JSON.stringify({ camadas: [] })));
    }));
    const documento: DetalheDoDocumento = {
      id: 'doc', titulo: 'Livro', autor: null, formato: 'md', criado_em: '2026-09-24T12:00:00Z', versao_id: 'v', texto_disponivel: true,
      estado: 'pronto', detalhe: null, partes_prontas: 0, partes_total: 0, marcas: { tese: 0, conceito: 0, justificativa: 0, nenhuma: 0, total: 0 },
      progresso: null, jobs_em_curso: 0, versoes: [], execucoes: [], exportacoes: [], preparacao_em_pausa: true,
      jobs: [{ id: 'J1', tipo: 'gerar_esquema', estado: 'fila', attempt: 0, not_before: null, error_code: null, atualizado_em: ONTEM, em_pausa: true }],
    };
    const carregar = vi.fn(() => Promise.resolve(documento));
    render(<Detalhe documento_id="doc" carregar={carregar} ir={() => {}}
      capitulos={() => Promise.resolve({ capitulos: [], concluidos: [] })}
      preparacao={{ situacao: () => Promise.reject(new Error('sem')), preparar: () => Promise.reject(new Error('sem')) }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Opções do documento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Diagnóstico' }));
    expect(screen.getByText(/gerar_esquema · em pausa, esperando você/u)).toBeTruthy();
    expect(screen.getByText(/Análise pedida antes · em pausa, esperando você/u)).toBeTruthy();
    const botoes = screen.getAllByRole('button', { name: 'Retomar' });
    expect(botoes).toHaveLength(2);
    await act(async () => { fireEvent.click(botoes[1]!); await Promise.resolve(); await Promise.resolve(); });
    expect(corpos).toEqual([{ ids: ['J1'] }]);
    expect(carregar.mock.calls.length).toBeGreaterThan(1);
  });
});
