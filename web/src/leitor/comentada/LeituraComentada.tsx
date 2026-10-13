/**
 * Leitura comentada integral (J92, `docs/jobs/J92-SPEC.md`): a voz lê o capítulo inteiro, frase por
 * frase, com karaokê palavra por palavra no próprio texto do livro (a faixa da frase e o bloco da
 * palavra pelo serviço comum `../karaoke/`, sem mexer no DOM nem nas marcas), e a rolagem acompanha.
 * Com voz, a palavra anda no tempo real do alinhamento; sem voz, no tempo estimado pelo tamanho dela. Onde há um
 * grifo ou uma relação, a leitura **para**: o texto não avança, o trecho rola para o terço de cima e os grifos e braquetes dele acendem (e,
 * numa relação, o outro lado), as marcas das fontes acendem, o painel mostra o comentário, e a voz
 * retoma a leitura exatamente de onde parou.
 *
 * Controles: tocar/pausar, frase anterior/seguinte (← →; no comentário, → pula o comentário),
 * comentário anterior, pular comentário, comentários ligados/desligados (C), velocidade, pular
 * capítulo (Shift+→), sair (Esc). Retomada por documento; ao fim, segue para o próximo capítulo.
 * A barra lateral é a da leitura guiada (J31/J91).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { AncoraV1, LeituraComentadaV1, ModeloDoCapituloV1, NarracaoDaLeituraV1, PausaDaLeituraV1, TrechoTemporizado } from '@margem/contratos';
import {
  etapaDaLeituraNoInstante, fimDaPausa, montarSequenciaDaLeitura, palavraNoInstante, pausaAnterior, proximaPausa, saltarFrase, type EtapaDaLeitura,
} from '@margem/core/leitura-comentada';
import { frasesDaFala } from '@margem/core/visita';
import { BotaoDeTocar, BotaoDoPlayer, CartaoNoTexto, PlayerCentral, TrilhaCentral, formatarTempo } from '../player/PlayerCentral';
import { arquivoDaNarracaoDaLeitura } from '../../biblioteca/api';
import type { ApiDoLeitor } from '../tipos';
import type { MarcaDoLeitor } from '../f2';
import type { FocoDoPasso } from '../compreensao/foco';
import { faixaDaAncora } from '../compreensao/geometria';
import { intervaloDoTrecho } from '../karaoke/karaoke';
import { useKaraoke, VoltarAoTrecho } from '../karaoke/VoltarAoTrecho';
import {
  comentariosLigados, gravarComentariosLigados, gravarPontoDaLeitura, lerPontoDaLeitura, pedirContinuacaoDaLeitura,
} from './retomada';
import '../visita/visita.css';
import './comentada.css';
import { useSessaoDeMidia } from '../player/useSessaoDeMidia';
import { atalhoDeUmaTeclaDesligado, digitando } from '../teclado/comandos';

export interface FocoDaLeitura extends FocoDoPasso { ancora: AncoraV1 | null }

export interface PropsDaLeituraComentada {
  leitura: LeituraComentadaV1;
  narracao: NarracaoDaLeituraV1 | null;
  modelo: ModeloDoCapituloV1 | null;
  documentoId: string;
  tituloDocumento?: string | undefined;
  leitor: RefObject<ApiDoLeitor | null>;
  /** Onde está o texto do capítulo (para o karaokê). */
  raiz: HTMLElement | null;
  marcas?: readonly MarcaDoLeitor[];
  tocarAoAbrir?: boolean;
  aoSair: () => void;
  aoCitar: (ancora: AncoraV1) => void;
  aoMudarFoco?: (foco: FocoDaLeitura | null) => void;
  aoIrCapitulo?: (secaoId: string) => void;
}

const VELOCIDADES = [0.75, 1, 1.25, 1.5, 1.75] as const;
const CHAVE_DA_VELOCIDADE = 'margem:comentada:velocidade';
const CLASSE_DO_KARAOKE = 'com-leitura-comentada';
const SEM_MARCAS: readonly MarcaDoLeitor[] = [];
const ROTULO_DA_RELACAO: Record<string, string> = {
  suporta: 'suporta', desenvolve: 'desenvolve', pressupoe: 'pressupõe', contrasta: 'contrasta', exemplifica: 'exemplifica',
  retoma: 'retoma', responde: 'responde', tensiona: 'tensiona', ecoa: 'ecoa',
};

