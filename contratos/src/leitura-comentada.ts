/**
 * Leitura comentada integral (J92, `docs/jobs/J92-SPEC.md`): um professor lê o capítulo inteiro, na
 * ordem, e para onde o Margem já tem algo a dizer — **todos** os grifos e **todas** as relações do
 * capítulo, cada um no ponto do texto em que está ancorado.
 *
 * - `LeituraComentadaV1`: os trechos lidos (uma frase de um bloco cada, lida literalmente) e as pausas
 *   (a fala do professor depois de um trecho, com as fontes que ela comenta). Nenhum limite de tamanho
 *   nem de quantidade de comentários: decisão de produto (o comentário tem o tamanho que o assunto pede).
 * - `NarracaoDaLeituraV1`: o MP3 montado do capítulo, com o intervalo de cada fala (trechos e pausas na
 *   ordem da leitura) e, quando houver alinhamento, as palavras do livro com tempo.
 */
import type { AncoraV1, Id } from './tipos';
import type { TrechoTemporizado } from './midia';

/** Uma frase do livro, lida literalmente. `texto` é o do bloco; `falado` é o que a voz diz (pronúncia normalizada). */
export interface TrechoLidoV1 {
  /** `t0001`, `t0002`… na ordem da leitura. */
  id: string;
  bloco_id: Id;
  inicio_utf16: number;
  fim_utf16: number;
  texto: string;
  falado: string;
}

export interface FonteDoComentarioV1 {
  tipo: 'grifo' | 'relacao';
  id: Id;
}

/** Uma parada do professor, depois de um trecho lido. */
export interface PausaDaLeituraV1 {
  /** `p001`, `p002`… na ordem da leitura. */
  id: string;
  /** O trecho depois do qual a leitura para. */
  depois_de: string;
  /** O que a pausa comenta, na ordem do texto (âncora do grifo, ou ponta posterior da relação). */
  fontes: FonteDoComentarioV1[];
  /** As âncoras comentadas (acendem durante a pausa). */
  foco: AncoraV1[];
  /** O outro lado das relações (aparece no véu). */
  pontas: AncoraV1[];
  /** A fala do professor; vazia quando o Codex não a escreveu (diagnóstico; a pausa fica só com o foco). */
  texto: string;
  falado: string;
}

export interface LeituraComentadaV1 {
  versao: 1;
  id: Id;
  execucao_id: Id;
  versao_id: Id;
  secao_id: Id;
  /** A revisão do modelo do capítulo de onde vieram as relações. */
  modelo_id: Id;
  /** Hash do conjunto de fontes (grifos e relações): mudou um grifo, é outra leitura. */
  fontes_hash: string;
  capitulo: { titulo: string; numero: number; total: number };
  trechos: TrechoLidoV1[];
  pausas: PausaDaLeituraV1[];
  /** Blocos que a voz não lê (código, tabela, equação, figura, legenda). */
  saltados: { bloco_id: Id; tipo: string }[];
  proxima_secao_id: Id | null;
  diagnosticos: { codigo: string; mensagem: string }[];
  execucao: { modelo: string; esforco: string; prompt: string };
  job_id: Id;
  criado_em: string;
}

export interface NarracaoDaLeituraV1 {
  versao: 1;
  id: Id;
  leitura_id: Id;
  sha256_audio: string;
  voz_sha256: string;
  jobs_colab: string[];
  receita: string;
  duracao_s: number;
  /** Como a montagem separa leitura e comentário. */
  transicao: { silencio_antes_s: number; silencio_depois_s: number; sinal: boolean; contraste: boolean };
  /** Uma entrada por trecho e por pausa com fala, na ordem da leitura. */
  falas: { fala_id: string; inicio_s: number; fim_s: number }[];
  /** Palavras do livro com tempo (alinhamento forçado); vazio quando não houve alinhamento. */
  palavras: TrechoTemporizado[];
  criado_em: string;
}

const idDoTrecho = (i: number): string => `t${String(i + 1).padStart(4, '0')}`;
const idDaPausa = (i: number): string => `p${String(i + 1).padStart(3, '0')}`;

function ancoraCoerente(ancora: AncoraV1, versaoId: Id): boolean {
  return ancora.versao_id === versaoId && ancora.fim_utf16 > ancora.inicio_utf16 && ancora.fim_utf16 - ancora.inicio_utf16 === ancora.citacao.length;
}

