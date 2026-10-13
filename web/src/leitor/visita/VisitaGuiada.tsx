/**
 * Visita guiada do livro (J91, `docs/jobs/J91-SPEC.md`): o capítulo como uma sequência narrada —
 * abertura, paradas, fechamento e ponte para o próximo — tocada com a voz da fábrica (ou, sem voz, no
 * ritmo de leitura em voz alta).
 *
 * A cada parada, o foco muda: o texto rola até o trecho e as marcas da parada acendem (as outras
 * recuam); numa relação, a chave acende até a outra ponta. Sem véu e sem caixa: o grifo e o braquete já
 * se destacam pelas próprias funções (decisão de produto, 30/09). "Ler o trecho inteiro" pausa e rola
 * até o trecho todo da parada. Tudo passa por `ApiDoLeitor`, então vale igual para texto corrido e PDF.
 *
 * Os controles ficam no player central inferior (Player v2) e a fala em curso, com a frase acesa, num
 * cartão dentro do documento, ao lado do trecho da parada. O texto do livro não recebe karaokê: a fala é
 * comentário, não leitura do texto.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { AncoraV1, Bloco, ModeloDoCapituloV1, NarracaoDaVisitaV1, ParadaDoRoteiroV1, RoteiroGuiadoV1 } from '@margem/contratos';
import { etapaNoInstante, frasesDaFala, fraseNoInstante, montarSequenciaDaVisita, saltarParada } from '@margem/core/visita';
import { BotaoDeTocar, BotaoDoPlayer, CartaoNoTexto, PlayerCentral, TrilhaCentral } from '../player/PlayerCentral';
import { arquivoDaNarracao } from '../../biblioteca/api';
import type { ApiDoLeitor } from '../tipos';
import type { MarcaDoLeitor } from '../f2';
import type { FocoDoPasso } from '../compreensao/foco';
import { ancoraDoBloco, faixaDaAncora, faixaDosBlocos, type Faixa } from '../compreensao/geometria';
import { gravarPonto, lerPonto, pedirContinuacao } from './retomada';
import './visita.css';
import { atalhoDeUmaTeclaDesligado, digitando } from '../teclado/comandos';

export interface FocoDaVisita extends FocoDoPasso { ancora: AncoraV1 | null }

export interface PropsDaVisita {
  roteiro: RoteiroGuiadoV1;
  narracao: NarracaoDaVisitaV1 | null;
  modelo: ModeloDoCapituloV1 | null;
  documentoId: string;
  versaoId: string;
  blocos: readonly Pick<Bloco, 'id' | 'texto'>[];
  leitor: RefObject<ApiDoLeitor | null>;
  marcas?: readonly MarcaDoLeitor[];
  /** Começar tocando (o capítulo anterior terminou e pediu para continuar). */
  tocarAoAbrir?: boolean;
  aoSair: () => void;
  aoCitar: (ancora: AncoraV1) => void;
  aoMudarFoco?: (foco: FocoDaVisita | null) => void;
  /** Abre outro capítulo (o próximo, ao fim da ponte ou em "pular capítulo"). */
  aoIrCapitulo?: (secaoId: string) => void;
}

export const ROTULO_DA_PARADA: Record<ParadaDoRoteiroV1['tipo'], string> = {
  tese: 'Tese', conceito: 'Conceito', argumento: 'Argumento', exemplo: 'Exemplo', relacao: 'Relação', retorno: 'Relação que volta',
  dificuldade: 'Dificuldade', visual: 'Visual', nota: 'Sua nota', pergunta: 'Pergunta',
};
const VELOCIDADES = [0.75, 1, 1.25, 1.5] as const;
const CHAVE_DA_VELOCIDADE = 'margem:visita:velocidade';
const SEM_MARCAS: readonly MarcaDoLeitor[] = [];

function lerVelocidade(): number {
  try { const v = Number(localStorage.getItem(CHAVE_DA_VELOCIDADE)); return (VELOCIDADES as readonly number[]).includes(v) ? v : 1; } catch { return 1; }
}
const mesmaAncora = (a: AncoraV1, b: AncoraV1): boolean => a.bloco_id === b.bloco_id && a.inicio_utf16 === b.inicio_utf16 && a.fim_utf16 === b.fim_utf16;
export function formatarTempo(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}


