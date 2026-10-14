/**
 * Camadas sobre o vídeo (noite2/video-popups):
 *
 * - `LegendaDosGrifos`: no modo "só o vídeo", o trecho grifado que está sendo falado aparece como
 *   legenda, sublinhado na cor da função, palavra a palavra no tempo da transcrição;
 * - `ConceitosNoVideo`: no instante programado, uma bolinha surge sobre o vídeo e vira uma pílula
 *   (timer-pizza na cor do grifo + rótulo curto, como "LLM"); o setor avança por 15 s e a pílula
 *   some. Passar o mouse pausa; clicar (ou Enter) abre o cartão com o conceito inteiro e "Ir ao
 *   trecho"; Esc ou "Fechar" voltam à pílula. A região é a menos ocupada do rodapé do quadro.
 *
 * Tudo o que vem do modelo entra como texto do React, nunca como HTML.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ConceitoDoVideoV1, ConceitosDoVideoV1, Id } from '@margem/contratos';
import { pedir } from '../../biblioteca/api';
import { Button } from '../../ui/Primitives';
import { usarFuncoes } from '../ContextoDosModos';
import type { MarcaDoLeitor } from '../f2';
import {
  conceitoQueEntra, DURACAO_DO_CARTAO_MS, escolherRegiao, esquecerOsAdiante, folgasDoConteudo, JANELA_DE_ENTRADA_S, linhaNoInstante, marcaDaCor,
  ocupacaoDoQuadro, REGIAO_PADRAO, rotuloCurto, setorDaPizza, suavizarOcupacao, type LinhaDeLegenda, type OcupacaoDoQuadro, type RegiaoDaPilula,
} from './sobre-o-video';
import './sobre-o-video.css';

function movimentoReduzido(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---------------------------------------------------------------- legenda dos grifos

export function LegendaDosGrifos({ linhas, marcas, tempo }: { linhas: readonly LinhaDeLegenda[]; marcas: readonly MarcaDoLeitor[]; tempo: number }): ReactNode {
  const { daMarca } = usarFuncoes();
  const linha = linhaNoInstante(linhas, tempo);
  const marca = linha ? marcas.find((m) => m.id === linha.marca_id) : undefined;
  if (!linha || !marca) return null;
  return <div className="legenda-dos-grifos" aria-live="off">
    <p key={`${linha.marca_id}-${String(linha.inicio_s)}`} style={{ '--cor-da-funcao': daMarca(marca) } as CSSProperties}>
      {linha.palavras.map((p, i) => <span key={i} data-dita={tempo >= p.inicio_s ? 'sim' : undefined}>{i > 0 ? ' ' : ''}{p.texto}</span>)}
    </p>
  </div>;
}

// ---------------------------------------------------------------- conceitos: dados

export type EstadoDosConceitos = 'carregando' | 'erro' | 'nao_preparado' | 'preparando' | 'pronto' | 'falhou';
export interface Conceitos { estado: EstadoDosConceitos; conceitos: ConceitosDoVideoV1 | null; preparar: () => void }

const ESPERA_DO_PREPARO_MS = 5000;

/** Os conceitos programados de um vídeo; enquanto o worker prepara, pergunta de novo a cada 5 s. */
export function useConceitosDoVideo(midiaId: Id | null): Conceitos {
  const [dados, definir] = useState<{ estado: EstadoDosConceitos; conceitos: ConceitosDoVideoV1 | null }>({ estado: 'carregando', conceitos: null });
  /** Cresce a cada "Preparar": refaz a consulta (e a espera enquanto prepara). */
  const [pedidos, contar] = useState(0);
  useEffect(() => {
    if (midiaId === null) return;
    let ativo = true;
    let relogio = 0;
    const buscar = (): void => {
      void pedir<typeof dados>(`/api/midias/${midiaId}/conceitos`).then((r) => {
        if (!ativo) return;
        definir(r);
        if (r.estado === 'preparando') relogio = window.setTimeout(buscar, ESPERA_DO_PREPARO_MS);
      }, () => { if (ativo) definir({ estado: 'erro', conceitos: null }); });
    };
    buscar();
    return () => { ativo = false; window.clearTimeout(relogio); };
  }, [midiaId, pedidos]);
  const preparar = useCallback(() => {
    if (midiaId === null) return;
    definir((d) => ({ ...d, estado: 'preparando' }));
    void pedir(`/api/midias/${midiaId}/conceitos`, { method: 'POST' })
      .then(() => contar((n) => n + 1), () => definir((d) => ({ ...d, estado: 'falhou' })));
  }, [midiaId]);
  return { ...dados, preparar };
}

