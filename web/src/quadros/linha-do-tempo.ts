/**
 * A linha do tempo da análise curta de um quadro, pura (sem DOM): as batidas com o tempo de cada uma e o de
 * cada palavra da fala. Com narração (`manifesto.json`), valem os tempos reais da voz; as palavras do
 * manifesto casam, em ordem, com as palavras da narração da curta, e as que não casarem são interpoladas
 * (`completarPalavras`, o mesmo serviço do karaokê do leitor). Sem narração, os tempos estimados da curta
 * e as palavras distribuídas pelo peso de cada uma (`estimarPalavras`).
 */
import type { AnaliseCurtaDaObraV1, BatidaVisual, RetanguloDaObra, TrechoTemporizado } from '@margem/contratos';
import { completarPalavras, estimarPalavras, palavrasDoTexto, ultimaPalavraNoInstante } from '@margem/core/karaoke';
import type { ManifestoDaNarracao } from './tipos';

export interface PalavraDaFala { inicio: number; fim: number; inicio_s: number; fim_s: number }
export interface BatidaNaLinha {
  indice: number;
  batida: BatidaVisual;
  inicio_s: number;
  fim_s: number;
  /** O texto falado (a narração da batida). */
  texto: string;
  palavras: PalavraDaFala[];
}
export interface LinhaDoTempo { batidas: BatidaNaLinha[]; duracao_s: number; narrada: boolean }

const normalizar = (texto: string): string => texto.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]/gu, '');
const PAUSA_FINAL_S = 0.35;

function semBloco(trechos: readonly TrechoTemporizado[]): PalavraDaFala[] {
  return trechos.map((t) => ({ inicio: t.inicio_utf16, fim: t.fim_utf16, inicio_s: t.inicio_s, fim_s: t.fim_s }));
}

/** Casa as palavras do manifesto com as da narração, em ordem (uma palavra do manifesto pode pular adiante até 3). */
export function casarPalavras(texto: string, faladas: readonly { texto: string; inicio_s: number; fim_s: number }[]): TrechoTemporizado[] {
  const doTexto = palavrasDoTexto(texto);
  const casadas: TrechoTemporizado[] = [];
  let cursor = 0;
  for (const falada of faladas) {
    const alvo = normalizar(falada.texto);
    if (!alvo) continue;
    for (let salto = 0; salto < 4 && cursor + salto < doTexto.length; salto += 1) {
      const candidata = doTexto[cursor + salto]!;
      if (normalizar(texto.slice(candidata.inicio_utf16, candidata.fim_utf16)) === alvo) {
        casadas.push({ bloco_id: 'b', inicio_utf16: candidata.inicio_utf16, fim_utf16: candidata.fim_utf16, inicio_s: falada.inicio_s, fim_s: falada.fim_s });
        cursor += salto + 1;
        break;
      }
    }
  }
  return casadas;
}

export function montarLinhaDoTempo(curta: AnaliseCurtaDaObraV1, manifesto: ManifestoDaNarracao | null): LinhaDoTempo {
  const narrada = manifesto !== null && manifesto.batidas.length === curta.batidas.length;
  const batidas = curta.batidas.map((batida, indice): BatidaNaLinha => {
    const texto = batida.narracao;
    if (narrada) {
      const falada = manifesto.batidas[indice]!;
      const frase = { bloco_id: 'b', inicio_utf16: 0, fim_utf16: texto.length, inicio_s: falada.inicio_s, fim_s: falada.fim_s, texto };
      return { indice, batida, texto, inicio_s: falada.inicio_s, fim_s: falada.fim_s, palavras: semBloco(completarPalavras([frase], casarPalavras(texto, falada.palavras))) };
    }
    const fimDaFala = Math.max(batida.inicio_s + 0.2, batida.fim_s - PAUSA_FINAL_S);
    return { indice, batida, texto, inicio_s: batida.inicio_s, fim_s: batida.fim_s, palavras: semBloco(estimarPalavras({ bloco_id: 'b', inicio_utf16: 0, fim_utf16: texto.length, inicio_s: batida.inicio_s, fim_s: fimDaFala, texto })) };
  });
  const ultima = batidas.at(-1)?.fim_s ?? 0;
  return { batidas, narrada, duracao_s: narrada ? Math.max(manifesto.duracao_s, ultima) : ultima };
}

/** A batida em curso: a última que já começou (no silêncio entre duas, vale a anterior). */
export function batidaNoInstante(linha: LinhaDoTempo, t: number): number {
  let indice = 0;
  for (const b of linha.batidas) { if (b.inicio_s <= t + 1e-6) indice = b.indice; else break; }
  return indice;
}

/** A palavra em curso dentro da batida (-1 antes da primeira). */
export function palavraNoInstante(batida: BatidaNaLinha, t: number): number {
  return ultimaPalavraNoInstante(batida.palavras, t);
}

/** A câmera no instante: de → para em cada batida, com a mesma suavização do núcleo (`cameraNoInstante`). */
export function cameraDaLinha(linha: LinhaDoTempo, t: number): RetanguloDaObra {
  const b = linha.batidas[batidaNoInstante(linha, t)];
  if (!b) return { x: 0, y: 0, largura: 1, altura: 1 };
  const span = Math.max(0.01, b.fim_s - b.inicio_s);
  const u0 = Math.max(0, Math.min(1, (t - b.inicio_s) / span));
  const u = u0 * u0 * (3 - 2 * u0);
  const { de, para } = b.batida.camera;
  return { x: de.x + (para.x - de.x) * u, y: de.y + (para.y - de.y) * u, largura: de.largura + (para.largura - de.largura) * u, altura: de.altura + (para.altura - de.altura) * u };
}

/** ← e →: a batida anterior (ou o começo da atual, se já se passou um pouco dela) e a próxima. */
export function saltarBatida(linha: LinhaDoTempo, t: number, sentido: 1 | -1): number {
  const atual = batidaNoInstante(linha, t);
  if (sentido === 1) return linha.batidas[atual + 1]?.inicio_s ?? linha.duracao_s;
  const b = linha.batidas[atual];
  if (b && t - b.inicio_s > 1.2) return b.inicio_s;
  return linha.batidas[Math.max(0, atual - 1)]?.inicio_s ?? 0;
}
