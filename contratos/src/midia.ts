import type { AncoraV1, Id } from './tipos';

/** Um intervalo de texto de um bloco com o seu intervalo de tempo na mídia. */
export interface TrechoTemporizado {
  bloco_id: Id;
  inicio_utf16: number;
  fim_utf16: number;
  inicio_s: number;
  fim_s: number;
}

/**
 * Mídia de um documento cuja versão de texto é a transcrição (J71). O arquivo é imutável e
 * guardado por hash; o alinhamento palavra→tempo pertence à versão (`versao_id`) e usa offsets
 * UTF-16 no texto do bloco, resolvidos pelo serviço a partir das palavras transcritas.
 */
export interface MidiaV1 {
  versao: 1;
  id: Id;
  documento_id: Id;
  versao_id: Id;
  tipo: 'video' | 'audio';
  titulo: string;
  sha256: string;
  mime: 'video/mp4' | 'video/webm' | 'audio/mpeg' | 'audio/mp4' | 'audio/webm' | 'audio/ogg';
  bytes: number;
  duracao_s: number;
  largura?: number;
  altura?: number;
  fonte: { url: string; canal?: string; publicado_em?: string } | null;
  transcricao: { motor: string; idioma: string; sha256: string };
  capitulos: { inicio_s: number; titulo: string }[];
  palavras: TrechoTemporizado[];
  frases: TrechoTemporizado[];
}

/** Folga para o fim da última palavra: o reconhecimento às vezes passa alguns décimos do arquivo. */
export const FOLGA_DO_FIM_S = 0.5;

function trechosCoerentes(trechos: readonly TrechoTemporizado[], duracao: number): boolean {
  const fins = new Map<Id, number>();
  let anterior = 0;
  for (const t of trechos) {
    if (t.inicio_utf16 >= t.fim_utf16 || t.fim_s < t.inicio_s || t.fim_s > duracao + FOLGA_DO_FIM_S) return false;
    // Em ordem de tempo; dentro de um bloco, em ordem de texto e sem sobreposição.
    if (t.inicio_s < anterior || t.inicio_utf16 < (fins.get(t.bloco_id) ?? 0)) return false;
    anterior = t.inicio_s;
    fins.set(t.bloco_id, t.fim_utf16);
  }
  return true;
}

/** Invariantes locais (sem o canônico): tempos, ordem, tipo × MIME e capítulos. */
export function regrasMidia(m: MidiaV1): boolean {
  if ((m.tipo === 'video') !== m.mime.startsWith('video/')) return false;
  if (m.tipo === 'audio' && (m.largura !== undefined || m.altura !== undefined)) return false;
  if ((m.largura === undefined) !== (m.altura === undefined)) return false;
  if (!m.capitulos.every((c, i) => c.inicio_s < m.duracao_s && (i === 0 || c.inicio_s > m.capitulos[i - 1]!.inicio_s))) return false;
  return trechosCoerentes(m.palavras, m.duracao_s) && trechosCoerentes(m.frases, m.duracao_s);
}

/**
 * Conceitos programados de um vídeo (noite2/video-popups): poucos momentos escolhidos pelo Codex
 * com um conceito que merece explicação curta. O modelo devolve parágrafo + citação literal; o
 * serviço confere a citação, resolve a âncora e o instante (o tempo da primeira palavra citada).
 * Gravado como derivado imutável da mídia (`0022_conceitos_do_video.sql`).
 */
export interface ConceitoDoVideoV1 {
  id: Id;
  instante_s: number;
  titulo: string;
  /** Rótulo da pílula sobre o vídeo (1–3 palavras, ≤ 20 caracteres), desde `conceitos-do-video@2`. */
  curto?: string;
  explicacao: string;
  ancora: AncoraV1;
}
export interface ConceitosDoVideoV1 {
  versao: 1;
  id: Id;
  midia_id: Id;
  versao_id: Id;
  conceitos: ConceitoDoVideoV1[];
  diagnosticos: { codigo: string; mensagem: string }[];
  execucao: { modelo: string; esforco: string; prompt: string };
  job_id: Id;
  criado_em: string;
}
