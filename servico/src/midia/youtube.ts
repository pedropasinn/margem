/**
 * Vídeo do YouTube (J109), a parte pura: metadados do yt-dlp, escolha da legenda, leitura das
 * legendas no formato `json3` do YouTube (palavra a palavra nas automáticas, por fala nas manuais),
 * parágrafos do texto e o texto do documento. Nada aqui chama rede nem processo.
 */
import type { PalavraTranscrita } from '@margem/core';
import type { VideoYoutubeV1 } from '@margem/contratos';
import { textoDaTranscricao } from './revisao';

/** O que o importador usa da saída `yt-dlp -J`. */
export interface MetadadosDoYoutube {
  id: string;
  titulo: string | null;
  canal: string | null;
  publicado_em: string | null;
  duracao_s: number | null;
  idioma: string | null;
  descricao: string | null;
  capitulos: { inicio_s: number; titulo: string }[];
  /** Línguas com legenda escrita pelo canal. */
  legendas: string[];
  /** Línguas com legenda automática (inclui as traduções automáticas; a original termina em `-orig`). */
  automaticas: string[];
}

const texto = (valor: unknown, maximo: number): string | null => {
  if (typeof valor !== 'string') return null;
  const limpo = valor.replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  return limpo === '' ? null : limpo.slice(0, maximo);
};

/** Interpreta a saída `yt-dlp -J` (desconfiada: tudo é opcional e limitado). */
export function metadadosDoYtDlp(bruto: unknown, id: string): MetadadosDoYoutube {
  const info = (typeof bruto === 'object' && bruto !== null ? bruto : {}) as Record<string, unknown>;
  const data = typeof info.upload_date === 'string' && /^\d{8}$/.test(info.upload_date) ? info.upload_date : null;
  const duracao = typeof info.duration === 'number' && Number.isFinite(info.duration) && info.duration > 0 ? info.duration : null;
  const capitulos = (Array.isArray(info.chapters) ? info.chapters : [])
    .map((c: unknown) => {
      const cap = (typeof c === 'object' && c !== null ? c : {}) as Record<string, unknown>;
      const inicio = typeof cap.start_time === 'number' && Number.isFinite(cap.start_time) && cap.start_time >= 0 ? Math.round(cap.start_time * 1000) / 1000 : null;
      const titulo = texto(cap.title, 300);
      return inicio === null || titulo === null ? null : { inicio_s: inicio, titulo };
    })
    .filter((c): c is { inicio_s: number; titulo: string } => c !== null)
    .sort((a, b) => a.inicio_s - b.inicio_s)
    .slice(0, 500);
  const chaves = (valor: unknown): string[] => (typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? Object.keys(valor).filter((k) => /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{1,8})*$/.test(k) && k !== 'live_chat') : []);
  const descricao = typeof info.description === 'string' ? info.description.slice(0, 5000) : null;
  return {
    id,
    titulo: texto(info.title, 500),
    canal: texto(info.channel, 300) ?? texto(info.uploader, 300),
    publicado_em: data === null ? null : `${data.slice(0, 4)}-${data.slice(4, 6)}-${data.slice(6, 8)}`,
    duracao_s: duracao,
    idioma: typeof info.language === 'string' && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/.test(info.language) ? info.language : null,
    descricao: descricao !== null && descricao.trim() !== '' ? descricao : null,
    capitulos,
    legendas: chaves(info.subtitles),
    automaticas: chaves(info.automatic_captions),
  };
}

export interface EscolhaDaLegenda { idioma: string; automatica: boolean }

const base = (lingua: string): string => lingua.toLowerCase().split(/[-_]/)[0]!;

/**
 * A legenda que vira texto: a escrita pelo canal na língua do vídeo; senão uma escrita em português
 * ou inglês, ou qualquer outra escrita; senão a automática da língua original (`<língua>-orig` ou a
 * própria língua do vídeo). Tradução automática nunca: ela não é o que se fala no vídeo.
 */
