/**
 * O player da análise curta de um quadro, na pílula central do leitor (`PlayerCentral`): tocar e pausar,
 * batida anterior e seguinte, a trilha com as batidas, a velocidade e a legenda. A câmera anda pela
 * linha do tempo (de → para em cada batida) e a legenda acende palavra por palavra, no visual do karaokê
 * do leitor (bloco da palavra atrás das letras, só a tinta muda). Com narração, o relógio é o áudio e os
 * tempos são os reais; sem ela, o ritmo de leitura estimado.
 *
 * Teclado: Espaço (ou K) toca e pausa, ← → andam de batida, C liga a legenda, Esc fecha.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RetanguloDaObra } from '@margem/contratos';
import { BotaoDeTocar, BotaoDoPlayer, PlayerCentral, TrilhaCentral, formatarTempo } from '../leitor/player/PlayerCentral';
import { batidaNoInstante, cameraDaLinha, palavraNoInstante, saltarBatida, type BatidaNaLinha, type LinhaDoTempo } from './linha-do-tempo';

const VELOCIDADES = [0.75, 1, 1.25, 1.5] as const;
const CHAVE_DA_VELOCIDADE = 'margem:quadro:velocidade';
const PAPEIS: Record<string, string> = { abertura: 'Abertura', evidencia_visual: 'Evidência visual', contexto: 'Contexto', interpretacao: 'Interpretação', fechamento: 'Fechamento' };

function lerVelocidade(): number {
  try { const v = Number(localStorage.getItem(CHAVE_DA_VELOCIDADE)); return (VELOCIDADES as readonly number[]).includes(v) ? v : 1; } catch { return 1; }
}

/** A fala da batida com a palavra em curso: o bloco atrás da palavra desliza; as letras não mudam de peso nem de fonte. */
export function LegendaComKaraoke({ batida, palavra }: { batida: BatidaNaLinha; palavra: number }): ReactNode {
  const caixa = useRef<HTMLParagraphElement>(null);
  const bloco = useRef<HTMLSpanElement>(null);
  const partes = useMemo(() => {
    const saida: { texto: string; indice: number | null }[] = [];
    let cursor = 0;
    batida.palavras.forEach((p, i) => {
      if (p.inicio > cursor) saida.push({ texto: batida.texto.slice(cursor, p.inicio), indice: null });
      saida.push({ texto: batida.texto.slice(p.inicio, p.fim), indice: i });
      cursor = p.fim;
    });
    if (cursor < batida.texto.length) saida.push({ texto: batida.texto.slice(cursor), indice: null });
    return saida;
  }, [batida]);
  useLayoutEffect(() => {
    const alvo = caixa.current?.querySelector<HTMLElement>(`[data-palavra="${String(palavra)}"]`);
    const b = bloco.current;
    if (!b) return;
    if (!alvo) { b.style.opacity = '0'; return; }
    b.style.opacity = '1';
    b.style.transform = `translate(${String(alvo.offsetLeft - 3)}px, ${String(alvo.offsetTop - 2)}px)`;
    b.style.width = `${String(alvo.offsetWidth + 6)}px`;
    b.style.height = `${String(alvo.offsetHeight + 4)}px`;
  }, [palavra, batida]);
  // A legenda nova não desliza da posição da anterior.
  useLayoutEffect(() => { bloco.current?.setAttribute('data-salto', ''); const q = requestAnimationFrame(() => bloco.current?.removeAttribute('data-salto')); return () => cancelAnimationFrame(q); }, [batida]);
  return <p ref={caixa} className="legenda-do-quadro" aria-live="off">
    <span ref={bloco} className="karaoke-palavra bloco-da-legenda" aria-hidden="true" />
    {partes.map((p, i) => p.indice === null ? <span key={String(i)}>{p.texto}</span>
      : <span key={String(i)} data-palavra={p.indice} className={p.indice < palavra ? 'dita' : p.indice === palavra ? 'atual' : 'por-vir'}>{p.texto}</span>)}
  </p>;
}

