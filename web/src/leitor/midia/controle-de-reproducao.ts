/**
 * Controle de reprodução do player (J109): uma interface, duas implementações.
 *
 * - `controleLocal`: o elemento `<video>`/`<audio>` com o arquivo servido pelo Margem (áudio narrado,
 *   mídias que não são do YouTube e a alternativa local quando o YouTube não deixa incorporar).
 * - `controleDoYoutube`: o player oficial embutido (`youtube.com/embed/<id>?enablejsapi=1&origin=…`)
 *   comandado pela YouTube IFrame Player API, para cada reprodução contar para o canal.
 *
 * O `PlayerDeMidia` só fala com a interface: tempo (lido a cada quadro), tocar/pausar, ir para,
 * velocidade e as taxas disponíveis, e os eventos (tocou, pausou, terminou, duração, velocidade, erro).
 *
 * Regras do YouTube respeitadas aqui (Required Minimum Functionality e referência da IFrame API):
 * a moldura é a do próprio YouTube, sem nada por cima e sem esconder a marca; nada toca sozinho (o
 * `seekTo` em vídeo ainda não iniciado tocaria, então a posição fica pendente até o leitor pedir para
 * tocar); a moldura manda o Referer da origem (`referrerpolicy`), porque a página usa `same-origin` e
 * sem Referer o YouTube recusa com o erro 153.
 */
import { urlDoPlayerDoYoutube } from '@margem/core/youtube';

export type MotivoDoErro =
  /** 101/150: o dono do vídeo não permite assistir fora do YouTube. */
  | 'incorporacao_bloqueada'
  /** 100: vídeo removido ou privado. */
  | 'video_indisponivel'
  /** 2, 5, 153 ou a API que não carregou. */
  | 'falha';

export interface ErroDoControle { motivo: MotivoDoErro; codigo?: number }

export interface EventosDoControle {
  aoTocar: () => void;
  aoPausar: () => void;
  aoTerminar: () => void;
  /** Pronto para receber comandos (metadados do arquivo, ou `onReady` do YouTube). */
  aoFicarPronto: () => void;
  aoMudarDuracao: (segundos: number) => void;
  aoMudarVelocidade: (velocidade: number) => void;
  aoErro: (erro: ErroDoControle) => void;
}

export interface ControleDeReproducao {
  readonly tipo: 'local' | 'youtube';
  /** Segundos desde o começo (lido a cada quadro). */
  tempo(): number;
  /** `NaN` enquanto não se sabe. */
  duracao(): number;
  pausado(): boolean;
  terminado(): boolean;
  tocar(): void;
  pausar(): void;
  irPara(segundos: number): void;
  definirVelocidade(velocidade: number): void;
  /** As taxas aceitas, em ordem; `null` = qualquer uma entre 0,5 e 2,5 (o elemento local). */
  velocidadesDisponiveis(): readonly number[] | null;
  destruir(): void;
}

/** A taxa disponível mais perto da pedida. */
export function velocidadeMaisProxima(pedida: number, disponiveis: readonly number[] | null): number {
  if (disponiveis === null || disponiveis.length === 0) return pedida;
  return disponiveis.reduce((melhor, v) => (Math.abs(v - pedida) < Math.abs(melhor - pedida) ? v : melhor), disponiveis[0]!);
}

// ---------------------------------------------------------------- local

export function controleLocal(elemento: HTMLMediaElement, eventos: EventosDoControle): ControleDeReproducao {
  const ouvintes: [string, () => void][] = [
    ['play', () => eventos.aoTocar()],
    ['pause', () => eventos.aoPausar()],
    ['ended', () => eventos.aoTerminar()],
    ['loadedmetadata', () => eventos.aoFicarPronto()],
    ['durationchange', () => { if (Number.isFinite(elemento.duration)) eventos.aoMudarDuracao(elemento.duration); }],
    ['ratechange', () => eventos.aoMudarVelocidade(elemento.playbackRate)],
    ['error', () => eventos.aoErro({ motivo: 'falha' })],
  ];
  for (const [nome, ouvinte] of ouvintes) elemento.addEventListener(nome, ouvinte);
  // O elemento pode ter carregado os metadados antes de o controle existir.
  if (elemento.readyState >= 1) queueMicrotask(() => eventos.aoFicarPronto());
  return {
    tipo: 'local',
    tempo: () => elemento.currentTime,
    duracao: () => (Number.isFinite(elemento.duration) && elemento.duration > 0 ? elemento.duration : Number.NaN),
    pausado: () => elemento.paused,
    terminado: () => elemento.ended,
    tocar: () => { if (elemento.ended) elemento.currentTime = 0; void elemento.play()?.catch(() => undefined); },
    pausar: () => elemento.pause(),
    irPara: (s) => { elemento.currentTime = s; },
    definirVelocidade: (v) => { elemento.playbackRate = v; },
    velocidadesDisponiveis: () => null,
    destruir: () => { for (const [nome, ouvinte] of ouvintes) elemento.removeEventListener(nome, ouvinte); },
  };
}

