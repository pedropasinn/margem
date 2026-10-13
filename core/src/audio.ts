import type { AudioNarrado, CanonicoV1, Id, TrechoDoAudio } from '@margem/contratos';
import { conferirTextoAncora } from '@margem/contratos/texto';
/** Entrada local válida; as referências e a citação pertencem ao capítulo desta versão. */
export function conferirAudioNoCanonico(audio: Pick<AudioNarrado, 'versao_id' | 'secao_id' | 'trechos'>, versaoId: Id, canonico: CanonicoV1): boolean {
  if (audio.versao_id !== versaoId) return false;
  const secao = canonico.secoes.find(s => s.id === audio.secao_id);
  if (!secao) return false;
  const inicio = canonico.blocos.findIndex(b => b.id === secao.bloco_inicio);
  const fim = canonico.blocos.findIndex(b => b.id === secao.bloco_fim);
  const blocos = new Map(canonico.blocos.slice(inicio, fim + 1).map(b => [b.id, b]));
  return audio.trechos.every(t => {
    const bloco = blocos.get(t.ancora.bloco_id);
    return bloco !== undefined && conferirTextoAncora(bloco, t.ancora);
  });
}
/** Lacunas e fim do arquivo não mantêm um destaque antigo. */
export function trechoNoInstante(audio: Pick<AudioNarrado, 'trechos'>, segundos: number): TrechoDoAudio | null {
  return audio.trechos.find(t => segundos >= t.inicio_s && segundos < t.fim_s) ?? null;
}
