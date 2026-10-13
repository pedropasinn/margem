/**
 * Visita guiada do livro (J91, `docs/jobs/J91-SPEC.md`): o roteiro narrado de um capítulo e a narração
 * gerada pela fábrica de voz. Os dois são derivados imutáveis; mudar o modelo, o perfil ou a voz gera
 * outra linha.
 *
 * - `RoteiroGuiadoV1`: abertura → paradas (5–12, cada uma com foco num trecho) → fechamento → ponte.
 *   As falas são a unidade da voz (uma cena por fala na fábrica) e do foco (cada fala pertence, no
 *   máximo, a uma parada).
 * - `NarracaoDaVisitaV1`: o MP3 de um roteiro, com o intervalo de cada fala.
 */
import type { AncoraV1, Id } from './tipos';

export type TipoDaParadaV1 =
  | 'tese' | 'conceito' | 'argumento' | 'exemplo' | 'relacao' | 'retorno' | 'dificuldade' | 'visual' | 'nota' | 'pergunta';
export const TIPOS_DE_PARADA: readonly TipoDaParadaV1[] = [
  'tese', 'conceito', 'argumento', 'exemplo', 'relacao', 'retorno', 'dificuldade', 'visual', 'nota', 'pergunta',
];
export type PapelDaFalaV1 = 'abertura' | 'parada' | 'pergunta' | 'transicao' | 'fechamento' | 'ponte';

export interface ParadaDoRoteiroV1 {
  /** 1, 2, 3… na ordem da visita. */
  ordem: number;
  tipo: TipoDaParadaV1;
  titulo: string;
  /** O trecho que "ler o trecho inteiro" mostra. */
  bloco_inicio: Id;
  bloco_fim: Id;
  /** O que acende: a âncora do elemento, da dificuldade, da nota ou do visual (ou o bloco inteiro). */
  foco: AncoraV1;
  /** O outro lado de uma relação, quando fica fora do trecho. */
  ponta: AncoraV1 | null;
  elementos: Id[];
  relacoes: Id[];
  dificuldades: Id[];
  /** Anotações e grifos do leitor que a parada retoma. */
  anotacoes: Id[];
  visuais: Id[];
  pergunta: string | null;
}

export interface FalaDoRoteiroV1 {
  /** `f001`, `f002`… na ordem em que se fala. */
  id: string;
  papel: PapelDaFalaV1;
  /** A parada a que a fala pertence (`parada`, `pergunta`, `transicao`); `null` nas outras. */
  parada: number | null;
  texto: string;
}

export interface RoteiroGuiadoV1 {
  versao: 1;
  id: Id;
  execucao_id: Id;
  versao_id: Id;
  secao_id: Id;
  modelo_id: Id;
  perfil_hash: string;
  capitulo: { titulo: string; numero: number; total: number };
  paradas: ParadaDoRoteiroV1[];
  falas: FalaDoRoteiroV1[];
  perguntas_finais: string[];
  proxima_secao_id: Id | null;
  diagnosticos: { codigo: string; mensagem: string }[];
  execucao: { modelo: string; esforco: string; prompt: string };
  job_id: Id;
  criado_em: string;
}

export interface NarracaoDaVisitaV1 {
  versao: 1;
  id: Id;
  roteiro_id: Id;
  sha256_audio: string;
  voz_sha256: string;
  job_colab: string;
  receita: string;
  duracao_s: number;
  falas: { fala_id: string; inicio_s: number; fim_s: number }[];
  criado_em: string;
}

/** No máximo doze paradas: o motivo da visita é não parar em todo parágrafo. */
export const MAXIMO_DE_PARADAS = 12;

function ancoraCoerente(ancora: AncoraV1, versaoId: Id): boolean {
  return ancora.versao_id === versaoId && ancora.fim_utf16 > ancora.inicio_utf16 && ancora.fim_utf16 - ancora.inicio_utf16 === ancora.citacao.length;
}

/** Invariantes locais (sem o canônico): numeração, ordem das falas e âncoras da mesma versão. */
export function regrasRoteiroGuiado(r: RoteiroGuiadoV1): boolean {
  if (r.paradas.length === 0 || r.paradas.length > MAXIMO_DE_PARADAS) return false;
  if (r.capitulo.numero > r.capitulo.total) return false;
  if (!r.paradas.every((p, i) => p.ordem === i + 1 && ancoraCoerente(p.foco, r.versao_id) && (p.ponta === null || ancoraCoerente(p.ponta, r.versao_id)))) return false;
  const ids = r.falas.map((f) => f.id);
  if (new Set(ids).size !== ids.length || !ids.every((id, i) => id === `f${String(i + 1).padStart(3, '0')}`)) return false;
  // Abertura primeiro; depois as paradas em ordem (parada, pergunta?, transição?); fechamento; ponte por último.
  const ordem: Record<PapelDaFalaV1, number> = { abertura: 0, parada: 1, pergunta: 2, transicao: 3, fechamento: 4, ponte: 5 };
  let anterior: { papel: PapelDaFalaV1; parada: number } = { papel: 'abertura', parada: 0 };
  const falasDaParada = new Map<number, number>();
  for (const [i, fala] of r.falas.entries()) {
    const daParada = fala.papel === 'parada' || fala.papel === 'pergunta' || fala.papel === 'transicao';
    if (daParada !== (fala.parada !== null)) return false;
    if (fala.parada !== null && (fala.parada < 1 || fala.parada > r.paradas.length)) return false;
    if (i === 0 && fala.papel !== 'abertura') return false;
    if (i > 0 && fala.papel === 'abertura') return false;
    const atual = { papel: fala.papel, parada: fala.parada ?? (fala.papel === 'fechamento' || fala.papel === 'ponte' ? r.paradas.length + 1 : 0) };
    if (atual.parada < anterior.parada) return false;
    if (atual.parada === anterior.parada && i > 0 && ordem[atual.papel] <= ordem[anterior.papel]) return false;
    if (daParada && atual.parada > anterior.parada && fala.papel !== 'parada') return false;
    if (fala.papel === 'parada') falasDaParada.set(fala.parada!, (falasDaParada.get(fala.parada!) ?? 0) + 1);
    anterior = atual;
  }
  if (!r.paradas.every((p) => falasDaParada.get(p.ordem) === 1)) return false;
  if (r.falas.some((f) => f.papel === 'ponte') && r.proxima_secao_id === null) return false;
  return true;
}

/** Tempos em ordem, sem sobreposição, dentro do arquivo; cada fala uma vez. */
export function regrasNarracaoDaVisita(n: NarracaoDaVisitaV1): boolean {
  const ids = n.falas.map((f) => f.fala_id);
  if (new Set(ids).size !== ids.length) return false;
  return n.falas.every((f, i) => f.fim_s > f.inicio_s && f.fim_s <= n.duracao_s + 0.05 && (i === 0 || f.inicio_s >= n.falas[i - 1]!.fim_s));
}