// ---------------------------------------------------------------- YouTube

/** O pedaço da IFrame Player API que o Margem usa (`window.YT`). */
export interface PlayerDoYoutube {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(segundos: number, permitirBuscaAdiante: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(taxa: number): void;
  getPlaybackRate(): number;
  getAvailablePlaybackRates(): number[];
  destroy(): void;
}
export interface OpcoesDoPlayerDoYoutube {
  events: {
    onReady?: (e: { target: PlayerDoYoutube }) => void;
    onStateChange?: (e: { data: number; target: PlayerDoYoutube }) => void;
    onPlaybackRateChange?: (e: { data: number; target: PlayerDoYoutube }) => void;
    onError?: (e: { data: number; target: PlayerDoYoutube }) => void;
  };
}
export interface ApiDoYoutube {
  Player: new (alvo: HTMLElement, opcoes: OpcoesDoPlayerDoYoutube) => PlayerDoYoutube;
}

/** Estados do `onStateChange`. */
export const ESTADO_DO_YOUTUBE = { naoIniciado: -1, terminado: 0, tocando: 1, pausado: 2, carregando: 3, indicado: 5 } as const;

export const URL_DA_API_DO_YOUTUBE = 'https://www.youtube.com/iframe_api';
const PRAZO_DA_API_MS = 15_000;

interface JanelaComYoutube { YT?: Partial<ApiDoYoutube> & { loaded?: number }; onYouTubeIframeAPIReady?: () => void }
let carregando: Promise<ApiDoYoutube> | null = null;

/** Carrega a IFrame Player API uma vez (script assíncrono, como manda a documentação). */
export function carregarApiDoYoutube(janela: Window = window): Promise<ApiDoYoutube> {
  const global = janela as unknown as JanelaComYoutube;
  if (global.YT?.Player) return Promise.resolve(global.YT as ApiDoYoutube);
  if (carregando) return carregando;
  carregando = new Promise<ApiDoYoutube>((resolver, rejeitar) => {
    const anterior = global.onYouTubeIframeAPIReady;
    const prazo = janela.setTimeout(() => { carregando = null; rejeitar(new Error('A API do YouTube não carregou.')); }, PRAZO_DA_API_MS);
    global.onYouTubeIframeAPIReady = () => {
      janela.clearTimeout(prazo);
      anterior?.();
      if (global.YT?.Player) resolver(global.YT as ApiDoYoutube);
      else { carregando = null; rejeitar(new Error('A API do YouTube veio incompleta.')); }
    };
    const script = janela.document.createElement('script');
    script.src = URL_DA_API_DO_YOUTUBE;
    script.async = true;
    script.referrerPolicy = 'strict-origin-when-cross-origin';
    script.onerror = () => { janela.clearTimeout(prazo); carregando = null; script.remove(); rejeitar(new Error('A API do YouTube não carregou.')); };
    janela.document.head.appendChild(script);
  });
  return carregando;
}

/** Só para os testes: esquece a API carregada. */
export function esquecerApiDoYoutube(): void { carregando = null; }

export interface OpcoesDoControleDoYoutube {
  videoId: string;
  titulo: string;
  /** Origem da página (`location.origin`), que vai no parâmetro `origin` do embed. */
  origem: string;
  /** Posição lembrada: entra como `start` do embed, sem tocar. */
  inicio_s?: number;
  velocidade?: number;
  carregarApi?: () => Promise<ApiDoYoutube>;
}

/**
 * Cria a moldura do YouTube dentro de `hospede` (o controle é dono dela: o `destroy` da API a remove)
 * e liga a IFrame Player API a ela.
 */
export function controleDoYoutube(hospede: HTMLElement, opcoes: OpcoesDoControleDoYoutube, eventos: EventosDoControle): ControleDeReproducao {
  const moldura = hospede.ownerDocument.createElement('iframe');
  moldura.className = 'moldura-do-youtube';
  moldura.src = urlDoPlayerDoYoutube(opcoes.videoId, { origem: opcoes.origem, ...(opcoes.inicio_s === undefined ? {} : { inicio_s: opcoes.inicio_s }) });
  moldura.title = opcoes.titulo;
  moldura.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  moldura.allowFullscreen = true;
  moldura.referrerPolicy = 'strict-origin-when-cross-origin';
  hospede.appendChild(moldura);

  /** O player pronto (depois do `onReady`); `criado` é o objeto da API desde a construção, para o `destroy`. */
  let player: PlayerDoYoutube | null = null;
  let criado: PlayerDoYoutube | null = null;
  let destruido = false;
  let estado: number = ESTADO_DO_YOUTUBE.naoIniciado;
  /** Posição pedida antes de tocar: o `seekTo` num vídeo não iniciado começaria a tocar. */
  let pendente: number | null = null;
  let inicio = opcoes.inicio_s !== undefined && Number.isFinite(opcoes.inicio_s) ? Math.floor(opcoes.inicio_s) : 0;
  let querTocar = false;
  let velocidade = opcoes.velocidade ?? 1;

  const aplicarVelocidade = (): void => {
    if (!player) return;
    const alvo = velocidadeMaisProxima(velocidade, player.getAvailablePlaybackRates());
    if (Math.abs(player.getPlaybackRate() - alvo) > 1e-6) player.setPlaybackRate(alvo);
  };
  const duracaoAgora = (): number => { const d = player?.getDuration() ?? 0; return d > 0 ? d : Number.NaN; };
  const naoComecou = (): boolean => estado === ESTADO_DO_YOUTUBE.naoIniciado || estado === ESTADO_DO_YOUTUBE.indicado || estado === ESTADO_DO_YOUTUBE.terminado;

  const comecar = (): void => {
    if (!player) { querTocar = true; return; }
    if (pendente !== null) { const alvo = pendente; pendente = null; player.seekTo(alvo, true); }
    else if (estado === ESTADO_DO_YOUTUBE.terminado) player.seekTo(0, true);
    player.playVideo();
  };

  void (opcoes.carregarApi ?? (() => carregarApiDoYoutube(hospede.ownerDocument.defaultView ?? window)))().then((api) => {
    if (destruido) return;
    // Os métodos do player só existem depois do `onReady`: até lá, o controle responde sem ele.
    criado = new api.Player(moldura, {
      events: {
        onReady: (e) => {
          if (destruido) return;
          player = e.target;
          aplicarVelocidade();
          const d = duracaoAgora();
          if (Number.isFinite(d)) eventos.aoMudarDuracao(d);
          eventos.aoFicarPronto();
          if (querTocar) { querTocar = false; comecar(); }
        },
        onStateChange: (e) => {
          estado = e.data;
          const d = duracaoAgora();
          if (Number.isFinite(d)) eventos.aoMudarDuracao(d);
          if (e.data === ESTADO_DO_YOUTUBE.tocando) {
            // O leitor tocou pelo próprio player do YouTube com uma posição pendente: vai para ela.
            if (pendente !== null) { const alvo = pendente; pendente = null; e.target.seekTo(alvo, true); }
            inicio = 0;
            eventos.aoTocar();
          } else if (e.data === ESTADO_DO_YOUTUBE.pausado) eventos.aoPausar();
          else if (e.data === ESTADO_DO_YOUTUBE.terminado) eventos.aoTerminar();
        },
        onPlaybackRateChange: (e) => eventos.aoMudarVelocidade(e.data),
        onError: (e) => eventos.aoErro({
          motivo: e.data === 101 || e.data === 150 ? 'incorporacao_bloqueada' : e.data === 100 ? 'video_indisponivel' : 'falha', codigo: e.data,
        }),
      },
    });
  }, () => { if (!destruido) eventos.aoErro({ motivo: 'falha' }); });

  return {
    tipo: 'youtube',
    tempo: () => {
      if (pendente !== null) return pendente;
      if (!player) return inicio;
      const t = player.getCurrentTime();
      // Antes de tocar, o player indicado ainda pode dizer 0: vale o `start` da posição lembrada.
      return naoComecou() && estado !== ESTADO_DO_YOUTUBE.terminado ? Math.max(inicio, t) : t;
    },
    duracao: duracaoAgora,
    pausado: () => estado !== ESTADO_DO_YOUTUBE.tocando && estado !== ESTADO_DO_YOUTUBE.carregando,
    terminado: () => estado === ESTADO_DO_YOUTUBE.terminado,
    tocar: comecar,
    pausar: () => { querTocar = false; player?.pauseVideo(); },
    irPara: (s) => {
      if (!player || naoComecou()) { pendente = s; return; }
      player.seekTo(s, true);
    },
    definirVelocidade: (v) => { velocidade = v; aplicarVelocidade(); },
    velocidadesDisponiveis: () => {
      const taxas = player?.getAvailablePlaybackRates() ?? [];
      return taxas.length > 0 ? [...taxas].sort((a, b) => a - b) : null;
    },
    destruir: () => {
      destruido = true;
      try { (player ?? criado)?.destroy(); } catch { /* a moldura já saiu, ou a API não terminou de montar */ }
      moldura.remove();
    },
  };
}
