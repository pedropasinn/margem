/**
 * Voz de reserva (Web Speech API): o que não depende do React. Quando o capítulo não tem áudio
 * preparado, o "Ouvir a partir daqui" lê os blocos com a voz do sistema, frase por frase, e o karaokê
 * destaca a frase (e a palavra, se a voz avisar onde está).
 */
import type { Id } from '@margem/contratos';
import { frasesDoTexto } from '@margem/core/leitura-comentada';
import type { PontoDeTexto } from '../tipos';

export interface FraseDaVoz { bloco_id: Id; inicio_utf16: number; fim_utf16: number; texto: string }

/** Blocos que não se leem em voz alta: imagem, fórmula, código, tabela e as notas de rodapé no meio do texto. */
const NAO_SE_LEEM = new Set(['figura', 'equacao', 'codigo', 'tabela', 'nota_rodape']);

/** As frases do capítulo, na ordem do texto. */
export function frasesDoCapitulo(blocos: readonly { id: Id; tipo?: string; texto: string }[]): FraseDaVoz[] {
  return blocos.flatMap((bloco) => NAO_SE_LEEM.has(bloco.tipo ?? '') ? [] : frasesDoTexto(bloco.texto)
    .map((f) => ({ bloco_id: bloco.id, inicio_utf16: f.inicio, fim_utf16: f.fim, texto: bloco.texto.slice(f.inicio, f.fim) })));
}

/** A frase onde a leitura começa: a que contém o ponto; senão a primeira do bloco ou de um bloco seguinte. */
export function fraseDoPonto(frases: readonly FraseDaVoz[], blocos: readonly { id: Id }[], ponto: PontoDeTexto | null): number {
  if (!ponto || frases.length === 0) return 0;
  const ordem = new Map(blocos.map((b, i) => [b.id, i]));
  const alvo = ordem.get(ponto.bloco_id);
  if (alvo === undefined) return 0;
  let achado = -1;
  for (let i = 0; i < frases.length; i += 1) {
    const f = frases[i]!;
    const posicao = ordem.get(f.bloco_id) ?? -1;
    if (posicao > alvo) return achado >= 0 ? achado : i;
    if (posicao === alvo) {
      if (f.inicio_utf16 <= ponto.offset_utf16) achado = i;
      else if (achado < 0) return i;
    }
  }
  return achado >= 0 ? achado : 0;
}

/**
 * A melhor voz em português do aparelho: pt-BR antes de pt-*, e entre elas as neurais ("Natural",
 * "Neural", "Online", "Google", "Premium", "Enhanced") antes das sintéticas antigas. `null` sem voz em português.
 */
export function escolherVoz(vozes: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const nota = (voz: SpeechSynthesisVoice): number => {
    const lingua = voz.lang.replace('_', '-').toLowerCase();
    if (!lingua.startsWith('pt')) return -1;
    let pontos = lingua === 'pt-br' ? 100 : 50;
    if (/natural|neural|online|premium|enhanced|aprimorad/i.test(voz.name)) pontos += 20;
    if (/google/i.test(voz.name)) pontos += 10;
    if (/espeak/i.test(voz.name)) pontos -= 15;
    if (voz.default) pontos += 1;
    return pontos;
  };
  let melhor: SpeechSynthesisVoice | null = null;
  let maior = -1;
  for (const voz of vozes) { const n = nota(voz); if (n > maior) { maior = n; melhor = voz; } }
  return maior >= 0 ? melhor : null;
}

/** A palavra que começa em `offset` (do evento `boundary`), até o próximo espaço. */
export function palavraEm(texto: string, offset: number, comprimento?: number): { inicio: number; fim: number } | null {
  if (offset < 0 || offset >= texto.length) return null;
  if (comprimento && comprimento > 0) return { inicio: offset, fim: Math.min(texto.length, offset + comprimento) };
  const resto = texto.slice(offset).search(/[\s—–]/u);
  const fim = resto < 0 ? texto.length : offset + resto;
  return fim > offset ? { inicio: offset, fim } : null;
}

export function vozDisponivel(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function';
}
