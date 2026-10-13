import * as desenhoDosTracos from './tracos';
import { createRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { capituloExemplo } from '../../leitor/fixtures/capitulo-exemplo';
import { APARENCIA_PADRAO } from '../../leitor/preferencias';
import { CamadaDeMarcas } from './CamadaDeMarcas';

const marca = capituloExemplo.marcas[0]!;
let retorno: IntersectionObserverCallback;
let redimensionar: () => void;
let medicoes = 0;
const artigo = createRef<HTMLElement>();
beforeEach(() => {
  medicoes = 0;
  sessionStorage.clear();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { retorno = callback; }
    observe = vi.fn(); disconnect = vi.fn();
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { redimensionar = callback; }
    observe = vi.fn(); disconnect = vi.fn();
  });
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: vi.fn(() => {
    medicoes++;
    return [new DOMRect(10, 20, 100, 18), new DOMRect(10, 48, 80, 18)];
  }) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); delete (Range.prototype as Partial<Range>).getClientRects; });
function exemplo(visivel = true, rejeitada = false, ativa: string | null = null, animacao = true) {
  return <article ref={artigo}><p><span data-marcas={marca.id}>Citação literal 📖</span></p><CamadaDeMarcas artigo={artigo}
    marcas={[{ ...marca, visivel, avaliacao: rejeitada ? 'rejeitada' : 'nao_avaliada' }]} ativa={ativa} preferencias={{ ...APARENCIA_PADRAO, animacao }} /></article>;
}
describe('camada SVG do capítulo', () => {
  test('mantém textContent, um único SVG e, por linha, a faixa do grifo e a linha de base', () => {
    const { container } = render(exemplo());
    expect(artigo.current?.textContent).toBe('Citação literal 📖');
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    expect(container.querySelectorAll('path')).toHaveLength(4);
    expect([...container.querySelectorAll('path')].map((path) => path.getAttribute('class'))).toEqual(['traco-faixa', 'traco-linha', 'traco-faixa', 'traco-linha']);
  });
  test('marcas ocultas e rejeitadas não desenham', () => {
    const { container, rerender } = render(exemplo(false));
    expect(container.querySelectorAll('path')).toHaveLength(0);
    rerender(exemplo(true, true));
    expect(container.querySelectorAll('path')).toHaveLength(0);
  });
  test('reduced motion e a opção do painel dispensam animação', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const { container, rerender } = render(exemplo());
    expect(container.querySelector('g')?.dataset['animacao']).toBe('pronta');
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    rerender(exemplo(true, false, null, false));
    expect(container.querySelector('g')?.dataset['animacao']).toBe('pronta');
  });
  test('ativa não ganha moldura, só uma linha de base mais grossa, sem medir novamente; resize mede', () => {
    const marcas = [marca];
    const elemento = (ativa: string | null) => <article ref={artigo}><span data-marcas={marca.id}>Trecho</span><CamadaDeMarcas artigo={artigo} marcas={marcas} ativa={ativa} /></article>;
    const { container, rerender } = render(elemento(null));
    const antes = medicoes;
    const linha = () => Number(container.querySelector('path.traco-linha')?.getAttribute('stroke-width'));
    const fina = linha();
    const caminhos = container.querySelectorAll('path').length;
    rerender(elemento(marca.id));
    expect(medicoes).toBe(antes);
    expect(container.querySelectorAll('path')).toHaveLength(caminhos);
    expect(linha()).toBeGreaterThan(fina);
    act(() => redimensionar());
    expect(medicoes).toBeGreaterThan(antes);
  });
  test('só anima ao entrar na tela e não repete ao remontar na sessão', () => {
    const { container, unmount } = render(exemplo());
    expect(container.querySelector('g')?.dataset['animacao']).toBe('aguardando');
    act(() => retorno([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(container.querySelector('g')?.dataset['animacao']).toBe('desenhando');
    unmount();
    const segunda = render(exemplo());
    expect(segunda.container.querySelector('g')?.dataset['animacao']).toBe('pronta');
  });
});

test('trocar a marca ativa recalcula somente seu traço e preserva os caminhos em repouso', () => {
  const marcas = Array.from({ length: 12 }, (_, i) => ({ ...marca, id: `marca-${i}` }));
  const spy = vi.spyOn(desenhoDosTracos, 'tracos');
  const exemplo = (ativa: string | null) => <article ref={artigo}>
    {marcas.map(m => <span key={m.id} data-marcas={m.id}>Trecho</span>)}
    <CamadaDeMarcas artigo={artigo} marcas={marcas} ativa={ativa} />
  </article>;
  const { rerender, container } = render(exemplo(null));
  const antes = container.querySelector('[data-desenho="marca-2"] path')?.getAttribute('d');
  spy.mockClear(); rerender(exemplo('marca-0'));
  expect(spy).toHaveBeenCalledTimes(1);
  spy.mockClear(); rerender(exemplo('marca-1'));
  expect(spy).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-desenho="marca-2"] path')?.getAttribute('d')).toBe(antes);
});
