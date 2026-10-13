/**
 * O que o player toca (J71): a mídia com transcrição alinhada (`MidiaV1`, vídeo ou áudio, com
 * palavras) e o áudio narrado (`AudioV1` do Colab, J63/J64, ou `AudioV2` gerado no app, J106; por frase).
 * Todos viram a mesma fonte.
 *
 * J109: mídia cuja `fonte.url` é um vídeo do YouTube toca pelo player oficial embutido (cada
 * reprodução conta para o canal); o arquivo local, quando existe, fica como alternativa explícita.
 * Vídeo importado por link sem transcrição sincronizada (`VideoYoutubeV1` sem mídia) também toca,
 * sem karaokê.
 */
import { useEffect, useRef, useState } from 'react';
import type { AudioNarrado, Id, MidiaV1, TrechoTemporizado, VideoYoutubeV1 } from '@margem/contratos';
import { frasesDoAudio } from '@margem/core/midia';
import { idDoVideoDoYoutube, urlDeAssistirNoYoutube } from '@margem/core/youtube';
import { pedir } from '../../biblioteca/api';

export interface FonteDeReproducao {
  id: Id;
  origem: 'midia' | 'audio' | 'youtube';
  /** O que se apresenta: vídeo (ao lado do texto) ou só áudio. */
  tipo: 'video' | 'audio';
  titulo: string;
  /** O arquivo servido pelo Margem; `null` quando só há o vídeo no YouTube. */
  url: string | null;
  /** O que o arquivo local é (o de um vídeo do YouTube é só o áudio). */
  tipoDoArquivo: 'video' | 'audio';
  /** Vídeo do YouTube: toca pelo player embutido. */
  youtube: { id: string; url: string } | null;
  duracao_s: number;
  largura?: number;
  altura?: number;
  palavras: readonly TrechoTemporizado[];
  frases: readonly TrechoTemporizado[];
  capitulos: readonly { inicio_s: number; titulo: string }[];
  fonte: MidiaV1['fonte'];
  /** Chave da posição lembrada: o arquivo, não a linha (a transcrição revisada do J90 é outra mídia do mesmo vídeo). */
  lembranca: string;
}

function youtubeDaUrl(url: string | undefined): FonteDeReproducao['youtube'] {
  const id = url === undefined ? null : idDoVideoDoYoutube(url);
  return id === null ? null : { id, url: urlDeAssistirNoYoutube(id) };
}

export function fonteDaMidia(m: MidiaV1): FonteDeReproducao {
  const youtube = youtubeDaUrl(m.fonte?.url);
  return {
    id: m.id, origem: 'midia', tipo: youtube !== null ? 'video' : m.tipo, titulo: m.titulo, url: `/api/midias/${m.id}/arquivo`, tipoDoArquivo: m.tipo, youtube, duracao_s: m.duracao_s,
    ...(m.largura !== undefined && m.altura !== undefined ? { largura: m.largura, altura: m.altura } : {}),
    palavras: m.palavras, frases: m.frases, capitulos: m.capitulos, fonte: m.fonte, lembranca: `arquivo:${m.sha256}`,
  };
}

export function fonteDoAudio(a: AudioNarrado): FonteDeReproducao {
  return { id: a.id, origem: 'audio', tipo: 'audio', titulo: a.titulo, url: `/api/audios/${a.id}/arquivo`, tipoDoArquivo: 'audio', youtube: null, duracao_s: a.duracao_s,
    palavras: [], frases: frasesDoAudio(a), capitulos: [], fonte: null, lembranca: a.id };
}

/** Vídeo importado por link ainda sem mídia sincronizada: toca pelo YouTube, sem karaokê. */
export function fonteDoVideoDoYoutube(v: VideoYoutubeV1): FonteDeReproducao {
  return {
    id: v.documento_id, origem: 'youtube', tipo: 'video', titulo: v.titulo, url: null, tipoDoArquivo: 'video',
    youtube: { id: v.video_id, url: v.url }, duracao_s: v.duracao_s ?? 0, palavras: [], frases: [], capitulos: v.capitulos,
    fonte: { url: v.url, ...(v.canal === undefined ? {} : { canal: v.canal }) }, lembranca: `youtube:${v.video_id}`,
  };
}

