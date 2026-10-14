/**
 * Sobre o vídeo (noite2/video-popups): legendas dos grifos no tempo das palavras e as pílulas de
 * conceito (bolinha → pílula com timer-pizza de 15 s → cartão), com relógios falsos e um canvas
 * simulado para a escolha da região.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ConceitoDoVideoV1, MidiaV1, TrechoTemporizado } from '@margem/contratos';
import type { SnapshotCapitulo } from '../tipos';
import { fonteDaMidia } from './fontes';
import { PlayerDeMidia } from './PlayerDeMidia';
import type { MarcaDoLeitor } from '../f2';
import { AMOSTRA_DO_QUADRO_MS, ConceitosNoVideo, LegendaDosGrifos } from './SobreOVideo';
import {
  conceitoQueEntra, derivarCurto, DURACAO_DO_CARTAO_MS, escolherRegiao, esquecerOsAdiante, folgasDoConteudo, linhaNoInstante, linhasDosGrifos, marcaDaCor, marcaDoConceito,
  MAXIMO_DO_CURTO, ocupacaoDoQuadro, REGIAO_PADRAO, rotuloCurto, setorDaPizza, suavizarOcupacao, VIZINHANCA_DA_COR_S,
} from './sobre-o-video';

const B1 = '0000000000000000000000B001';
const TEXTO = 'Hoje falamos de stablecoin. Uma stablecoin é uma moeda digital atrelada ao dólar, auditada todo mês por uma empresa de fora.';
/** Uma palavra a cada 0,5 s, a partir de 10 s. */
const palavras: TrechoTemporizado[] = [...TEXTO.matchAll(/\S+/gu)].map((m, i) => ({ bloco_id: B1, inicio_utf16: m.index, fim_utf16: m.index + m[0].length, inicio_s: 10 + i * 0.5, fim_s: 10 + i * 0.5 + 0.4 }));
const inicio = TEXTO.indexOf('Uma stablecoin');
const marca = { id: 'M1', funcao: 'conceito', visivel: true, ancora: { versao_id: 'V', bloco_id: B1, inicio_utf16: inicio, fim_utf16: TEXTO.length, citacao: TEXTO.slice(inicio), prefixo: '', sufixo: '' } } as unknown as MarcaDoLeitor;

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test('legendas: o grifo vira linhas com o tempo das próprias palavras, quebradas na pontuação', () => {
  const linhas = linhasDosGrifos([marca], [{ id: B1, texto: TEXTO }], palavras);
  expect(linhas.map((l) => l.palavras.map((p) => p.texto).join(' '))).toEqual([
    'Uma stablecoin é uma moeda digital atrelada ao dólar,',
    'auditada todo mês por uma empresa de fora.',
  ]);
  expect(linhas[0]!.inicio_s).toBe(12);
  expect(linhaNoInstante(linhas, 11)).toBeNull();
  expect(linhaNoInstante(linhas, 12)?.palavras[0]!.texto).toBe('Uma');
  // A segunda linha toma o lugar da primeira assim que começa.
  expect(linhaNoInstante(linhas, linhas[1]!.inicio_s)?.palavras[0]!.texto).toBe('auditada');
  // Depois do fim, a legenda segura um instante e some.
  expect(linhaNoInstante(linhas, linhas[1]!.fim_s + 0.5)).not.toBeNull();
  expect(linhaNoInstante(linhas, linhas[1]!.fim_s + 2)).toBeNull();
  // Marca escondida ou sem fala não vira legenda.
  expect(linhasDosGrifos([{ ...marca, visivel: false }], [{ id: B1, texto: TEXTO }], palavras)).toEqual([]);
  expect(linhasDosGrifos([marca], [{ id: B1, texto: TEXTO }], [])).toEqual([]);
});

