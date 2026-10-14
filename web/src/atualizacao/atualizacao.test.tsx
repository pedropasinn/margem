import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AvisoDeAtualizacao } from './AvisoDeAtualizacao';
import { frase, ponteDaAtualizacao, quandoProcurou, type PonteDaAtualizacao, type SituacaoDaAtualizacao } from './ponte';
import { SobreEAtualizacoes } from './SobreEAtualizacoes';

afterEach(() => { cleanup(); delete (window as { margemDesktop?: unknown }).margemDesktop; });

/** Ponte falsa: `mudar` empurra um estado como o processo principal faria. */
function ponteFalsa(inicial: SituacaoDaAtualizacao['atualizacao']) {
  let ouvinte: ((s: SituacaoDaAtualizacao) => void) | null = null;
  const ponte = {
    situacao: vi.fn(() => Promise.resolve({ versao: '0.1.0', atualizacao: inicial })),
    procurar: vi.fn(() => Promise.resolve({ versao: '0.1.0', atualizacao: { estado: 'procurando' as const } })),
    reiniciar: vi.fn(),
    abrirDownload: vi.fn(),
    aoMudar: vi.fn((ouvir: (s: SituacaoDaAtualizacao) => void) => { ouvinte = ouvir; return () => { ouvinte = null; }; }),
  } satisfies PonteDaAtualizacao;
  const mudar = (atualizacao: SituacaoDaAtualizacao['atualizacao']) => act(() => { ouvinte?.({ versao: '0.1.0', atualizacao }); });
  return { ponte, mudar };
}

describe('atualização do app de computador', () => {
  test('no navegador não há ponte, e nem a seção nem o aviso aparecem', () => {
    expect(ponteDaAtualizacao()).toBeNull();
    const { container } = render(<><SobreEAtualizacoes /><AvisoDeAtualizacao /></>);
    expect(container.innerHTML).toBe('');
    (window as { margemDesktop?: unknown }).margemDesktop = { atualizacao: ponteFalsa({ estado: 'ociosa' }).ponte };
    expect(ponteDaAtualizacao()).not.toBeNull();
  });

  test('versão, procurar, baixando N%, pronta → Reiniciar e atualizar', async () => {
    const { ponte, mudar } = ponteFalsa({ estado: 'ociosa' });
    render(<SobreEAtualizacoes ponte={ponte} />);
    expect(await screen.findByText('Margem 0.1.0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Procurar atualização' }));
    expect(ponte.procurar).toHaveBeenCalledOnce();
    mudar({ estado: 'procurando' });
    expect(screen.getByRole('button', { name: 'Procurando…' })).toHaveProperty('disabled', true);
    mudar({ estado: 'baixando', versao: '0.2.0', porcentagem: 42 });
    expect(screen.getByText('Baixando o Margem 0.2.0: 42%.')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('42');
    mudar({ estado: 'pronta', versao: '0.2.0' });
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar e atualizar' }));
    expect(ponte.reiniciar).toHaveBeenCalledOnce();
  });

  test('indisponível e desligada dizem o motivo; sem feed oferece o site', async () => {
    const { ponte, mudar } = ponteFalsa({ estado: 'desligada', motivo: 'sem_feed' });
    render(<SobreEAtualizacoes ponte={ponte} />);
    expect(await screen.findByText(/instalada sem atualização automática/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Procurar atualização' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir margem.dev' }));
    expect(ponte.abrirDownload).toHaveBeenCalledOnce();
    mudar({ estado: 'indisponivel', motivo: 'Sem conexão com a internet.' });
    expect(screen.getByText('Atualização indisponível: sem conexão com a internet.')).toBeTruthy();
  });

  test('o aviso só aparece com a versão pronta; Depois esconde esta versão', async () => {
    const { ponte, mudar } = ponteFalsa({ estado: 'ociosa' });
    render(<AvisoDeAtualizacao ponte={ponte} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('status')).toBeNull();
    mudar({ estado: 'pronta', versao: '0.2.0' });
    expect(screen.getByText('O Margem 0.2.0 está pronto para instalar.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar agora' }));
    expect(ponte.reiniciar).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Depois' }));
    expect(screen.queryByText(/pronto para instalar/)).toBeNull();
    mudar({ estado: 'pronta', versao: '0.3.0' });
    expect(screen.getByText('O Margem 0.3.0 está pronto para instalar.')).toBeTruthy();
  });

  test('frases', () => {
    const agora = new Date('2026-10-14T15:00:00');
    expect(quandoProcurou(new Date('2026-10-14T14:59:40').toISOString(), agora)).toBe('agora há pouco');
    expect(quandoProcurou(new Date('2026-10-14T09:05:00').toISOString(), agora)).toBe('às 09:05');
    expect(frase({ estado: 'atualizada', quando: new Date('2026-10-14T09:05:00').toISOString() }, agora)).toBe('O Margem está atualizado. Última procura às 09:05.');
    expect(frase({ estado: 'manual', versao: '0.2.0' })).toMatch(/^O Margem 0\.2\.0 está disponível/);
  });
});
