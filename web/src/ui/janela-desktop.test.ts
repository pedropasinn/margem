import { afterEach, describe, expect, test, vi } from 'vitest';
import { corOpaca, janelaDoDesktop, ligarJanelaDoDesktop, type JanelaDoDesktop } from './janela-desktop';

function ponte(sistema = 'win32'): JanelaDoDesktop & { abrirMenu: ReturnType<typeof vi.fn>; definirMoldura: ReturnType<typeof vi.fn> } {
  return { sistema, alturaDoTitulo: 40, abrirMenu: vi.fn(), definirMoldura: vi.fn() };
}

let desligar: (() => void) | null = null;
afterEach(() => { desligar?.(); desligar = null; delete (window as { margemDesktop?: unknown }).margemDesktop; });

describe('casca da janela do app de computador (V-U5)', () => {
  test('no navegador (sem a ponte, ou com a ponte antiga) nada muda', () => {
    expect(janelaDoDesktop()).toBeNull();
    expect(ligarJanelaDoDesktop()).toBeNull();
    (window as { margemDesktop?: unknown }).margemDesktop = { exportarParaObsidian: () => Promise.resolve() };
    expect(janelaDoDesktop()).toBeNull();
    expect(document.documentElement.classList.contains('janela-desktop')).toBe(false);
    expect(document.querySelector('.topo-da-janela')).toBeNull();
  });

  test('no Windows e no Linux: faixa de arraste antes do conteúdo, botão de menu e moldura com as cores do tema', () => {
    const raiz = document.createElement('div');
    raiz.id = 'raiz';
    document.body.append(raiz);
    const janela = ponte('linux');
    (window as { margemDesktop?: unknown }).margemDesktop = { janela };
    // O jsdom não resolve var(): o tema claro já resolvido (--bg e --texto-2).
    const estilo = vi.spyOn(window, 'getComputedStyle').mockReturnValue({ backgroundColor: 'rgb(255, 255, 255)', color: 'rgba(0, 0, 0, 0.65)' } as CSSStyleDeclaration);
    desligar = ligarJanelaDoDesktop();
    expect(document.documentElement.classList.contains('janela-desktop')).toBe(true);
    expect(document.documentElement.dataset['sistemaDaJanela']).toBe('linux');
    const faixa = document.querySelector('.topo-da-janela');
    // Antes do #raiz: na ordem do documento, os controles da página recortam a área de arraste.
    expect(document.body.firstElementChild).toBe(faixa);
    const botao = faixa?.querySelector<HTMLButtonElement>('button.menu-da-janela');
    expect(botao?.getAttribute('aria-label')).toBe('Menu do Margem');
    botao?.click();
    expect(janela.abrirMenu).toHaveBeenCalledTimes(1);
    expect(janela.definirMoldura).toHaveBeenCalled();
    const moldura = janela.definirMoldura.mock.calls[0]?.[0] as { fundo: string; simbolo: string; altura: number; menu: { x: number; y: number } };
    expect(moldura).toMatchObject({ fundo: '#ffffff', simbolo: '#595959', altura: 40 });
    estilo.mockRestore();
    desligar?.();
    desligar = null;
    expect(document.querySelector('.topo-da-janela')).toBeNull();
    expect(document.documentElement.classList.contains('janela-desktop')).toBe(false);
    raiz.remove();
  });

  test('no macOS: sem botão de menu (o menu fica na barra do sistema)', () => {
    desligar = ligarJanelaDoDesktop(ponte('darwin'));
    expect(document.querySelector('.topo-da-janela')).not.toBeNull();
    expect(document.querySelector('.menu-da-janela')).toBeNull();
  });

  test('cores opacas para os botões nativos: hex, rgb e transparência composta sobre o fundo', () => {
    expect(corOpaca('rgb(20, 20, 20)')).toBe('#141414');
    expect(corOpaca('#F5EFDF')).toBe('#f5efdf');
    expect(corOpaca('rgba(0, 0, 0, 0.65)', 'rgb(255, 255, 255)')).toBe('#595959');
    expect(corOpaca('rgba(255, 255, 255, 0.72)', '#141414')).toBe('#bdbdbd');
    expect(corOpaca('color(srgb 1 1 1)')).toBeNull();
  });
});
