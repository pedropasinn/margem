/**
 * A casca da janela no app de computador (V-U5). Lá a janela não tem barra de título nem faixa de menu:
 * o conteúdo vai até o topo, e esta faixa transparente (a altura dos botões nativos) arrasta a janela; os
 * controles que caem nela continuam clicáveis. Fora do macOS ela traz o botão do menu do app no canto
 * esquerdo, e os botões nativos (à direita) recebem as cores do tema do app.
 *
 * Só vale com a ponte do Electron (`window.margemDesktop.janela`): no navegador nada muda.
 */
import './janela-desktop.css';

/** O pedaço da ponte do app de computador que cuida da janela. Espelho de `desktop/src/principal/ponte.ts`. */
export interface JanelaDoDesktop {
  sistema: string;
  alturaDoTitulo: number;
  abrirMenu: () => void;
  definirMoldura: (moldura: MolduraDaJanela) => void;
}

/**
 * O que a página manda para a janela: as cores `#rrggbb` dos botões nativos, a altura da área de título
 * em px e onde o menu abre (logo abaixo do botão de menu, em px da janela).
 */
export interface MolduraDaJanela { fundo: string; simbolo: string; altura: number; menu: { x: number; y: number } }

/** Barras do topo mais altas que a faixa padrão: os botões nativos crescem até a altura delas e ficam alinhados. */
const BARRAS_DO_TOPO = '.barra-do-leitor, .barra-do-quadro, .topbar';

export function janelaDoDesktop(): JanelaDoDesktop | null {
  const ponte = (window as { margemDesktop?: { janela?: Partial<JanelaDoDesktop> } }).margemDesktop;
  const janela = ponte?.janela;
  return typeof janela?.abrirMenu === 'function' && typeof janela.definirMoldura === 'function' ? janela as JanelaDoDesktop : null;
}

/** `rgb()`/`rgba()` (o que o `getComputedStyle` devolve) ou `#rrggbb` em componentes; null se não reconhecer. */
function componentes(cor: string): [number, number, number, number] | null {
  const emHex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(cor.trim());
  if (emHex !== null) return [Number.parseInt(emHex[1] ?? '0', 16), Number.parseInt(emHex[2] ?? '0', 16), Number.parseInt(emHex[3] ?? '0', 16), 1];
  const achado = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(cor.trim());
  if (achado === null) return null;
  const alfa = achado[4] === undefined ? 1 : achado[4].endsWith('%') ? Number.parseFloat(achado[4]) / 100 : Number.parseFloat(achado[4]);
  return [Number(achado[1]), Number(achado[2]), Number(achado[3]), alfa];
}

const hex = (canal: number): string => Math.round(Math.min(255, Math.max(0, canal))).toString(16).padStart(2, '0');

/**
 * A cor como `#rrggbb` opaco, com a transparência composta sobre `fundo` (os botões nativos não aceitam
 * alfa). Null se alguma das duas não for reconhecida.
 */
export function corOpaca(cor: string, fundo = 'rgb(255, 255, 255)'): string | null {
  const c = componentes(cor);
  const f = componentes(fundo);
  if (c === null || f === null) return null;
  const [r, g, b, a] = c;
  return `#${hex(r * a + f[0] * (1 - a))}${hex(g * a + f[1] * (1 - a))}${hex(b * a + f[2] * (1 - a))}`;
}

/** Os elementos num ponto, do de cima para o de baixo (vazio onde o navegador não sabe dizer). */
const elementosNoPonto = (x: number, y: number): Element[] => (typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : []);

/**
 * O fundo visível num ponto da página, opaco: as camadas translúcidas (um véu de diálogo, um hover) compostas
 * sobre a primeira opaca abaixo delas. `base` é o fundo da página, se nenhuma for opaca.
 */
export function fundoNoPonto(x: number, y: number, base: string): string {
  const camadas: string[] = [];
  // Do mais de cima para o de baixo, como a tela pinta (inclui os ancestrais).
  for (const elemento of elementosNoPonto(x, y)) {
    const cor = getComputedStyle(elemento).backgroundColor;
    const partes = componentes(cor);
    if (partes === null || partes[3] === 0) continue;
    camadas.push(cor);
    if (partes[3] >= 1) break;
  }
  return camadas.reduceRight((abaixo, cor) => corOpaca(cor, abaixo) ?? abaixo, base);
}

/**
 * As cores dos botões nativos: o fundo que está sob eles (o canto superior direito: a página, um painel
 * lateral, a barra do leitor) e o texto secundário do tema (o tom dos ícones do app) composto sobre ele.
 */
