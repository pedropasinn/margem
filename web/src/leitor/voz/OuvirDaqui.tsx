/**
 * "Ouvir a partir daqui" com a voz do sistema (Web Speech API), para o capítulo que não tem áudio
 * preparado. Lê as frases dos blocos a partir do trecho selecionado (ou do que está na tela), uma
 * frase por fala; a frase em leitura ganha a faixa do karaokê (`../karaoke/`) e, quando a voz avisa
 * onde está (evento `boundary`), a palavra também. Pausar cancela a fala e tocar retoma do começo da
 * frase: o `pause()` do navegador não é confiável em todas as vozes. Mesma pílula central da leitura
 * comentada (`PlayerCentral`).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BotaoDeTocar, BotaoDoPlayer, PlayerCentral } from '../player/PlayerCentral';
import { intervaloDoTrecho } from '../karaoke/karaoke';
import { useKaraoke, VoltarAoTrecho } from '../karaoke/VoltarAoTrecho';
import type { PontoDeTexto, SnapshotCapitulo } from '../tipos';
import { escolherVoz, fraseDoPonto, frasesDoCapitulo, palavraEm } from './voz';

const VELOCIDADES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const CHAVE_DA_VELOCIDADE = 'margem:voz-do-sistema:velocidade';

function lerVelocidade(): number {
  try { const v = Number(localStorage.getItem(CHAVE_DA_VELOCIDADE)); return (VELOCIDADES as readonly number[]).includes(v) ? v : 1; } catch { return 1; }
}
const movimentoReduzido = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface PropsDoOuvirDaqui {
  blocos: SnapshotCapitulo['blocos'];
  /** Onde está o texto do capítulo (para o karaokê). */
  raiz: HTMLElement | null;
  /** De onde começar: a seleção, ou o trecho visível. */
  inicio: PontoDeTexto | null;
  aoSair: () => void;
}