export function escolherLegenda(meta: Pick<MetadadosDoYoutube, 'idioma' | 'legendas' | 'automaticas'>): EscolhaDaLegenda | null {
  const idioma = meta.idioma === null ? null : base(meta.idioma);
  const escritas = meta.legendas;
  const daLingua = (lista: string[], lingua: string): string | undefined => lista.find((l) => l.toLowerCase() === lingua) ?? lista.find((l) => base(l) === lingua);
  const escrita = (idioma === null ? undefined : daLingua(escritas, idioma)) ?? daLingua(escritas, 'pt') ?? daLingua(escritas, 'en') ?? escritas[0];
  if (escrita !== undefined) return { idioma: escrita, automatica: false };
  const originais = meta.automaticas.filter((l) => l.toLowerCase().endsWith('-orig'));
  const automatica = (idioma === null ? undefined : originais.find((l) => base(l) === idioma) ?? meta.automaticas.find((l) => l.toLowerCase() === idioma))
    ?? (originais.length === 1 ? originais[0] : undefined);
  return automatica === undefined ? null : { idioma: automatica, automatica: true };
}

interface EventoJson3 { tStartMs?: unknown; dDurationMs?: unknown; segs?: unknown }

/** Anotações que não são fala: `[Música]`, `[Aplausos]`, `(risos)`, `♪` e o marcador de troca de falante `>>`. */
const NAO_E_FALA = /^(?:>>+|-+|♪+|♫+)$/;

/**
 * Palavras com tempo a partir de uma legenda `json3`. Nas automáticas cada segmento é uma palavra com o
 * seu deslocamento; nas escritas pelo canal, o segmento é a fala inteira e o tempo de cada palavra é
 * repartido pela duração da fala, proporcional ao tamanho da palavra. Anotações entre colchetes ou
 * parênteses que não são fala saem; os tempos ficam em ordem.
 */
export function palavrasDaLegendaJson3(bruto: unknown): PalavraTranscrita[] {
  const eventos = (typeof bruto === 'object' && bruto !== null && Array.isArray((bruto as { events?: unknown }).events)
    ? (bruto as { events: unknown[] }).events : []) as EventoJson3[];
  const saida: PalavraTranscrita[] = [];
  let dentroDeAnotacao = false;
  for (const evento of eventos) {
    if (!Array.isArray(evento.segs) || typeof evento.tStartMs !== 'number' || !Number.isFinite(evento.tStartMs)) continue;
    const inicioDoEvento = Math.max(0, evento.tStartMs);
    const fimDoEvento = inicioDoEvento + (typeof evento.dDurationMs === 'number' && Number.isFinite(evento.dDurationMs) && evento.dDurationMs > 0 ? evento.dDurationMs : 0);
    const pedacos = (evento.segs as unknown[]).map((s) => {
      const seg = (typeof s === 'object' && s !== null ? s : {}) as { utf8?: unknown; tOffsetMs?: unknown };
      const deslocamento = typeof seg.tOffsetMs === 'number' && Number.isFinite(seg.tOffsetMs) && seg.tOffsetMs >= 0 ? seg.tOffsetMs : 0;
      return { texto: typeof seg.utf8 === 'string' ? seg.utf8 : '', inicio: inicioDoEvento + deslocamento };
    });
    pedacos.forEach((pedaco, i) => {
      const fimDoPedaco = Math.max(pedaco.inicio, i + 1 < pedacos.length ? pedacos[i + 1]!.inicio : fimDoEvento);
      const tokens = pedaco.texto.split(/\s+/).filter((t) => {
        if (t === '') return false;
        if (dentroDeAnotacao || /^[[(]/.test(t)) {
          dentroDeAnotacao = !/[\])][.,;:!?…]*$/.test(t);
          return false;
        }
        return !NAO_E_FALA.test(t);
      });
      if (tokens.length === 0) return;
      const total = tokens.reduce((soma, t) => soma + t.length + 1, 0);
      let cursor = pedaco.inicio;
      for (const token of tokens) {
        const fim = cursor + ((fimDoPedaco - pedaco.inicio) * (token.length + 1)) / total;
        saida.push({ texto: token, inicio_s: cursor / 1000, fim_s: fim / 1000 });
        cursor = fim;
      }
    });
  }
  // Falas que se sobrepõem (legendas escritas) não podem fazer o tempo voltar.
  for (let i = 1; i < saida.length; i++) {
    const anterior = saida[i - 1]!, atual = saida[i]!;
    if (atual.inicio_s < anterior.inicio_s) atual.inicio_s = anterior.inicio_s;
    if (atual.fim_s < atual.inicio_s) atual.fim_s = atual.inicio_s;
  }
  return saida.map((p) => ({ texto: p.texto, inicio_s: Math.round(p.inicio_s * 1000) / 1000, fim_s: Math.round(p.fim_s * 1000) / 1000 }));
}