function molduraDoCanto(alturaPadrao: number, botao: HTMLElement | null): MolduraDaJanela | null {
  const sonda = document.createElement('span');
  sonda.style.cssText = 'position:absolute;visibility:hidden;background:var(--bg);color:var(--texto-2)';
  document.body.append(sonda);
  const estilo = getComputedStyle(sonda);
  const base = corOpaca(estilo.backgroundColor);
  const texto = estilo.color;
  sonda.remove();
  if (base === null) return null;
  const x = Math.max(0, window.innerWidth - 24);
  const fundo = corOpaca(fundoNoPonto(x, 4, base)) ?? base;
  const simbolo = corOpaca(texto, fundo);
  if (simbolo === null) return null;
  const altura = alturaNoCanto(x, alturaPadrao);
  const caixa = botao?.getBoundingClientRect();
  const menu = caixa === undefined || caixa.height === 0
    ? { x: 6, y: altura }
    : { x: Math.round(caixa.left), y: Math.round(caixa.bottom + 4) };
  return { fundo, simbolo, altura, menu };
}

/** A altura da barra do topo sob o canto (a do leitor, a do quadro), ou a padrão se não houver uma. */
export function alturaNoCanto(x: number, alturaPadrao: number): number {
  for (const elemento of elementosNoPonto(x, 4)) {
    const barra = elemento.closest(BARRAS_DO_TOPO);
    if (barra === null) continue;
    const caixa = barra.getBoundingClientRect();
    if (caixa.top <= 1 && caixa.height >= alturaPadrao && caixa.height <= 72) return Math.round(caixa.height);
  }
  return alturaPadrao;
}

function iconeDoMenu(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [nome, valor] of Object.entries({ width: '18', height: '18', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'aria-hidden': 'true' })) svg.setAttribute(nome, valor);
  for (const y of [6, 12, 18]) {
    const linha = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    for (const [nome, valor] of Object.entries({ x1: '4', x2: '20', y1: String(y), y2: String(y) })) linha.setAttribute(nome, valor);
    svg.append(linha);
  }
  return svg;
}

/**
 * Liga a casca da janela se a página está no app de computador. A faixa entra antes do `#raiz`: na ordem
 * do documento, os controles da página (que vêm depois) recortam a área de arraste e seguem clicáveis.
 */
export function ligarJanelaDoDesktop(janela = janelaDoDesktop()): (() => void) | null {
  if (janela === null) return null;
  const html = document.documentElement;
  html.classList.add('janela-desktop');
  html.dataset['sistemaDaJanela'] = janela.sistema;
  html.style.setProperty('--altura-titulo-padrao', `${janela.alturaDoTitulo}px`);

  const faixa = document.createElement('div');
  faixa.className = 'topo-da-janela';
  let botao: HTMLButtonElement | null = null;
  if (janela.sistema !== 'darwin') {
    botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'menu-da-janela';
    botao.setAttribute('aria-label', 'Menu do Margem');
    botao.title = 'Menu (Alt)';
    botao.append(iconeDoMenu());
    botao.addEventListener('click', () => { janela.abrirMenu(); });
    faixa.append(botao);
  }
  document.body.prepend(faixa);

  // Os botões nativos acompanham o tema do app (que pode não ser o do sistema) e o que está sob eles em
  // cada tela: a cor e a altura da barra do topo. Uma conta por quadro, no máximo, e só manda o que mudou.
  let ultima = '';
  let pedido = 0;
  const pintar = (): void => {
    pedido = 0;
    const moldura = molduraDoCanto(janela.alturaDoTitulo, botao);
    if (moldura === null) return;
    const chave = JSON.stringify(moldura);
    if (chave === ultima) return;
    ultima = chave;
    // No macOS não há `titlebar-area-*`: a altura vale pela variável (no Windows e no Linux o env() ganha).
    html.style.setProperty('--altura-titulo-padrao', `${moldura.altura}px`);
    janela.definirMoldura(moldura);
    // A altura nova muda a posição do botão (e com ela a do menu): mais uma conta no próximo quadro.
    agendar();
  };
  const agendar = (): void => { if (pedido === 0) pedido = requestAnimationFrame(pintar); };
  pintar();
  const observador = new MutationObserver(agendar);
  observador.observe(html, { attributes: true, attributeFilter: ['data-tema'] });
  observador.observe(document.body, { childList: true, subtree: true });
  const esquema = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  esquema?.addEventListener('change', agendar);
  window.addEventListener('resize', agendar);
  return () => {
    observador.disconnect();
    if (pedido !== 0) cancelAnimationFrame(pedido);
    esquema?.removeEventListener('change', agendar);
    window.removeEventListener('resize', agendar);
    faixa.remove();
    html.classList.remove('janela-desktop');
    delete html.dataset['sistemaDaJanela'];
  };
}