/**
 * A ordem da leitura: cada trecho, e depois dele a sua pausa (se houver). É a ordem das cenas da voz e
 * das falas da narração. Pausas sem fala não entram (não há o que dizer).
 */
export function falasDaLeitura(leitura: Pick<LeituraComentadaV1, 'trechos' | 'pausas'>): { id: string; tipo: 'trecho' | 'pausa'; falado: string }[] {
  const depois = new Map(leitura.pausas.map((pausa) => [pausa.depois_de, pausa]));
  return leitura.trechos.flatMap((trecho) => {
    const pausa = depois.get(trecho.id);
    const aqui = { id: trecho.id, tipo: 'trecho' as const, falado: trecho.falado };
    return pausa && pausa.falado.trim() !== '' ? [aqui, { id: pausa.id, tipo: 'pausa' as const, falado: pausa.falado }] : [aqui];
  });
}

/**
 * Invariantes locais (sem o canônico): ids em sequência, trechos de um mesmo bloco em ordem e sem
 * sobreposição, texto do tamanho do intervalo, pausas em ordem e nunca duas depois do mesmo trecho,
 * cada fonte uma vez só, âncoras da mesma versão, fala e fala normalizada juntas.
 */
export function regrasLeituraComentada(l: LeituraComentadaV1): boolean {
  if (l.trechos.length === 0 || l.capitulo.numero > l.capitulo.total) return false;
  const fimNoBloco = new Map<Id, number>();
  const blocosVistos: Id[] = [];
  for (const [i, trecho] of l.trechos.entries()) {
    if (trecho.id !== idDoTrecho(i) || trecho.fim_utf16 <= trecho.inicio_utf16 || trecho.fim_utf16 - trecho.inicio_utf16 !== trecho.texto.length) return false;
    if (trecho.falado.trim() === '') return false;
    const anterior = fimNoBloco.get(trecho.bloco_id);
    // Um bloco é lido de uma vez: depois de passar para outro, não se volta a ele.
    if (anterior !== undefined && (blocosVistos.at(-1) !== trecho.bloco_id || trecho.inicio_utf16 < anterior)) return false;
    if (anterior === undefined) blocosVistos.push(trecho.bloco_id);
    fimNoBloco.set(trecho.bloco_id, trecho.fim_utf16);
  }
  const posicao = new Map(l.trechos.map((trecho, i) => [trecho.id, i]));
  const fontes = new Set<string>();
  let ultima = -1;
  for (const [i, pausa] of l.pausas.entries()) {
    if (pausa.id !== idDaPausa(i)) return false;
    const onde = posicao.get(pausa.depois_de);
    if (onde === undefined || onde <= ultima) return false;
    ultima = onde;
    if (pausa.fontes.length === 0 || pausa.foco.length === 0) return false;
    for (const fonte of pausa.fontes) {
      const chave = `${fonte.tipo}:${fonte.id}`;
      if (fontes.has(chave)) return false;
      fontes.add(chave);
    }
    if (![...pausa.foco, ...pausa.pontas].every((ancora) => ancoraCoerente(ancora, l.versao_id))) return false;
    if ((pausa.texto.trim() === '') !== (pausa.falado.trim() === '')) return false;
  }
  if (new Set(l.saltados.map((s) => s.bloco_id)).size !== l.saltados.length) return false;
  if (l.saltados.some((s) => fimNoBloco.has(s.bloco_id))) return false;
  return true;
}

/** Tempos em ordem, sem sobreposição, dentro do arquivo; cada fala uma vez; palavras em ordem de tempo. */
export function regrasNarracaoDaLeitura(n: NarracaoDaLeituraV1): boolean {
  const ids = n.falas.map((f) => f.fala_id);
  if (new Set(ids).size !== ids.length || new Set(n.jobs_colab).size !== n.jobs_colab.length) return false;
  const falasOk = n.falas.every((f, i) => f.fim_s > f.inicio_s && f.fim_s <= n.duracao_s + 0.05 && (i === 0 || f.inicio_s >= n.falas[i - 1]!.fim_s - 1e-6));
  const palavrasOk = n.palavras.every((p, i) => p.fim_s >= p.inicio_s && p.fim_utf16 > p.inicio_utf16 && p.fim_s <= n.duracao_s + 0.5
    && (i === 0 || p.inicio_s >= n.palavras[i - 1]!.inicio_s - 1e-6));
  return falasOk && palavrasOk;
}