test('legenda: o texto entra como texto, com as palavras já ditas acesas e a cor da função', () => {
  const linhas = linhasDosGrifos([marca], [{ id: B1, texto: TEXTO }], palavras);
  const { container } = render(<LegendaDosGrifos linhas={linhas} marcas={[marca]} tempo={13.1} />);
  const p = container.querySelector('.legenda-dos-grifos p') as HTMLElement;
  expect(p.textContent).toBe('Uma stablecoin é uma moeda digital atrelada ao dólar,');
  expect(p.style.getPropertyValue('--cor-da-funcao')).not.toBe('');
  expect([...p.querySelectorAll('[data-dita]')].map((s) => s.textContent?.trim())).toEqual(['Uma', 'stablecoin', 'é']);
});

const conceito: ConceitoDoVideoV1 = {
  id: 'C1', instante_s: 60, titulo: 'O que é uma stablecoin?', explicacao: 'Uma moeda digital atrelada a outra moeda. Serve para guardar dólar na rede.',
  ancora: { versao_id: 'V', bloco_id: B1, inicio_utf16: 16, fim_utf16: 26, citacao: 'stablecoin', prefixo: '', sufixo: '' },
};

test('conceitos: entra no instante, uma vez, e volta a valer quando o vídeo volta para antes', () => {
  expect(conceitoQueEntra([conceito], 59, new Set())).toBeNull();
  expect(conceitoQueEntra([conceito], 61, new Set())?.id).toBe('C1');
  expect(conceitoQueEntra([conceito], 61, new Set(['C1']))).toBeNull();
  expect(conceitoQueEntra([conceito], 70, new Set())).toBeNull();
  expect(esquecerOsAdiante(new Set(['C1']), [conceito], 61).has('C1')).toBe(true);
  expect(esquecerOsAdiante(new Set(['C1']), [conceito], 30).has('C1')).toBe(false);
});

test('rótulo curto: o do serviço, ou derivado do título (sem a pergunta, o artigo e a pontuação)', () => {
  expect(rotuloCurto({ titulo: 'O que é um LLM?', curto: 'LLM' })).toBe('LLM');
  expect(rotuloCurto({ titulo: 'O que é um LLM?', curto: '  ' })).toBe('LLM');
  const casos: [string, string][] = [
    ['O que é um LLM?', 'LLM'],
    ['O que é uma stablecoin?', 'Stablecoin'],
    ['O que são stablecoins?', 'Stablecoins'],
    ['O que foi Bretton Woods?', 'Bretton Woods'],
    ['Como funciona o SWIFT?', 'SWIFT'],
    ['Quem é o Fed?', 'Fed'],
    ['Para que serve a Selic?', 'Selic'],
    ['Selic', 'Selic'],
    ['Quantitative easing (QE)', 'Quantitative easing'],
    ['O que é o arcabouço fiscal brasileiro de 2023?', 'Arcabouço fiscal'],
    ['Teto de gastos públicos federais', 'Teto de gastos'],
    ['Taxa de juros neutra', 'Taxa de juros'],
    ['Banco de Compensações Internacionais', 'Banco'],
    ['Superintercontinentalização', 'Superintercontinent…'],
    ['?', '?'],
  ];
  for (const [titulo, curto] of casos) expect([titulo, derivarCurto(titulo)]).toEqual([titulo, curto]);
  for (const [titulo] of casos) expect(derivarCurto(titulo).length).toBeLessThanOrEqual(MAXIMO_DO_CURTO);
});

test('cor: a marca visível que mais cobre o trecho do conceito', () => {
  const m = (id: string, inicio: number, fim: number, visivel = true) => ({ id, visivel, ancora: { bloco_id: B1, inicio_utf16: inicio, fim_utf16: fim } });
  expect(marcaDoConceito(conceito, [m('A', 0, 18), m('B', 14, 40)])?.id).toBe('B');
  expect(marcaDoConceito(conceito, [m('A', 0, 18), m('B', 14, 40, false)])?.id).toBe('A');
  expect(marcaDoConceito(conceito, [m('A', 30, 40)])).toBeNull();
  expect(marcaDoConceito(conceito, [{ ...m('A', 0, 40), ancora: { bloco_id: 'outro', inicio_utf16: 0, fim_utf16: 40 } }])).toBeNull();
});