/** As fontes de vídeo da versão: as mídias e, se nenhuma for desse vídeo do YouTube, o próprio vídeo. */
export function fontesDasMidias(midias: readonly MidiaV1[], youtube: VideoYoutubeV1 | null | undefined, versaoId: Id): FonteDeReproducao[] {
  const deMidia = midias.filter((m) => m.versao_id === versaoId).map(fonteDaMidia);
  if (youtube && !deMidia.some((f) => f.youtube?.id === youtube.video_id)) deMidia.push(fonteDoVideoDoYoutube(youtube));
  return deMidia.sort((a, b) => Number(b.tipo === 'video') - Number(a.tipo === 'video'));
}

export type EstadoDasFontes = { estado: 'carregando' } | { estado: 'erro' } | { estado: 'pronto'; fontes: FonteDeReproducao[] };

/**
 * As fontes do capítulo: as mídias da versão (vídeo primeiro) e os áudios narrados do capítulo.
 * Uma falha numa das duas listas não esconde a outra. `recarga` (J106) lista de novo sem passar por
 * "carregando" — uma narração recém-gerada entra sem fechar o player aberto.
 */
export function useFontesDeReproducao(versaoId: Id, secaoId: Id, recarga = 0): EstadoDasFontes {
  const [estado, definir] = useState<EstadoDasFontes>({ estado: 'carregando' });
  const capitulo = useRef('');
  useEffect(() => {
    let ativo = true;
    if (capitulo.current !== `${versaoId}:${secaoId}`) { capitulo.current = `${versaoId}:${secaoId}`; definir({ estado: 'carregando' }); }
    void Promise.allSettled([
      pedir<{ midias: MidiaV1[]; youtube?: VideoYoutubeV1 | null }>(`/api/versoes/${versaoId}/midias`),
      pedir<{ audios: AudioNarrado[] }>(`/api/versoes/${versaoId}/capitulos/${secaoId}/audios`),
    ]).then(([midias, audios]) => {
      if (!ativo) return;
      if (midias.status === 'rejected' && audios.status === 'rejected') { definir({ estado: 'erro' }); return; }
      const deMidia = midias.status === 'fulfilled' ? fontesDasMidias(midias.value.midias, midias.value.youtube, versaoId) : [];
      const deAudio = audios.status === 'fulfilled' ? audios.value.audios.filter((a) => a.versao_id === versaoId && a.secao_id === secaoId).map(fonteDoAudio) : [];
      definir({ estado: 'pronto', fontes: [...deMidia, ...deAudio] });
    });
    return () => { ativo = false; };
  }, [versaoId, secaoId, recarga]);
  return estado;
}

/** Preferências do player, por navegador (não são dado do documento). */
export const CHAVES = {
  velocidade: 'margem:midia:velocidade',
  destaque: 'margem:midia:destaque',
  video: 'margem:midia:video',
  largura: 'margem:midia:largura-video',
  legendas: 'margem:midia:legendas-dos-grifos',
  posicao: (id: Id) => `margem:midia:posicao:${id}`,
} as const;

export function lerLocal(chave: string): string | null {
  try { return localStorage.getItem(chave); } catch { return null; }
}
export function gravarLocal(chave: string, valor: string): void {
  try { localStorage.setItem(chave, valor); } catch { /* sem armazenamento: segue sem lembrar */ }
}

/** A posição guardada da fonte; a chave antiga (id da mídia, J71) ainda vale como reserva. */
export function posicaoGuardada(fonte: Pick<FonteDeReproducao, 'id' | 'lembranca'>): number {
  return Number(lerLocal(CHAVES.posicao(fonte.lembranca)) ?? lerLocal(CHAVES.posicao(fonte.id)));
}

export const VELOCIDADES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export function velocidadeGuardada(): number {
  const valor = Number(lerLocal(CHAVES.velocidade));
  return Number.isFinite(valor) && valor >= 0.5 && valor <= 2.5 ? valor : 1;
}

/** "1,25×": vírgula decimal, sem zeros sobrando. */
export function rotuloDaVelocidade(v: number): string {
  return `${String(Math.round(v * 100) / 100).replace('.', ',')}×`;
}