export interface PropsDoPlayer {
  linha: LinhaDoTempo;
  titulo: string;
  audio: string | null;
  /** A câmera conduzida pela linha do tempo (a cada quadro, enquanto `seguir`). */
  aoCamera: (camera: RetanguloDaObra) => void;
  seguir: boolean;
  aoSeguir: () => void;
  aoBatida: (indice: number) => void;
  legenda: boolean;
  aoAlternarLegenda: () => void;
  tocarAoAbrir?: boolean;
  aoFechar: () => void;
}

export function PlayerDoQuadro({ linha, titulo, audio, aoCamera, seguir, aoSeguir, aoBatida, legenda, aoAlternarLegenda, tocarAoAbrir = false, aoFechar }: PropsDoPlayer): ReactNode {
  const [semVoz, definirSemVoz] = useState(false);
  const narrada = linha.narrada && audio !== null && !semVoz;
  const [t, definirT] = useState(0);
  const [tocando, definirTocando] = useState(false);
  const [velocidade, definirVelocidade] = useState(lerVelocidade);
  const elemento = useRef<HTMLAudioElement | null>(null);
  const relogio = useRef({ t: 0, ultimo: 0, quadro: 0, desenhado: 0, chave: '' });
  const refs = useRef({ aoCamera, seguir, aoBatida });
  refs.current = { aoCamera, seguir, aoBatida };
  const indice = batidaNoInstante(linha, t);
  const batida = linha.batidas[indice] ?? null;
  const palavra = batida ? palavraNoInstante(batida, t) : -1;

  const conduzir = useCallback((instante: number) => { if (refs.current.seguir) refs.current.aoCamera(cameraDaLinha(linha, instante)); }, [linha]);
  useEffect(() => { refs.current.aoBatida(indice); }, [indice]);
  // Ao voltar a seguir (ou trocar de análise), a câmera retoma de onde a linha do tempo está.
  useEffect(() => { conduzir(relogio.current.t); }, [seguir, conduzir]);

  const passar = useCallback((novo: number) => {
    const limitado = Math.min(Math.max(0, novo), linha.duracao_s);
    relogio.current.t = limitado;
    if (elemento.current && narrada) elemento.current.currentTime = limitado;
    definirT(limitado);
    conduzir(limitado);
  }, [linha.duracao_s, narrada, conduzir]);

  const tocar = useCallback(() => {
    if (relogio.current.t >= linha.duracao_s - 0.05) passar(0);
    if (!refs.current.seguir) aoSeguir();
    if (elemento.current && narrada) {
      elemento.current.playbackRate = velocidade;
      void elemento.current.play().then(() => definirTocando(true), () => definirTocando(false));
    } else definirTocando(true);
  }, [narrada, velocidade, linha.duracao_s, passar, aoSeguir]);
  const pausar = useCallback(() => { elemento.current?.pause(); definirTocando(false); }, []);

  useEffect(() => { if (elemento.current) elemento.current.playbackRate = velocidade; try { localStorage.setItem(CHAVE_DA_VELOCIDADE, String(velocidade)); } catch { /* sem storage */ } }, [velocidade]);

  useEffect(() => {
    if (!tocando) return undefined;
    relogio.current.ultimo = performance.now();
    const passo = (agora: number): void => {
      const r = relogio.current;
      if (elemento.current && narrada) r.t = elemento.current.currentTime;
      else r.t = Math.min(linha.duracao_s, r.t + ((agora - r.ultimo) / 1000) * velocidade);
      r.ultimo = agora;
      conduzir(r.t);
      // O React só redesenha quando a palavra ou a batida mudam (ou a cada quarto de segundo, pela trilha).
      const b = linha.batidas[batidaNoInstante(linha, r.t)];
      const chave = `${String(b?.indice ?? -1)}:${String(b ? palavraNoInstante(b, r.t) : -1)}`;
      if (chave !== r.chave || Math.abs(r.t - r.desenhado) >= 0.25) { r.chave = chave; r.desenhado = r.t; definirT(r.t); }
      if (!narrada && r.t >= linha.duracao_s) { definirT(r.t); definirTocando(false); return; }
      r.quadro = requestAnimationFrame(passo);
    };
    relogio.current.quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(relogio.current.quadro);
  }, [tocando, narrada, velocidade, linha, conduzir]);

  useEffect(() => { if (tocarAoAbrir) tocar(); else conduzir(0); }, []);

  const saltar = useCallback((sentido: 1 | -1) => { passar(saltarBatida(linha, relogio.current.t, sentido)); }, [linha, passar]);
  useEffect(() => {
    const teclar = (evento: KeyboardEvent): void => {
      if (evento.target instanceof Element && evento.target.closest('input, textarea, select, [contenteditable], [role="dialog"]')) return;
      if (evento.ctrlKey || evento.metaKey || evento.altKey) return;
      const tecla = evento.key.toLowerCase();
      if (evento.key === ' ' || tecla === 'k') { evento.preventDefault(); if (tocando) pausar(); else tocar(); }
      else if (evento.key === 'ArrowRight') { evento.preventDefault(); saltar(1); }
      else if (evento.key === 'ArrowLeft') { evento.preventDefault(); saltar(-1); }
      else if (tecla === 'c') { evento.preventDefault(); aoAlternarLegenda(); }
      else if (evento.key === 'Escape') { evento.preventDefault(); pausar(); aoFechar(); }
    };
    window.addEventListener('keydown', teclar);
    return () => window.removeEventListener('keydown', teclar);
  }, [tocando, tocar, pausar, saltar, aoAlternarLegenda, aoFechar]);

  const estadoDaVoz = narrada ? 'voz · palavra a palavra' : 'sem voz · ritmo de leitura';
  return <>
    {narrada && audio && <audio ref={elemento} src={audio} preload="auto"
      onLoadedMetadata={(evento) => { evento.currentTarget.currentTime = relogio.current.t; evento.currentTarget.playbackRate = velocidade; }}
      onEnded={() => definirTocando(false)} onError={() => { definirSemVoz(true); definirTocando(false); }} />}
    {legenda && batida && <div className="legenda-do-quadro-moldura"><LegendaComKaraoke batida={batida} palavra={palavra} /></div>}
    {!seguir && <button type="button" className="voltar-ao-trecho voltar-a-camera" onClick={() => { aoSeguir(); }}>Voltar à câmera da análise</button>}
    <PlayerCentral rotulo="Análise curta" className="player-do-quadro">
      <TrilhaCentral rotulo="Posição na análise" t={t} duracao={linha.duracao_s} marcas={linha.batidas.slice(1).map((b) => b.inicio_s)} aoPassar={passar} />
      <div className="linha-do-player">
        <div className="esquerda-do-player">
          <span className="titulo-do-player">{titulo}</span>
          <span className="detalhe-do-player" aria-live="off">
            <span>{batida ? `${PAPEIS[batida.batida.papel] ?? batida.batida.papel} · ${String(indice + 1)} de ${String(linha.batidas.length)}` : ''}</span>
            {' · '}<span>{estadoDaVoz}</span>{' · '}<span>{formatarTempo(t)} / {formatarTempo(linha.duracao_s)}</span>
          </span>
        </div>
        <div className="centro-do-player">
          <BotaoDoPlayer icone="anterior" rotulo="Batida anterior" atalho="←" onClick={() => saltar(-1)} />
          <BotaoDeTocar tocando={tocando} aoAlternar={() => { if (tocando) pausar(); else tocar(); }} />
          <BotaoDoPlayer icone="proximo" rotulo="Próxima batida" atalho="→" disabled={indice >= linha.batidas.length - 1} onClick={() => saltar(1)} />
        </div>
        <div className="direita-do-player">
          <button type="button" className="velocidade-central" aria-label="Velocidade" data-dica="Velocidade" onClick={() => definirVelocidade((atual) => VELOCIDADES[(VELOCIDADES.indexOf(atual as (typeof VELOCIDADES)[number]) + 1) % VELOCIDADES.length]!)}>{String(velocidade).replace('.', ',')}×</button>
          <BotaoDoPlayer icone="legenda" rotulo={legenda ? 'Esconder a legenda' : 'Mostrar a legenda'} atalho="C" pressionado={legenda} onClick={aoAlternarLegenda} />
          <BotaoDoPlayer icone="xis" rotulo="Fechar o player" atalho="Esc" onClick={() => { pausar(); aoFechar(); }} />
        </div>
      </div>
    </PlayerCentral>
  </>;
}