export function OuvirDaqui({ blocos, raiz, inicio, aoSair }: PropsDoOuvirDaqui): ReactNode {
  const frases = useMemo(() => frasesDoCapitulo(blocos), [blocos]);
  const [indice, definirIndice] = useState(() => fraseDoPonto(frases, blocos, inicio));
  const [palavra, definirPalavra] = useState<{ inicio: number; fim: number } | null>(null);
  const [tocando, definirTocando] = useState(false);
  const [terminou, definirTerminou] = useState(false);
  const [erro, definirErro] = useState<string | null>(null);
  const [velocidade, definirVelocidade] = useState(lerVelocidade);
  const [voz, definirVoz] = useState<SpeechSynthesisVoice | null>(() => escolherVoz(window.speechSynthesis.getVoices()));
  const [vozesCarregadas, definirVozesCarregadas] = useState(() => window.speechSynthesis.getVoices().length > 0);
  const [seguir, definirSeguir] = useState(true);
  /** Cada fala tem a sua geração: os eventos de uma fala cancelada não mexem em nada. */
  const geracao = useRef(0);
  const estado = useRef({ indice, velocidade, voz });
  estado.current = { indice, velocidade, voz };

  // As vozes chegam depois, no Chrome (evento `voiceschanged`).
  useEffect(() => {
    const sintese = window.speechSynthesis;
    const carregar = (): void => {
      const vozes = sintese.getVoices();
      if (vozes.length > 0) { definirVoz(escolherVoz(vozes)); definirVozesCarregadas(true); }
    };
    carregar();
    sintese.addEventListener?.('voiceschanged', carregar);
    // Sem nenhuma voz depois de um instante: avisa (a fala ainda tenta a voz padrão em pt-BR).
    const espera = window.setTimeout(() => definirVozesCarregadas(true), 1500);
    return () => { sintese.removeEventListener?.('voiceschanged', carregar); window.clearTimeout(espera); };
  }, []);

  const falar = useCallback((i: number) => {
    const sintese = window.speechSynthesis;
    const minha = ++geracao.current;
    sintese.cancel();
    const frase = frases[i];
    if (!frase) { definirTocando(false); definirTerminou(true); return; }
    definirIndice(i); definirPalavra(null); definirTerminou(false); definirErro(null);
    const fala = new SpeechSynthesisUtterance(frase.texto);
    const { velocidade: taxa, voz: escolhida } = estado.current;
    fala.lang = escolhida?.lang ?? 'pt-BR';
    if (escolhida) fala.voice = escolhida;
    fala.rate = taxa;
    fala.onboundary = (evento) => {
      if (minha !== geracao.current || evento.name !== 'word') return;
      definirPalavra(palavraEm(frase.texto, evento.charIndex, evento.charLength));
    };
    fala.onend = () => { if (minha === geracao.current) falar(i + 1); };
    fala.onerror = (evento) => {
      if (minha !== geracao.current || evento.error === 'interrupted' || evento.error === 'canceled') return;
      definirTocando(false);
      definirErro('A voz do sistema não conseguiu ler este trecho.');
    };
    sintese.speak(fala);
  }, [frases]);

  const tocar = useCallback(() => {
    definirTocando(true); definirSeguir(true);
    falar(terminou ? 0 : estado.current.indice);
  }, [falar, terminou]);
  const pausar = useCallback(() => { geracao.current += 1; window.speechSynthesis.cancel(); definirTocando(false); }, []);
  const parar = useCallback(() => { pausar(); aoSair(); }, [pausar, aoSair]);
  const irPara = useCallback((i: number) => {
    const destino = Math.min(Math.max(0, i), Math.max(0, frases.length - 1));
    definirSeguir(true);
    if (tocando) falar(destino); else { definirIndice(destino); definirPalavra(null); definirTerminou(false); }
  }, [frases.length, tocando, falar]);

  // Começa a ler ao abrir; ao fechar, cala.
  useEffect(() => { if (frases.length > 0) tocar(); return () => { geracao.current += 1; window.speechSynthesis.cancel(); }; }, []);

  // A velocidade nova vale já: a frase em curso recomeça nela.
  const primeiraVelocidade = useRef(true);
  useEffect(() => {
    try { localStorage.setItem(CHAVE_DA_VELOCIDADE, String(velocidade)); } catch { /* sem storage */ }
    if (primeiraVelocidade.current) { primeiraVelocidade.current = false; return; }
    if (tocando) falar(estado.current.indice);
  }, [velocidade]);

  // ------------------------------------------------------------ karaokê e rolagem
  const { karaoke, fora } = useKaraoke();
  const frase = frases[indice] ?? null;
  useEffect(() => {
    if (!frase) { karaoke.current?.definir(raiz, { frase: null, palavra: null, modo: 'nenhum' }); return; }
    const trecho = { bloco_id: frase.bloco_id, inicio_utf16: frase.inicio_utf16, fim_utf16: frase.fim_utf16 };
    karaoke.current?.definir(raiz, palavra
      ? { frase: trecho, palavra: { bloco_id: frase.bloco_id, inicio_utf16: frase.inicio_utf16 + palavra.inicio, fim_utf16: frase.inicio_utf16 + palavra.fim }, modo: 'palavra' }
      : { frase: trecho, palavra: null, modo: 'frase' });
  }, [frase, palavra, raiz, karaoke]);
  useEffect(() => {
    if (!raiz || !frase || !seguir) return;
    const caixa = intervaloDoTrecho(raiz, frase)?.getBoundingClientRect();
    if (!caixa || caixa.height === 0) return;
    if (caixa.top < 72 || caixa.bottom > window.innerHeight * 0.72) window.scrollBy({ top: caixa.top - window.innerHeight * 0.38, behavior: movimentoReduzido() ? 'auto' : 'smooth' });
  }, [frase, raiz]);
  useEffect(() => {
    const soltar = (evento: Event): void => { if (!(evento.target instanceof Element && evento.target.closest('.player-central'))) definirSeguir(false); };
    window.addEventListener('wheel', soltar, { passive: true });
    window.addEventListener('touchmove', soltar, { passive: true });
    return () => { window.removeEventListener('wheel', soltar); window.removeEventListener('touchmove', soltar); };
  }, []);

  // ------------------------------------------------------------ teclado: espaço, ← →, Esc
  useEffect(() => {
    const teclar = (evento: KeyboardEvent): void => {
      if (evento.target instanceof Element && evento.target.closest('input, textarea, select, [contenteditable]')) return;
      if (evento.ctrlKey || evento.metaKey || evento.altKey) return;
      if (evento.key === ' ' || evento.key.toLowerCase() === 'k') { evento.preventDefault(); if (tocando) pausar(); else tocar(); }
      else if (evento.key === 'ArrowRight') { evento.preventDefault(); irPara(indice + 1); }
      else if (evento.key === 'ArrowLeft') { evento.preventDefault(); irPara(indice - 1); }
      else if (evento.key === 'Escape') parar();
    };
    window.addEventListener('keydown', teclar);
    return () => window.removeEventListener('keydown', teclar);
  }, [tocando, tocar, pausar, parar, irPara, indice]);

  const semPortugues = vozesCarregadas && voz === null;
  const detalhe = frases.length === 0 ? 'Este capítulo não tem texto para ler em voz alta.'
    : erro ?? (terminou ? 'Fim do capítulo.' : `Frase ${String(indice + 1)} de ${String(frases.length)} · ${semPortugues ? 'sem voz em português neste aparelho' : voz ? voz.name : 'voz do sistema'}`);
  return <>
    <VoltarAoTrecho visivel={!seguir && fora} acimaDe=".player-voz-do-sistema" aoVoltar={() => { definirSeguir(true); karaoke.current?.rolarAteAFrase(movimentoReduzido() ? 'auto' : 'smooth'); }} />
    <PlayerCentral rotulo="Ouvir com a voz do sistema" className="player-voz-do-sistema">
      <div className="linha-do-player">
        <div className="esquerda-do-player">
          <span className="titulo-do-player">Voz do sistema</span>
          <span className="detalhe-do-player" role={erro || semPortugues ? 'status' : undefined}>{detalhe}</span>
        </div>
        <div className="centro-do-player">
          <BotaoDoPlayer icone="voltar-trecho" rotulo="Frase anterior" atalho="←" disabled={indice === 0} onClick={() => irPara(indice - 1)} />
          <BotaoDeTocar tocando={tocando} aoAlternar={() => { if (tocando) pausar(); else tocar(); }} />
          <BotaoDoPlayer icone="avancar-trecho" rotulo="Próxima frase" atalho="→" disabled={indice >= frases.length - 1} onClick={() => irPara(indice + 1)} />
        </div>
        <div className="direita-do-player">
          <button type="button" className="velocidade-central" aria-label="Velocidade" data-dica="Velocidade" onClick={() => definirVelocidade((atual) => VELOCIDADES[(VELOCIDADES.indexOf(atual as (typeof VELOCIDADES)[number]) + 1) % VELOCIDADES.length]!)}>{String(velocidade).replace('.', ',')}×</button>
          <BotaoDoPlayer icone="xis" rotulo="Parar" atalho="Esc" onClick={parar} />
        </div>
      </div>
    </PlayerCentral>
  </>;
}
