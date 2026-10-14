/**
 * Moldura das janelas (V-U5): sem a barra de título do sistema e sem a faixa do menu, como o Obsidian e o
 * VS Code. O conteúdo vai até o topo; no Windows e no Linux os botões minimizar/maximizar/fechar são os
 * nativos, sobrepostos no canto direito (Window Controls Overlay) com as cores do tema do app; no macOS
 * ficam os semáforos à esquerda (`hiddenInset`), e o menu continua na barra do sistema.
 *
 * O menu do app continua instalado (os atalhos funcionam), mas não é desenhado: no Windows e no Linux ele
 * abre como pop-up pela tecla Alt sozinha ou pelo botão de menu da página. Funções puras, testadas sem
 * Electron.
 */
import type { BrowserWindowConstructorOptions } from 'electron';

/** Altura da área de título, em px: a dos botões nativos e a da faixa de arraste da página. */
export const ALTURA_DO_TITULO = 40;

/** Onde o pop-up do menu abre (logo abaixo do botão de menu, no canto superior esquerdo). */
export const POSICAO_DO_MENU = { x: 6, y: ALTURA_DO_TITULO } as const;

export interface CoresDaMoldura {
  /** Fundo dos botões nativos (o do topo da página). */
  fundo: string;
  /** Cor dos símbolos (–, □, ×). */
  simbolo: string;
}

/**
 * Cores antes de a página dizer as dela (e na janela de abertura, que segue o sistema): os tokens do web
 * (`--bg` na biblioteca, `--bg-2` na abertura; símbolo em `--texto-2` já composto sobre o fundo).
 */
export function coresPadrao(escuro: boolean, janela: 'principal' | 'abertura' = 'principal'): CoresDaMoldura {
  if (janela === 'abertura') return escuro ? { fundo: '#1e1e1e', simbolo: '#c0c0c0' } : { fundo: '#f8f8f8', simbolo: '#575757' };
  return escuro ? { fundo: '#141414', simbolo: '#bdbdbd' } : { fundo: '#ffffff', simbolo: '#595959' };
}

type OpcoesDaMoldura = Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'titleBarOverlay' | 'trafficLightPosition' | 'autoHideMenuBar'>;

/** As opções de `new BrowserWindow` que tiram a barra de título e o menu, por sistema. */
export function opcoesDaMoldura(sistema: NodeJS.Platform, cores: CoresDaMoldura): OpcoesDaMoldura {
  if (sistema === 'darwin') {
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: posicaoDosSemaforos(ALTURA_DO_TITULO) };
  }
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: cores.fundo, symbolColor: cores.simbolo, height: ALTURA_DO_TITULO },
    // Alt não deve mostrar a faixa do menu: quem abre o menu é o pop-up (`proximoEstadoDoAlt`).
    autoHideMenuBar: false,
  };
}

/** Onde ficam os semáforos do macOS, centrados (12 px de diâmetro) numa área de título desta altura. */
export function posicaoDosSemaforos(altura: number): { x: number; y: number } {
  return { x: 16, y: Math.round((altura - 12) / 2) };
}

/** Limites da altura que a página pode pedir (a barra do leitor tem 56 px). */
export const ALTURA_MINIMA_DO_TITULO = 32;
export const ALTURA_MAXIMA_DO_TITULO = 72;

export interface MolduraDaPagina extends CoresDaMoldura {
  altura: number;
  /** Onde o pop-up do menu abre (abaixo do botão de menu da página). */
  menu: { x: number; y: number };
}

/** Uma coordenada do menu: inteiro dentro do canto superior esquerdo da janela, ou nada. */
function coordenada(valor: unknown, maximo: number): number | null {
  return typeof valor === 'number' && Number.isInteger(valor) && valor >= 0 && valor <= maximo ? valor : null;
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Valida o que a página manda pela ponte: cores só `#rrggbb`, altura inteira entre os limites (fora deles,
 * a padrão). Qualquer outra coisa é recusada.
 */
export function molduraDaPagina(dado: unknown): MolduraDaPagina | null {
  if (typeof dado !== 'object' || dado === null) return null;
  const { fundo, simbolo, altura, menu } = dado as Record<string, unknown>;
  if (typeof fundo !== 'string' || typeof simbolo !== 'string' || !HEX.test(fundo) || !HEX.test(simbolo)) return null;
  const alturaValida = typeof altura === 'number' && Number.isInteger(altura) && altura >= ALTURA_MINIMA_DO_TITULO && altura <= ALTURA_MAXIMA_DO_TITULO;
  const alturaFinal = alturaValida ? altura : ALTURA_DO_TITULO;
  const { x, y } = (typeof menu === 'object' && menu !== null ? menu : {}) as Record<string, unknown>;
  const menuX = coordenada(x, 200);
  const menuY = coordenada(y, 200);
  return {
    fundo: fundo.toLowerCase(), simbolo: simbolo.toLowerCase(), altura: alturaFinal,
    menu: menuX === null || menuY === null ? { x: POSICAO_DO_MENU.x, y: alturaFinal } : { x: menuX, y: menuY },
  };
}

/** O que importa de um `Electron.Input` para reconhecer o Alt sozinho. */
export interface EntradaDeTecla {
  type: string;
  key: string;
  code?: string;
  isAutoRepeat?: boolean;
}

/**
 * Alt apertado e solto sem nenhuma outra tecla no meio abre o menu (como no Windows). `armado` é o estado
 * entre um evento e o próximo. AltGr (teclados com acento) nunca abre.
 */
export function proximoEstadoDoAlt(armado: boolean, entrada: EntradaDeTecla): { armado: boolean; abrir: boolean } {
  const ehAlt = entrada.key === 'Alt' && entrada.code !== 'AltRight';
  if (entrada.type === 'keyDown') {
    if (ehAlt) return { armado: entrada.isAutoRepeat === true ? armado : true, abrir: false };
    return { armado: false, abrir: false };
  }
  if (entrada.type === 'keyUp' && ehAlt) return { armado: false, abrir: armado };
  return { armado, abrir: false };
}
