import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AvisoDeAtualizacao } from './AvisoDeAtualizacao';
import { frase, ponteDaAtualizacao, quandoProcurou, vistaDoAviso, type PonteDaAtualizacao, type SituacaoDaAtualizacao } from './ponte';
import { SobreEAtualizacoes } from './SobreEAtualizacoes';

afterEach(() => { cleanup(); delete (window as { margemDesktop?: unknown }).margemDesktop; window.sessionStorage.clear(); });

/** Ponte falsa: `mudar` empurra um estado como o processo principal faria. */
function ponteFalsa(inicial: SituacaoDaAtualizacao['atualizacao']) {
  let ouvinte: ((s: SituacaoDaAtualizacao) => void) | null = null;
  const ponte = {
    situacao: vi.fn(() => Promise.resolve({ versao: '0.1.0', atualizacao: inicial })),
    procurar: vi.fn(() => Promise.resolve({ versao: '0.1.0', atualizacao: { estado: 'procurando' as const } })),
    reiniciar: vi.fn(),
    abrirDownload: vi.fn(),
    atualizarAgora: vi.fn(),
    adiar: vi.fn(),
    abrirNovidades: vi.fn(),
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
    mudar({ estado: 'baixando', versao: '0.2.0', porcentagem: 42, notas: null, pedida: false });
    expect(screen.getByText('Baixando o Margem 0.2.0: 42%.')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('42');
    mudar({ estado: 'pronta', versao: '0.2.0', notas: null });
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
    mudar({ estado: 'indisponivel', motivo: 'Sem conexão com a internet.', versao: null, pedida: false });
    expect(screen.getByText('Atualização indisponível: sem conexão com a internet.')).toBeTruthy();
  });

  test('sem novidade e falha da procura automática não mostram aviso', async () => {
    const { ponte, mudar } = ponteFalsa({ estado: 'ociosa' });
    render(<AvisoDeAtualizacao ponte={ponte} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('status')).toBeNull();
    mudar({ estado: 'procurando' });
    mudar({ estado: 'atualizada', quando: new Date().toISOString() });
    mudar({ estado: 'indisponivel', motivo: 'Sem conexão com a internet.', versao: null, pedida: false });
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('ao abrir com versão nova baixando: aviso com "O que mudou", Atualizar agora mostra o progresso', async () => {
    const { ponte, mudar } = ponteFalsa({ estado: 'baixando', versao: '0.2.0', porcentagem: 7, notas: null, pedida: false });
    render(<AvisoDeAtualizacao ponte={ponte} />);
    expect(await screen.findByText('Versão 0.2.0 disponível')).toBeTruthy();
    expect(screen.getByText('Baixando em segundo plano: 7%.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'O que mudou' }));
    expect(ponte.abrirNovidades).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar agora' }));
    expect(ponte.atualizarAgora).toHaveBeenCalledOnce();
    mudar({ estado: 'baixando', versao: '0.2.0', porcentagem: 64, notas: null, pedida: true });
    expect(screen.getByText('Atualizando para a versão 0.2.0')).toBeTruthy();
    expect(screen.getByText('Baixando: 64%. O Margem reinicia sozinho ao terminar.')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('64');
    expect(screen.queryByRole('button', { name: 'Atualizar agora' })).toBeNull();
    // "Depois" no meio do download desfaz o pedido e esconde o aviso desta versão até o app fechar.
    fireEvent.click(screen.getByRole('button', { name: 'Depois (instala ao fechar)' }));
    expect(ponte.adiar).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).toBeNull();
    mudar({ estado: 'pronta', versao: '0.2.0', notas: null });
    expect(screen.queryByRole('status')).toBeNull();
    expect(window.sessionStorage.getItem('margem:atualizacao:depois')).toBe('0.2.0');
    mudar({ estado: 'pronta', versao: '0.3.0', notas: 'Marcações em PDF.' });
    expect(screen.getByText('Versão 0.3.0 pronta para instalar')).toBeTruthy();
    expect(screen.getByText(/Marcações em PDF\./)).toBeTruthy();
  });

  test('pronta: Atualizar agora instala; Depois não pede reinício', async () => {
    const { ponte } = ponteFalsa({ estado: 'pronta', versao: '0.2.0', notas: null });
    render(<AvisoDeAtualizacao ponte={ponte} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Atualizar agora' }));
    expect(ponte.atualizarAgora).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Depois (instala ao fechar)' }));
    expect(ponte.adiar).toHaveBeenCalledOnce();
    expect(screen.queryByText(/pronta para instalar/)).toBeNull();
  });

  test('erro: motivo, Tentar de novo e o site', async () => {
    const { ponte } = ponteFalsa({ estado: 'indisponivel', motivo: 'Não foi possível baixar a versão nova.', versao: '0.2.0', pedida: false });
    render(<AvisoDeAtualizacao ponte={ponte} />);
    expect(await screen.findByText('Não deu para atualizar o Margem')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(ponte.atualizarAgora).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'baixe no site' }));
    expect(ponte.abrirDownload).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Agora não' }));
    expect(ponte.adiar).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('macOS sem assinatura: o botão leva ao site', async () => {
    const { ponte } = ponteFalsa({ estado: 'manual', versao: '0.2.0', notas: null });
    render(<AvisoDeAtualizacao ponte={ponte} />);
    expect(await screen.findByText('Versão 0.2.0 disponível')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Baixar no site' }));
    expect(ponte.atualizarAgora).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Depois' }));
    expect(ponte.adiar).not.toHaveBeenCalled();
  });

  test('vista do aviso', () => {
    expect(vistaDoAviso(undefined)).toBeNull();
    expect(vistaDoAviso({ estado: 'baixando', versao: null, porcentagem: 3, notas: null, pedida: false })).toBeNull();
    expect(vistaDoAviso({ estado: 'disponivel', versao: '0.2.0', notas: null })).toEqual({ tipo: 'disponivel', versao: '0.2.0', notas: null, porcentagem: null, manual: false });
    expect(vistaDoAviso({ estado: 'indisponivel', motivo: 'Sem conexão com a internet.', versao: null, pedida: true })).toMatchObject({ tipo: 'erro' });
  });

  test('frases', () => {
    const agora = new Date('2026-10-14T15:00:00');
    expect(quandoProcurou(new Date('2026-10-14T14:59:40').toISOString(), agora)).toBe('agora há pouco');
    expect(quandoProcurou(new Date('2026-10-14T09:05:00').toISOString(), agora)).toBe('às 09:05');
    expect(frase({ estado: 'atualizada', quando: new Date('2026-10-14T09:05:00').toISOString() }, agora)).toBe('O Margem está atualizado. Última procura às 09:05.');
    expect(frase({ estado: 'manual', versao: '0.2.0', notas: null })).toMatch(/^O Margem 0\.2\.0 está disponível/);
  });
});