/**
 * A linha do popover do player: o estado das partes e dos momentos do vídeo. Eles vêm do "Analisar" da
 * página do documento (J142); o botão aqui só aparece quando ainda não foram feitos (ou falharam).
 */
export function PrepararConceitos({ conceitos }: { conceitos: Conceitos }): ReactNode {
  const { estado } = conceitos;
  const n = conceitos.conceitos?.conceitos.length ?? 0;
  const partes = conceitos.conceitos?.partes?.length ?? 0;
  const contagem = [partes === 0 ? null : partes === 1 ? '1 parte' : `${String(partes)} partes`,
    n === 0 ? 'nenhum momento' : n === 1 ? '1 momento' : `${String(n)} momentos`].filter(Boolean).join(' e ');
  return <div className="preparar-conceitos">
    <span>Partes e momentos do vídeo</span>
    {estado === 'pronto' ? <p>{`${contagem.charAt(0).toUpperCase()}${contagem.slice(1)}.`}</p>
      : estado === 'preparando' ? <p>Separando as partes e os momentos…</p>
        : estado === 'carregando' ? <p>…</p>
          : <>
            {estado === 'falhou' && <p>A última análise do vídeo falhou.</p>}
            {estado === 'erro' && <p>Não deu para ver os momentos agora.</p>}
            <Button variante="secundario" onClick={conceitos.preparar}>{estado === 'falhou' ? 'Tentar de novo' : 'Preparar partes e momentos'}</Button>
          </>}
  </div>;
}

const ROTULO_DO_TIPO: Record<NonNullable<ConceitoDoVideoV1['tipo']>, string> = { conceito: 'Conceito', dado: 'Dado', contexto: 'Contexto', pergunta: 'Pergunta' };

// ---------------------------------------------------------------- conceitos: a pílula

type Fase = 'bolinha' | 'pilula' | 'aberto' | 'saindo';
const PASSO_MS = 100;
const BOLINHA_MS = 200;
const SAIDA_MS = 460;
/** Quantas pílulas cabem empilhadas; a mais antiga sai quando chega outra. */
const MAXIMO_EMPILHADO = 3;
/** De quanto em quanto tempo o quadro é amostrado para escolher a região, enquanto há conceito por vir. */
export const AMOSTRA_DO_QUADRO_MS = 3000;
const LADO_DA_AMOSTRA = { largura: 64, altura: 36 } as const;

type ResultadoDaAmostra = Uint8ClampedArray | 'contaminado' | null;

/** Um quadro reduzido do vídeo, ou `'contaminado'` se o navegador recusa ler os pixels (outra origem). */
function amostrarQuadro(video: HTMLVideoElement, canvas: HTMLCanvasElement): ResultadoDaAmostra {
  if (video.readyState < 2 || video.videoWidth === 0) return null;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 'contaminado';
  try {
    ctx.drawImage(video, 0, 0, LADO_DA_AMOSTRA.largura, LADO_DA_AMOSTRA.altura);
    return ctx.getImageData(0, 0, LADO_DA_AMOSTRA.largura, LADO_DA_AMOSTRA.altura).data;
  } catch {
    return 'contaminado';
  }
}

/**
 * Amostra o quadro a cada 3 s enquanto `ativo` e guarda a ocupação suavizada; `regiaoAgora()` lê a
 * escolha sem renderizar de novo. Canvas contaminado (ou sem 2D): fica embaixo à esquerda para sempre.
 */