function lerVelocidade(): number {
  try { const v = Number(localStorage.getItem(CHAVE_DA_VELOCIDADE)); return (VELOCIDADES as readonly number[]).includes(v) ? v : 1; } catch { return 1; }
}
const mesmaAncora = (a: AncoraV1, b: AncoraV1): boolean => a.bloco_id === b.bloco_id && a.inicio_utf16 === b.inicio_utf16 && a.fim_utf16 === b.fim_utf16;
const movimentoReduzido = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function LeituraComentada({
  leitura, narracao, modelo, documentoId, tituloDocumento, leitor, raiz, marcas = SEM_MARCAS, tocarAoAbrir = false, aoSair, aoCitar, aoMudarFoco, aoIrCapitulo,
}: PropsDaLeituraComentada): ReactNode {
  const sequencia = useMemo(() => montarSequenciaDaLeitura(leitura, narracao), [leitura, narracao]);
  const [semVoz, definirSemVoz] = useState(false);
  const narrada = sequencia.narrada && narracao !== null && !semVoz;
  const inicial = useMemo(() => {
    const ponto = lerPontoDaLeitura(documentoId);
    if (!ponto || ponto.secao_id !== leitura.secao_id || ponto.leitura_id !== leitura.id || tocarAoAbrir) return 0;
    return etapaDaLeituraNoInstante(sequencia, ponto.t)?.inicio_s ?? 0;
  }, []);
  const [t, definirT] = useState(inicial);
  const [tocando, definirTocando] = useState(false);
  const [velocidade, definirVelocidade] = useState(lerVelocidade);
  const [comentarios, definirComentarios] = useState(comentariosLigados);
  const [seguir, definirSeguir] = useState(true);
  const [terminou, definirTerminou] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const relogio = useRef({ t: inicial, ultimo: 0, quadro: 0, desenhado: inicial, etapa: -1 });
  const refs = useRef({ comentarios, seguir });
  refs.current = { comentarios, seguir };
  const etapa = etapaDaLeituraNoInstante(sequencia, t);
  const pausa: PausaDaLeituraV1 | null = etapa?.pausa ?? null;
  const pausas = useMemo(() => sequencia.etapas.filter((e) => e.tipo === 'pausa'), [sequencia]);
  const trechoPorId = useMemo(() => new Map(leitura.trechos.map((trecho) => [trecho.id, trecho])), [leitura]);
  /** A frase lida (ou, no comentário, a frase em que a leitura parou). */
  const trechoAtual = etapa?.trecho ?? (pausa ? trechoPorId.get(pausa.depois_de) ?? null : null);

  // ------------------------------------------------------------ classe do karaokê
  // Sem barra lateral (Player v2): o controle é a pílula central e o comentário fica no documento, então
  // a coluna do texto não se desloca (antes, `--largura-guiada` a empurrava e as braquetes mediam errado).
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.classList.add(CLASSE_DO_KARAOKE);
    return () => { html.classList.remove(CLASSE_DO_KARAOKE); };
  }, []);

  // ------------------------------------------------------------ relógio: a voz, ou o ritmo de leitura
  const passar = useCallback((novo: number) => {
    const limitado = Math.min(Math.max(0, novo), sequencia.duracao_s);
    relogio.current.t = limitado;
    if (audio.current && narrada) audio.current.currentTime = limitado;
    definirT(limitado);
    definirTerminou(false);
    definirSeguir(true);
  }, [sequencia.duracao_s, narrada]);

  const tocar = useCallback(() => {
    if (relogio.current.t >= sequencia.duracao_s - 0.05) passar(0);
    if (audio.current && narrada) {
      audio.current.playbackRate = velocidade;
      void audio.current.play().then(() => definirTocando(true), () => definirTocando(false));
    } else definirTocando(true);
  }, [narrada, velocidade, sequencia.duracao_s, passar]);
  const pausar = useCallback(() => { audio.current?.pause(); definirTocando(false); }, []);

  useEffect(() => { if (audio.current) audio.current.playbackRate = velocidade; try { localStorage.setItem(CHAVE_DA_VELOCIDADE, String(velocidade)); } catch { /* sem storage */ } }, [velocidade]);

  const seguirCapitulo = useCallback(() => {
    pausar();
    if (leitura.proxima_secao_id && aoIrCapitulo) {
      gravarPontoDaLeitura(documentoId, { secao_id: leitura.proxima_secao_id, leitura_id: '', t: 0 });
      pedirContinuacaoDaLeitura(documentoId, leitura.proxima_secao_id);
      aoIrCapitulo(leitura.proxima_secao_id);
    }
  }, [pausar, leitura, aoIrCapitulo, documentoId]);
  const terminar = useRef(() => { /* definido abaixo */ });
  terminar.current = () => { definirTocando(false); definirTerminou(true); if (leitura.proxima_secao_id && aoIrCapitulo) seguirCapitulo(); };

  useEffect(() => {
    if (!tocando) return undefined;
    relogio.current.ultimo = performance.now();
    const passo = (agora: number): void => {
      const r = relogio.current;
      if (audio.current && narrada) r.t = audio.current.currentTime;
      else r.t = Math.min(sequencia.duracao_s, r.t + ((agora - r.ultimo) / 1000) * velocidade);
      r.ultimo = agora;
      // Comentários desligados: a leitura salta a pausa inteira.
      const aqui = etapaDaLeituraNoInstante(sequencia, r.t);
      if (!refs.current.comentarios && aqui?.tipo === 'pausa') {
        r.t = fimDaPausa(sequencia, aqui);
        if (audio.current && narrada) audio.current.currentTime = r.t;
      }
      desenharKaraoke.current(r.t);
      // O React só redesenha o player umas quatro vezes por segundo (ou quando a etapa muda); a palavra anda pela camada.
      const etapaAgora = etapaDaLeituraNoInstante(sequencia, r.t)?.indice ?? -1;
      if (Math.abs(r.t - r.desenhado) >= 0.25 || etapaAgora !== r.etapa) { r.desenhado = r.t; r.etapa = etapaAgora; definirT(r.t); }
      if (!narrada && r.t >= sequencia.duracao_s) { definirT(r.t); terminar.current(); return; }
      r.quadro = requestAnimationFrame(passo);
    };
    relogio.current.quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(relogio.current.quadro);
  }, [tocando, narrada, velocidade, sequencia]);

  useEffect(() => { if (tocarAoAbrir) tocar(); }, []);

  // Onde parou: a cada etapa nova, e ao sair.
  const indiceDaEtapa = etapa?.indice ?? 0;
  useEffect(() => { gravarPontoDaLeitura(documentoId, { secao_id: leitura.secao_id, leitura_id: leitura.id, t: relogio.current.t }); }, [indiceDaEtapa, documentoId, leitura]);
  useEffect(() => () => { gravarPontoDaLeitura(documentoId, { secao_id: leitura.secao_id, leitura_id: leitura.id, t: relogio.current.t }); }, []);

  // ------------------------------------------------------------ karaokê e rolagem
  const frase: TrechoTemporizado | null = trechoAtual ? { bloco_id: trechoAtual.bloco_id, inicio_utf16: trechoAtual.inicio_utf16, fim_utf16: trechoAtual.fim_utf16, inicio_s: 0, fim_s: 0 } : null;
  const { karaoke, fora } = useKaraoke();
  /** A faixa da frase e a palavra no instante; no comentário, o grifo e o braquete destacam e a faixa sai. */
  const desenharKaraoke = useRef<(instante: number) => void>(() => { /* definido abaixo */ });
  desenharKaraoke.current = (instante: number) => {
    const aqui = etapaDaLeituraNoInstante(sequencia, instante);
    karaoke.current?.definir(raiz, aqui?.trecho
      ? { frase: aqui.trecho, palavra: palavraNoInstante(sequencia, aqui, instante), modo: 'palavra' }
      : { frase: null, palavra: null, modo: 'nenhum' });
  };
  useEffect(() => { desenharKaraoke.current(relogio.current.t); }, [t, raiz, sequencia]);

  // A frase nova vai para ~38 % da altura (a não ser que o leitor tenha rolado por conta própria).
  useEffect(() => {
    if (!raiz || !frase || pausa || !refs.current.seguir) return;
    const caixa = intervaloDoTrecho(raiz, frase)?.getBoundingClientRect();
    if (!caixa || caixa.height === 0) return;
    const alvo = window.innerHeight * 0.38;
    if (caixa.top < 72 || caixa.bottom > window.innerHeight * 0.72) window.scrollBy({ top: caixa.top - alvo, behavior: movimentoReduzido() ? 'auto' : 'smooth' });
  }, [trechoAtual?.id, raiz, pausa]);
  useEffect(() => {
    const soltar = (evento: Event): void => { if (!(evento.target instanceof Element && evento.target.closest('.player-central, .cartao-no-texto'))) definirSeguir(false); };
    window.addEventListener('wheel', soltar, { passive: true });
    window.addEventListener('touchmove', soltar, { passive: true });
    return () => { window.removeEventListener('wheel', soltar); window.removeEventListener('touchmove', soltar); };
  }, []);

  // ------------------------------------------------------------ foco do comentário: marcas e chaves acesas (sem véu nem caixa: o grifo e o braquete já destacam)
  const elementos = useMemo(() => new Map((modelo?.elementos ?? []).map((e) => [e.id, e])), [modelo]);
  const relacoes = useMemo(() => new Map((modelo?.relacoes ?? []).map((r) => [r.id, r])), [modelo]);
  const foco = useMemo((): FocoDaLeitura | null => {
    if (!pausa) return null;
    const marcaDe = (ancora: AncoraV1 | undefined) => (ancora ? marcas.find((m) => mesmaAncora(m.ancora, ancora))?.id : undefined);
    const grifos = pausa.fontes.filter((f) => f.tipo === 'grifo').map((f) => f.id).filter((id) => marcas.some((m) => m.id === id));
    const idsRelacoes = pausa.fontes.filter((f) => f.tipo === 'relacao').map((f) => f.id).filter((id) => relacoes.has(id));
    const pontas = idsRelacoes.flatMap((id) => { const r = relacoes.get(id)!; return [r.origem_id, r.destino_id]; }).map((id) => marcaDe(elementos.get(id)?.ancoras[0]));
    const acesas = [...new Set([...grifos, ...pontas.filter((m): m is string => m !== undefined), ...pausa.foco.map(marcaDe).filter((m): m is string => m !== undefined)])];
    return { marcas: acesas, ativa: marcaDe(pausa.foco[0]) ?? grifos[0] ?? null, relacoes: idsRelacoes, destacada: idsRelacoes[0] ?? null, ancora: pausa.foco[0] ?? null };
  }, [pausa, marcas, elementos, relacoes]);
  const chaveDoFoco = `${pausa?.id ?? ''}|${foco?.marcas.join(',') ?? ''}`;
  useEffect(() => { aoMudarFoco?.(foco); }, [chaveDoFoco]);
  useEffect(() => () => aoMudarFoco?.(null), []);

  // Comentário novo: o trecho comentado vai para o terço de cima (com a ponta, se couber).
  useLayoutEffect(() => {
    // Com relação, quem posiciona é o braquete (como no Percorrer): ele rola até a ponta de cima e dobra
    // o texto entre as duas. Rolar aqui também tirava a ponta de cima da tela.
    if (pausa && pausa.pontas.length === 0) {
      const alvo = faixaDaAncora(leitor.current, pausa.foco[0]!);
      if (alvo) window.scrollBy({ top: alvo.topo - window.innerHeight * (window.innerWidth < 600 ? 0.12 : 0.28), behavior: movimentoReduzido() ? 'auto' : 'smooth' });
    }
  }, [pausa?.id]);

  // ------------------------------------------------------------ controles
  const irAoComentario = useCallback((alvo: EtapaDaLeitura | null) => { if (alvo) passar(alvo.inicio_s); }, [passar]);
  const pularComentario = useCallback(() => {
    if (etapa?.tipo === 'pausa') passar(fimDaPausa(sequencia, etapa));
    else irAoComentario(proximaPausa(sequencia, relogio.current.t));
  }, [etapa, sequencia, passar, irAoComentario]);
  const comentarioAnterior = useCallback(() => irAoComentario(pausaAnterior(sequencia, relogio.current.t)), [sequencia, irAoComentario]);
  const alternarComentarios = useCallback(() => definirComentarios((atual) => { gravarComentariosLigados(!atual); return !atual; }), []);
  const frasePara = useCallback((sentido: 1 | -1) => {
    const destino = saltarFrase(sequencia, relogio.current.t, sentido);
    if (destino >= sequencia.duracao_s && sentido === 1) { if (leitura.proxima_secao_id) seguirCapitulo(); return; }
    passar(destino);
  }, [sequencia, passar, seguirCapitulo, leitura.proxima_secao_id]);
  useSessaoDeMidia({
    ativa: narrada, titulo: tituloDocumento ?? leitura.capitulo.titulo, capitulo: leitura.capitulo.titulo,
    tocando, tempo: t, duracao: sequencia.duracao_s, velocidade, tocar, pausar, buscar: passar,
    instante: () => audio.current?.currentTime ?? relogio.current.t,
    anterior: () => frasePara(-1), proximo: () => frasePara(1),
  });

  useEffect(() => {
    const teclar = (evento: KeyboardEvent): void => {
      if (digitando(evento.target)) return;
      if (evento.ctrlKey || evento.metaKey || evento.altKey || atalhoDeUmaTeclaDesligado(evento)) return;
      const tecla = evento.key.toLowerCase();
      if (evento.key === ' ' || tecla === 'k') { evento.preventDefault(); if (tocando) pausar(); else tocar(); }
      else if (evento.key === 'ArrowRight' && evento.shiftKey) { evento.preventDefault(); seguirCapitulo(); }
      else if (evento.key === 'ArrowRight') { evento.preventDefault(); frasePara(1); }
      else if (evento.key === 'ArrowLeft') { evento.preventDefault(); frasePara(-1); }
      else if (tecla === 'c') { evento.preventDefault(); alternarComentarios(); }
      else if (evento.key === 'Escape') { pausar(); aoSair(); }
    };
    window.addEventListener('keydown', teclar);
    return () => window.removeEventListener('keydown', teclar);
  }, [tocando, tocar, pausar, frasePara, seguirCapitulo, alternarComentarios, aoSair]);

  // ------------------------------------------------------------ desenho

  const ordemDaPausa = pausa ? pausas.findIndex((e) => e.id === pausa.id) + 1 : 0;
  const frasesDoComentario = pausa ? frasesDaFala(pausa.texto) : [];
  const fracao = etapa && pausa ? Math.min(1, Math.max(0, (t - etapa.inicio_s) / Math.max(0.01, etapa.fim_s - etapa.inicio_s))) : 0;
  const fraseAtual = Math.max(0, frasesDoComentario.findIndex((f) => fracao < f.fim));
  const seguinte = pausa ? null : proximaPausa(sequencia, t);
  const lidas = etapa ? sequencia.etapas.slice(0, etapa.indice + 1).filter((e) => e.tipo === 'trecho').length : 0;
  const fonte = narracao && sequencia.narrada && !semVoz ? arquivoDaNarracaoDaLeitura(narracao.id) : null;
  const relacaoDe = (id: string) => relacoes.get(id);
  const rotuloDaFonte = (f: PausaDaLeituraV1['fontes'][number]): string => {
    if (f.tipo === 'grifo') {
      const marca = marcas.find((m) => m.id === f.id);
      return `Grifo${marca && 'funcao' in marca ? ` · ${String(marca.funcao)}` : ''}`;
    }
    const r = relacaoDe(f.id);
    return `Relação${r ? ` · ${ROTULO_DA_RELACAO[r.tipo] ?? r.tipo}` : ''}`;
  };

  const estadoDaVoz = narrada ? 'voz · palavra a palavra' : 'sem voz · ritmo de leitura';
  const voltarAoTrecho = () => { definirSeguir(true); karaoke.current?.rolarAteAFrase(movimentoReduzido() ? 'auto' : 'smooth'); };
  return <>
    {fonte && <audio ref={audio} src={fonte} preload="auto" onLoadedMetadata={(evento) => { evento.currentTarget.currentTime = relogio.current.t; evento.currentTarget.playbackRate = velocidade; }}
      onEnded={() => terminar.current()} onError={() => { definirSemVoz(true); definirTocando(false); }} />}
    {/* O comentário do professor, dentro do documento, ao lado do trecho comentado. */}
    {pausa && <CartaoNoTexto ancora={pausa.foco[0] ?? null} leitor={leitor} rotulo="Comentário do professor" className="comentario-no-texto">
      <span className="eyebrow">Comentário do professor</span>
      <p className="fontes-no-texto fontes-do-comentario">{pausa.fontes.map((f) => <span key={f.tipo + f.id} className={`fonte-${f.tipo}`}>{rotuloDaFonte(f)}</span>)}</p>
      <p className="fala-no-texto fala-comentada" aria-live="polite">
        {frasesDoComentario.map((f, i) => <span key={String(i)} className={i < fraseAtual ? 'frase-dita' : i === fraseAtual ? 'frase-atual' : 'frase-por-vir'}>{f.texto}</span>)}
      </p>
      {pausa.pontas.slice(0, 3).map((ponta) => <button key={`${ponta.bloco_id}:${String(ponta.inicio_utf16)}`} type="button" className="ponta-no-texto" onClick={() => { pausar(); aoCitar(ponta); }}>
        <span className="eyebrow">Volta a</span>
        <span>“{ponta.citacao.slice(0, 140)}{ponta.citacao.length > 140 ? '…' : ''}”</span>
      </button>)}
    </CartaoNoTexto>}
    <VoltarAoTrecho visivel={!seguir && fora && !pausa} acimaDe=".player-comentada" aoVoltar={voltarAoTrecho} />
    <PlayerCentral rotulo="Leitura comentada" className="player-comentada">
      <TrilhaCentral rotulo="Posição na leitura" t={t} duracao={sequencia.duracao_s} marcas={pausas.map((e) => e.inicio_s)} aoPassar={passar} />
      <div className="linha-do-player">
        <div className="esquerda-do-player">
          <span className="titulo-do-player">Leitura comentada · Cap. {leitura.capitulo.numero} de {leitura.capitulo.total}</span>
          <span className="detalhe-do-player" aria-live="off">
            <span>{pausa ? `Comentário ${String(ordemDaPausa)} de ${String(pausas.length)}` : `Lendo · frase ${String(lidas)} de ${String(leitura.trechos.length)}`}</span>
            {' · '}<span>{estadoDaVoz}</span>
            {!pausa && !comentarios && <>{' · '}<span>Comentários desligados: só a leitura.</span></>}
            {!pausa && comentarios && seguinte && <>{' · '}<span>próximo comentário em {formatarTempo(Math.max(0, seguinte.inicio_s - t))}</span></>}
            {terminou && !leitura.proxima_secao_id && <>{' · '}<span role="status">Fim da leitura deste livro.</span></>}
          </span>
        </div>
        <div className="centro-do-player">
          <BotaoDoPlayer icone="voltar-trecho" rotulo="Comentário anterior" onClick={comentarioAnterior} />
          <BotaoDeTocar tocando={tocando} aoAlternar={() => { if (tocando) pausar(); else tocar(); }} />
          <BotaoDoPlayer icone="avancar-trecho" rotulo={pausa ? 'Pular comentário' : 'Ir ao próximo comentário'} onClick={pularComentario} />
        </div>
        <div className="direita-do-player">
          <button type="button" className="velocidade-central" aria-label="Velocidade" data-dica="Velocidade" onClick={() => definirVelocidade((atual) => VELOCIDADES[(VELOCIDADES.indexOf(atual as (typeof VELOCIDADES)[number]) + 1) % VELOCIDADES.length]!)}>{String(velocidade).replace('.', ',')}×</button>
          <BotaoDoPlayer icone={comentarios ? 'comentario' : 'sem-comentarios'} rotulo={comentarios ? 'Desligar os comentários' : 'Ligar os comentários'} atalho="C" pressionado={comentarios} onClick={alternarComentarios} />
          <BotaoDoPlayer icone="pular" rotulo="Pular capítulo" atalho="Shift →" disabled={!leitura.proxima_secao_id || !aoIrCapitulo} onClick={seguirCapitulo} />
          <BotaoDoPlayer icone="xis" rotulo="Sair da leitura comentada" atalho="Esc" onClick={() => { pausar(); aoSair(); }} />
        </div>
      </div>
    </PlayerCentral>
  </>;
}
