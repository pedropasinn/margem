import { Aparencia, PilulaDeLeitura } from './Aparencia';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ContextoDeAparencia } from './ContextoDeAparencia';
import { ReaderController } from './ReaderController';
import { capituloExemplo } from './fixtures/capitulo-exemplo';

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1440);
  localStorage.clear();
  vi.stubGlobal('scrollBy', vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); document.documentElement.removeAttribute('style'); delete document.documentElement.dataset['tema']; delete document.documentElement.dataset['atalhos']; });
const exemplo = () => <ContextoDeAparencia><ReaderController snapshot={capituloExemplo} documento_id="exemplo" /></ContextoDeAparencia>;
describe('painel de aparência no leitor', () => {
  test('muda o tema e a tipografia sem trocar os nós nem o texto da fonte', () => {
    const { container } = render(exemplo());
    const artigo = container.querySelector('.capitulo');
    const conteudo = artigo?.textContent;
    const trecho = artigo?.querySelector('[data-marcas]');
    fireEvent.click(screen.getByRole('button', { name: 'Aparência' }));
    // Sem listas nem sliders: blocos (radiogroup) e linhas com − e +.
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Tema' })).getByRole('radio', { name: /Sépia/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Diminuir tamanho' }));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Estilo das marcas' })).getByRole('radio', { name: /Só na margem/ }));
    expect(document.documentElement.dataset['tema']).toBe('sepia');
    expect(document.documentElement.style.getPropertyValue('--tamanho-leitura')).toBe('21px');
    expect(artigo?.textContent).toBe(conteudo);
    expect(artigo?.querySelector('[data-marcas]')).toBe(trecho);
    expect(JSON.parse(localStorage.getItem('margem:aparencia') ?? '{}')).toMatchObject({ tema: 'sepia', tamanho: 21, estilo: 'margem' });
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Aparência da leitura' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Aparência' }));
  });
  test('recolhe a margem em números operáveis com Enter e Espaço', () => {
    const { container } = render(exemplo());
    fireEvent.click(screen.getByRole('button', { name: 'Aparência' }));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Margem' })).getByRole('radio', { name: /Números/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(container.querySelector('.margem.recolhida')).not.toBeNull();
    const numero = screen.getByRole('button', { name: /^Nota 1:/ });
    act(() => numero.focus());
    fireEvent.keyDown(numero, { key: ' ' });
    expect(container.querySelector('.nota.ativa .nota-acoes')).not.toBeNull();
    fireEvent.keyDown(numero, { key: 'Escape' });
    expect(container.querySelector('.nota.ativa')).toBeNull();
    fireEvent.keyDown(numero, { key: 'Enter' });
    expect(container.querySelector('.nota.ativa .nota-acoes')).not.toBeNull();
  });
});

test('entrelinha, largura e intensidade andam com − e +, nas pontas desabilitados', () => {
  render(<ContextoDeAparencia><Aparencia abertaInicialmente /></ContextoDeAparencia>);
  fireEvent.click(screen.getByRole('button', { name: 'Aumentar entrelinha' }));
  expect(screen.getByRole('button', { name: 'Aumentar entrelinha' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Diminuir largura' }));
  fireEvent.click(screen.getByRole('button', { name: 'Aumentar intensidade' }));
  expect(JSON.parse(localStorage.getItem('margem:aparencia') ?? '{}')).toMatchObject({ entrelinha: 'folgada', medida: 65, intensidade: .35 });
});

test('legibilidade: espaçamento em três níveis, alinhamento à esquerda e atalhos de uma tecla vão para a raiz', () => {
  render(<ContextoDeAparencia><Aparencia abertaInicialmente /></ContextoDeAparencia>);
  const html = document.documentElement;
  expect(html.dataset['alinhamento']).toBe('justificado');
  expect(html.dataset['espacamento']).toBe('normal');
  expect(html.dataset['atalhos']).toBe('ligados');
  fireEvent.click(screen.getByRole('button', { name: 'Aumentar espaçamento' }));
  fireEvent.click(screen.getByRole('button', { name: 'Aumentar espaçamento' }));
  expect(screen.getByRole('button', { name: 'Aumentar espaçamento' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Alinhamento' })).getByRole('radio', { name: /À esquerda/ }));
  fireEvent.click(screen.getByRole('switch', { name: /Atalhos de uma tecla/ }));
  expect(html.dataset['espacamento']).toBe('maximo');
  expect(html.dataset['alinhamento']).toBe('esquerda');
  expect(html.dataset['atalhos']).toBe('desligados');
  expect(JSON.parse(localStorage.getItem('margem:aparencia') ?? '{}')).toMatchObject({ espacamento: 'maximo', alinhamento: 'esquerda', atalhosDeLetra: false });
});

test('com os atalhos de uma tecla ligados (padrão), M recolhe a margem', () => {
  localStorage.setItem('margem:aparencia', JSON.stringify({ versao: 3, margem: 'mostrar' }));
  const { container } = render(exemplo());
  fireEvent.keyDown(window, { key: 'm' });
  expect(container.querySelector('.margem.recolhida')).not.toBeNull();
});

test('com os atalhos de uma tecla desligados, M não recolhe a margem; Ctrl K continua abrindo a paleta', () => {
  localStorage.setItem('margem:aparencia', JSON.stringify({ versao: 3, margem: 'mostrar', atalhosDeLetra: false }));
  const { container } = render(exemplo());
  fireEvent.keyDown(window, { key: 'm' });
  expect(container.querySelector('.margem.recolhida')).toBeNull();
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  expect(screen.getByRole('dialog', { name: /comando/i })).toBeDefined();
});

describe('pílula do canto inferior direito (Player v2, etapa 2)', () => {
  test('no texto, A− e A+ andam dentro de 16–32 px, a partir dos 22 do padrão', () => {
    render(<ContextoDeAparencia><PilulaDeLeitura pdf={false} escala={1} /></ContextoDeAparencia>);
    expect(screen.getByText('22 px')).toBeDefined();
    for (let i = 0; i < 12; i++) fireEvent.click(screen.getByRole('button', { name: 'Aumentar o texto' }));
    expect(screen.getByText('32 px')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Aumentar o texto' }).hasAttribute('disabled')).toBe(true);
    for (let i = 0; i < 20; i++) fireEvent.click(screen.getByRole('button', { name: 'Diminuir o texto' }));
    expect(screen.getByText('16 px')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Diminuir o texto' }).hasAttribute('disabled')).toBe(true);
  });
  test('no PDF, − % + e a próxima página; a porcentagem volta a ajustar à largura', () => {
    const proxima = vi.fn();
    render(<ContextoDeAparencia><PilulaDeLeitura pdf escala={1.94} aoProximaPagina={proxima} /></ContextoDeAparencia>);
    const grupo = screen.getByRole('group', { name: 'Zoom do PDF' });
    expect(grupo.textContent).toContain('194%');
    fireEvent.click(screen.getByRole('button', { name: 'Diminuir zoom' }));
    expect(screen.getByRole('button', { name: /^Zoom 194%; ajustar à largura/ }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /^Zoom 194%/ }));
    expect(screen.getByRole('button', { name: /^Zoom 194%, ajustado à largura/ })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }));
    expect(proxima).toHaveBeenCalledOnce();
  });
});
