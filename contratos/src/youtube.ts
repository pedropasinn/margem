/**
 * Vídeos do YouTube (J109): o pedido de importação e o vídeo de um documento importado.
 *
 * `ImportacaoYoutubeV1` é o corpo de `POST /api/importacoes/youtube` (202 `{ documento_id, job_id }`;
 * 409 `{ erro: 'documento_duplicado', existente: { documento_id } }`; 400 para URL que não é de um
 * vídeo do YouTube). Que a URL é do YouTube o serviço confere com `idDoVideoDoYoutube` do núcleo.
 */
import type { Id } from './tipos';

export interface ImportacaoYoutubeV1 {
  /** Qualquer forma de link de vídeo do YouTube (watch, youtu.be, embed, shorts, live). */
  url: string;
  /** Título do documento; sem ele, o do vídeo. */
  titulo?: string;
  /** Autor do documento; sem ele, o canal. */
  autor?: string;
}

export type EstadoDaTranscricaoDoYoutube = 'pendente' | 'pronta' | 'sem_sincronia' | 'sem_transcricao' | 'falhou';

export interface VideoYoutubeV1 {
  versao: 1;
  documento_id: Id;
  video_id: string;
  /** `https://www.youtube.com/watch?v=<video_id>`. */
  url: string;
  titulo: string;
  canal?: string;
  publicado_em?: string;
  duracao_s?: number;
  capitulos: { inicio_s: number; titulo: string }[];
  transcricao: {
    estado: EstadoDaTranscricaoDoYoutube;
    origem?: 'legendas' | 'legendas_automaticas' | 'transcritor_local';
    idioma?: string;
    /** A MidiaV1 com a sincronia (o áudio local, `fonte.url` no YouTube); só quando `pronta`. */
    midia_id?: Id;
    detalhe?: string;
  };
}

/** A URL é a do próprio vídeo; `midia_id` só existe com a transcrição pronta; capítulos em ordem. */
export function regrasVideoYoutube(valor: VideoYoutubeV1): boolean {
  if (valor.url !== `https://www.youtube.com/watch?v=${valor.video_id}`) return false;
  if ((valor.transcricao.midia_id !== undefined) !== (valor.transcricao.estado === 'pronta')) return false;
  if (valor.transcricao.origem !== undefined && !['pronta', 'sem_sincronia'].includes(valor.transcricao.estado)) return false;
  for (let i = 1; i < valor.capitulos.length; i++) if (valor.capitulos[i]!.inicio_s < valor.capitulos[i - 1]!.inicio_s) return false;
  return true;
}