function useRegiaoDoQuadro(video: { current: HTMLVideoElement | null } | undefined, ativo: boolean): () => RegiaoDaPilula {
  const ocupacao = useRef<OcupacaoDoQuadro | null>(null);
  const desistiu = useRef(false);
  useEffect(() => {
    if (!ativo || !video || desistiu.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = LADO_DA_AMOSTRA.largura; canvas.height = LADO_DA_AMOSTRA.altura;
    let relogio = 0;
    const amostrar = (): void => {
      const v = video.current;
      if (!v) return;
      const pixels = amostrarQuadro(v, canvas);
      if (pixels === 'contaminado') { desistiu.current = true; ocupacao.current = null; window.clearInterval(relogio); return; }
      if (pixels) ocupacao.current = suavizarOcupacao(ocupacao.current, ocupacaoDoQuadro(pixels, LADO_DA_AMOSTRA.largura, LADO_DA_AMOSTRA.altura));
    };
    relogio = window.setInterval(amostrar, AMOSTRA_DO_QUADRO_MS);
    amostrar();
    return () => window.clearInterval(relogio);
  }, [ativo, video]);
  return useCallback(() => escolherRegiao(ocupacao.current), []);
}

export interface PropsDosConceitos {
  conceitos: readonly ConceitoDoVideoV1[];
  tempo: number;
  tocando: boolean;
  /** As marcas do capítulo: a pílula toma a cor do grifo que contém o trecho do conceito. */
  marcas?: readonly MarcaDoLeitor[];
  /** O vídeo, para amostrar o quadro e achar a imagem dentro das faixas pretas. */
  video?: { current: HTMLVideoElement | null };
  /** As linhas de legenda dos grifos (com o tempo de cada grifo falado), para a cor do grifo mais perto. */
  linhas?: readonly LinhaDeLegenda[];
  /** A legenda dos grifos está na tela: a pílula fica acima dela. */
  comLegenda?: boolean;
  aoIrAoTrecho: (conceito: ConceitoDoVideoV1) => void;
}

/**
 * Os conceitos sobre o vídeo: no instante, uma bolinha surge e vira uma pílula (timer-pizza na cor
 * do grifo + rótulo curto) por 15 s; dois ao mesmo tempo se empilham, o mais novo embaixo. A região
 * (rodapé à esquerda, no centro, à direita ou em cima) é a menos ocupada do quadro e só muda entre
 * uma leva de pílulas e a próxima.
 */
export function ConceitosNoVideo({ conceitos, tempo, tocando, marcas = [], linhas = [], video, comLegenda = false, aoIrAoTrecho }: PropsDosConceitos): ReactNode {
  const { daMarca } = usarFuncoes();
  const [vistos, definirVistos] = useState<ReadonlySet<Id>>(() => new Set());
  const [ativos, definirAtivos] = useState<readonly ConceitoDoVideoV1[]>([]);
  const [regiao, definirRegiao] = useState<RegiaoDaPilula>(REGIAO_PADRAO);
  const [folgas, definirFolgas] = useState({ x: 0, y: 0 });
  const porVir = conceitos.some((c) => !vistos.has(c.id) && tempo < c.instante_s + JANELA_DE_ENTRADA_S);
  const regiaoAgora = useRegiaoDoQuadro(video, porVir && tocando);

  // Voltar o vídeo para antes de um conceito faz ele valer de novo.
  useEffect(() => {
    definirVistos((v) => { const n = esquecerOsAdiante(v, conceitos, tempo); return n.size === v.size ? v : n; });
  }, [tempo, conceitos]);
  // No instante, entra a pílula; numa tela vazia, a região é escolhida de novo.
  useEffect(() => {
    const c = conceitoQueEntra(conceitos, tempo, vistos);
    if (!c) return;
    definirVistos((v) => new Set(v).add(c.id));
    if (ativos.length === 0) definirRegiao(regiaoAgora());
    definirAtivos((a) => [...a, c].slice(-MAXIMO_EMPILHADO));
  }, [tempo, conceitos, vistos, ativos.length, regiaoAgora]);
  // A imagem dentro das faixas pretas: medida com pílula na tela e de novo quando o quadro muda de
  // tamanho ("Só o vídeo", a alça de largura).
  const naTela = ativos.length > 0;
  useEffect(() => {
    const v = video?.current;
    if (!naTela || !v) return;
    const medir = (): void => {
      const f = folgasDoConteudo({ largura: v.clientWidth, altura: v.clientHeight }, { largura: v.videoWidth, altura: v.videoHeight });
      definirFolgas((a) => (a.x === f.x && a.y === f.y ? a : f));
    };
    medir();
    if (typeof ResizeObserver !== 'function') return;
    const observador = new ResizeObserver(medir);
    observador.observe(v);
    return () => observador.disconnect();
  }, [naTela, video]);
  const sair = useCallback((id: Id) => definirAtivos((a) => a.filter((c) => c.id !== id)), []);

  if (ativos.length === 0) return null;
  const estilo = { '--folga-x': `${String(folgas.x)}px`, '--folga-y': `${String(folgas.y)}px` } as CSSProperties;
  return <div className="conceitos-no-video" data-regiao={regiao} data-com-legenda={comLegenda ? 'sim' : undefined} style={estilo}>
    {ativos.map((c) => {
      const marca = marcaDaCor(c, marcas, linhas);
      return <PilulaDoConceito key={c.id} conceito={c} cor={marca ? daMarca(marca) : null} tocando={tocando} aoSair={sair} aoIrAoTrecho={aoIrAoTrecho} />;
    })}
  </div>;
}

function Pizza({ passou }: { passou: number }): ReactNode {
  return <svg className="pizza-do-conceito" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
    <circle className="disco" cx="12" cy="12" r="10.5" />
    {passou > 0 && <path className="setor" d={setorDaPizza(passou, 10.5)} />}
    <circle className="aro" cx="12" cy="12" r="10.5" />
  </svg>;
}

interface PropsDaPilula {
  conceito: ConceitoDoVideoV1;
  cor: string | null;
  tocando: boolean;
  aoSair: (id: Id) => void;
  aoIrAoTrecho: (conceito: ConceitoDoVideoV1) => void;
}

function PilulaDoConceito({ conceito, cor, tocando, aoSair, aoIrAoTrecho }: PropsDaPilula): ReactNode {
  const reduzido = useMemo(movimentoReduzido, []);
  const [fase, definirFase] = useState<Fase>(reduzido ? 'pilula' : 'bolinha');
  const [restante, definirRestante] = useState(DURACAO_DO_CARTAO_MS);
  const [sobre, definirSobre] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const cartao = useRef<HTMLDivElement>(null);
  /** Ao fechar o cartão, o foco volta para a pílula (se estava nele). */
  const devolverFoco = useRef(false);
  const curto = rotuloCurto(conceito);
  const tipo = ROTULO_DO_TIPO[conceito.tipo ?? 'conceito'];

  // A bolinha se transforma na pílula.
  useEffect(() => {
    if (fase !== 'bolinha') return;
    const relogio = window.setTimeout(() => definirFase('pilula'), BOLINHA_MS);
    return () => window.clearTimeout(relogio);
  }, [fase]);
  // O setor corre só com a pílula fechada, o vídeo tocando e o mouse fora.
  const correndo = fase === 'pilula' && tocando && !sobre;
  useEffect(() => {
    if (!correndo) return;
    const relogio = window.setInterval(() => definirRestante((r) => Math.max(0, r - PASSO_MS)), PASSO_MS);
    return () => window.clearInterval(relogio);
  }, [correndo]);
  useEffect(() => { if (fase === 'pilula' && restante <= 0) definirFase('saindo'); }, [fase, restante]);
  useEffect(() => {
    if (fase !== 'saindo') return;
    const relogio = window.setTimeout(() => aoSair(conceito.id), reduzido ? 160 : SAIDA_MS);
    return () => window.clearTimeout(relogio);
  }, [fase, reduzido, aoSair, conceito.id]);
  const fechar = useCallback(() => {
    devolverFoco.current = cartao.current?.contains(document.activeElement) ?? false;
    definirSobre(false);
    definirFase('pilula');
  }, []);
  useEffect(() => {
    if (fase === 'aberto') { cartao.current?.focus(); return; }
    if (fase === 'pilula' && devolverFoco.current) { devolverFoco.current = false; botao.current?.focus(); }
  }, [fase]);
  useEffect(() => {
    if (fase !== 'aberto') return;
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); fechar(); } };
    document.addEventListener('keydown', esc, true);
    return () => document.removeEventListener('keydown', esc, true);
  }, [fase, fechar]);

  const passou = 1 - restante / DURACAO_DO_CARTAO_MS;
  const estilo = (cor === null ? {} : { '--cor-do-conceito': cor }) as CSSProperties;
  const idDoTitulo = `conceito-${conceito.id}`;
  return <div className="conceito-no-video" data-fase={fase} data-passou={passou.toFixed(2)} style={estilo}
    onPointerEnter={() => definirSobre(true)} onPointerLeave={() => definirSobre(false)}>
    {fase === 'aberto'
      ? <div ref={cartao} className="cartao-do-conceito" role="group" aria-labelledby={idDoTitulo} tabIndex={-1}>
        <div className="cabeca-do-cartao"><Pizza passou={passou} /><p className="titulo-do-conceito"><span className="tipo-do-momento">{tipo}</span>{' '}<span id={idDoTitulo}>{conceito.titulo}</span></p></div>
        <p>{conceito.explicacao}</p>
        <blockquote>“{conceito.ancora.citacao}”</blockquote>
        <div className="acoes-do-conceito">
          <Button variante="secundario" onClick={() => { aoIrAoTrecho(conceito); definirFase('saindo'); }}>Ir ao trecho</Button>
          <Button variante="ghost" onClick={fechar}>Fechar</Button>
        </div>
      </div>
      : <button ref={botao} type="button" className="pilula-do-conceito" aria-label={`${tipo}: ${conceito.titulo}`}
        tabIndex={fase === 'saindo' ? -1 : undefined} onClick={() => { if (fase === 'pilula' || fase === 'bolinha') definirFase('aberto'); }}>
        <Pizza passou={passou} />
        <span className="rotulo-da-pilula">{curto}</span>
      </button>}
  </div>;
}
