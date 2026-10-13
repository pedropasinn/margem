/**
 * J109 · Vídeo do YouTube pelo player oficial embutido: o controle com uma IFrame Player API falsa (sem
 * rede), o player do Margem com todas as funções (karaokê pelo tempo do YouTube, capítulos, velocidade
 * nas taxas aceitas, posição lembrada, teclado), o aviso de vídeo que não pode ser incorporado e as
 * fontes montadas a partir do vídeo importado.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { MidiaV1, TrechoTemporizado, VideoYoutubeV1 } from '@margem/contratos';
import { CHAVES, fonteDaMidia, fontesDasMidias } from './fontes';
import { controleDoYoutube, ESTADO_DO_YOUTUBE, velocidadeMaisProxima, type ApiDoYoutube, type EventosDoControle, type OpcoesDoPlayerDoYoutube, type PlayerDoYoutube } from './controle-de-reproducao';
import { PlayerDeMidia } from './PlayerDeMidia';
import { REALCE_DA_PALAVRA } from '../karaoke/karaoke';
import type { SnapshotCapitulo } from '../tipos';

const ID = 'dO8EW2LqBfU';
const V = '0000000000000000000000V001';
const B1 = '0000000000000000000000B001';
const B2 = '0000000000000000000000B002';
const TEXTO1 = 'Olá 🧭, isto é um teste.';
const TEXTO2 = 'Segunda frase aqui.';
const palavra = (bloco: string, inicio: number, fim: number, s: number): TrechoTemporizado => ({ bloco_id: bloco, inicio_utf16: inicio, fim_utf16: fim, inicio_s: s, fim_s: s + 0.4 });
const palavras = [palavra(B1, 0, 3, 0), palavra(B1, 8, 12, 0.5), palavra(B1, 13, 14, 1), palavra(B1, 15, 17, 1.5), palavra(B1, 18, 24, 2), palavra(B2, 0, 7, 3), palavra(B2, 8, 13, 3.5), palavra(B2, 14, 19, 4)];
const frases = [{ ...palavra(B1, 0, 24, 0), fim_s: 2.4 }, { ...palavra(B2, 0, 19, 3), fim_s: 4.4 }];
/** A mídia de um vídeo importado do YouTube: o arquivo local é só o áudio. */
const midia: MidiaV1 = {
  versao: 1, id: '0000000000000000000000M001', documento_id: '0000000000000000000000D001', versao_id: V, tipo: 'audio', titulo: 'Vídeo do YouTube',
  sha256: 'a'.repeat(64), mime: 'audio/mp4', bytes: 10, duracao_s: 5,
  fonte: { url: `https://www.youtube.com/watch?v=${ID}`, canal: 'Canal' }, transcricao: { motor: 'legendas do YouTube', idioma: 'pt', sha256: 'b'.repeat(64) },
  capitulos: [{ inicio_s: 0, titulo: 'Abertura' }, { inicio_s: 3, titulo: 'Segundo bloco' }], palavras, frases,
};
const snapshot = { versao_id: V, secao: { id: 'S', nivel: 1, titulo: 'T', ordem: 0, bloco_inicio: B1, bloco_fim: B2 }, blocos: [{ id: B1, tipo: 'paragrafo', texto: TEXTO1, inline: [] }, { id: B2, tipo: 'paragrafo', texto: TEXTO2, inline: [] }], marcas: [], assets: {} } as unknown as SnapshotCapitulo;

function artigo(): HTMLElement {
  const raiz = document.createElement('div');
  raiz.innerHTML = `<article class="capitulo"><p data-bloco="${B1}"><span data-inicio="0">Olá 🧭, isto </span><span data-inicio="13">é um teste.</span></p><p data-bloco="${B2}"><span data-inicio="0">${TEXTO2}</span></p></article>`;
  document.body.appendChild(raiz);
  return raiz;
}

