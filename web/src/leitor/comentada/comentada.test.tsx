// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AncoraV1, LeituraComentadaV1, NarracaoDaLeituraV1 } from '@margem/contratos';
import type { ApiDoLeitor } from '../tipos';
import type { MarcaDoLeitor } from '../f2';
import { LeituraComentada, type FocoDaLeitura } from './LeituraComentada';
import { consumirContinuacaoDaLeitura, lerPontoDaLeitura } from './retomada';
import { useLeituraComentada, type FontesDaLeituraComentada } from './useLeituraComentada';
import { sessaoFalsa, MetadadosFalsos } from '../player/sessao-falsa';

const id = (n: number): string => String(n).padStart(26, '0');
const V = id(20);
const blocos = [
  { id: id(1), texto: 'Capítulo um' },
  { id: id(2), texto: 'Admitamos inicialmente que os preços são rígidos. Isto é provisório.' },
  { id: id(3), texto: 'Logo, somente com preços rígidos o produto cai.' },
];
const ancora = (bloco: number, citacao: string): AncoraV1 => {
  const texto = blocos[bloco - 1]!.texto;
  const inicio = texto.indexOf(citacao);
  return { versao_id: V, bloco_id: id(bloco), inicio_utf16: inicio, fim_utf16: inicio + citacao.length, citacao, prefixo: '', sufixo: '' };
};
const trecho = (n: number, bloco: number, texto: string) => {
  const inicio = blocos[bloco - 1]!.texto.indexOf(texto);
  return { id: `t000${String(n)}`, bloco_id: id(bloco), inicio_utf16: inicio, fim_utf16: inicio + texto.length, texto, falado: texto };
};

function leitura(): LeituraComentadaV1 {
  return {
    versao: 1, id: id(300), execucao_id: id(40), versao_id: V, secao_id: id(60), modelo_id: id(50), fontes_hash: 'a'.repeat(64),
    capitulo: { titulo: 'Capítulo um', numero: 1, total: 2 },
    trechos: [trecho(1, 1, 'Capítulo um'), trecho(2, 2, 'Admitamos inicialmente que os preços são rígidos.'), trecho(3, 2, 'Isto é provisório.'), trecho(4, 3, 'Logo, somente com preços rígidos o produto cai.')],
    pausas: [
      { id: 'p001', depois_de: 't0002', fontes: [{ tipo: 'grifo', id: 'm1' }], foco: [ancora(2, 'Admitamos inicialmente')], pontas: [], texto: 'Repare no inicialmente.', falado: 'Repare no inicialmente.' },
      { id: 'p002', depois_de: 't0004', fontes: [{ tipo: 'grifo', id: 'm2' }, { tipo: 'relacao', id: id(201) }], foco: [ancora(3, 'somente com preços rígidos')],
        pontas: [ancora(2, 'Admitamos inicialmente')], texto: 'A hipótese do começo volta aqui. Sem ela, nada disso vale.', falado: 'A hipótese do começo volta aqui. Sem ela, nada disso vale.' },
    ],
    saltados: [], proxima_secao_id: id(61), diagnosticos: [],
    execucao: { modelo: 'm', esforco: 'medium', prompt: 'comentar-leitura@1' }, job_id: id(90), criado_em: '2026-09-29T23:00:00.000Z',
  };
}
const narracao: NarracaoDaLeituraV1 = {
  versao: 1, id: id(400), leitura_id: id(300), sha256_audio: 'a'.repeat(64), voz_sha256: 'b'.repeat(64), jobs_colab: ['job_1'], receita: 'r', duracao_s: 20,
  transicao: { silencio_antes_s: 0.9, silencio_depois_s: 0.7, sinal: true, contraste: false },
  falas: [{ fala_id: 't0001', inicio_s: 0, fim_s: 1 }, { fala_id: 't0002', inicio_s: 1.4, fim_s: 4 }, { fala_id: 'p001', inicio_s: 5, fim_s: 7 },
    { fala_id: 't0003', inicio_s: 7.7, fim_s: 9 }, { fala_id: 't0004', inicio_s: 9.7, fim_s: 12 }, { fala_id: 'p002', inicio_s: 13, fim_s: 19 }],
  palavras: [], criado_em: '2026-09-29T23:30:00.000Z',
};

