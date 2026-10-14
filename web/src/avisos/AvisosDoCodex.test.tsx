import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { PilhaDeAvisos, AvisosDoCodex } from './AvisosDoCodex';
import { ESTADO_INICIAL, organizarPilha, reduzirAvisos } from './execucoes';
import { listaDeExemplo } from './exemplos';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const T0 = Date.parse('2026-10-01T12:00:00.000Z');

function Pilha({ aoAbrir = () => undefined }: { aoAbrir?: (rota: string | null) => void }) {
  const [estado, definir] = useState(() => reduzirAvisos(ESTADO_INICIAL, { tipo: 'lista', lista: listaDeExemplo(T0), recebidaEm: T0 }));
  return <PilhaDeAvisos pilha={organizarPilha(estado)} agora={T0} desvioMs={0}
    aoDispensar={(id) => definir((e) => reduzirAvisos(e, { tipo: 'dispensar', id }))} aoAbrir={(e) => aoAbrir(e.rota)} />;
}

describe('pilha de avisos do Codex', () => {
  test('mostra rótulo, estado e tempo; falha com mensagem; conclusão com Abrir', () => {
    const abrir = vi.fn();
    render(<Pilha aoAbrir={abrir} />);
    const avisos = screen.getAllByRole('listitem').filter((li) => li.classList.contains('aviso-do-codex'));
    expect(avisos.map((li) => li.getAttribute('aria-label'))).toEqual([
      'Revisando sua nota: falhou', 'Montando o mapa do capítulo 3 de Mixtape: pronto', 'Lendo o capítulo 3 de Mixtape: rodando',
    ]);
    expect(screen.getByText('O Codex demorou demais e parou.')).toBeTruthy();
    expect(screen.getByText('Codex · rodando · 1 min 05 s')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Abrir' });
    expect(link.getAttribute('href')).toBe('/ler/01K0000000000000000000D001/01K0000000000000000000S003');
    fireEvent.click(link);
    expect(abrir).toHaveBeenCalledWith('/ler/01K0000000000000000000D001/01K0000000000000000000S003');
    expect(screen.queryByText('Montando o mapa do capítulo 3 de Mixtape')).toBeNull();
  });

  test('agrupador expande e Esc o recolhe; Esc num aviso o dispensa', () => {
    render(<Pilha />);
    const mais = screen.getByRole('button', { name: /Mais 6 em andamento/ });
    expect(mais.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(mais);
    expect(mais.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Respondendo à sua pergunta')).toBeTruthy();
    expect(screen.getByText('e mais 4 na fila')).toBeTruthy();
    fireEvent.keyDown(screen.getByText('Respondendo à sua pergunta'), { key: 'Escape' });
    expect(mais.getAttribute('aria-expanded')).toBe('false');
    const fechar = screen.getByRole('button', { name: 'Dispensar aviso: Revisando sua nota' });
    fechar.focus();
    fireEvent.keyDown(fechar, { key: 'Escape' });
    expect(screen.queryByText('Revisando sua nota')).toBeNull();
    expect(screen.getByRole('region', { name: 'Execuções do Codex' })).toBeTruthy();
  });

  test('sem EventSource, consulta /api/execucoes/ativas e anuncia em região educada', async () => {
    vi.stubGlobal('EventSource', undefined);
    const buscar = vi.fn(() => Promise.resolve(new Response(JSON.stringify(listaDeExemplo(Date.now())))));
    vi.stubGlobal('fetch', buscar);
    render(<AvisosDoCodex ir={() => undefined} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(buscar).toHaveBeenCalledWith('/api/execucoes/ativas', expect.anything());
    expect(await screen.findByText('Revisando sua nota')).toBeTruthy();
    const anuncio = screen.getByRole('status');
    expect(anuncio.getAttribute('aria-live')).toBe('polite');
    expect(anuncio.textContent).toMatch(/^(Pronto|Falhou|O Codex começou)/);
  });
});

describe('conclusão com avisos', () => {
  test('mostra "pronto, com avisos", as ressalvas e o Abrir; não some sozinha', () => {
    const lista = listaDeExemplo(T0);
    const AVISO = 'O Codex leu só parte deste trecho; pode faltar alguma marca.';
    lista.execucoes = [{ ...lista.execucoes[1]!, mensagem: AVISO, avisos: [{ codigo: 'leitura_parcial', mensagem: AVISO },
      { codigo: 'marcas_recusadas', mensagem: '2 marcas ficaram de fora porque não deu para ancorá-las no texto.' }] }];
    let estado = reduzirAvisos(ESTADO_INICIAL, { tipo: 'lista', lista, recebidaEm: T0 });
    estado = reduzirAvisos(estado, { tipo: 'expirar', agora: T0 + 60_000 });
    render(<PilhaDeAvisos pilha={organizarPilha(estado)} agora={T0} desvioMs={0} aoDispensar={() => undefined} aoAbrir={() => undefined} />);
    const aviso = screen.getByRole('listitem', { name: 'Montando o mapa do capítulo 3 de Mixtape: pronto, com avisos' });
    expect(aviso.hasAttribute('data-avisos')).toBe(true);
    expect(screen.getByText(AVISO)).toBeTruthy();
    expect(screen.getByText('2 marcas ficaram de fora porque não deu para ancorá-las no texto.')).toBeTruthy();
    expect(screen.getByText('Codex · pronto com avisos em 46 s')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Abrir' })).toBeTruthy();
  });
});
