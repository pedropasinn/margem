import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AudioV1, MidiaV1, TrechoTemporizado } from '@margem/contratos';
import { fonteDaMidia, fonteDoAudio, posicaoGuardada, rotuloDaVelocidade, CHAVES } from './fontes';
import { indicePorBloco, intervaloDoTrecho, Karaoke, REALCE_DA_PALAVRA, trechoNoPonto } from '../karaoke/karaoke';
import { PlayerDeMidia } from './PlayerDeMidia';
import type { SnapshotCapitulo } from '../tipos';
import { sessaoFalsa, MetadadosFalsos } from '../player/sessao-falsa';

const V = '0000000000000000000000V001';
const B1 = '0000000000000000000000B001';
const B2 = '0000000000000000000000B002';
const TEXTO1 = 'Olá 🧭, isto é um teste.';
const TEXTO2 = 'Segunda frase aqui.';

/** O DOM que o leitor desenha: um `[data-bloco]` por bloco e `span[data-inicio]` por segmento (aqui, dois no primeiro). */
function artigo(): HTMLElement {
  const raiz = document.createElement('div');
  raiz.innerHTML = `<article class="capitulo"><p data-bloco="${B1}"><span data-inicio="0">Olá 🧭, isto </span><span data-inicio="13">é um teste.</span></p><p data-bloco="${B2}"><span data-inicio="0">${TEXTO2}</span></p></article>`;
  document.body.appendChild(raiz);
  return raiz;
}

const palavra = (bloco: string, inicio: number, fim: number, s: number): TrechoTemporizado => ({ bloco_id: bloco, inicio_utf16: inicio, fim_utf16: fim, inicio_s: s, fim_s: s + 0.4 });
const palavras = [palavra(B1, 0, 3, 0), palavra(B1, 8, 12, 0.5), palavra(B1, 13, 14, 1), palavra(B1, 15, 17, 1.5), palavra(B1, 18, 24, 2), palavra(B2, 0, 7, 3), palavra(B2, 8, 13, 3.5), palavra(B2, 14, 19, 4)];
const frases = [{ ...palavra(B1, 0, 24, 0), fim_s: 2.4 }, { ...palavra(B2, 0, 19, 3), fim_s: 4.4 }];
const midia: MidiaV1 = {
  versao: 1, id: '0000000000000000000000M001', documento_id: '0000000000000000000000D001', versao_id: V, tipo: 'video', titulo: 'Vídeo de teste',
  sha256: 'a'.repeat(64), mime: 'video/mp4', bytes: 10, duracao_s: 5, largura: 640, altura: 360,
  fonte: { url: 'https://www.youtube.com/watch?v=x', canal: 'Canal' }, transcricao: { motor: 'teste', idioma: 'pt', sha256: 'b'.repeat(64) },
  capitulos: [{ inicio_s: 0, titulo: 'Abertura' }, { inicio_s: 3, titulo: 'Segundo bloco' }], palavras, frases,
};
const snapshot = { versao_id: V, secao: { id: 'S', nivel: 1, titulo: 'T', ordem: 0, bloco_inicio: B1, bloco_fim: B2 }, blocos: [{ id: B1, tipo: 'paragrafo', texto: TEXTO1 }, { id: B2, tipo: 'paragrafo', texto: TEXTO2 }], marcas: [], assets: {} } as unknown as SnapshotCapitulo;

class RealceFalso { priority = 0; readonly intervalos: Range[]; constructor(...intervalos: Range[]) { this.intervalos = intervalos; } }
let registro: Map<string, RealceFalso>;
let tocar: ReturnType<typeof vi.spyOn>;
let pausar: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  registro = new Map();
  vi.stubGlobal('CSS', { highlights: registro });
  vi.stubGlobal('Highlight', RealceFalso);
  tocar = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) { Object.defineProperty(this, 'paused', { value: false, configurable: true }); this.dispatchEvent(new Event('play')); return Promise.resolve(); });
  pausar = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) { Object.defineProperty(this, 'paused', { value: true, configurable: true }); this.dispatchEvent(new Event('pause')); });
  window.scrollBy = vi.fn();
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ''; document.documentElement.className = ''; });