test('cor: sem grifo no trecho, o grifo falado mais perto no tempo, até ±30 s', () => {
  const m = (id: string, visivel = true) => ({ id, visivel, ancora: { bloco_id: 'outro', inicio_utf16: 0, fim_utf16: 5 } });
  const linha = (marca_id: string, inicio_s: number, fim_s: number) => ({ marca_id, inicio_s, fim_s });
  // O conceito está aos 60 s.
  expect(marcaDaCor(conceito, [m('A'), m('B')], [linha('A', 20, 25), linha('B', 85, 95)])?.id).toBe('B');
  expect(marcaDaCor(conceito, [m('A'), m('B')], [linha('A', 31, 40), linha('B', 85, 95)])?.id).toBe('A');
  // Exatamente a 30 s ainda vale; a 30,5 s, não.
  expect(marcaDaCor(conceito, [m('A')], [linha('A', 10, 30)])?.id).toBe('A');
  expect(marcaDaCor(conceito, [m('A')], [linha('A', 10, 29.5)])).toBeNull();
  expect(marcaDaCor(conceito, [m('A')], [linha('A', 90.5, 99)])).toBeNull();
  // Linha que atravessa o instante: distância zero, ganha.
  expect(marcaDaCor(conceito, [m('A'), m('B')], [linha('A', 55, 65), linha('B', 61, 62)])?.id).toBe('A');
  // Grifo escondido não empresta cor; o que contém o trecho vem antes do tempo.
  expect(marcaDaCor(conceito, [m('A', false)], [linha('A', 59, 61)])).toBeNull();
  const contem = { id: 'C', visivel: true, ancora: { bloco_id: B1, inicio_utf16: 10, fim_utf16: 30 } };
  expect(marcaDaCor(conceito, [m('A'), contem], [linha('A', 59, 61)])?.id).toBe('C');
  expect(VIZINHANCA_DA_COR_S).toBe(30);
});

test('pizza: o setor que passou cresce do meio-dia em sentido horário até o círculo inteiro', () => {
  expect(setorDaPizza(0)).toBe('');
  expect(setorDaPizza(0.25)).toBe('M12 12L12 2A10 10 0 0 1 22 12Z');
  expect(setorDaPizza(0.5)).toBe('M12 12L12 2A10 10 0 0 1 12 22Z');
  expect(setorDaPizza(0.75)).toBe('M12 12L12 2A10 10 0 1 1 2 12Z');
  expect(setorDaPizza(1)).toBe('M12 2A10 10 0 1 1 11.999 2Z');
  expect(setorDaPizza(2)).toBe(setorDaPizza(1));
});

/** Um quadro 64 × 36 sintético: xadrez (ocupado) onde `ocupado(x, y)`, cinza liso no resto. */
function quadro(ocupado: (x: number, y: number) => boolean): Uint8ClampedArray {
  const px = new Uint8ClampedArray(64 * 36 * 4);
  for (let y = 0; y < 36; y++) for (let x = 0; x < 64; x++) {
    const v = ocupado(x, y) ? ((x + y) % 2 === 0 ? 230 : 20) : 120;
    px.set([v, v, v, 255], (y * 64 + x) * 4);
  }
  return px;
}

test('região: a menos ocupada do rodapé; rodapé todo ocupado → em cima; sem medida → embaixo à esquerda', () => {
  expect(escolherRegiao(null)).toBe(REGIAO_PADRAO);
  expect(REGIAO_PADRAO).toBe('baixo-esquerda');
  expect(escolherRegiao(ocupacaoDoQuadro(quadro(() => false), 64, 36))).toBe('baixo-esquerda');
  // Assunto à esquerda embaixo: vai para a direita (os cantos antes do centro).
  expect(escolherRegiao(ocupacaoDoQuadro(quadro((x, y) => x < 22 && y > 20), 64, 36))).toBe('baixo-direita');
  // Assunto nos dois cantos de baixo: centro.
  expect(escolherRegiao(ocupacaoDoQuadro(quadro((x, y) => (x < 21 || x >= 43) && y > 20), 64, 36))).toBe('baixo-centro');
  // O centro pesa mais: com a mesma ocupação leve nos três, o centro perde.
  const o = ocupacaoDoQuadro(quadro((_x, y) => y > 20), 64, 36);
  expect(o['baixo-centro']).toBeGreaterThan(o['baixo-esquerda']);
  // Rodapé todo ocupado e o alto liso: em cima.
  expect(escolherRegiao(o)).toBe('cima');
  // Tudo ocupado: fica no rodapé.
  expect(escolherRegiao(ocupacaoDoQuadro(quadro(() => true), 64, 36))).toBe('baixo-esquerda');
  // A média móvel: um quadro só não decide sozinho.
  const liso = ocupacaoDoQuadro(quadro(() => false), 64, 36);
  expect(suavizarOcupacao(null, o)).toEqual(o);
  expect(suavizarOcupacao(liso, o)['baixo-esquerda']).toBeCloseTo(o['baixo-esquerda'] / 2, 5);
});