const FIM_DE_FRASE = /[.!?…]["'”’»)\]]*$/;
/** Começos que o motor de TXT leria como lista, citação ou cerca: não podem abrir um parágrafo. */
const COMECO_ESPECIAL = /^(?:[-+*]|\d+[.)]|>|`{3,}|~{3,}|#{1,6})$/;
export const PALAVRAS_POR_PARAGRAFO = 110;
const PAUSA_DE_PARAGRAFO_S = 2.5;

/**
 * Parágrafos (índices das palavras), como `tools/midia/transcricao_whisper.py`: frases inteiras de ~110
 * palavras, parágrafo novo em capítulo novo ou pausa longa. Diferença: legenda automática não tem
 * pontuação, então um parágrafo fecha também ao passar do dobro do tamanho, sem esperar o fim da frase.
 */
export function paragrafosDasPalavras(palavras: readonly PalavraTranscrita[], capitulos: readonly { inicio_s: number }[]): number[][] {
  const inicios = capitulos.slice(1).map((c) => c.inicio_s);
  const grupos: number[][] = [];
  let atual: number[] = [];
  let proximo = 0;
  let pendente = false;
  palavras.forEach((p, i) => {
    while (proximo < inicios.length && p.inicio_s >= inicios[proximo]! - 0.3) { proximo++; pendente = true; }
    if (i > 0 && p.inicio_s - palavras[i - 1]!.fim_s > PAUSA_DE_PARAGRAFO_S) pendente = true;
    if (atual.length > 0 && ((pendente && FIM_DE_FRASE.test(palavras[i - 1]!.texto)) || (pendente && atual.length >= PALAVRAS_POR_PARAGRAFO / 2) || atual.length >= 2 * PALAVRAS_POR_PARAGRAFO)) {
      grupos.push(atual); atual = []; pendente = false;
    }
    atual.push(i);
    if (atual.length >= PALAVRAS_POR_PARAGRAFO && FIM_DE_FRASE.test(p.texto)) { grupos.push(atual); atual = []; pendente = false; }
  });
  if (atual.length > 0) grupos.push(atual);
  const juntos: number[][] = [];
  for (const grupo of grupos) {
    if (juntos.length > 0 && COMECO_ESPECIAL.test(palavras[grupo[0]!]!.texto)) juntos[juntos.length - 1]!.push(...grupo);
    else juntos.push(grupo);
  }
  return juntos;
}

/** Os parágrafos do texto do documento (tokens das palavras, na ordem). */
export function paragrafosDoTexto(palavras: readonly PalavraTranscrita[], capitulos: readonly { inicio_s: number }[]): string[] {
  return paragrafosDasPalavras(palavras, capitulos).map((g) => g.map((i) => palavras[i]!.texto).join(' '));
}

/** O texto do documento quando não há transcrição: o aviso e a descrição do vídeo, se houver. */
export function textoSemTranscricao(meta: Pick<MetadadosDoYoutube, 'descricao'>, motivo: string): string {
  const descricao = (meta.descricao ?? '').split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 30);
  return textoDaTranscricao([`Sem transcrição. ${motivo} O vídeo toca normalmente no player.`, ...(descricao.length > 0 ? ['Descrição do vídeo no YouTube:', ...descricao] : [])]);
}

export function tituloProvisorio(videoId: string): string {
  return `Vídeo do YouTube ${videoId}`;
}

/** O vídeo como o leitor o recebe, montado da linha do banco (o estado da importação vem do job). */
export function videoComEstadoDoJob(video: VideoYoutubeV1, job: { estado: string; error_code: string | null } | null): VideoYoutubeV1 {
  if (video.transcricao.estado !== 'pendente' || job === null || job.estado !== 'falhou') return video;
  return { ...video, transcricao: { estado: 'falhou', detalhe: `A importação parou: ${job.error_code ?? 'erro desconhecido'}.`.slice(0, 500) } };
}