/** IFrame Player API falsa: guarda as chamadas e deixa o teste disparar os eventos do YouTube. */
class PlayerFalso implements PlayerDoYoutube {
  static ultimo: PlayerFalso | null = null;
  estado: number = ESTADO_DO_YOUTUBE.indicado;
  tempo = 0;
  taxa = 1;
  taxas = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  chamadas: string[] = [];
  destruido = false;
  constructor(readonly alvo: HTMLElement, readonly opcoes: OpcoesDoPlayerDoYoutube) { PlayerFalso.ultimo = this; }
  playVideo(): void { this.chamadas.push('play'); this.mudarEstado(ESTADO_DO_YOUTUBE.tocando); }
  pauseVideo(): void { this.chamadas.push('pause'); this.mudarEstado(ESTADO_DO_YOUTUBE.pausado); }
  seekTo(s: number): void { this.chamadas.push(`seek:${String(s)}`); this.tempo = s; }
  /** Como na API de verdade: os métodos de consulta só funcionam depois do onReady. */
  prontoDisparado = false;
  getCurrentTime(): number { if (!this.prontoDisparado) throw new TypeError('getCurrentTime is not a function'); return this.tempo; }
  getDuration(): number { return 5; }
  getPlayerState(): number { return this.estado; }
  setPlaybackRate(t: number): void { this.chamadas.push(`taxa:${String(t)}`); this.taxa = t; this.opcoes.events.onPlaybackRateChange?.({ data: t, target: this }); }
  getPlaybackRate(): number { return this.taxa; }
  getAvailablePlaybackRates(): number[] { return this.taxas; }
  destroy(): void { this.destruido = true; this.alvo.remove(); }
  pronto(): void { this.prontoDisparado = true; this.opcoes.events.onReady?.({ target: this }); }
  mudarEstado(estado: number): void { this.estado = estado; this.opcoes.events.onStateChange?.({ data: estado, target: this }); }
  erro(codigo: number): void { this.opcoes.events.onError?.({ data: codigo, target: this }); }
}
const api: ApiDoYoutube = { Player: PlayerFalso };
const carregarApi = (): Promise<ApiDoYoutube> => Promise.resolve(api);
const player = (): PlayerFalso => PlayerFalso.ultimo!;

class RealceFalso { priority = 0; readonly intervalos: Range[]; constructor(...intervalos: Range[]) { this.intervalos = intervalos; } }
let registro: Map<string, RealceFalso>;
beforeEach(() => {
  PlayerFalso.ultimo = null;
  registro = new Map();
  vi.stubGlobal('CSS', { highlights: registro });
  vi.stubGlobal('Highlight', RealceFalso);
  window.scrollBy = vi.fn();
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ''; document.documentElement.className = ''; });

function eventosFalsos(): EventosDoControle & { [K in keyof EventosDoControle]: ReturnType<typeof vi.fn> } {
  return { aoTocar: vi.fn(), aoPausar: vi.fn(), aoTerminar: vi.fn(), aoFicarPronto: vi.fn(), aoMudarDuracao: vi.fn(), aoMudarVelocidade: vi.fn(), aoErro: vi.fn() };
}
const esperarApi = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('controleDoYoutube', () => {
  test('moldura oficial com enablejsapi, origin e Referer; nada toca sozinho; posição pendente até tocar', async () => {
    const hospede = document.createElement('div');
    document.body.appendChild(hospede);
    const eventos = eventosFalsos();
    const controle = controleDoYoutube(hospede, { videoId: ID, titulo: 'Vídeo', origem: 'http://127.0.0.1:8730', inicio_s: 42.7, velocidade: 2.3, carregarApi }, eventos);
    const moldura = hospede.querySelector('iframe')!;
    const src = new URL(moldura.src);
    expect(src.origin + src.pathname).toBe(`https://www.youtube.com/embed/${ID}`);
    expect(src.searchParams.get('enablejsapi')).toBe('1');
    expect(src.searchParams.get('origin')).toBe('http://127.0.0.1:8730');
    expect(src.searchParams.get('start')).toBe('42');
    expect(src.searchParams.get('autoplay')).toBeNull();
    expect(moldura.referrerPolicy).toBe('strict-origin-when-cross-origin');
    expect(moldura.title).toBe('Vídeo');
    expect(controle.tempo()).toBe(42);
    expect(controle.pausado()).toBe(true);

    await esperarApi();
    expect(player().alvo).toBe(moldura);
    player().pronto();
    expect(eventos.aoFicarPronto).toHaveBeenCalled();
    expect(eventos.aoMudarDuracao).toHaveBeenCalledWith(5);
    // 2,3× não existe no YouTube: vai a 2×, a mais próxima aceita.
    expect(player().taxa).toBe(2);
    expect(controle.velocidadesDisponiveis()).toEqual(player().taxas);
    expect(player().chamadas).not.toContain('play');

    // Ir para um ponto antes de tocar não chama seekTo (que tocaria sozinho): fica pendente.
    controle.irPara(3);
    expect(controle.tempo()).toBe(3);
    expect(player().chamadas.some((c) => c.startsWith('seek'))).toBe(false);
    controle.tocar();
    expect(player().chamadas).toEqual(['taxa:2', 'seek:3', 'play']);
    expect(eventos.aoTocar).toHaveBeenCalled();
    expect(controle.pausado()).toBe(false);
    player().tempo = 3.6;
    expect(controle.tempo()).toBe(3.6);
    controle.irPara(1);
    expect(player().chamadas.at(-1)).toBe('seek:1');
    controle.pausar();
    expect(eventos.aoPausar).toHaveBeenCalled();
    player().mudarEstado(ESTADO_DO_YOUTUBE.terminado);
    expect(eventos.aoTerminar).toHaveBeenCalled();
    expect(controle.terminado()).toBe(true);

    controle.destruir();
    expect(player().destruido).toBe(true);
    expect(hospede.querySelector('iframe')).toBeNull();
  });

  test('erros da API: 101/150 = incorporação bloqueada, 100 = indisponível, API que não carrega = falha', async () => {
    const eventos = eventosFalsos();
    controleDoYoutube(document.body.appendChild(document.createElement('div')), { videoId: ID, titulo: 'V', origem: 'http://a.b', carregarApi }, eventos);
    await esperarApi();
    player().erro(150);
    player().erro(101);
    player().erro(100);
    player().erro(5);
    expect(eventos.aoErro.mock.calls.map((chamada) => chamada[0] as unknown)).toEqual([
      { motivo: 'incorporacao_bloqueada', codigo: 150 }, { motivo: 'incorporacao_bloqueada', codigo: 101 },
      { motivo: 'video_indisponivel', codigo: 100 }, { motivo: 'falha', codigo: 5 }]);
    const semApi = eventosFalsos();
    controleDoYoutube(document.body.appendChild(document.createElement('div')), { videoId: ID, titulo: 'V', origem: 'http://a.b', carregarApi: () => Promise.reject(new Error('sem rede')) }, semApi);
    await esperarApi();
    expect(semApi.aoErro).toHaveBeenCalledWith({ motivo: 'falha' });
  });

  test('velocidade mais próxima', () => {
    expect(velocidadeMaisProxima(1.4, [1, 1.25, 1.5])).toBe(1.5);
    expect(velocidadeMaisProxima(2.5, [0.5, 1, 2])).toBe(2);
    expect(velocidadeMaisProxima(1.3, null)).toBe(1.3);
  });
});

