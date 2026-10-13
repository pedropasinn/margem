/**
 * Mídia com transcrição (J71): as palavras reconhecidas, com tempo, viram trechos da versão de
 * texto (bloco + offsets UTF-16). Puro, sem Node nem DOM: o serviço usa para publicar e o leitor
 * usa para achar a palavra e a frase do instante.
 */
import type { AudioV1, CanonicoV1, Id, MidiaV1, TrechoTemporizado } from '@margem/contratos';
import { fronteiraUtf16 } from '@margem/contratos/texto';

/** Palavra como sai do reconhecimento (whisper/whisperx), antes de conhecer a versão de texto. */
export interface PalavraTranscrita {
  texto: string;
  inicio_s: number;
  fim_s: number;
}

export interface TokenDoTexto {
  bloco_id: Id;
  inicio_utf16: number;
  fim_utf16: number;
  chave: string;
}

/** Comparação tolerante: minúsculas, NFC, só letras e números (a pontuação não decide o par). */
export function chaveDaPalavra(texto: string): string {
  return texto.normalize('NFC').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]/gu, '');
}

/** Tokens de texto (sequências sem espaço) de cada bloco, em ordem, com offsets UTF-16. */
export function tokensDosBlocos(blocos: readonly { id: Id; texto: string }[]): TokenDoTexto[] {
  const tokens: TokenDoTexto[] = [];
  for (const bloco of blocos) {
    for (const achado of bloco.texto.matchAll(/\S+/gu)) {
      const chave = chaveDaPalavra(achado[0]);
      if (chave === '') continue;
      tokens.push({ bloco_id: bloco.id, inicio_utf16: achado.index, fim_utf16: achado.index + achado[0].length, chave });
    }
  }
  return tokens;
}

export interface ResultadoDoAlinhamento {
  palavras: TrechoTemporizado[];
  /** Palavras transcritas sem par no texto (entraram na contagem, não no alinhamento). */
  sem_par: number;
  /** Tokens do texto que nenhuma palavra cobriu. */
  texto_sem_tempo: number;
  transcritas: number;
}

/** Quanto adiante procurar quando palavra e token não coincidem. */
const JANELA = 12;

/**
 * Casa as palavras transcritas com os tokens do texto, em ordem, sem escolher silenciosamente
 * um par distante: quando não coincidem, procura o par mais próximo numa janela pequena dos dois
 * lados; o que fica no meio é contado como sem par. Tempos negativos ou invertidos são corrigidos
 * para uma sequência monotônica (o whisper às vezes devolve fim < início).
 */
export function alinharPalavras(blocos: readonly { id: Id; texto: string }[], transcritas: readonly PalavraTranscrita[]): ResultadoDoAlinhamento {
  const tokens = tokensDosBlocos(blocos);
  const palavras = transcritas
    .map((p) => ({ ...p, chave: chaveDaPalavra(p.texto) }))
    .filter((p) => p.chave !== '' && Number.isFinite(p.inicio_s) && Number.isFinite(p.fim_s));
  const saida: TrechoTemporizado[] = [];
  let i = 0, j = 0, semPar = 0;
  let tempo = 0;
  while (i < palavras.length && j < tokens.length) {
    if (palavras[i]!.chave !== tokens[j]!.chave) {
      let melhor: [number, number] | null = null;
      for (let soma = 1; soma <= 2 * JANELA && melhor === null; soma++) {
        for (let a = Math.max(0, soma - JANELA); a <= Math.min(soma, JANELA); a++) {
          const b = soma - a;
          if (i + a < palavras.length && j + b < tokens.length && palavras[i + a]!.chave === tokens[j + b]!.chave) { melhor = [a, b]; break; }
        }
      }
      if (melhor === null) { semPar++; i++; continue; }
      semPar += melhor[0];
      i += melhor[0]; j += melhor[1];
    }
    const p = palavras[i]!, t = tokens[j]!;
    const inicio = Math.max(tempo, p.inicio_s, 0);
    const fim = Math.max(inicio, p.fim_s);
    saida.push({ bloco_id: t.bloco_id, inicio_utf16: t.inicio_utf16, fim_utf16: t.fim_utf16, inicio_s: arredondar(inicio), fim_s: arredondar(fim) });
    tempo = inicio;
    i++; j++;
  }
  semPar += palavras.length - i;
  return { palavras: saida, sem_par: semPar, texto_sem_tempo: tokens.length - saida.length, transcritas: palavras.length };
}

function arredondar(s: number): number {
  return Math.round(s * 1000) / 1000;
}