const texto = (nome: string): string => registro.get(nome)?.intervalos[0]?.toString() ?? '';

test('intervalo do trecho atravessa segmentos e respeita UTF-16', () => {
  const raiz = artigo();
  expect(intervaloDoTrecho(raiz, palavras[1]!)?.toString()).toBe('isto');
  expect(intervaloDoTrecho(raiz, frases[0]!)?.toString()).toBe(TEXTO1);
  expect(intervaloDoTrecho(raiz, { bloco_id: 'ausente', inicio_utf16: 0, fim_utf16: 2 })).toBeNull();
});

/** Layout falso: cada `Range` vira um retângulo por caractere numa linha de 60 caracteres (10 px cada, 24 px de altura, linhas a 34 px). */
function layoutFalso(): void {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, writable: true, value: function (this: Range) {
    const bloco = (this.startContainer.parentElement?.closest('[data-bloco]') as HTMLElement | null);
    const inicio = Number((this.startContainer.parentElement as HTMLElement).dataset['inicio'] ?? 0) + this.startOffset;
    const fim = Number((this.endContainer.parentElement as HTMLElement).dataset['inicio'] ?? 0) + this.endOffset;
    const linhaDoBloco = bloco?.dataset['bloco'] === B2 ? 3 : 0;
    const caixas: DOMRect[] = [];
    for (let c = inicio; c < fim; c += 1) caixas.push(new DOMRect(100 + (c % 12) * 10, 50 + (linhaDoBloco + Math.floor(c / 12)) * 34, 10, 24));
    return caixas as unknown as DOMRectList;
  } });
}
afterEach(() => { delete (Range.prototype as { getClientRects?: unknown }).getClientRects; });
const quadro = (): Promise<void> => new Promise((r) => { requestAnimationFrame(() => r()); });

test('karaokê: a faixa da frase por linha e o bloco da palavra numa camada atrás do texto, sem tocar no texto', async () => {
  layoutFalso();
  const raiz = artigo();
  const capitulo = raiz.querySelector('.capitulo')!;
  for (const p of capitulo.querySelectorAll('p')) p.getBoundingClientRect = () => new DOMRect(100, 50, 120, 68);
  const antes = capitulo.querySelector('p')!.outerHTML;
  const karaoke = new Karaoke();
  karaoke.definir(raiz, { frase: frases[0]!, palavra: palavras[1]!, modo: 'palavra' });
  await quadro();
  const camada = capitulo.querySelector('.camada-do-karaoke')!;
  expect(camada.getAttribute('aria-hidden')).toBe('true');
  // TEXTO1 tem 24 unidades: duas linhas de 12 → duas faixas; "isto" (8–12) fica numa linha só.
  expect(camada.querySelectorAll('.karaoke-faixa')).toHaveLength(2);
  expect(camada.querySelectorAll('.karaoke-palavra')).toHaveLength(1);
  // Sem faixa lateral colorida (J142): o filete à esquerda do parágrafo saiu.
  expect(camada.querySelector('.karaoke-filete')).toBeNull();
  expect(registro.get(REALCE_DA_PALAVRA)?.intervalos[0]?.toString()).toBe('isto');
  expect(capitulo.querySelector('p')!.outerHTML).toBe(antes);
  const faixas = [...camada.querySelectorAll('.karaoke-faixa')];

  // A palavra anda na mesma frase: a faixa não é refeita, só o bloco da palavra se move.
  const palavraAntes = (camada.querySelector('.karaoke-palavra') as HTMLElement).style.transform;
  karaoke.definir(raiz, { frase: frases[0]!, palavra: palavras[2]!, modo: 'palavra' });
  await quadro();
  expect([...camada.querySelectorAll('.karaoke-faixa')]).toEqual(faixas);
  expect((camada.querySelector('.karaoke-palavra') as HTMLElement).style.transform).not.toBe(palavraAntes);
  expect(registro.get(REALCE_DA_PALAVRA)?.intervalos[0]?.toString()).toBe('é');

  // Só a frase: sem bloco nem tinta da palavra. Nenhum: a camada se esvazia.
  karaoke.definir(raiz, { frase: frases[1]!, palavra: palavras[6]!, modo: 'frase' });
  await quadro();
  expect(camada.querySelectorAll('.karaoke-faixa')).toHaveLength(2); // TEXTO2: 19 unidades, duas linhas
  expect(camada.querySelectorAll('.karaoke-palavra')).toHaveLength(0);
  expect(registro.has(REALCE_DA_PALAVRA)).toBe(false);
  karaoke.definir(raiz, { frase: frases[1]!, palavra: null, modo: 'nenhum' });
  await quadro();
  expect(camada.childElementCount).toBe(0);
  karaoke.destruir();
  expect(capitulo.querySelector('.camada-do-karaoke')).toBeNull();
});