test('folgas: a imagem dentro das faixas pretas do object-fit: contain', () => {
  expect(folgasDoConteudo({ largura: 1600, altura: 900 }, { largura: 1280, altura: 720 })).toEqual({ x: 0, y: 0 });
  expect(folgasDoConteudo({ largura: 1600, altura: 1000 }, { largura: 1280, altura: 720 })).toEqual({ x: 0, y: 50 });
  expect(folgasDoConteudo({ largura: 2000, altura: 900 }, { largura: 1280, altura: 720 })).toEqual({ x: 200, y: 0 });
  expect(folgasDoConteudo({ largura: 0, altura: 0 }, { largura: 0, altura: 0 })).toEqual({ x: 0, y: 0 });
});

function movimento(reduzido: boolean): void {
  vi.stubGlobal('matchMedia', (consulta: string) => ({ matches: reduzido && consulta.includes('reduce'), addEventListener: () => undefined, removeEventListener: () => undefined }));
}
beforeEach(() => movimento(false));

const pilulas = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.conceito-no-video')];
const fase = (): string | null => pilulas()[0]?.getAttribute('data-fase') ?? null;
const passou = (): number => Number(pilulas()[0]!.getAttribute('data-passou'));
const pilula = (titulo = conceito.titulo): HTMLElement => screen.getByRole('button', { name: `Conceito: ${titulo}` });

test('pílula: bolinha → pílula com rótulo curto → setor de 15 s → some; o mouse pausa o setor', () => {
  vi.useFakeTimers();
  const ir = vi.fn();
  const { rerender } = render(<ConceitosNoVideo conceitos={[conceito]} tempo={59} tocando aoIrAoTrecho={ir} />);
  expect(fase()).toBeNull();
  rerender(<ConceitosNoVideo conceitos={[conceito]} tempo={60.2} tocando aoIrAoTrecho={ir} />);
  expect(fase()).toBe('bolinha');
  act(() => { vi.advanceTimersByTime(200); });
  expect(fase()).toBe('pilula');
  expect(pilula().textContent).toBe('Stablecoin');
  expect(document.querySelector('.pizza-do-conceito .setor')).toBeNull();
  act(() => { vi.advanceTimersByTime(5000); });
  expect(passou()).toBeCloseTo(1 / 3, 2);
  expect(document.querySelector('.pizza-do-conceito .setor')?.getAttribute('d')).toMatch(/^M12 12L12 1\.5A/u);
  // Mouse em cima: o setor para.
  fireEvent.pointerEnter(pilulas()[0]!);
  act(() => { vi.advanceTimersByTime(20_000); });
  expect(fase()).toBe('pilula');
  expect(passou()).toBeCloseTo(1 / 3, 2);
  fireEvent.pointerLeave(pilulas()[0]!);
  act(() => { vi.advanceTimersByTime(5000); });
  expect(passou()).toBeCloseTo(2 / 3, 2);
  act(() => { vi.advanceTimersByTime(5000); });
  expect(fase()).toBe('saindo');
  act(() => { vi.advanceTimersByTime(500); });
  expect(fase()).toBeNull();
  // Visto: o tempo seguindo no mesmo trecho não traz a pílula de volta.
  rerender(<ConceitosNoVideo conceitos={[conceito]} tempo={62} tocando aoIrAoTrecho={ir} />);
  expect(fase()).toBeNull();
});