const FIM_DE_FRASE = /[.!?…]["'”’»)\]]*$/u;
/** Uma frase longa demais (fala sem pontuação) é cortada para o destaque não cobrir meia tela. */
const MAXIMO_DE_PALAVRAS_NA_FRASE = 40;

/**
 * Frases a partir das palavras alinhadas: quebra na pontuação final, na troca de bloco, numa
 * pausa longa ou no limite de palavras. A frase é o intervalo do texto e do tempo das suas palavras.
 */
export function frasesDasPalavras(blocos: readonly { id: Id; texto: string }[], palavras: readonly TrechoTemporizado[], pausaMaxima_s = 1.6): TrechoTemporizado[] {
  const textos = new Map(blocos.map((b) => [b.id, b.texto]));
  const frases: TrechoTemporizado[] = [];
  let atual: TrechoTemporizado | null = null;
  let contagem = 0;
  palavras.forEach((p, indice) => {
    if (atual && (atual.bloco_id !== p.bloco_id || p.inicio_s - atual.fim_s > pausaMaxima_s)) { frases.push(atual); atual = null; }
    if (atual === null) { atual = { ...p }; contagem = 0; } else { atual.fim_utf16 = p.fim_utf16; atual.fim_s = Math.max(atual.fim_s, p.fim_s); }
    contagem++;
    const texto = textos.get(p.bloco_id)?.slice(p.inicio_utf16, p.fim_utf16) ?? '';
    const ultima = indice === palavras.length - 1;
    if (ultima || FIM_DE_FRASE.test(texto) || contagem >= MAXIMO_DE_PALAVRAS_NA_FRASE) { frases.push(atual); atual = null; }
  });
  return frases;
}

/**
 * Índice no instante por busca binária. `ultima` é o último trecho que já começou; `atual` é ele
 * mesmo enquanto dura (com uma tolerância curta para a pausa até o próximo), ou -1 no silêncio.
 */
export function indiceNoInstante(trechos: readonly Pick<TrechoTemporizado, 'inicio_s' | 'fim_s'>[], segundos: number, tolerancia_s = 0.25): { atual: number; ultima: number } {
  let baixo = 0, alto = trechos.length;
  while (baixo < alto) {
    const meio = (baixo + alto) >> 1;
    if (trechos[meio]!.inicio_s <= segundos) baixo = meio + 1;
    else alto = meio;
  }
  const ultima = baixo - 1;
  if (ultima < 0) return { atual: -1, ultima };
  const t = trechos[ultima]!;
  const proximo = trechos[ultima + 1]?.inicio_s ?? Number.POSITIVE_INFINITY;
  const limite = Math.min(Math.max(t.fim_s, t.inicio_s) + tolerancia_s, proximo);
  return { atual: segundos < limite ? ultima : -1, ultima };
}

/** Os trechos no intervalo de índices [de, ate), para pintar as palavras já ditas de uma frase. */
export function trechosEntre<T>(trechos: readonly T[], de: number, ate: number): readonly T[] {
  return trechos.slice(Math.max(0, de), Math.max(0, ate));
}

/** Conferência contextual: toda palavra e toda frase caem dentro de um bloco da versão, em fronteira UTF-16. */
export function conferirMidiaNoCanonico(midia: Pick<MidiaV1, 'versao_id' | 'palavras' | 'frases'>, versaoId: Id, canonico: Pick<CanonicoV1, 'blocos'>): boolean {
  if (midia.versao_id !== versaoId) return false;
  const textos = new Map(canonico.blocos.map((b) => [b.id, b.texto]));
  return [...midia.palavras, ...midia.frases].every((t) => {
    const texto = textos.get(t.bloco_id);
    return texto !== undefined && t.fim_utf16 <= texto.length && fronteiraUtf16(texto, t.inicio_utf16)
      && fronteiraUtf16(texto, t.fim_utf16) && texto.slice(t.inicio_utf16, t.fim_utf16).trim() !== '';
  });
}

/**
 * O áudio narrado de J63/J64 (AudioV1) no mesmo formato: cada trecho do roteiro é uma frase,
 * sem palavras. O player trata os dois do mesmo jeito; sem palavras, o destaque é por frase.
 */
export function frasesDoAudio(audio: Pick<AudioV1, 'trechos'>): TrechoTemporizado[] {
  return audio.trechos.map((t) => ({ bloco_id: t.ancora.bloco_id, inicio_utf16: t.ancora.inicio_utf16, fim_utf16: t.ancora.fim_utf16, inicio_s: t.inicio_s, fim_s: t.fim_s }));
}

/** Capítulo (da mídia) no instante: o último que já começou. */
export function capituloNoInstante(capitulos: readonly { inicio_s: number }[], segundos: number): number {
  let indice = -1;
  for (let i = 0; i < capitulos.length; i++) {
    if (capitulos[i]!.inicio_s <= segundos + 0.4) indice = i;
    else break;
  }
  return indice;
}

/** `m:ss` ou `h:mm:ss`, com números tabulares na tela. */
export function formatarTempo(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos < 0) return '0:00';
  const total = Math.floor(segundos);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${String(h)}:${String(m).padStart(2, '0')}:${ss}` : `${String(m)}:${ss}`;
}