describe('PlayerDeMidia com vídeo do YouTube', () => {
  test('toca pelo embed com karaokê, clique no texto, capítulos, velocidade, posição lembrada e teclado', async () => {
    const raiz = artigo();
    const fonte = fonteDaMidia(midia);
    expect(fonte.tipo).toBe('video');
    expect(fonte.youtube).toEqual({ id: ID, url: `https://www.youtube.com/watch?v=${ID}` });
    localStorage.setItem(CHAVES.posicao(fonte.lembranca), '0');
    render(<PlayerDeMidia fontes={[fonte]} raiz={raiz} snapshot={snapshot} aoFechar={vi.fn()} carregarApiDoYoutube={carregarApi} />);
    expect(document.querySelector('video')).toBeNull();
    expect(document.querySelector('audio')).toBeNull();
    const moldura = document.querySelector<HTMLIFrameElement>('.painel-video[data-controle=youtube] .quadro-do-video iframe')!;
    expect(moldura.src).toContain(`/embed/${ID}?enablejsapi=1`);
    // O vídeo do YouTube não toca escondido: não há botão de esconder.
    expect(screen.queryByRole('button', { name: 'Esconder o vídeo' })).toBeNull();
    await esperarApi();
    act(() => player().pronto());

    // Tocar e pausar pelo transporte e pelo teclado.
    fireEvent.click(screen.getByRole('button', { name: 'Tocar' }));
    expect(player().chamadas).toContain('play');
    expect(screen.getByRole('button', { name: 'Pausar' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'k' });
    expect(player().chamadas.at(-1)).toBe('pause');
    fireEvent.keyDown(window, { key: 'l' });
    expect(player().chamadas.at(-1)).toMatch(/^seek:/);

    // Clique na palavra do texto ("frase", no segundo parágrafo): vai ao tempo dela e toca.
    const segundoParagrafo = raiz.querySelector(`[data-bloco="${B2}"] span`)!.firstChild!;
    (document as unknown as { caretPositionFromPoint: () => unknown }).caretPositionFromPoint = () => ({ offsetNode: segundoParagrafo, offset: 9 });
    fireEvent.click(raiz.querySelector(`[data-bloco="${B2}"] span`)!, { clientX: 5, clientY: 5 });
    expect(player().chamadas.slice(-2)).toEqual(['seek:3.5', 'play']);
    delete (document as unknown as { caretPositionFromPoint?: unknown }).caretPositionFromPoint;

    // Capítulo: vai ao tempo (já tocando, segue tocando).
    fireEvent.click(screen.getByRole('button', { name: /Segundo bloco/ }));
    expect(player().chamadas.at(-1)).toBe('seek:3.05');
    expect(player().estado).toBe(ESTADO_DO_YOUTUBE.tocando);

    // O tempo lido do YouTube a cada quadro acende a palavra no texto.
    player().tempo = 3.6;
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    expect(registro.get(REALCE_DA_PALAVRA)?.intervalos[0]?.toString()).toBe('frase');

    // Velocidade: só as taxas que o YouTube aceita (2,5× não existe lá).
    fireEvent.click(screen.getByRole('button', { name: /^Velocidade/ }));
    const deslizador = screen.getByRole('slider', { name: 'Velocidade de reprodução' });
    expect(deslizador.getAttribute('max')).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: '1,75×' }));
    expect(player().taxa).toBe(1.75);
    fireEvent.change(deslizador, { target: { value: '1.4' } });
    expect(player().taxa).toBe(1.5);

    // A posição é lembrada ao pausar.
    player().tempo = 4.2;
    act(() => player().mudarEstado(ESTADO_DO_YOUTUBE.pausado));
    expect(localStorage.getItem(CHAVES.posicao(fonte.lembranca))).toBe('4.2');
  });

  test('posição lembrada vira o start do embed, sem tocar', async () => {
    const fonte = fonteDaMidia({ ...midia, duracao_s: 600 });
    localStorage.setItem(CHAVES.posicao(fonte.lembranca), '125.5');
    render(<PlayerDeMidia fontes={[fonte]} raiz={null} snapshot={snapshot} aoFechar={vi.fn()} carregarApiDoYoutube={carregarApi} />);
    expect(new URL(document.querySelector('iframe')!.src).searchParams.get('start')).toBe('125');
    expect(screen.getByText('2:05')).toBeTruthy();
    await esperarApi();
    act(() => player().pronto());
    expect(player().chamadas).not.toContain('play');
  });

  test('vídeo que não pode ser incorporado: aviso, "Assistir no YouTube" e o arquivo local como alternativa explícita', async () => {
    render(<PlayerDeMidia fontes={[fonteDaMidia(midia)]} raiz={null} snapshot={snapshot} aoFechar={vi.fn()} carregarApiDoYoutube={carregarApi} />);
    await esperarApi();
    act(() => player().erro(150));
    expect(screen.getByText('O dono deste vídeo não permite assistir fora do YouTube.')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Assistir no YouTube' });
    expect(link.getAttribute('href')).toBe(`https://www.youtube.com/watch?v=${ID}`);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    // Nada por cima da moldura: o aviso fica fora do quadro do vídeo.
    expect(document.querySelector('.quadro-do-video .aviso-do-video')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ouvir o áudio local' }));
    expect(player().destruido).toBe(true);
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('audio')?.getAttribute('src')).toBe(`/api/midias/${midia.id}/arquivo`);
    expect(screen.getByText('Arquivo local')).toBeTruthy();
  });

  test('sem arquivo local, o aviso só leva ao YouTube', async () => {
    const video: VideoYoutubeV1 = { versao: 1, documento_id: '0000000000000000000000D001', video_id: ID, url: `https://www.youtube.com/watch?v=${ID}`, titulo: 'Sem legendas', capitulos: [], transcricao: { estado: 'sem_transcricao' } };
    const [fonte] = fontesDasMidias([], video, V);
    render(<PlayerDeMidia fontes={[fonte!]} raiz={null} snapshot={snapshot} aoFechar={vi.fn()} carregarApiDoYoutube={carregarApi} />);
    expect(screen.getByText('Sem transcrição')).toBeTruthy();
    expect(document.documentElement.classList.contains('com-karaoke')).toBe(false);
    await esperarApi();
    act(() => player().erro(101));
    expect(screen.getByRole('link', { name: 'Assistir no YouTube' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /local/ })).toBeNull();
  });
});