test('pílula: a cor do grifo que contém o trecho; sem grifo, a de destaque (sem variável própria)', () => {
  vi.useFakeTimers();
  const grifo = { ...marca, id: 'M2', ancora: { ...marca.ancora, inicio_utf16: 10, fim_utf16: 30 } };
  const { unmount } = render(<ConceitosNoVideo conceitos={[conceito]} marcas={[grifo]} tempo={60.2} tocando aoIrAoTrecho={() => undefined} />);
  expect(pilulas()[0]!.style.getPropertyValue('--cor-do-conceito')).not.toBe('');
  unmount();
  render(<ConceitosNoVideo conceitos={[conceito]} marcas={[]} tempo={60.2} tocando aoIrAoTrecho={() => undefined} />);
  expect(pilulas()[0]!.style.getPropertyValue('--cor-do-conceito')).toBe('');
});

test('pílula: Enter/clique abre o cartão (que não some sozinho); Esc volta à pílula com o foco; "Ir ao trecho" leva ao instante', () => {
  vi.useFakeTimers();
  const ir = vi.fn();
  render(<ConceitosNoVideo conceitos={[conceito]} tempo={60.5} tocando aoIrAoTrecho={ir} />);
  act(() => { vi.advanceTimersByTime(200); });
  pilula().focus();
  fireEvent.click(pilula());
  expect(fase()).toBe('aberto');
  const cartao = screen.getByRole('group', { name: conceito.titulo });
  expect(document.activeElement).toBe(cartao);
  expect(screen.getByText(conceito.explicacao)).toBeTruthy();
  expect(screen.getByText('“stablecoin”')).toBeTruthy();
  act(() => { vi.advanceTimersByTime(60_000); });
  expect(fase()).toBe('aberto');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(fase()).toBe('pilula');
  expect(document.activeElement).toBe(pilula());
  fireEvent.click(pilula());
  fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
  expect(fase()).toBe('pilula');
  fireEvent.click(pilula());
  fireEvent.click(screen.getByRole('button', { name: 'Ir ao trecho' }));
  expect(ir).toHaveBeenCalledWith(conceito);
  expect(fase()).toBe('saindo');
});

const segundo: ConceitoDoVideoV1 = { ...conceito, id: 'C2', instante_s: 120, titulo: 'O que foi Bretton Woods?', curto: 'Bretton Woods' };

test('pílulas: duas ao mesmo tempo se empilham, a mais nova embaixo; a primeira sai e a outra fica', () => {
  vi.useFakeTimers();
  const { rerender } = render(<ConceitosNoVideo conceitos={[conceito, segundo]} tempo={60.2} tocando aoIrAoTrecho={() => undefined} />);
  act(() => { vi.advanceTimersByTime(200); });
  // O mouse segura a primeira enquanto o vídeo chega ao segundo conceito.
  fireEvent.pointerEnter(pilulas()[0]!);
  rerender(<ConceitosNoVideo conceitos={[conceito, segundo]} tempo={120.1} tocando aoIrAoTrecho={() => undefined} />);
  act(() => { vi.advanceTimersByTime(200); });
  expect(pilulas().map((p) => p.querySelector('.rotulo-da-pilula')!.textContent)).toEqual(['Stablecoin', 'Bretton Woods']);
  expect(document.querySelectorAll('.conceitos-no-video')).toHaveLength(1);
  // Com o mouse sobre as duas, nenhuma corre; ele sai da primeira, que termina e sai.
  fireEvent.pointerEnter(pilulas()[1]!);
  fireEvent.pointerLeave(pilulas()[0]!);
  act(() => { vi.advanceTimersByTime(DURACAO_DO_CARTAO_MS); });
  act(() => { vi.advanceTimersByTime(500); });
  expect(pilulas().map((p) => p.querySelector('.rotulo-da-pilula')!.textContent)).toEqual(['Bretton Woods']);
});