test('clique: acha a palavra do ponto pelo bloco e pelo offset', () => {
  const porBloco = indicePorBloco(palavras);
  expect(trechoNoPonto(palavras, porBloco, { bloco_id: B1, offset_utf16: 9 })).toBe(1);
  expect(trechoNoPonto(palavras, porBloco, { bloco_id: B2, offset_utf16: 0 })).toBe(5);
  expect(trechoNoPonto(palavras, porBloco, { bloco_id: 'x', offset_utf16: 0 })).toBe(-1);
});

test('fontes: mídia e áudio narrado viram a mesma coisa', () => {
  const doAudio = fonteDoAudio({ versao: 1, id: 'A', versao_id: V, secao_id: 'S', titulo: 'Narração', sha256_audio: 'a'.repeat(64), voz_sha256: 'b'.repeat(64), job_colab: 'job_a', duracao_s: 3,
    trechos: [{ inicio_s: 0, fim_s: 2, ancora: { versao_id: V, bloco_id: B1, inicio_utf16: 0, fim_utf16: 24, citacao: TEXTO1, prefixo: '', sufixo: '' } }] } satisfies AudioV1);
  expect(doAudio).toMatchObject({ tipo: 'audio', url: '/api/audios/A/arquivo', palavras: [] });
  expect(doAudio.frases[0]).toMatchObject({ bloco_id: B1, fim_utf16: 24 });
  expect(fonteDaMidia(midia).url).toBe(`/api/midias/${midia.id}/arquivo`);
  expect(rotuloDaVelocidade(1.25)).toBe('1,25×');
});

test('player: não toca sozinho, salta, muda velocidade, capítulos e teclado', async () => {
  const raiz = artigo();
  const fechar = vi.fn();
  render(<PlayerDeMidia fontes={[fonteDaMidia(midia)]} raiz={raiz} snapshot={snapshot} aoFechar={fechar} />);
  const video = document.querySelector('video')!;
  expect(video.autoplay).toBe(false);
  expect(video.getAttribute('src')).toBe(`/api/midias/${midia.id}/arquivo`);
  expect(document.documentElement.classList.contains('com-player')).toBe(true);
  expect(document.documentElement.classList.contains('com-karaoke')).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: 'Avançar 10 segundos' }));
  expect(video.currentTime).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Tocar' }));
  expect(tocar).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Pausar' })).toBeTruthy();
  fireEvent.keyDown(window, { key: ' ' });
  expect(pausar).toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: /^Velocidade/ }));
  fireEvent.click(screen.getByRole('button', { name: '1,5×' }));
  expect(video.playbackRate).toBe(1.5);
  expect(localStorage.getItem(CHAVES.velocidade)).toBe('1.5');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Velocidade e destaque' })).toBeNull();

  // Capítulos ao lado do vídeo, com o ativo marcado; clicar vai ao tempo e toca.
  const segundo = screen.getByRole('button', { name: /Segundo bloco/ });
  fireEvent.click(segundo);
  expect(video.currentTime).toBeCloseTo(3.05);

  // O quadro seguinte pinta a palavra do instante.
  Object.defineProperty(video, 'currentTime', { value: 3.6, configurable: true, writable: true });
  await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
  expect(texto(REALCE_DA_PALAVRA)).toBe('frase');
  expect(raiz.querySelector('.capitulo .camada-do-karaoke')).not.toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Fechar o player' }));
  expect(fechar).toHaveBeenCalled();
});