function leitorFalso(): { current: ApiDoLeitor } {
  const posicao: Record<string, [number, number]> = { [id(1)]: [40, 30], [id(2)]: [100, 60], [id(3)]: [400, 30] };
  return { current: { localizar: () => null, ancoraVisivel: () => null,
    retangulosDaAncora: (a) => { const [topo, altura] = posicao[a.bloco_id] ?? [0, 0]; return [{ top: topo, bottom: topo + altura, left: 400, right: 1100, width: 700, height: altura, x: 400, y: topo, toJSON: () => ({}) }]; } } };
}
const marcas = [{ id: 'm1', ancora: ancora(2, 'Admitamos inicialmente'), funcao: 'conceito' }, { id: 'm2', ancora: ancora(3, 'somente com preços rígidos'), funcao: 'tese' }] as unknown as MarcaDoLeitor[];

beforeEach(() => { window.scrollBy = vi.fn(); Element.prototype.scrollTo = vi.fn(); window.matchMedia = vi.fn().mockReturnValue({ matches: true }); });
afterEach(() => { cleanup(); vi.useRealTimers(); try { localStorage.clear(); sessionStorage.clear(); } catch { /* sem storage */ } });

test('lê frase a frase; no comentário o texto para, grifo e chave acendem sem véu, e a leitura retoma depois', () => {
  const focos: (FocoDaLeitura | null)[] = [];
  const aoCitar = vi.fn();
  const { container } = render(<LeituraComentada leitura={leitura()} narracao={null} modelo={null} documentoId="doc" leitor={leitorFalso()} raiz={null}
    marcas={marcas} aoSair={() => undefined} aoCitar={aoCitar} aoMudarFoco={(foco) => focos.push(foco)} />);
  expect(screen.getByText('Leitura comentada · Cap. 1 de 2')).toBeDefined();
  expect(screen.getByText('Lendo · frase 1 de 4')).toBeDefined();
  expect(screen.getByText('sem voz · ritmo de leitura')).toBeDefined();
  expect(container.querySelector('.veu-guiado')).toBeNull();

  // → avança uma frase; na segunda → entra o comentário.
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  expect(screen.getByText('Lendo · frase 2 de 4')).toBeDefined();
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  expect(screen.getByText('Comentário 1 de 2')).toBeDefined();
  expect(container.querySelector('.fala-comentada')?.textContent).toBe('Repare no inicialmente.');
  expect(focos.at(-1)).toMatchObject({ marcas: ['m1'], ativa: 'm1', ancora: { bloco_id: id(2) } });
  // Sem véu (decisão de produto, 30/09): o grifo e o braquete já destacam o trecho.
  expect(container.querySelector('.veu-guiado')).toBeNull();

  // Pular comentário: a leitura retoma exatamente na frase seguinte.
  fireEvent.click(screen.getByRole('button', { name: 'Pular comentário' }));
  expect(screen.getByText('Lendo · frase 3 de 4')).toBeDefined();
  expect(container.querySelector('.veu-guiado')).toBeNull();

  // Próximo comentário: grifo e relação juntos, com a ponta lá atrás.
  fireEvent.click(screen.getByRole('button', { name: 'Ir ao próximo comentário' }));
  expect(screen.getByText('Comentário 2 de 2')).toBeDefined();
  expect(screen.getByText('Grifo · tese')).toBeDefined();
  expect(screen.getByText('Relação')).toBeDefined();
  expect(container.querySelector('.veu-guiado')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Volta a/ }));
  expect(aoCitar).toHaveBeenCalledWith(expect.objectContaining({ bloco_id: id(2) }));

  // Comentário anterior.
  fireEvent.click(screen.getByRole('button', { name: 'Comentário anterior' }));
  expect(screen.getByText('Comentário 1 de 2')).toBeDefined();
  expect(lerPontoDaLeitura('doc')).toMatchObject({ secao_id: id(60), leitura_id: id(300) });
});

test('com voz: o tempo vem da narração; comentários desligados pulam a pausa ao tocar', async () => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] });
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  const { container } = render(<LeituraComentada leitura={leitura()} narracao={narracao} modelo={null} documentoId="doc" leitor={leitorFalso()} raiz={null}
    aoSair={() => undefined} aoCitar={() => undefined} />);
  expect(screen.getByText('voz · palavra a palavra')).toBeDefined();
  const audio = container.querySelector('audio')!;
  expect(audio.getAttribute('src')).toBe(`/api/narracoes-leitura/${id(400)}/arquivo`);
  // Desliga os comentários (C) e toca a partir do começo do comentário 1: salta para a frase 3.
  fireEvent.keyDown(window, { key: 'c' });
  expect(screen.getByText('Comentários desligados: só a leitura.')).toBeDefined();
  audio.currentTime = 5.5;
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tocar' })); await Promise.resolve(); });
  expect(play).toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(50); });
  expect(audio.currentTime).toBeCloseTo(7.7, 5);
});