test('pílula: com o vídeo pausado o setor espera; movimento reduzido pula a bolinha', () => {
  movimento(true);
  vi.useFakeTimers();
  render(<ConceitosNoVideo conceitos={[conceito]} tempo={60} tocando={false} aoIrAoTrecho={() => undefined} />);
  expect(fase()).toBe('pilula');
  act(() => { vi.advanceTimersByTime(30_000); });
  expect(passou()).toBe(0);
});

/** Um vídeo "carregado" e um canvas simulado que devolve o quadro pedido (ou recusa, se contaminado). */
function videoSimulado(pixels: Uint8ClampedArray | 'contaminado'): { ref: { current: HTMLVideoElement }; leituras: () => number } {
  const video = document.createElement('video');
  Object.defineProperties(video, {
    readyState: { value: 4 }, videoWidth: { value: 1280 }, videoHeight: { value: 720 }, clientWidth: { value: 640 }, clientHeight: { value: 400 },
  });
  let leituras = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    drawImage: () => undefined,
    getImageData: () => {
      leituras++;
      if (pixels === 'contaminado') throw new DOMException('O canvas está contaminado.', 'SecurityError');
      return { data: pixels };
    },
  }) as unknown as CanvasRenderingContext2D);
  return { ref: { current: video }, leituras: () => leituras };
}

test('região no player: o quadro amostrado leva a pílula para o canto livre; dentro das faixas pretas', () => {
  vi.useFakeTimers();
  const { ref } = videoSimulado(quadro((x, y) => x < 22 && y > 20));
  const { rerender } = render(<ConceitosNoVideo conceitos={[conceito]} tempo={50} tocando video={ref} aoIrAoTrecho={() => undefined} />);
  act(() => { vi.advanceTimersByTime(AMOSTRA_DO_QUADRO_MS * 3); });
  rerender(<ConceitosNoVideo conceitos={[conceito]} tempo={60.1} tocando video={ref} aoIrAoTrecho={() => undefined} />);
  const pilha = document.querySelector<HTMLElement>('.conceitos-no-video')!;
  expect(pilha.getAttribute('data-regiao')).toBe('baixo-direita');
  // 640 × 400 com 16:9: a imagem tem 360 de altura, 20 px de faixa em cima e embaixo.
  expect(pilha.style.getPropertyValue('--folga-y')).toBe('20px');
});

test('região no player: canvas contaminado → embaixo à esquerda, e para de amostrar', () => {
  vi.useFakeTimers();
  const { ref, leituras } = videoSimulado('contaminado');
  const { rerender } = render(<ConceitosNoVideo conceitos={[conceito]} tempo={50} tocando video={ref} aoIrAoTrecho={() => undefined} />);
  act(() => { vi.advanceTimersByTime(AMOSTRA_DO_QUADRO_MS * 3); });
  expect(leituras()).toBe(1);
  rerender(<ConceitosNoVideo conceitos={[conceito]} tempo={60.1} tocando video={ref} aoIrAoTrecho={() => undefined} />);
  expect(document.querySelector('.conceitos-no-video')!.getAttribute('data-regiao')).toBe('baixo-esquerda');
});

test('região: não pula com a pílula na tela; muda só na próxima leva', () => {
  vi.useFakeTimers();
  let pixels = quadro((x, y) => x < 22 && y > 20);
  const video = document.createElement('video');
  Object.defineProperties(video, { readyState: { value: 4 }, videoWidth: { value: 16 }, videoHeight: { value: 9 } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage: () => undefined, getImageData: () => ({ data: pixels }) }) as unknown as CanvasRenderingContext2D);
  const ref = { current: video };
  const terceiro: ConceitoDoVideoV1 = { ...conceito, id: 'C3', instante_s: 200, titulo: 'SWIFT' };
  const props = { conceitos: [conceito, terceiro], tocando: true, video: ref, aoIrAoTrecho: () => undefined };
  const { rerender } = render(<ConceitosNoVideo {...props} tempo={50} />);
  act(() => { vi.advanceTimersByTime(AMOSTRA_DO_QUADRO_MS * 3); });
  rerender(<ConceitosNoVideo {...props} tempo={60.1} />);
  const regiao = (): string | null => document.querySelector('.conceitos-no-video')?.getAttribute('data-regiao') ?? null;
  expect(regiao()).toBe('baixo-direita');
  // O assunto passa para a direita enquanto a pílula está na tela: ela não se mexe.
  pixels = quadro((x, y) => x > 42 && y > 20);
  act(() => { vi.advanceTimersByTime(AMOSTRA_DO_QUADRO_MS * 3); });
  expect(regiao()).toBe('baixo-direita');
  act(() => { vi.advanceTimersByTime(DURACAO_DO_CARTAO_MS); });
  act(() => { vi.advanceTimersByTime(500); });
  expect(regiao()).toBeNull();
  rerender(<ConceitosNoVideo {...props} tempo={200.1} />);
  expect(regiao()).toBe('baixo-esquerda');
});

