import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EnviarParaObsidian } from './EnviarParaObsidian';
import { intencaoDaUrl } from './intencao';
import {
  LIMITE_DA_URI, arquivoDoCabecalho, caminhoNoCofre, lerPreferenciasDoObsidian, limparPasta, uriDoObsidian, validarPreferenciasDoObsidian,
} from './obsidian';

const DOC = '01KD0000000000000000000010';
const SECAO = '01KS0000000000000000000010';
const BLOCO = '01KB0000000000000000000020';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('URI do Obsidian', () => {
  test('nota pequena: conteúdo na URI, codificado com %20 (nunca +), cofre e substituir opcionais', () => {
    expect(uriDoObsidian({ cofre: 'Zettel Leitor', caminho: 'Margem/Meditações - dúvida', conteudo: '# Olá & adeus\n> 1+1', substituir: true }))
      .toEqual({ via: 'conteudo', uri: 'obsidian://new?vault=Zettel%20Leitor&file=Margem%2FMedita%C3%A7%C3%B5es%20-%20d%C3%BAvida&content=%23%20Ol%C3%A1%20%26%20adeus%0A%3E%201%2B1&overwrite=true' });
    expect(uriDoObsidian({ cofre: ' ', caminho: 'Nota', conteudo: 'x', substituir: false }))
      .toEqual({ via: 'conteudo', uri: 'obsidian://new?file=Nota&content=x' });
  });

  test('nota grande: a URI pede a área de transferência e não leva o conteúdo', () => {
    const conteudo = 'á'.repeat(LIMITE_DA_URI);
    expect(uriDoObsidian({ cofre: 'Z', caminho: 'Margem/Livro', conteudo, substituir: false }))
      .toEqual({ via: 'area_de_transferencia', uri: 'obsidian://new?vault=Z&file=Margem%2FLivro&clipboard=true' });
  });

  test('caminho no cofre: pasta limpa, sem .md, sem subir de pasta', () => {
    expect(caminhoNoCofre(' /Leituras\\Margem/ ', 'Livro.md')).toBe('Leituras/Margem/Livro');
    expect(caminhoNoCofre('', 'Livro.md')).toBe('Livro');
    expect(limparPasta('../a/./b/..')).toBe('a/b');
  });

  test('nome do arquivo vem do Content-Disposition em UTF-8', () => {
    expect(arquivoDoCabecalho(`attachment; filename="Meditacoes.md"; filename*=UTF-8''${encodeURIComponent('Meditações.md')}`, 'x.md')).toBe('Meditações.md');
    expect(arquivoDoCabecalho('attachment; filename="Simples.md"', 'x.md')).toBe('Simples.md');
    expect(arquivoDoCabecalho(null, 'x.md')).toBe('x.md');
  });

  test('preferências guardadas são reconstruídas campo a campo', () => {
    expect(validarPreferenciasDoObsidian({ cofre: ' Zettel ', pasta: '/a/b/', marcas: 'todas', substituir: true, extra: 1 }))
      .toEqual({ cofre: 'Zettel', pasta: 'a/b', marcas: 'todas', substituir: true });
    expect(validarPreferenciasDoObsidian({ marcas: 'ia', substituir: 'sim' })).toEqual({ cofre: '', pasta: 'Margem', marcas: 'minhas', substituir: false });
    localStorage.setItem('margem:obsidian', '{quebrado');
    expect(lerPreferenciasDoObsidian()).toEqual({ cofre: '', pasta: 'Margem', marcas: 'minhas', substituir: false });
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

describe('Enviar para o Obsidian', () => {
  const resposta = (conteudo: string) => new Response(conteudo, { status: 200, headers: {
    'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="x.md"; filename*=UTF-8''${encodeURIComponent('Meditações.md')}`,
  } });

  test('abre a nota no cofre e pasta escolhidos, que ficam guardados', async () => {
    const pedidos: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => { pedidos.push(url); return Promise.resolve(resposta('# Nota\n')); }));
    const abrir = vi.fn();
    render(<EnviarParaObsidian documentoId={DOC} abrir={abrir} origem="https://margem.ts.net" />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Cofre' }), { target: { value: 'Zettel' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Pasta' }), { target: { value: 'Leituras' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Incluir as marcas da leitura' }));
    expect(screen.getByRole('link', { name: 'Baixar .md' }).getAttribute('href'))
      .toBe(`/api/documentos/${DOC}/obsidian.md?marcas=todas&base=https%3A%2F%2Fmargem.ts.net`);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir no Obsidian' }));
    await waitFor(() => expect(abrir).toHaveBeenCalledOnce());
    expect(pedidos).toEqual([`/api/documentos/${DOC}/obsidian.md?marcas=todas&base=https%3A%2F%2Fmargem.ts.net`]);
    expect(abrir).toHaveBeenCalledWith('obsidian://new?vault=Zettel&file=Leituras%2FMedita%C3%A7%C3%B5es&content=%23%20Nota%0A');
    expect(lerPreferenciasDoObsidian()).toEqual({ cofre: 'Zettel', pasta: 'Leituras', marcas: 'todas', substituir: false });
  });

  test('nota grande vai pela área de transferência; sem ela, avisa e não abre', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(resposta('x'.repeat(LIMITE_DA_URI)))));
    const abrir = vi.fn();
    const copiar = vi.fn(() => Promise.resolve());
    render(<EnviarParaObsidian documentoId={DOC} abrir={abrir} copiar={copiar} origem="https://margem.ts.net" />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir no Obsidian' }));
    await waitFor(() => expect(abrir).toHaveBeenCalledWith('obsidian://new?file=Margem%2FMedita%C3%A7%C3%B5es&clipboard=true'));
    expect(copiar).toHaveBeenCalledWith('x'.repeat(LIMITE_DA_URI));
    cleanup();

    const semCopia = vi.fn();
    render(<EnviarParaObsidian documentoId={DOC} abrir={semCopia} copiar={() => Promise.reject(new Error('negado'))} origem="https://margem.ts.net" />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir no Obsidian' }));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('Baixar .md') as string);
    expect(semCopia).not.toHaveBeenCalled();
  });

  test('erro da API aparece', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ erro: 'sem_texto', detalhe: 'O documento ainda não tem texto canonizado.' }), { status: 409 }))));
    render(<EnviarParaObsidian documentoId={DOC} abrir={vi.fn()} origem="https://margem.ts.net" />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir no Obsidian' }));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'O documento ainda não tem texto canonizado.');
  });
});