test('ao fim do capítulo, segue para o próximo tocando; pular capítulo e sair pelo teclado', () => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] });
  const aoIrCapitulo = vi.fn();
  const aoSair = vi.fn();
  render(<LeituraComentada leitura={leitura()} narracao={null} modelo={null} documentoId="doc" leitor={leitorFalso()} raiz={null}
    aoSair={aoSair} aoCitar={() => undefined} aoIrCapitulo={aoIrCapitulo} />);
  fireEvent.click(screen.getByRole('button', { name: 'Tocar' }));
  act(() => { vi.advanceTimersByTime(60_000); });
  expect(aoIrCapitulo).toHaveBeenCalledWith(id(61));
  expect(consumirContinuacaoDaLeitura('doc', id(61))).toBe(true);
  fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });
  expect(aoIrCapitulo).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(aoSair).toHaveBeenCalled();
});

test('useLeituraComentada consulta até ficar pronta e prepara num pedido explícito', async () => {
  const detalhe = vi.fn<FontesDaLeituraComentada['detalhe']>()
    .mockResolvedValueOnce({ estado: 'nao_preparada', leitura: null, narracao: null })
    .mockResolvedValue({ estado: 'pronta', leitura: leitura(), narracao: null });
  const preparar = vi.fn<FontesDaLeituraComentada['preparar']>().mockResolvedValue({ estado: 'preparando', leitura: null, narracao: null });
  const fontes = { detalhe, preparar };
  const { result } = renderHook(() => useLeituraComentada('exec', 'sec', fontes, 10));
  await waitFor(() => expect(result.current.estado).toBe('nao_preparada'));
  expect(preparar).not.toHaveBeenCalled();
  act(() => result.current.preparar());
  await waitFor(() => expect(result.current.estado).toBe('pronta'));
  expect(result.current.leitura?.id).toBe(id(300));
});

test('Player v2: controle no player central, comentário no documento, e a coluna do texto nunca se desloca (as braquetes medem no lugar)', () => {
  const html = document.documentElement;
  const { container, unmount } = render(<LeituraComentada leitura={leitura()} narracao={null} modelo={null} documentoId="doc" leitor={leitorFalso()} raiz={null}
    marcas={marcas} aoSair={() => undefined} aoCitar={() => undefined} />);
  // Sem barra lateral: nada de `--largura-guiada` empurrando o texto (era o que desalinhava as braquetes).
  expect(html.classList.contains('com-leitura-guiada')).toBe(false);
  expect(html.style.getPropertyValue('--largura-guiada')).toBe('');
  expect(container.querySelector('.painel-comentada')).toBeNull();
  expect(screen.getByRole('region', { name: 'Leitura comentada' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Ir ao próximo comentário' }));
  // O comentário mora num cartão dentro do documento, ao lado do trecho comentado.
  const cartao = screen.getByRole('complementary', { name: 'Comentário do professor' });
  expect(cartao.textContent).toContain('Repare no inicialmente.');
  unmount();
  expect(html.classList.contains('com-leitura-comentada')).toBe(false);
});

test('Media Session da leitura narrada busca, pausa e navega frases', async () => {
  const sessao = sessaoFalsa();
  vi.stubGlobal('navigator', { mediaSession: sessao });
  vi.stubGlobal('MediaMetadata', MetadadosFalsos);
  const tocar = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  const pausar = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  try {
    const { container, unmount } = render(<LeituraComentada leitura={leitura()} narracao={narracao} modelo={null} documentoId="doc" tituloDocumento="Livro"
      leitor={leitorFalso()} raiz={null} aoSair={() => undefined} aoCitar={() => undefined} />);
    const audio = container.querySelector('audio')!;
    expect(sessao.metadata).toMatchObject({ title: 'Capítulo um', album: 'Livro' });
    await act(async () => { sessao.executar('play'); await Promise.resolve(); });
    expect(tocar).toHaveBeenCalled();
    expect(sessao.playbackState).toBe('playing');
    act(() => sessao.executar('pause'));
    expect(pausar).toHaveBeenCalled();
    expect(sessao.playbackState).toBe('paused');
    act(() => sessao.executar('seekto', { seekTime: 8 }));
    expect(audio.currentTime).toBe(8);
    act(() => sessao.executar('seekbackward', { seekOffset: 2 }));
    expect(audio.currentTime).toBe(6);
    act(() => sessao.executar('seekforward', { seekOffset: 2 }));
    expect(audio.currentTime).toBe(8);
    act(() => sessao.executar('nexttrack'));
    expect(audio.currentTime).toBeGreaterThan(8);
    act(() => sessao.executar('previoustrack'));
    expect(audio.currentTime).toBeLessThan(9.7);
    unmount();
    expect(sessao.metadata).toBeNull();
    expect(sessao.playbackState).toBe('none');
  } finally { vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});