// ---------------------------------------------------------------- no player

const V = '0000000000000000000000V001';
const midia: MidiaV1 = {
  versao: 1, id: '0000000000000000000000M001', documento_id: '0000000000000000000000D001', versao_id: V, tipo: 'video', titulo: 'Vídeo de teste',
  sha256: 'a'.repeat(64), mime: 'video/mp4', bytes: 10, duracao_s: 120, largura: 640, altura: 360,
  fonte: { url: 'https://www.youtube.com/watch?v=x', canal: 'Canal' }, transcricao: { motor: 'teste', idioma: 'pt', sha256: 'b'.repeat(64) },
  capitulos: [], palavras, frases: [{ ...palavras[0]!, fim_utf16: TEXTO.length, fim_s: palavras.at(-1)!.fim_s }],
};
const snapshot = { versao_id: V, secao: { id: 'S', nivel: 1, titulo: 'T', ordem: 0, bloco_inicio: B1, bloco_fim: B1 }, blocos: [{ id: B1, tipo: 'paragrafo', texto: TEXTO }], marcas: [marca], assets: {} } as unknown as SnapshotCapitulo;

test('player: "Só o vídeo" mostra a legenda do grifo, que liga e desliga; "Preparar partes e momentos" pede ao serviço', async () => {
  const chamadas: string[] = [];
  let pronto = false;
  vi.stubGlobal('fetch', (url: string, inicio?: RequestInit) => {
    chamadas.push(`${inicio?.method ?? 'GET'} ${url}`);
    if (inicio?.method === 'POST') pronto = true;
    const corpo = pronto ? { estado: 'pronto', conceitos: { conceitos: [conceito] } } : { estado: 'nao_preparado', conceitos: null };
    return Promise.resolve(new Response(JSON.stringify(corpo), { status: inicio?.method === 'POST' ? 202 : 200 }));
  });
  vi.stubGlobal('CSS', { highlights: new Map() });
  vi.stubGlobal('Highlight', class { readonly falso = true; });
  window.scrollBy = vi.fn();
  render(<PlayerDeMidia fontes={[fonteDaMidia(midia)]} raiz={null} snapshot={snapshot} aoFechar={() => undefined} />);
  const video = document.querySelector('video')!;
  Object.defineProperty(video, 'currentTime', { value: 13.1, writable: true, configurable: true });
  await act(async () => { await new Promise((r) => { setTimeout(r, 50); }); });
  expect(document.querySelector('.legenda-dos-grifos')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Só o vídeo' }));
  expect(document.querySelector('.player-midia')!.getAttribute('data-video')).toBe('so');
  expect(document.querySelector('.legenda-dos-grifos p')?.textContent).toBe('Uma stablecoin é uma moeda digital atrelada ao dólar,');
  fireEvent.click(screen.getByRole('button', { name: 'Desligar as legendas dos grifos' }));
  expect(document.querySelector('.legenda-dos-grifos')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Ligar as legendas dos grifos' }));
  expect(document.querySelector('.legenda-dos-grifos')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Voltar ao texto' }));
  expect(document.querySelector('.legenda-dos-grifos')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: /^Velocidade/u }));
  fireEvent.click(await screen.findByRole('button', { name: 'Preparar partes e momentos' }));
  expect(await screen.findByText('1 momento.')).toBeTruthy();
  expect(chamadas).toContain(`POST /api/midias/${midia.id}/conceitos`);
});
