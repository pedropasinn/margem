import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EnviarParaObsidian } from './EnviarParaObsidian';
import { intencaoDaUrl } from './intencao';
import { lerPreferenciasDoObsidian, ponteDoDesktop, urlDoZip, validarPreferenciasDoObsidian } from './obsidian';

const DOC = '01KD0000000000000000000010';
const SECAO = '01KS0000000000000000000010';
const BLOCO = '01KB0000000000000000000020';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); delete (window as { margemDesktop?: unknown }).margemDesktop; });

describe('exportação para o Obsidian: preferências e endereços', () => {
  test('o ZIP do formato 2, de um documento ou da biblioteca, com as marcas e a origem', () => {
    expect(urlDoZip('todas', 'https://margem.ts.net', DOC))
      .toBe(`/api/obsidian/v2/exportacao.zip?marcas=todas&base=https%3A%2F%2Fmargem.ts.net&documento=${DOC}`);
    expect(urlDoZip('minhas', 'http://127.0.0.1:8730')).toBe('/api/obsidian/v2/exportacao.zip?marcas=minhas&base=http%3A%2F%2F127.0.0.1%3A8730');
  });

  test('preferências guardadas (inclusive as antigas, com cofre e pasta) viram só a escolha das marcas', () => {
    expect(validarPreferenciasDoObsidian({ cofre: 'Zettel', pasta: 'a', marcas: 'todas', substituir: true })).toEqual({ marcas: 'todas' });
    expect(validarPreferenciasDoObsidian({ marcas: 'ia' })).toEqual({ marcas: 'minhas' });
    localStorage.setItem('margem:obsidian', '{quebrado');
    expect(lerPreferenciasDoObsidian()).toEqual({ marcas: 'minhas' });
  });

  test('a ponte do app de computador só existe com a função', () => {
    expect(ponteDoDesktop()).toBeNull();
    (window as { margemDesktop?: unknown }).margemDesktop = { exportarParaObsidian: () => Promise.resolve({ estado: 'ok', mensagem: '' }) };
    expect(ponteDoDesktop()).not.toBeNull();
  });
});

describe('link de volta do Obsidian', () => {
  test('/ler/<doc>/<capítulo>?bloco=<bloco> vira intenção de leitura', () => {
    expect(intencaoDaUrl(`/ler/${DOC}/${SECAO}`, `?bloco=${BLOCO}`))
      .toEqual({ intencao: { documento_id: DOC, secao_id: SECAO, bloco: BLOCO }, caminho: `/ler/${DOC}/${SECAO}` });
    expect(intencaoDaUrl(`/ler/${DOC}/${SECAO}`, '')).toBeNull();
    expect(intencaoDaUrl(`/ler/${DOC}`, `?bloco=${BLOCO}`)).toBeNull();
    expect(intencaoDaUrl(`/ler/${DOC}/${SECAO}`, '?bloco=../../x')).toBeNull();
  });
});

describe('Exportar para o Obsidian', () => {
  test('no navegador: só os ZIPs, sem URI obsidian:// nem cofre; a escolha das marcas fica guardada', () => {
    render(<EnviarParaObsidian documentoId={DOC} origem="https://margem.ts.net" desktop={null} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Incluir as marcas da leitura' }));
    expect(screen.getByRole('link', { name: 'Baixar a pasta (.zip)' }).getAttribute('href'))
      .toBe(`/api/obsidian/v2/exportacao.zip?marcas=todas&base=https%3A%2F%2Fmargem.ts.net&documento=${DOC}`);
    expect(screen.getByRole('link', { name: 'Baixar a biblioteca inteira (.zip)' }).getAttribute('href'))
      .toBe('/api/obsidian/v2/exportacao.zip?marcas=todas&base=https%3A%2F%2Fmargem.ts.net');
    expect(screen.queryByRole('button', { name: /cofre/ })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.body.innerHTML).not.toContain('obsidian://');
    expect(lerPreferenciasDoObsidian()).toEqual({ marcas: 'todas' });
  });

  test('no app de computador: grava no cofre pela ponte e mostra o resultado; cancelar não diz nada', async () => {
    const exportar = vi.fn()
      .mockResolvedValueOnce({ estado: 'ok', mensagem: 'Exportado para o Obsidian. 14 notas novas, 0 atualizadas, 0 sem mudança.' })
      .mockResolvedValueOnce({ estado: 'cancelada', mensagem: 'Nada foi exportado.' });
    render(<EnviarParaObsidian documentoId={DOC} origem="http://127.0.0.1:8730" desktop={{ exportarParaObsidian: exportar }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Exportar para o cofre…' }));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Exportado para o Obsidian. 14 notas novas, 0 atualizadas, 0 sem mudança.');
    expect(exportar).toHaveBeenCalledWith(DOC);
    fireEvent.click(screen.getByRole('button', { name: 'Exportar para o cofre…' }));
    await waitFor(() => expect(exportar).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.getByRole('link', { name: 'Baixar a pasta (.zip)' })).toBeTruthy();
  });
});
