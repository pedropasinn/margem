import { describe, expect, test } from 'vitest';
import {
  ALTURA_DO_TITULO, coresPadrao, molduraDaPagina, opcoesDaMoldura, posicaoDosSemaforos, proximoEstadoDoAlt, type EntradaDeTecla,
} from '../src/principal/moldura.js';

describe('moldura da janela por sistema (V-U5)', () => {
  const cores = coresPadrao(false);

  test('Windows e Linux: sem barra de título, botões nativos sobrepostos com as cores do tema e a altura da área de título', () => {
    for (const sistema of ['win32', 'linux'] as const) {
      expect(opcoesDaMoldura(sistema, cores)).toEqual({
        titleBarStyle: 'hidden',
        titleBarOverlay: { color: '#ffffff', symbolColor: '#595959', height: ALTURA_DO_TITULO },
        autoHideMenuBar: false,
      });
    }
    expect(ALTURA_DO_TITULO).toBeGreaterThanOrEqual(40);
    expect(ALTURA_DO_TITULO).toBeLessThanOrEqual(44);
  });

  test('macOS: semáforos à esquerda (hiddenInset), centrados na área de título, sem overlay', () => {
    const opcoes = opcoesDaMoldura('darwin', cores);
    expect(opcoes).toEqual({ titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 14 } });
    expect(opcoes.titleBarOverlay).toBeUndefined();
    expect(posicaoDosSemaforos(56)).toEqual({ x: 16, y: 22 });
  });

  test('cores padrão seguem o tema do sistema (biblioteca em --bg, abertura em --bg-2)', () => {
    expect(coresPadrao(true)).toEqual({ fundo: '#141414', simbolo: '#bdbdbd' });
    expect(coresPadrao(false, 'abertura').fundo).toBe('#f8f8f8');
    expect(coresPadrao(true, 'abertura').fundo).toBe('#1e1e1e');
    expect(opcoesDaMoldura('linux', coresPadrao(true)).titleBarOverlay).toEqual({ color: '#141414', symbolColor: '#bdbdbd', height: ALTURA_DO_TITULO });
  });
});

describe('o que a página manda pela ponte', () => {
  test('aceita só #rrggbb; altura e posição do menu fora dos limites caem no padrão', () => {
    expect(molduraDaPagina({ fundo: '#F8F8F8', simbolo: '#575757', altura: 56, menu: { x: 6, y: 60 } }))
      .toEqual({ fundo: '#f8f8f8', simbolo: '#575757', altura: 56, menu: { x: 6, y: 60 } });
    expect(molduraDaPagina({ fundo: '#fff', simbolo: '#000000', altura: 40 })).toBeNull();
    expect(molduraDaPagina({ fundo: 'red', simbolo: '#000000' })).toBeNull();
    expect(molduraDaPagina({ fundo: '#ffffff; x', simbolo: '#000000' })).toBeNull();
    expect(molduraDaPagina(null)).toBeNull();
    expect(molduraDaPagina('#ffffff')).toBeNull();
    expect(molduraDaPagina({ fundo: '#ffffff', simbolo: '#000000', altura: 400, menu: { x: -1, y: 9999 } }))
      .toEqual({ fundo: '#ffffff', simbolo: '#000000', altura: ALTURA_DO_TITULO, menu: { x: 6, y: ALTURA_DO_TITULO } });
    expect(molduraDaPagina({ fundo: '#ffffff', simbolo: '#000000', altura: 56.5 })?.altura).toBe(ALTURA_DO_TITULO);
  });
});

describe('Alt sozinho abre o menu', () => {
  const rodar = (entradas: EntradaDeTecla[]): boolean[] => {
    let armado = false;
    return entradas.map((entrada) => { const r = proximoEstadoDoAlt(armado, entrada); armado = r.armado; return r.abrir; });
  };
  const desce = (key: string, code = key, isAutoRepeat = false): EntradaDeTecla => ({ type: 'keyDown', key, code, isAutoRepeat });
  const sobe = (key: string, code = key): EntradaDeTecla => ({ type: 'keyUp', key, code });

  test('apertar e soltar Alt abre; repetição da tecla segurada não desarma', () => {
    expect(rodar([desce('Alt', 'AltLeft'), sobe('Alt', 'AltLeft')])).toEqual([false, true]);
    expect(rodar([desce('Alt', 'AltLeft'), desce('Alt', 'AltLeft', true), sobe('Alt', 'AltLeft')])).toEqual([false, false, true]);
  });

  test('Alt com outra tecla (atalho) não abre; AltGr (acentos) nunca abre', () => {
    expect(rodar([desce('Alt', 'AltLeft'), desce('ArrowLeft'), sobe('ArrowLeft'), sobe('Alt', 'AltLeft')])).toEqual([false, false, false, false]);
    expect(rodar([desce('Alt', 'AltRight'), sobe('Alt', 'AltRight')])).toEqual([false, false]);
    expect(rodar([desce('AltGraph', 'AltRight'), sobe('AltGraph', 'AltRight')])).toEqual([false, false]);
    expect(rodar([sobe('Alt', 'AltLeft')])).toEqual([false]);
  });
});