export function VisitaGuiada({
  roteiro, narracao, modelo, documentoId, versaoId, blocos, leitor, marcas = SEM_MARCAS, tocarAoAbrir = false, aoSair, aoCitar, aoMudarFoco, aoIrCapitulo,
}: PropsDaVisita): ReactNode {
  const sequencia = useMemo(() => montarSequenciaDaVisita(roteiro, narracao), [roteiro, narracao]);
  const [semVoz, definirSemVoz] = useState(false);
  const narrada = sequencia.narrada && narracao !== null && !semVoz;
  const inicial = useMemo(() => {
    const ponto = lerPonto(documentoId);
    if (!ponto || ponto.secao_id !== roteiro.secao_id || ponto.roteiro_id !== roteiro.id || tocarAoAbrir) return 0;
    // Retoma do começo da fala em que parou.
    return etapaNoInstante(sequencia, ponto.t)?.inicio_s ?? 0;
  }, []);
  const [t, definirT] = useState(inicial);
  const [tocando, definirTocando] = useState(false);
  const [velocidade, definirVelocidade] = useState(lerVelocidade);
  const [trechoInteiro, definirTrechoInteiro] = useState(false);
  const [terminou, definirTerminou] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const relogio = useRef({ t: inicial, ultimo: 0, quadro: 0 });
  const etapa = etapaNoInstante(sequencia, t);
  const parada = etapa?.parada ? roteiro.paradas[etapa.parada - 1] ?? null : null;
  const total = roteiro.paradas.length;

  // ------------------------------------------------------------ relógio: a voz, ou o ritmo de leitura
  const passar = useCallback((novo: number) => {
    const limitado = Math.min(Math.max(0, novo), sequencia.duracao_s);
    relogio.current.t = limitado;
    if (audio.current && narrada) audio.current.currentTime = limitado;
    definirT(limitado);
    definirTerminou(false);
  }, [sequencia.duracao_s, narrada]);

  const tocar = useCallback(() => {
    definirTrechoInteiro(false);
    if (relogio.current.t >= sequencia.duracao_s - 0.05) passar(0);
    if (audio.current && narrada) {
      audio.current.playbackRate = velocidade;
      void audio.current.play().then(() => definirTocando(true), () => definirTocando(false));
    } else {
      definirTocando(true);
    }
  }, [narrada, velocidade, sequencia.duracao_s, passar]);
  const pausar = useCallback(() => { audio.current?.pause(); definirTocando(false); }, []);

  useEffect(() => { if (audio.current) audio.current.playbackRate = velocidade; try { localStorage.setItem(CHAVE_DA_VELOCIDADE, String(velocidade)); } catch { /* sem storage */ } }, [velocidade]);

  useEffect(() => {
    if (!tocando) return undefined;
    relogio.current.ultimo = performance.now();
    const passo = (agora: number) => {
      const r = relogio.current;
      if (audio.current && narrada) r.t = audio.current.currentTime;
      else r.t = Math.min(sequencia.duracao_s, r.t + ((agora - r.ultimo) / 1000) * velocidade);
      r.ultimo = agora;
      definirT(r.t);
      if (!narrada && r.t >= sequencia.duracao_s) { terminar.current(); return; }
      r.quadro = requestAnimationFrame(passo);
    };
    relogio.current.quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(relogio.current.quadro);
  }, [tocando, narrada, velocidade, sequencia.duracao_s]);

  useEffect(() => { if (tocarAoAbrir) tocar(); }, []);

  // Onde parou: a cada fala nova, e ao sair.
  const indiceDaEtapa = etapa?.indice ?? 0;
  useEffect(() => { gravarPonto(documentoId, { secao_id: roteiro.secao_id, roteiro_id: roteiro.id, t: relogio.current.t }); }, [indiceDaEtapa, documentoId, roteiro]);
  useEffect(() => () => { gravarPonto(documentoId, { secao_id: roteiro.secao_id, roteiro_id: roteiro.id, t: relogio.current.t }); }, []);

  // Fim do capítulo: segue para o próximo, que abre a visita já tocando.
  const seguir = useCallback(() => {
    pausar();
    if (roteiro.proxima_secao_id && aoIrCapitulo) {
      gravarPonto(documentoId, { secao_id: roteiro.proxima_secao_id, roteiro_id: '', t: 0 });
      pedirContinuacao(documentoId, roteiro.proxima_secao_id);
      aoIrCapitulo(roteiro.proxima_secao_id);
    }
  }, [pausar, roteiro, aoIrCapitulo, documentoId]);
  const terminar = useRef(() => { /* definido abaixo */ });
  terminar.current = () => { definirTocando(false); definirTerminou(true); if (roteiro.proxima_secao_id && aoIrCapitulo) seguir(); };

  // ------------------------------------------------------------ foco: marcas e chaves acesas (sem véu nem caixa)
  const elementos = useMemo(() => new Map((modelo?.elementos ?? []).map((e) => [e.id, e])), [modelo]);
  const relacoes = useMemo(() => new Map((modelo?.relacoes ?? []).map((r) => [r.id, r])), [modelo]);
  const foco = useMemo((): FocoDaVisita | null => {
    if (!parada) return null;
    const marcaDe = (ancora: AncoraV1 | undefined) => ancora ? marcas.find((m) => mesmaAncora(m.ancora, ancora))?.id : undefined;
    const pontas = parada.relacoes.flatMap((id) => { const r = relacoes.get(id); return r ? [r.origem_id, r.destino_id] : []; });
    const ids = [...new Set([...parada.elementos, ...pontas])];
    const acesas = [...new Set([...ids.map((id) => marcaDe(elementos.get(id)?.ancoras[0])), marcaDe(parada.foco)].filter((m): m is string => m !== undefined))];
    return { marcas: acesas, ativa: marcaDe(parada.foco) ?? null, relacoes: parada.relacoes.filter((id) => relacoes.has(id)), destacada: parada.relacoes[0] ?? null, ancora: null };
  }, [parada, marcas, elementos, relacoes]);
  const chaveDoFoco = `${String(parada?.ordem ?? 0)}|${foco?.marcas.join(',') ?? ''}`;
  useEffect(() => { aoMudarFoco?.(foco); }, [chaveDoFoco]);
  useEffect(() => () => aoMudarFoco?.(null), []);


  // Parada nova (ou o trecho inteiro): o foco vai para o terço de cima da tela.
  const papelNaAbertura = etapa?.fala.papel === 'abertura';
  const ordemDaParada = parada?.ordem ?? 0;
  useLayoutEffect(() => {
    const api = leitor.current;
    let alvo: Faixa | null = null;
    // Parada com relação: quem posiciona é o braquete (rola até a ponta de cima e dobra o texto do meio).
    if (parada && !trechoInteiro && parada.relacoes.length > 0) return;
    if (parada) alvo = trechoInteiro ? faixaDosBlocos(api, versaoId, blocos, parada.bloco_inicio, parada.bloco_fim) : faixaDaAncora(api, parada.foco) ?? faixaDosBlocos(api, versaoId, blocos, parada.foco.bloco_id, parada.foco.bloco_id);
    else if (etapa?.fala.papel === 'abertura' && blocos[0]) alvo = faixaDosBlocos(api, versaoId, blocos, blocos[0].id, blocos[0].id);
    if (alvo) window.scrollBy({ top: alvo.topo - window.innerHeight * (window.innerWidth < 600 ? 0.12 : 0.24), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [ordemDaParada, trechoInteiro, papelNaAbertura]);


  // ------------------------------------------------------------ controles
  const saltar = useCallback((sentido: 1 | -1) => {
    definirTrechoInteiro(false);
    const destino = saltarParada(sequencia, relogio.current.t, sentido);
    if (destino >= sequencia.duracao_s && sentido === 1) { if (roteiro.proxima_secao_id) seguir(); return; }
    passar(destino);
  }, [sequencia, passar, seguir, roteiro.proxima_secao_id]);
  const lerTrecho = useCallback(() => { pausar(); definirTrechoInteiro((atual) => !atual); }, [pausar]);

  useEffect(() => {
    const teclar = (evento: KeyboardEvent) => {
      if (digitando(evento.target)) return;
      if (evento.key === ' ' || (evento.key.toLowerCase() === 'k' && !atalhoDeUmaTeclaDesligado(evento))) { evento.preventDefault(); if (tocando) pausar(); else tocar(); }
      else if (evento.key === 'ArrowRight' && evento.shiftKey) { evento.preventDefault(); seguir(); }
      else if (evento.key === 'ArrowRight') { evento.preventDefault(); saltar(1); }
      else if (evento.key === 'ArrowLeft') { evento.preventDefault(); saltar(-1); }
      else if (evento.key === 'Escape') { pausar(); aoSair(); }
    };
    window.addEventListener('keydown', teclar);
    return () => window.removeEventListener('keydown', teclar);
  }, [tocando, tocar, pausar, saltar, seguir, aoSair]);

  // ------------------------------------------------------------ desenho

  const fala = etapa?.fala ?? null;
  const frases = fala ? frasesDaFala(fala.texto) : [];
  const fraseAtual = etapa ? fraseNoInstante(etapa, t) : 0;
  const papel = fala?.papel ?? 'abertura';
  const rotuloDaEtapa = parada ? `Parada ${String(parada.ordem)} de ${String(total)}` : papel === 'abertura' ? 'Abertura' : papel === 'fechamento' ? 'Fechamento' : 'A seguir';
  const inicios = roteiro.paradas.map((p) => sequencia.etapas.find((e) => e.parada === p.ordem)?.inicio_s ?? 0);
  const fonte = narracao && sequencia.narrada && !semVoz ? arquivoDaNarracao(narracao.id) : null;

  // Onde a fala se ancora no documento: o foco da parada; na abertura, o começo do capítulo; no fim, o último bloco.
  const ultimoBloco = blocos[blocos.length - 1];
  const primeiroBloco = blocos.find((b) => b.texto.trim() !== '');
  const ancoraDaFala: AncoraV1 | null = parada ? parada.foco : papel === 'abertura' ? (primeiroBloco ? ancoraDoBloco(versaoId, primeiroBloco) : null) : (ultimoBloco ? ancoraDoBloco(versaoId, ultimoBloco) : null);
  return <>
    {fonte && <audio ref={audio} src={fonte} preload="auto" onLoadedMetadata={(evento) => { evento.currentTarget.currentTime = relogio.current.t; evento.currentTarget.playbackRate = velocidade; }} onEnded={() => terminar.current()}
      onError={() => { definirSemVoz(true); definirTocando(false); }} />}
    <CartaoNoTexto ancora={ancoraDaFala} leitor={leitor} rotulo="Fala da visita" className="fala-da-visita-no-texto">
      <span className="eyebrow">{parada ? ROTULO_DA_PARADA[parada.tipo] : papel === 'abertura' ? 'Para começar' : 'Para fechar'}</span>
      {parada && <h2 className="titulo-da-parada">{parada.titulo}</h2>}
      {fala && <p className="fala-no-texto" data-papel={fala.papel} aria-live="polite">
        {frases.map((frase, i) => <span key={String(i)} className={i < fraseAtual ? 'frase-dita' : i === fraseAtual ? 'frase-atual' : 'frase-por-vir'}>{frase.texto}</span>)}
      </p>}
      {parada?.pergunta && <p className="pergunta-no-texto"><span className="eyebrow">Antes de seguir</span>{parada.pergunta}</p>}
      {parada?.ponta && <button type="button" className="ponta-no-texto" onClick={() => { pausar(); aoCitar(parada.ponta!); }}>
        <span className="eyebrow">{parada.tipo === 'retorno' ? 'Volta a' : 'Liga a'}</span>
        <span>“{parada.ponta.citacao.slice(0, 140)}{parada.ponta.citacao.length > 140 ? '…' : ''}”</span>
      </button>}
      {!parada && papel !== 'abertura' && roteiro.perguntas_finais.length > 0 && <section className="perguntas-da-visita" aria-label="Para pensar">
        <span className="eyebrow">Para pensar</span>
        <ol>{roteiro.perguntas_finais.map((p) => <li key={p}>{p}</li>)}</ol>
      </section>}
    </CartaoNoTexto>
    <PlayerCentral rotulo="Visita guiada" className="player-visita">
      <TrilhaCentral rotulo="Posição na visita" t={t} duracao={sequencia.duracao_s} marcas={inicios} aoPassar={(novo) => { definirTrechoInteiro(false); passar(novo); }} />
      <div className="linha-do-player">
        <div className="esquerda-do-player">
          <span className="titulo-do-player">Visita guiada · Cap. {roteiro.capitulo.numero} de {roteiro.capitulo.total}</span>
          <span className="detalhe-do-player"><span>{rotuloDaEtapa}{parada ? ` · ${ROTULO_DA_PARADA[parada.tipo]}` : ''}</span>{' · '}<span>{narrada ? 'voz' : 'sem voz · ritmo de leitura'}</span>
            {terminou && !roteiro.proxima_secao_id && <>{' · '}<span role="status">Fim da visita deste livro.</span></>}</span>
        </div>
        <div className="centro-do-player">
          <BotaoDoPlayer icone="voltar-trecho" rotulo="Parada anterior" atalho="←" onClick={() => saltar(-1)} />
          <BotaoDeTocar tocando={tocando} aoAlternar={() => { if (tocando) pausar(); else tocar(); }} />
          <BotaoDoPlayer icone="avancar-trecho" rotulo="Próxima parada" atalho="→" onClick={() => saltar(1)} />
        </div>
        <div className="direita-do-player">
          <button type="button" className="velocidade-central" aria-label="Velocidade" data-dica="Velocidade" onClick={() => definirVelocidade((atual) => VELOCIDADES[(VELOCIDADES.indexOf(atual as (typeof VELOCIDADES)[number]) + 1) % VELOCIDADES.length]!)}>{String(velocidade).replace('.', ',')}×</button>
          <BotaoDoPlayer icone={trechoInteiro ? 'voltar-trecho' : 'texto'} rotulo={trechoInteiro ? 'Voltar à visita' : 'Ler o trecho inteiro'} pressionado={trechoInteiro} disabled={!parada} onClick={lerTrecho} />
          <BotaoDoPlayer icone="pular" rotulo="Pular capítulo" atalho="Shift →" disabled={!roteiro.proxima_secao_id || !aoIrCapitulo} onClick={seguir} />
          <BotaoDoPlayer icone="xis" rotulo="Sair da visita" atalho="Esc" onClick={() => { pausar(); aoSair(); }} />
        </div>
      </div>
    </PlayerCentral>
  </>;
}
