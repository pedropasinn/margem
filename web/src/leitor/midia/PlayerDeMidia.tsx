/**
 * Player do Margem (J71), a partir do player "The Rest Is History" do books (karaoke.html e
 * site/app/books/[slug]/ep/[n]/player.tsx): trilha com botão, tempo decorrido e restante, −10/+10,
 * velocidade com deslizador e atalhos, capítulos com o ativo aceso, rolagem que acompanha a frase
 * (a 40% da área visível) e desliga quando o leitor rola, pílula "Voltar ao trecho atual", clique
 * na palavra para ir ao tempo, teclado (espaço/K, ←/→, J/L), barra que se recolhe enquanto toca,
 * posição e velocidade lembradas, fim com "ouvir de novo" e vídeo ao lado (computador) ou acima
 * (celular), redimensionável.
 *
 * O que muda em relação ao books: o texto do karaokê é o próprio texto do leitor, com as marcas,
 * notas, conversas e conexões do Margem. O karaokê anda palavra por palavra (o tempo real de cada
 * palavra alinhada, interpolado onde o alinhamento falhou; no áudio narrado por frase, estimado pelo
 * tamanho de cada palavra) e é desenhado pelo serviço comum `../karaoke/`, o mesmo da leitura comentada.
 *
 * J109: o player fala com um `ControleDeReproducao` (./controle-de-reproducao). Vídeo do YouTube toca
 * pelo player oficial embutido (cada reprodução conta para o canal), com as mesmas funções: karaokê
 * pelo tempo lido a cada quadro, clique no texto, capítulos, velocidade nas taxas que o YouTube aceita,
 * posição lembrada e teclado. Nada fica por cima da moldura do YouTube: legenda dos grifos e conceitos
 * descem para baixo dela. Se o dono não deixa incorporar, o aviso oferece "Assistir no YouTube" e, se
 * houver, o arquivo local.
 *
 * J142: a análise do vídeo traz as **partes** por assunto (o índice ao lado do vídeo, no lugar dos
 * capítulos do canal) e os **momentos** (popups) também para o vídeo do YouTube, cujo arquivo local é só
 * o áudio; a lista dos momentos fica sob as partes. O vídeo pode ficar à esquerda ou à direita do texto
 * (preferência lembrada neste navegador).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as EventoDePonteiro, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { capituloNoInstante, formatarTempo, indiceNoInstante } from '@margem/core/midia';
import { completarPalavras, estimarPalavras, palavraDaFraseNoInstante, type FraseComTexto } from '@margem/core/karaoke';
import { Button, IconButton, SegmentedControl, Select, classesDoBotao } from '../../ui/Primitives';
import type { SnapshotCapitulo } from '../tipos';
import { urlDeAssistirNoYoutube } from '@margem/core/youtube';
import { CHAVES, gravarLocal, lerLocal, posicaoGuardada, rotuloDaVelocidade, VELOCIDADES, velocidadeGuardada, type FonteDeReproducao } from './fontes';
import { controleDoYoutube, controleLocal, velocidadeMaisProxima, type ApiDoYoutube, type ControleDeReproducao, type ErroDoControle, type EventosDoControle } from './controle-de-reproducao';
import { indicePorBloco, intervaloDoTrecho, pontoNoClique, trechoNoPonto, type ModoDoDestaque } from '../karaoke/karaoke';
import { useKaraoke, VoltarAoTrecho } from '../karaoke/VoltarAoTrecho';
import type { ConceitoDoVideoV1 } from '@margem/contratos';
import { ConceitosNoVideo, LegendaDosGrifos, PrepararConceitos, useConceitosDoVideo } from './SobreOVideo';
import { linhasDosGrifos } from './sobre-o-video';
import './player.css';
import { useSessaoDeMidia } from '../player/useSessaoDeMidia';
import { atalhoDeUmaTeclaDesligado, digitando } from '../teclado/comandos';

export interface PropsDoPlayer {
  fontes: readonly FonteDeReproducao[];
  tituloDocumento?: string | undefined;
  /** Onde está o texto do capítulo (o `.capitulo` do leitor fica dentro dele). */
  raiz: HTMLElement | null;
  snapshot: SnapshotCapitulo;
  aoFechar: () => void;
  /** Avisa a largura que o vídeo ocupa à direita (0 quando não ocupa), para a margem de notas. */
  aoMudarLateral?: (largura: number) => void;
  /** Só para os testes: a IFrame Player API (falsa) no lugar do script do YouTube. */
  carregarApiDoYoutube?: () => Promise<ApiDoYoutube>;
}

const SALTO_S = 10;
const RECOLHER_MS = 2600;
const CLASSE_DA_BARRA = 'com-leitura-guiada';
const CLASSE_DO_VIDEO = 'com-video';
const CLASSE_DO_VIDEO_NO_TOPO = 'com-video-no-topo';
const CLASSE_DO_VIDEO_A_ESQUERDA = 'com-video-a-esquerda';
const LARGURA_MINIMA_VIDEO = 320;
/** O YouTube exige ao menos 200×200 px de moldura: em 16:9, 356 px de largura. */
const LARGURA_MINIMA_DO_YOUTUBE = 360;

function larguraPadraoDoVideo(): number {
  const guardada = Number(lerLocal(CHAVES.largura));
  const base = Number.isFinite(guardada) && guardada >= LARGURA_MINIMA_VIDEO ? guardada : Math.round(window.innerWidth * 0.34);
  return Math.max(LARGURA_MINIMA_VIDEO, Math.min(base, 720, window.innerWidth - 560));
}

/** A posição lembrada, se valer a pena voltar a ela (mais de 10 s e não no fim). */
function inicioLembrado(fonte: FonteDeReproducao, duracao: number): number | null {
  const guardada = posicaoGuardada(fonte);
  return Number.isFinite(guardada) && guardada > 10 && (!(duracao > 0) || guardada < duracao - 8) ? guardada : null;
}