test('fontes: o vídeo importado entra sozinho só quando nenhuma mídia é dele', () => {
  const video: VideoYoutubeV1 = { versao: 1, documento_id: '0000000000000000000000D001', video_id: ID, url: `https://www.youtube.com/watch?v=${ID}`, titulo: 'V', duracao_s: 5, capitulos: [], transcricao: { estado: 'pendente' } };
  const so = fontesDasMidias([], video, V);
  expect(so.map((f) => [f.origem, f.url, f.youtube?.id, f.frases.length])).toEqual([['youtube', null, ID, 0]]);
  const comMidia = fontesDasMidias([midia], { ...video, transcricao: { estado: 'pronta', midia_id: midia.id, origem: 'legendas' } }, V);
  expect(comMidia.map((f) => f.origem)).toEqual(['midia']);
  // Mídia antiga (J71) com vídeo local e URL do YouTube: toca pelo YouTube, com o vídeo local de alternativa.
  const antiga = fonteDaMidia({ ...midia, tipo: 'video', mime: 'video/mp4' });
  expect([antiga.tipo, antiga.tipoDoArquivo, antiga.youtube?.id]).toEqual(['video', 'video', ID]);
  // URL que não é de vídeo do YouTube: arquivo local, como antes.
  expect(fonteDaMidia({ ...midia, tipo: 'video', fonte: { url: 'https://vimeo.com/1' } }).youtube).toBeNull();
});
