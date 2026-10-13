import type { AncoraV1, Id } from './tipos';
export interface TrechoDoAudio { inicio_s: number; fim_s: number; ancora: AncoraV1 }
/** Narração do Colab (J63/J64): voz clonada, job da fábrica. */
export interface AudioV1 {
  versao: 1; id: Id; versao_id: Id; secao_id: Id; titulo: string;
  sha256_audio: string; voz_sha256: string; job_colab: string; duracao_s: number;
  trechos: TrechoDoAudio[];
}
/** De onde veio a narração gerada pelo app (J106): provedor, voz e modelo escolhidos pela pessoa. */
export interface OrigemDoAudioV2 {
  provedor: string; voz_id: string; voz_nome: string; modelo_id: string;
  /** Caracteres enviados ao provedor (a base da cobrança). */
  caracteres: number;
}
/** Narração gerada dentro do app por um provedor de voz trocável (J106). O player lê os trechos como no V1. */
export interface AudioV2 {
  versao: 2; id: Id; versao_id: Id; secao_id: Id; titulo: string;
  sha256_audio: string; duracao_s: number; origem: OrigemDoAudioV2;
  trechos: TrechoDoAudio[];
}
/** O que o player consome: as duas versões têm os mesmos trechos temporizados. */
export type AudioNarrado = AudioV1 | AudioV2;
export function regrasAudio(a: Pick<AudioNarrado, 'versao_id' | 'duracao_s' | 'trechos'>): boolean {
  return a.trechos.every((t, i) => t.ancora.versao_id === a.versao_id && t.fim_s > t.inicio_s
    && t.fim_s <= a.duracao_s && (i === 0 || t.inicio_s >= a.trechos[i - 1]!.fim_s));
}