const AVISO_DO_ERRO: Record<ErroDoControle['motivo'], string> = {
  incorporacao_bloqueada: 'O dono deste vídeo não permite assistir fora do YouTube.',
  video_indisponivel: 'Este vídeo não está disponível no YouTube (removido ou privado).',
  falha: 'O player do YouTube não carregou aqui.',
};

function destaqueGuardado(): ModoDoDestaque {
  const valor = lerLocal(CHAVES.destaque);
  return valor === 'frase' || valor === 'nenhum' ? valor : 'palavra';
}

function useLarguraDaJanela(): number {
  const [largura, definir] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    const medir = (): void => definir(window.innerWidth);
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, []);
  return largura;
}

function movimentoReduzido(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Um item do índice ao lado do vídeo: parte da análise (com resumo) ou capítulo do canal. */
interface ItemDoIndice { inicio_s: number; titulo: string; resumo?: string }

const ROTULO_DO_TIPO: Record<NonNullable<ConceitoDoVideoV1['tipo']>, string> = { conceito: 'Conceito', dado: 'Dado', contexto: 'Contexto', pergunta: 'Pergunta' };

const Icone = {
  tocar: <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" /></svg>,
  pausar: <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M7 5h3.6v14H7zm6.4 0H17v14h-3.6z" /></svg>,
  denovo: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" /><path d="M4 4v4.5h4.5" /></svg>,
  voltar: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M11 7 7 11l4 4" /><path d="M7 11h7a4 4 0 1 1 0 8h-1" /></svg>,
  avancar: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m13 7 4 4-4 4" /><path d="M17 11h-7a4 4 0 1 0 0 8h1" /></svg>,
  capitulos: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" fill="currentColor" /><circle cx="4.5" cy="12" r="1" fill="currentColor" /><circle cx="4.5" cy="18" r="1" fill="currentColor" /></svg>,
  video: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><rect x="2.5" y="5.5" width="14" height="13" rx="2" /><path d="m16.5 10 5-3v10l-5-3" /></svg>,
  soVideo: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" /></svg>,
  lados: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 7h12M16 4l3 3-3 3M17 17H5M8 14l-3 3 3 3" /></svg>,
  legendas: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M10 10.2a2.2 2.2 0 1 0 0 3.6M17 10.2a2.2 2.2 0 1 0 0 3.6" strokeLinecap="round" /></svg>,
};

/** Lista de partes (ou capítulos) da mídia, com o tempo e o ativo aceso; clicar vai ao tempo. */
function CapitulosDaMidia({ capitulos, ativo, aoIr }: { capitulos: readonly ItemDoIndice[]; ativo: number; aoIr: (s: number) => void }): ReactNode {
  const lista = useRef<HTMLOListElement>(null);
  useEffect(() => {
    lista.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [ativo]);
  return <ol ref={lista} className="capitulos-da-midia">
    {capitulos.map((c, i) => <li key={`${String(c.inicio_s)}-${c.titulo}`}>
      <button type="button" aria-current={i === ativo ? 'true' : undefined} onClick={() => aoIr(c.inicio_s)}>
        <span className="tempo-do-capitulo">{formatarTempo(c.inicio_s)}</span>
        <span className="titulo-do-capitulo">{c.titulo}{c.resumo && <span className="resumo-da-parte">{c.resumo}</span>}</span>
      </button>
    </li>)}
  </ol>;
}

/** Os momentos da análise (os popups), em ordem de tempo; clicar vai a um segundo antes. */
function MomentosDoVideo({ momentos, tempo, aoIr }: { momentos: readonly ConceitoDoVideoV1[]; tempo: number; aoIr: (s: number) => void }): ReactNode {
  return <ol className="capitulos-da-midia momentos-do-video">
    {momentos.map((m) => <li key={m.id}>
      <button type="button" data-passou={m.instante_s <= tempo + 0.4 ? 'sim' : undefined} title={m.explicacao} onClick={() => aoIr(Math.max(0, m.instante_s - 1))}>
        <span className="tempo-do-capitulo">{formatarTempo(m.instante_s)}</span>
        <span className="titulo-do-capitulo"><span className="tipo-do-momento">{ROTULO_DO_TIPO[m.tipo ?? 'conceito']}</span>{' '}{m.titulo}</span>
      </button>
    </li>)}
  </ol>;
}

export function PlayerDeMidia({ fontes, tituloDocumento, raiz, snapshot, aoFechar, aoMudarLateral, carregarApiDoYoutube }: PropsDoPlayer): ReactNode {
  const [escolhida, escolher] = useState(0);
  const fonte = fontes[Math.min(escolhida, fontes.length - 1)]!;
  const elemento = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const hospedeDoYoutube = useRef<HTMLDivElement>(null);
  const controle = useRef<ControleDeReproducao | null>(null);
  /** Fonte do YouTube em que o leitor pediu o arquivo local (embed bloqueado). */
  const [localPedido, pedirLocal] = useState<string | null>(null);
  const usaYoutube = fonte.youtube !== null && (localPedido !== fonte.id || fonte.url === null);
  const [erroDoControle, definirErroDoControle] = useState<{ fonte: string; erro: ErroDoControle } | null>(null);
  const erroAtual = erroDoControle?.fonte === fonte.id && usaYoutube ? erroDoControle.erro : null;
  /** Taxas que o controle aceita (`null` = qualquer uma de 0,5 a 2,5). */
  const [taxas, definirTaxas] = useState<readonly number[] | null>(null);
  const trilha = useRef<HTMLDivElement>(null);
  const preenchida = useRef<HTMLDivElement>(null);
  const transporte = useRef<HTMLDivElement>(null);
  const painelVideo = useRef<HTMLElement>(null);
  const botaoVelocidade = useRef<HTMLButtonElement>(null);
  const botaoCapitulos = useRef<HTMLButtonElement>(null);
  const [tocando, definirTocando] = useState(false);
  const [tempo, definirTempo] = useState(0);
  const [duracao, definirDuracao] = useState(fonte.duracao_s);
  const [velocidade, definirVelocidade] = useState(velocidadeGuardada);
  const [destaque, definirDestaque] = useState<ModoDoDestaque>(destaqueGuardado);
  const [seguir, definirSeguir] = useState(true);
  const [recolhido, recolher] = useState(false);
  const [fim, definirFim] = useState(false);
  const [painel, abrirPainel] = useState<null | 'velocidade' | 'capitulos'>(null);
  const [videoVisivel, mostrarVideo] = useState(() => lerLocal(CHAVES.video) !== 'off');
  const [larguraGuardada, definirLarguraVideo] = useState(larguraPadraoDoVideo);
  const larguraDaJanela = useLarguraDaJanela();
  const celular = larguraDaJanela < 900;
  /** Há imagem para mostrar: o YouTube, ou um arquivo local de vídeo (o de um vídeo do YouTube é só o áudio). */
  const apresentaVideo = usaYoutube || (fonte.tipo === 'video' && fonte.tipoDoArquivo === 'video');
  // O vídeo do YouTube não toca escondido: a moldura fica sempre à vista enquanto ele é a fonte.
  const comVideo = apresentaVideo && (videoVisivel || usaYoutube);
  const larguraVideo = usaYoutube ? Math.max(larguraGuardada, LARGURA_MINIMA_DO_YOUTUBE) : larguraGuardada;
  /** "Só o vídeo": o vídeo ocupa a tela, o texto fica atrás e os grifos viram legenda. */
  const [soVideo, definirSoVideo] = useState(false);
  const telaDeVideo = comVideo && soVideo;
  const [legendas, definirLegendas] = useState(() => lerLocal(CHAVES.legendas) !== 'off');
  const videoAoLado = comVideo && !celular && !telaDeVideo;
  // J142: o vídeo do YouTube também (o arquivo dele é só o áudio, mas a fonte é vídeo); antes ficava de fora.
  const comMomentos = fonte.origem === 'midia' && fonte.tipo === 'video';
  const conceitos = useConceitosDoVideo(comMomentos ? fonte.id : null);
  const momentos = conceitos.conceitos?.conceitos ?? [];
  const partesDaAnalise = conceitos.conceitos?.partes ?? [];
  /** O índice ao lado do vídeo: as partes da análise; sem elas, os capítulos do canal. */
  const indice: readonly ItemDoIndice[] = useMemo(() => (partesDaAnalise.length > 0
    ? partesDaAnalise.map((p) => ({ inicio_s: p.instante_s, titulo: p.titulo, resumo: p.resumo })) : fonte.capitulos), [partesDaAnalise, fonte.capitulos]);
  const nomeDoIndice = partesDaAnalise.length > 0 ? 'Partes' : 'Capítulos';
  /** Vídeo à esquerda ou à direita do texto (computador). */
  const [lado, definirLado] = useState<'direita' | 'esquerda'>(() => (lerLocal(CHAVES.lado) === 'esquerda' ? 'esquerda' : 'direita'));

  const { karaoke, fora } = useKaraoke();
  /** Cada palavra do texto com tempo: as alinhadas com o tempo real, as outras interpoladas (ou, sem alinhamento, estimadas na frase). */
  const palavras = useMemo(() => {
    const textos = new Map(snapshot.blocos.map((b) => [b.id, b.texto]));
    const frases: FraseComTexto[] = fonte.frases.map((f) => ({ ...f, texto: textos.get(f.bloco_id)?.slice(f.inicio_utf16, f.fim_utf16) ?? '' }));
    if (frases.length === 0) return fonte.palavras;
    return fonte.palavras.length > 0 ? completarPalavras(frases, fonte.palavras) : frases.flatMap(estimarPalavras);
  }, [fonte, snapshot.blocos]);
  const linhasDaLegenda = useMemo(() => (fonte.tipo === 'video' ? linhasDosGrifos(snapshot.marcas, snapshot.blocos, palavras) : []), [fonte.tipo, snapshot.marcas, snapshot.blocos, palavras]);
  const referencias = useRef({ seguir, destaque, fonte, raiz, tocando, palavras, velocidade, taxas, rolarUmaVez: false });
  referencias.current = { ...referencias.current, seguir, destaque, fonte, raiz, tocando, palavras, velocidade, taxas };
  const intervaloDaFrase = useRef<{ indice: number; intervalo: Range | null }>({ indice: -1, intervalo: null });
  /** Onde começa a área de leitura visível (abaixo da barra e, no celular, do vídeo); medido fora do quadro a quadro. */
  const topoDaLeitura = useRef(64);
  const porBloco = useMemo(() => indicePorBloco(palavras.length > 0 ? palavras : fonte.frases), [palavras, fonte.frases]);

  // ---------------------------------------------------------------- mídia
  const irPara = useCallback((segundos: number, tocar = false) => {
    const c = controle.current;
    if (!c) return;
    const d = c.duracao();
    const fim = Number.isFinite(d) ? d : fonte.duracao_s > 0 ? fonte.duracao_s : Number.POSITIVE_INFINITY;
    const alvo = Math.max(0, Math.min(segundos, fim - 0.05));
    c.irPara(alvo);
    definirTempo(alvo); definirFim(false); definirSeguir(true);
    referencias.current.rolarUmaVez = true;
    if (tocar && c.pausado()) c.tocar();
  }, [fonte.duracao_s]);
  const alternar = useCallback(() => {
    const c = controle.current;
    if (!c) return;
    if (c.pausado()) c.tocar(); else c.pausar();
  }, []);
  const saltar = useCallback((delta: number) => {
    const c = controle.current;
    if (c) irPara(c.tempo() + delta);
  }, [irPara]);
  const mudarVelocidade = useCallback((v: number) => {
    const valor = Math.round(velocidadeMaisProxima(Math.max(0.5, Math.min(2.5, v)), referencias.current.taxas) * 100) / 100;
    definirVelocidade(valor); gravarLocal(CHAVES.velocidade, String(valor));
  }, []);
  useEffect(() => { controle.current?.definirVelocidade(velocidade); }, [velocidade, fonte.id, usaYoutube]);

  const guardarPosicao = useCallback(() => {
    const t = controle.current?.tempo() ?? 0;
    if (t > 0) gravarLocal(CHAVES.posicao(referencias.current.fonte.lembranca), t.toFixed(1));
  }, []);
  useEffect(() => () => { guardarPosicao(); }, [guardarPosicao]);
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('com-player');
    return () => html.classList.remove('com-player');
  }, []);
  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle('com-karaoke', destaque !== 'nenhum' && fonte.frases.length > 0);
    return () => html.classList.remove('com-karaoke');
  }, [destaque, fonte]);
  useEffect(() => {
    // Trocar de fonte recomeça do que foi guardado para ela; o destaque antigo não fica aceso.
    intervaloDaFrase.current = { indice: -1, intervalo: null };
    definirFim(false); definirTempo(0); definirDuracao(fonte.duracao_s); definirSeguir(true);
    karaoke.current?.definir(null, { frase: null, palavra: null, modo: 'nenhum' });
  }, [fonte.id]);
  // ---------------------------------------------------------------- controle (arquivo local ou YouTube)
  const eventos = useRef<EventosDoControle | null>(null);
  eventos.current = {
    aoFicarPronto: () => {
      const c = controle.current;
      if (!c) return;
      const { velocidade: v, fonte: f } = referencias.current;
      const disponiveis = c.velocidadesDisponiveis();
      definirTaxas(disponiveis);
      c.definirVelocidade(velocidadeMaisProxima(v, disponiveis));
      const d = c.duracao();
      definirDuracao(Number.isFinite(d) ? d : f.duracao_s);
      if (c.tipo === 'local') {
        const guardada = inicioLembrado(f, Number.isFinite(d) ? d : f.duracao_s);
        if (guardada !== null) { c.irPara(guardada); definirTempo(guardada); referencias.current.rolarUmaVez = true; }
      } else if (c.tempo() > 0) { definirTempo(c.tempo()); referencias.current.rolarUmaVez = true; }
    },
    aoTocar: () => { definirTocando(true); definirFim(false); },
    aoPausar: () => { definirTocando(false); guardarPosicao(); },
    aoTerminar: () => { definirTocando(false); definirFim(true); gravarLocal(CHAVES.posicao(referencias.current.fonte.lembranca), '0'); },
    aoMudarDuracao: (d) => { if (Number.isFinite(d) && d > 0) definirDuracao(d); },
    // O YouTube pode arredondar a taxa pedida: o botão mostra a que vale de fato (sem gravar a preferência).
    aoMudarVelocidade: (v) => { if (Number.isFinite(v) && v > 0 && Math.abs(v - referencias.current.velocidade) > 0.001) definirVelocidade(v); },
    aoErro: (erro) => { definirTocando(false); definirErroDoControle({ fonte: referencias.current.fonte.id, erro }); },
  };
  useEffect(() => {
    const repassar: EventosDoControle = {
      aoFicarPronto: () => eventos.current?.aoFicarPronto(), aoTocar: () => eventos.current?.aoTocar(), aoPausar: () => eventos.current?.aoPausar(),
      aoTerminar: () => eventos.current?.aoTerminar(), aoMudarDuracao: (d) => eventos.current?.aoMudarDuracao(d),
      aoMudarVelocidade: (v) => eventos.current?.aoMudarVelocidade(v), aoErro: (e) => eventos.current?.aoErro(e),
    };
    let criado: ControleDeReproducao | null = null;
    if (usaYoutube && fonte.youtube !== null && hospedeDoYoutube.current) {
      const inicio = inicioLembrado(fonte, fonte.duracao_s);
      criado = controleDoYoutube(hospedeDoYoutube.current, {
        videoId: fonte.youtube.id, titulo: fonte.titulo, origem: window.location.origin, velocidade: referencias.current.velocidade,
        ...(inicio === null ? {} : { inicio_s: inicio }), ...(carregarApiDoYoutube === undefined ? {} : { carregarApi: carregarApiDoYoutube }),
      }, repassar);
      if (inicio !== null) { definirTempo(inicio); referencias.current.rolarUmaVez = true; }
    } else if (!usaYoutube && elemento.current) {
      criado = controleLocal(elemento.current, repassar);
    }
    controle.current = criado;
    definirTaxas(null);
    return () => {
      criado?.destruir();
      if (controle.current === criado) controle.current = null;
    };
    // A fonte muda pelo id; o carregador da API é fixo por player.
  }, [fonte.id, usaYoutube]);

  // ---------------------------------------------------------------- quadro a quadro
  useEffect(() => {
    let quadro = 0;
    let ultimoGravado = 0;
    const passo = (): void => {
      quadro = requestAnimationFrame(passo);
      const c = controle.current;
      const { fonte: f, raiz: r, destaque: modo, seguir: acompanhar, tocando: tocandoAgora, palavras: lista } = referencias.current;
      if (!c) return;
      const t = c.tempo();
      const duracaoDoControle = c.duracao();
      const d = Number.isFinite(duracaoDoControle) && duracaoDoControle > 0 ? duracaoDoControle : f.duracao_s;
      const proporcao = d > 0 ? Math.min(1, t / d) : 0;
      preenchida.current?.style.setProperty('--progresso', String(proporcao));
      definirTempo((antes) => (Math.abs(antes - t) >= 0.25 ? t : antes));
      if (tocandoAgora && Math.abs(t - ultimoGravado) > 4) { ultimoGravado = t; gravarLocal(CHAVES.posicao(f.lembranca), t.toFixed(1)); }
      const frase = f.frases.length > 0 ? indiceNoInstante(f.frases, t, 0.4).ultima : -1;
      const fraseAtual = f.frases[frase] ?? null;
      // A camada compara as chaves e só redesenha o que mudou (a palavra, ou a faixa quando a frase muda).
      karaoke.current?.definir(r, { frase: fraseAtual, palavra: palavraDaFraseNoInstante(lista, fraseAtual, t), modo });
      if (!r || frase < 0 || !acompanhar || !(tocandoAgora || referencias.current.rolarUmaVez)) return;
      if (intervaloDaFrase.current.indice !== frase || !intervaloDaFrase.current.intervalo?.startContainer.isConnected) {
        intervaloDaFrase.current = { indice: frase, intervalo: intervaloDoTrecho(r, f.frases[frase]!) };
      }
      const caixa = intervaloDaFrase.current.intervalo?.getBoundingClientRect?.();
      if (!caixa || caixa.height === 0) return;
      const topo = topoDaLeitura.current;
      const base = transporte.current?.getBoundingClientRect().top ?? window.innerHeight;
      const alvo = topo + (base - topo) * 0.4;
      const diferenca = caixa.top + Math.min(caixa.height, (base - topo) * 0.5) / 2 - alvo;
      if (movimentoReduzido() || referencias.current.rolarUmaVez || Math.abs(diferenca) > window.innerHeight) {
        if (Math.abs(diferenca) > 1) window.scrollBy(0, diferenca);
        referencias.current.rolarUmaVez = false;
      } else if (Math.abs(diferenca) > 0.5) {
        window.scrollBy(0, diferenca * 0.1);
      }
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, []);

  // O leitor rolou por conta própria: para de acompanhar e oferece voltar.
  useEffect(() => {
    const soltar = (): void => { if (referencias.current.seguir) definirSeguir(false); };
    const teclasDeRolar = (e: KeyboardEvent): void => { if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(e.key)) soltar(); };
    const roda = (e: Event): void => { if (!(e.target instanceof Element && e.target.closest('.player-midia'))) soltar(); };
    window.addEventListener('wheel', roda, { passive: true });
    window.addEventListener('touchmove', roda, { passive: true });
    window.addEventListener('keydown', teclasDeRolar);
    return () => { window.removeEventListener('wheel', roda); window.removeEventListener('touchmove', roda); window.removeEventListener('keydown', teclasDeRolar); };
  }, []);

  // ---------------------------------------------------------------- clique na palavra
  useEffect(() => {
    if (!raiz) return;
    const clicar = (e: MouseEvent): void => {
      if (e.button !== 0 || e.defaultPrevented || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const selecao = window.getSelection();
      if (selecao && !selecao.isCollapsed) return;
      const alvo = e.target instanceof Element ? e.target : null;
      if (!alvo?.closest('.capitulo') || alvo.closest('button, a, input, textarea, select, [role=button], [role=toolbar], .margem, .nota')) return;
      const { fonte: f } = referencias.current;
      const lista = referencias.current.palavras.length > 0 ? referencias.current.palavras : f.frases;
      const ponto = pontoNoClique(document, e.clientX, e.clientY, snapshot);
      if (!ponto) return;
      const indice = trechoNoPonto(lista, porBloco, ponto);
      if (indice >= 0) irPara(lista[indice]!.inicio_s, true);
    };
    raiz.addEventListener('click', clicar);
    return () => raiz.removeEventListener('click', clicar);
  }, [raiz, snapshot, porBloco, irPara]);

  // ---------------------------------------------------------------- teclado
  useEffect(() => {
    const teclar = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || digitando(e.target) || atalhoDeUmaTeclaDesligado(e)) return;
      const alvo = e.target instanceof Element ? e.target : null;
      if (alvo?.closest('[role=dialog], [role=combobox]')) return;
      const tecla = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (tecla === ' ' && alvo?.closest('button, a, [role=button], summary')) return;
      if (tecla === ' ' || tecla === 'k') { e.preventDefault(); alternar(); }
      else if (tecla === 'ArrowLeft' || tecla === 'ArrowRight') { e.preventDefault(); saltar((tecla === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 5)); }
      else if (tecla === 'j' || tecla === 'l') { e.preventDefault(); saltar(tecla === 'j' ? -SALTO_S : SALTO_S); }
      else return;
      recolher(false);
    };
    window.addEventListener('keydown', teclar);
    return () => window.removeEventListener('keydown', teclar);
  }, [alternar, saltar]);

  // ---------------------------------------------------------------- barra que se recolhe enquanto toca
  const sobreOTransporte = useRef(false);
  useEffect(() => {
    let relogio = 0;
    const acordar = (): void => {
      recolher(false);
      window.clearTimeout(relogio);
      if (tocando && painel === null) relogio = window.setTimeout(() => { if (!sobreOTransporte.current) recolher(true); }, RECOLHER_MS);
    };
    acordar();
    window.addEventListener('pointermove', acordar, { passive: true });
    window.addEventListener('touchstart', acordar, { passive: true });
    return () => { window.clearTimeout(relogio); window.removeEventListener('pointermove', acordar); window.removeEventListener('touchstart', acordar); };
  }, [tocando, painel]);

  // ---------------------------------------------------------------- lugar do vídeo
  useLayoutEffect(() => {
    const html = document.documentElement;
    if (!videoAoLado || html.classList.contains(CLASSE_DA_BARRA)) { aoMudarLateral?.(0); return; }
    html.classList.add(CLASSE_DA_BARRA, CLASSE_DO_VIDEO);
    html.classList.toggle(CLASSE_DO_VIDEO_A_ESQUERDA, lado === 'esquerda');
    html.style.setProperty('--largura-guiada', `${String(larguraVideo)}px`);
    html.style.setProperty('--largura-guiada-alvo', `${String(larguraVideo)}px`);
    aoMudarLateral?.(larguraVideo);
    return () => {
      html.classList.remove(CLASSE_DA_BARRA, CLASSE_DO_VIDEO, CLASSE_DO_VIDEO_A_ESQUERDA);
      html.style.removeProperty('--largura-guiada'); html.style.removeProperty('--largura-guiada-alvo');
      aoMudarLateral?.(0);
    };
  }, [videoAoLado, larguraVideo, aoMudarLateral, lado]);
  // No celular o vídeo fica logo abaixo da barra do leitor, e o texto começa depois dele.
  useLayoutEffect(() => {
    const html = document.documentElement;
    const medir = (): void => {
      const barra = document.querySelector('.filtros')?.getBoundingClientRect();
      const topo = Math.max(0, barra ? barra.bottom : 0);
      const video = comVideo && celular ? painelVideo.current?.getBoundingClientRect().height ?? 0 : 0;
      topoDaLeitura.current = Math.round(topo + video) || 64;
      html.style.setProperty('--topo-do-video', `${String(Math.round(topo))}px`);
      html.style.setProperty('--altura-do-video', `${String(Math.round(video))}px`);
    };
    if (comVideo && celular) html.classList.add(CLASSE_DO_VIDEO_NO_TOPO);
    medir();
    window.addEventListener('scroll', medir, { passive: true });
    window.addEventListener('resize', medir);
    const observador = typeof ResizeObserver === 'function' && painelVideo.current ? new ResizeObserver(medir) : null;
    if (painelVideo.current) observador?.observe(painelVideo.current);
    return () => {
      html.classList.remove(CLASSE_DO_VIDEO_NO_TOPO);
      for (const nome of ['--topo-do-video', '--altura-do-video']) html.style.removeProperty(nome);
      window.removeEventListener('scroll', medir); window.removeEventListener('resize', medir); observador?.disconnect();
    };
  }, [comVideo, celular]);

  function redimensionar(e: EventoDePonteiro<HTMLDivElement>): void {
    e.preventDefault();
    const alca = e.currentTarget;
    alca.setPointerCapture(e.pointerId);
    document.documentElement.classList.add('arrastando-guiada');
    let largura = larguraVideo;
    const minima = usaYoutube ? LARGURA_MINIMA_DO_YOUTUBE : LARGURA_MINIMA_VIDEO;
    const mover = (ev: PointerEvent): void => {
      // A alça fica do lado do texto: à direita do vídeo quando ele está à esquerda.
      const pedida = lado === 'esquerda' ? ev.clientX : window.innerWidth - ev.clientX;
      largura = Math.round(Math.max(minima, Math.min(pedida, window.innerWidth - 560, 900)));
      definirLarguraVideo(largura);
    };
    const soltar = (): void => {
      alca.removeEventListener('pointermove', mover); alca.removeEventListener('pointerup', soltar); alca.removeEventListener('pointercancel', soltar);
      document.documentElement.classList.remove('arrastando-guiada');
      gravarLocal(CHAVES.largura, String(largura));
    };
    alca.addEventListener('pointermove', mover); alca.addEventListener('pointerup', soltar); alca.addEventListener('pointercancel', soltar);
  }

  // ---------------------------------------------------------------- trilha
  const arrastando = useRef(false);
  function irParaX(x: number): void {
    const caixa = trilha.current?.getBoundingClientRect();
    if (!caixa || caixa.width === 0) return;
    irPara(Math.min(1, Math.max(0, (x - caixa.left) / caixa.width)) * duracao);
  }

  // Popovers próprios: abrem para cima, a partir do transporte; Esc e clique fora fecham.
  useEffect(() => {
    if (painel === null) return;
    const fora = (e: PointerEvent): void => {
      if (e.target instanceof Element && (e.target.closest('.popover-do-player') || e.target.closest('[data-dono-select]') || botaoVelocidade.current?.contains(e.target) || botaoCapitulos.current?.contains(e.target))) return;
      abrirPainel(null);
    };
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); abrirPainel(null); } };
    document.addEventListener('pointerdown', fora);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', fora); document.removeEventListener('keydown', esc, true); };
  }, [painel]);

  const capituloAtual = capituloNoInstante(indice, tempo);
  useSessaoDeMidia({
    titulo: tituloDocumento ?? fonte.titulo,
    capitulo: indice[capituloAtual]?.titulo ?? snapshot.secao.titulo,
    tocando, tempo, duracao, velocidade, buscar: irPara,
    instante: () => controle.current?.tempo() ?? tempo,
    tocar: () => { const c = controle.current; if (c) { if (c.terminado()) irPara(0); c.tocar(); } },
    pausar: () => controle.current?.pausar(),
    anterior: () => irPara(indice[Math.max(0, capituloAtual - 1)]?.inicio_s ?? 0),
    proximo: () => irPara(indice[capituloAtual + 1]?.inicio_s ?? duracao),
  });
  const restante = Math.max(0, duracao - tempo);
  const titulo = indice[capituloAtual]?.titulo ?? fonte.titulo;
  const subtituloBruto = !usaYoutube && fonte.youtube !== null ? 'Arquivo local'
    : indice.length > 0 ? fonte.titulo : fonte.fonte?.canal ?? (fonte.origem === 'audio' ? 'Narração' : fonte.frases.length === 0 && fonte.tipo === 'video' ? 'Sem transcrição' : '');
  const subtitulo = subtituloBruto === titulo ? '' : subtituloBruto;
  const irECantar = (s: number): void => { irPara(s + 0.05, true); if (celular) abrirPainel(null); };
  // Os eventos do elemento chegam pelo controle (`controleLocal`); aqui só o elemento.
  const midia = usaYoutube
    // O player oficial do YouTube: o controle cria a moldura dentro deste hospedeiro e é dono dela.
    ? <div key={`yt-${fonte.id}`} ref={hospedeDoYoutube} className="hospede-do-youtube" />
    : fonte.url === null ? null
      : apresentaVideo
      // Sem legenda embutida: a transcrição sincronizada é o próprio texto do leitor.
        ? <video key={fonte.id} ref={elemento} src={fonte.url} preload="metadata" playsInline onClick={alternar} />
        : <audio key={fonte.id} ref={elemento} src={fonte.url} preload="metadata" />;
  const legendaEConceitos = <>
    {telaDeVideo && legendas && <LegendaDosGrifos linhas={linhasDaLegenda} marcas={snapshot.marcas} tempo={tempo} />}
    {comVideo && momentos.length > 0 && <ConceitosNoVideo conceitos={momentos} tempo={tempo} tocando={tocando}
      marcas={snapshot.marcas} linhas={linhasDaLegenda} {...(usaYoutube ? {} : { video: elemento })} comLegenda={telaDeVideo && legendas}
      aoIrAoTrecho={(c) => { definirSoVideo(false); irPara(Math.max(0, c.instante_s - 1)); }} />}
  </>;
  const temSobreposicao = (telaDeVideo && legendas) || momentos.length > 0;

  const estilo = { '--largura-do-video': `${String(larguraVideo)}px` } as CSSProperties;
  return createPortal(<div className="player-midia" data-tipo={fonte.tipo} data-lado={videoAoLado ? lado : undefined} data-video={telaDeVideo ? 'so' : comVideo ? (celular ? 'topo' : 'lado') : 'nenhum'} data-recolhido={recolhido && tocando ? 'sim' : undefined} style={estilo}>
    {apresentaVideo
      ? <aside ref={painelVideo} className="painel-video" aria-label="Vídeo" hidden={!comVideo} data-controle={usaYoutube ? 'youtube' : 'local'}>
        {!celular && <div className="alca-do-video" role="separator" aria-orientation="vertical" aria-label="Largura do vídeo" onPointerDown={redimensionar} />}
        <div className="quadro-do-video">
          {midia}
          {!usaYoutube && legendaEConceitos}
        </div>
        {/* YouTube: nada por cima da moldura (regra do player embutido); legenda e conceitos vêm logo abaixo. */}
        {usaYoutube && temSobreposicao && <div className="sob-o-video">{legendaEConceitos}</div>}
        {erroAtual && <div className="aviso-do-video" role="status">
          <p>{AVISO_DO_ERRO[erroAtual.motivo]}</p>
          <div className="acoes-do-aviso">
            <a className={classesDoBotao({ variante: 'primario', tamanho: 'md' })} href={urlDeAssistirNoYoutube(fonte.youtube!.id, tempo)} target="_blank" rel="noopener noreferrer">Assistir no YouTube</a>
            {fonte.url !== null && <Button className="small" onClick={() => { guardarPosicao(); pedirLocal(fonte.id); }}>{fonte.tipoDoArquivo === 'audio' ? 'Ouvir o áudio local' : 'Tocar o arquivo local'}</Button>}
          </div>
        </div>}
        {!celular && !telaDeVideo && (indice.length > 0 || momentos.length > 0) && <section className="capitulos-ao-lado" aria-label={nomeDoIndice}>
          {indice.length > 0 && <>
            <h3>{nomeDoIndice}</h3>
            <CapitulosDaMidia capitulos={indice} ativo={capituloAtual} aoIr={irECantar} />
          </>}
          {momentos.length > 0 && <>
            <h3>Momentos</h3>
            <MomentosDoVideo momentos={momentos} tempo={tempo} aoIr={(s) => irPara(s, true)} />
          </>}
        </section>}
      </aside>
      : midia}
    <VoltarAoTrecho visivel={!seguir && fora} acimaDe=".player-midia .transporte" aoVoltar={() => { definirSeguir(true); referencias.current.rolarUmaVez = true; }} />
    <div ref={transporte} className="transporte" role="region" aria-label="Reprodução"
      onPointerEnter={() => { sobreOTransporte.current = true; }} onPointerLeave={() => { sobreOTransporte.current = false; }}>
      <div className="linha-do-tempo">
        <span className="tempo">{formatarTempo(tempo)}</span>
        <div ref={trilha} className="trilha" role="slider" tabIndex={0} aria-label="Posição" aria-valuemin={0} aria-valuemax={Math.round(duracao)} aria-valuenow={Math.round(tempo)} aria-valuetext={`${formatarTempo(tempo)} de ${formatarTempo(duracao)}`}
          onPointerDown={(e) => { arrastando.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); irParaX(e.clientX); }}
          onPointerMove={(e) => { if (arrastando.current) irParaX(e.clientX); }}
          onPointerUp={() => { arrastando.current = false; }} onPointerCancel={() => { arrastando.current = false; }}
          onKeyDown={(e) => { if (e.key === 'Home') { e.preventDefault(); irPara(0); } else if (e.key === 'End') { e.preventDefault(); irPara(duracao); } }}>
          {indice.slice(1).map((c) => <span key={c.inicio_s} className="marca-de-capitulo" style={{ left: `${String((c.inicio_s / Math.max(duracao, 1)) * 100)}%` }} />)}
          <div ref={preenchida} className="trilha-preenchida" style={{ '--progresso': String(duracao > 0 ? tempo / duracao : 0) } as CSSProperties}><span className="trilha-botao" /></div>
        </div>
        <span className="tempo restante">-{formatarTempo(restante)}</span>
      </div>
      <div className="controles-da-midia">
        <div className="agora" aria-live="off">
          {fim ? <><strong>Fim</strong><button type="button" className="ouvir-de-novo" onClick={() => irPara(0, true)}>{fonte.tipo === 'video' ? 'Assistir de novo' : 'Ouvir de novo'}</button></>
            : <><strong title={titulo}>{titulo}</strong>{subtitulo && <span title={subtitulo}>{subtitulo}</span>}</>}
        </div>
        <div className="centro">
          <IconButton aria-label="Voltar 10 segundos" className="salto" onClick={() => saltar(-SALTO_S)}>{Icone.voltar}<span className="numero-do-salto">10</span></IconButton>
          <button type="button" className="tocar" aria-label={tocando ? 'Pausar' : fim ? 'Tocar de novo' : 'Tocar'} onClick={alternar}>{tocando ? Icone.pausar : fim ? Icone.denovo : Icone.tocar}</button>
          <IconButton aria-label="Avançar 10 segundos" className="salto" onClick={() => saltar(SALTO_S)}>{Icone.avancar}<span className="numero-do-salto">10</span></IconButton>
          <div className="ancora-do-popover">
            <Button ref={botaoVelocidade} variante="ghost" className="velocidade" aria-label={`Velocidade ${rotuloDaVelocidade(velocidade)}`} aria-expanded={painel === 'velocidade'} onClick={() => abrirPainel(painel === 'velocidade' ? null : 'velocidade')}>{rotuloDaVelocidade(velocidade)}</Button>
            {painel === 'velocidade' && <div className="popover-do-player" role="dialog" aria-label="Velocidade e destaque">
              <p className="valor-da-velocidade">{rotuloDaVelocidade(velocidade)}</p>
              <input className="ui-input" type="range" min={taxas ? Math.max(0.5, taxas[0]!) : 0.5} max={taxas ? Math.min(2.5, taxas[taxas.length - 1]!) : 2.5} step={0.05} value={velocidade} aria-label="Velocidade de reprodução" onChange={(e) => mudarVelocidade(Number(e.target.value))} />
              <div className="atalhos-de-velocidade">{VELOCIDADES.filter((v) => taxas === null || taxas.includes(v)).map((v) => <button key={v} type="button" aria-pressed={velocidade === v} onClick={() => mudarVelocidade(v)}>{rotuloDaVelocidade(v)}</button>)}</div>
              <SegmentedControl rotulo="Destaque no texto" valor={destaque} opcoes={[{ valor: 'palavra', rotulo: 'Palavra' }, { valor: 'frase', rotulo: 'Frase' }, { valor: 'nenhum', rotulo: 'Nenhum' }]}
                aoMudar={(v) => { const modo = v as ModoDoDestaque; definirDestaque(modo); gravarLocal(CHAVES.destaque, modo); }} />
              {comMomentos && <PrepararConceitos conceitos={conceitos} />}
              {fontes.length > 1 && <label className="escolha-da-fonte"><span>Fonte</span><Select aria-label="Fonte da reprodução" value={String(escolhida)} onChange={(e) => { guardarPosicao(); escolher(Number(e.target.value)); abrirPainel(null); }}>
                {fontes.map((f, i) => <option key={f.id} value={String(i)}>{f.titulo}</option>)}
              </Select></label>}
            </div>}
          </div>
        </div>
        <div className="direita">
          {telaDeVideo && <IconButton aria-label={legendas ? 'Desligar as legendas dos grifos' : 'Ligar as legendas dos grifos'} aria-pressed={legendas}
            onClick={() => { definirLegendas(!legendas); gravarLocal(CHAVES.legendas, legendas ? 'off' : 'on'); }}>{Icone.legendas}</IconButton>}
          {indice.length > 0 && (celular || !comVideo || telaDeVideo) && <div className="ancora-do-popover">
            <IconButton ref={botaoCapitulos} aria-label={nomeDoIndice} aria-expanded={painel === 'capitulos'} onClick={() => abrirPainel(painel === 'capitulos' ? null : 'capitulos')}>{Icone.capitulos}</IconButton>
            {painel === 'capitulos' && <div className="popover-do-player popover-de-capitulos" role="dialog" aria-label={nomeDoIndice}>
              <CapitulosDaMidia capitulos={indice} ativo={capituloAtual} aoIr={irECantar} />
            </div>}
          </div>}
          {videoAoLado && <IconButton aria-label={lado === 'direita' ? 'Pôr o vídeo à esquerda do texto' : 'Pôr o vídeo à direita do texto'}
            onClick={() => { const outro = lado === 'direita' ? 'esquerda' : 'direita'; definirLado(outro); gravarLocal(CHAVES.lado, outro); }}>{Icone.lados}</IconButton>}
          {comVideo && <IconButton aria-label={telaDeVideo ? 'Voltar ao texto' : 'Só o vídeo'} aria-pressed={telaDeVideo} onClick={() => definirSoVideo(!telaDeVideo)}>{Icone.soVideo}</IconButton>}
          {apresentaVideo && !usaYoutube && <IconButton aria-label={videoVisivel ? 'Esconder o vídeo' : 'Mostrar o vídeo'} aria-pressed={videoVisivel} onClick={() => { mostrarVideo(!videoVisivel); gravarLocal(CHAVES.video, videoVisivel ? 'off' : 'on'); }}>{Icone.video}</IconButton>}
          <IconButton aria-label="Fechar o player" onClick={() => { controle.current?.pausar(); aoFechar(); }} icone="xis" />
        </div>
      </div>
    </div>
  </div>, document.body);
}