test('player de áudio narrado: destaque por frase, sem vídeo nem capítulos', () => {
  const raiz = artigo();
  const narracao = fonteDoAudio({ versao: 1, id: 'A', versao_id: V, secao_id: 'S', titulo: 'Narração', sha256_audio: 'a'.repeat(64), voz_sha256: 'b'.repeat(64), job_colab: 'job_a', duracao_s: 3,
    trechos: [{ inicio_s: 0, fim_s: 2, ancora: { versao_id: V, bloco_id: B1, inicio_utf16: 0, fim_utf16: 24, citacao: TEXTO1, prefixo: '', sufixo: '' } }] });
  render(<PlayerDeMidia fontes={[narracao]} raiz={raiz} snapshot={snapshot} aoFechar={vi.fn()} />);
  expect(document.querySelector('audio')?.getAttribute('src')).toBe('/api/audios/A/arquivo');
  expect(document.querySelector('video')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Capítulos' })).toBeNull();
  expect(screen.queryByRole('button', { name: /vídeo/ })).toBeNull();
  expect(screen.getByText('Narração')).toBeTruthy();
});

test('posição lembrada pelo arquivo: a transcrição revisada (outra mídia, mesmo vídeo) continua de onde parou (J90)', () => {
  const fonte = fonteDaMidia(midia);
  expect(fonte.lembranca).toBe(`arquivo:${'a'.repeat(64)}`);
  localStorage.setItem(CHAVES.posicao(midia.id), '120.0');
  expect(posicaoGuardada(fonte)).toBe(120); // a chave antiga (id da mídia) ainda vale
  localStorage.setItem(CHAVES.posicao(fonte.lembranca), '300.5');
  const revisada = fonteDaMidia({ ...midia, id: '0000000000000000000000M002' });
  expect(posicaoGuardada(revisada)).toBe(300.5);
});

test('Media Session controla o player, atualiza capítulo e limpa ao fechar', async () => {
  const sessao = sessaoFalsa();
  vi.stubGlobal('navigator', { mediaSession: sessao });
  vi.stubGlobal('MediaMetadata', MetadadosFalsos);
  const { container, unmount } = render(<PlayerDeMidia fontes={[fonteDaMidia(midia)]} tituloDocumento="Livro" snapshot={snapshot} raiz={null} aoFechar={() => undefined} />);
  const video = document.querySelector('video')!;
  expect(sessao.metadata).toMatchObject({ title: 'Abertura', album: 'Livro' });
  await act(async () => { sessao.executar('play'); await Promise.resolve(); });
  expect(tocar).toHaveBeenCalled();
  expect(sessao.playbackState).toBe('playing');
  act(() => sessao.executar('pause'));
  expect(pausar).toHaveBeenCalled();
  expect(sessao.playbackState).toBe('paused');
  act(() => sessao.executar('nexttrack'));
  expect(video.currentTime).toBe(3);
  expect(sessao.metadata).toMatchObject({ title: 'Segundo bloco' });
  act(() => sessao.executar('previoustrack'));
  expect(video.currentTime).toBe(0);
  act(() => sessao.executar('seekto', { seekTime: 2 }));
  expect(video.currentTime).toBe(2);
  act(() => sessao.executar('seekforward', { seekOffset: 1 }));
  expect(video.currentTime).toBe(3);
  act(() => sessao.executar('seekbackward'));
  expect(video.currentTime).toBe(0);
  expect(sessao.posicao).toMatchObject({ duration: 5, position: 0 });
  unmount();
  expect(sessao.metadata).toBeNull();
  expect([...sessao.acoes.values()].every((acao) => acao === null)).toBe(true);
  expect(container.textContent).toBe('');
});
