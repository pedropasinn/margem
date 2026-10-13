/**
 * Leitura comentada integral (J92): puro, sem banco nem DOM.
 *
 * - `frasesDoTexto` e `trechosDoCapitulo`: o capítulo em frases lidas literalmente (uma cena de voz por
 *   frase), com os blocos que a voz não lê (código, tabela…) saltados.
 * - `pausasDasFontes`: cada grifo e cada relação no ponto do texto em que está ancorado (a frase onde
 *   termina a âncora; na relação, a ponta que aparece depois). O que cai depois da mesma frase vira uma
 *   pausa só, na ordem do texto.
 * - `montarSequenciaDaLeitura` e companhia: a linha do tempo da leitura (com a narração, ou estimada no
 *   ritmo de leitura em voz alta), para o leitor saber a cada instante que frase, que palavra ou que
 *   comentário toca.
 */
import type {
  AncoraV1, Bloco, FonteDoComentarioV1, Id, LeituraComentadaV1, NarracaoDaLeituraV1, PausaDaLeituraV1, TrechoLidoV1, TrechoTemporizado,
} from '@margem/contratos';
import { textoFalado } from './pronuncia';
import { completarPalavras, estimarPalavras, palavraDaFraseNoInstante } from './karaoke';

export { GLOSSARIO_DE_PRONUNCIA, soletrar, textoFalado } from './pronuncia';

/** Tipos de bloco que a voz não lê: o leitor vê o bloco passar, a voz segue para o próximo. */
export const BLOCOS_SALTADOS: ReadonlySet<Bloco['tipo']> = new Set(['codigo', 'equacao', 'tabela', 'figura', 'legenda']);

/** Abreviações que terminam em ponto sem terminar a frase. */
const ABREVIACOES = new Set([
  'sr', 'sra', 'srs', 'dr', 'dra', 'prof', 'profa', 'ex', 'p', 'pp', 'pág', 'págs', 'cap', 'caps', 'vol', 'vols', 'ed', 'eds', 'fig', 'figs',
  'n', 'nº', 'no', 'num', 'séc', 'sec', 'jr', 'st', 'vs', 'cf', 'op', 'cit', 'al', 'aprox', 'obs', 'ib', 'ibid', 'id', 'org', 'orgs', 'trad',
  'e.g', 'i.e', 'mr', 'mrs', 'ms', 'inc', 'ltda', 'art', 'arts', 'min', 'máx', 'mín',
]);

/**
 * Frases de um texto, como intervalos [início, fim) em UTF-16, sem o espaço entre elas. Quebra depois
 * de `.`, `!`, `?`, `…` (com aspas ou parênteses de fechamento) seguidos de espaço e de algo que
 * começa frase; não quebra em abreviação, inicial ("F. Brooks") nem número ("1.2"). Frase longa demais
 * (> `maximo` caracteres) quebra também em `;` ou `:`.
 */
export function frasesDoTexto(texto: string, maximo = 420): { inicio: number; fim: number }[] {
  const frases: { inicio: number; fim: number }[] = [];
  let inicio = texto.search(/\S/u);
  if (inicio < 0) return frases;
  const fechar = (fim: number, proximo: number): void => {
    let f = fim;
    while (f > inicio && /\s/u.test(texto[f - 1]!)) f -= 1;
    if (f > inicio) frases.push({ inicio, fim: f });
    inicio = proximo;
  };
  const padrao = /([.!?…]+)(["”»’)\]]*)(\s+)(?=["“«(\[]?[\p{Lu}\p{N}—–-])/gu;
  for (const achado of texto.matchAll(padrao)) {
    const pontuacao = achado.index;
    const fim = pontuacao + achado[1]!.length + achado[2]!.length;
    if (fim <= inicio) continue;
    if (achado[1] === '.') {
      const antes = texto.slice(inicio, pontuacao).match(/([\p{L}.]+)$/u)?.[1] ?? '';
      const palavra = antes.toLocaleLowerCase('pt-BR');
      if (ABREVIACOES.has(palavra) || /^\p{Lu}$/u.test(antes)) continue;
    }
    fechar(fim, fim + achado[3]!.length);
  }
  fechar(texto.length, texto.length);
  // Frases muito longas (listas corridas, citações): quebra em ";" ou ":" seguidos de espaço.
  return frases.flatMap((frase) => {
    if (frase.fim - frase.inicio <= maximo) return [frase];
    const partes: { inicio: number; fim: number }[] = [];
    let de = frase.inicio;
    for (const achado of texto.slice(frase.inicio, frase.fim).matchAll(/[;:](\s+)/gu)) {
      const fim = frase.inicio + achado.index + 1;
      if (fim - de < 80) continue;
      partes.push({ inicio: de, fim });
      de = fim + achado[1]!.length;
    }
    partes.push({ inicio: de, fim: frase.fim });
    return partes.filter((p) => p.fim > p.inicio);
  });
}

export interface TrechosDoCapitulo {
  trechos: TrechoLidoV1[];
  saltados: { bloco_id: Id; tipo: string }[];
}

/** O capítulo inteiro em frases lidas, na ordem dos blocos. */
export function trechosDoCapitulo(blocos: readonly Pick<Bloco, 'id' | 'tipo' | 'texto'>[], falar: (texto: string) => string = textoFalado): TrechosDoCapitulo {
  const trechos: TrechoLidoV1[] = [];
  const saltados: { bloco_id: Id; tipo: string }[] = [];
  for (const bloco of blocos) {
    if (BLOCOS_SALTADOS.has(bloco.tipo)) { saltados.push({ bloco_id: bloco.id, tipo: bloco.tipo }); continue; }
    // Estrofe e lista: um verso ou item por linha já é a unidade de fala.
    const linhas = bloco.tipo === 'estrofe' || bloco.tipo === 'lista' ? [...bloco.texto.matchAll(/[^\n]+/gu)].map((l) => ({ inicio: l.index, fim: l.index + l[0].length })) : [{ inicio: 0, fim: bloco.texto.length }];
    for (const linha of linhas) {
      for (const frase of frasesDoTexto(bloco.texto.slice(linha.inicio, linha.fim))) {
        const inicio = linha.inicio + frase.inicio;
        const fim = linha.inicio + frase.fim;
        const texto = bloco.texto.slice(inicio, fim);
        const falado = falar(texto);
        // Uma frase que só tinha "(link)" ou uma URL não tem o que falar.
        if (falado === '' || !/[\p{L}\p{N}]/u.test(falado)) continue;
        trechos.push({ id: `t${String(trechos.length + 1).padStart(4, '0')}`, bloco_id: bloco.id, inicio_utf16: inicio, fim_utf16: fim, texto, falado });
      }
    }
    if (!trechos.some((t) => t.bloco_id === bloco.id) && bloco.texto.trim() !== '') saltados.push({ bloco_id: bloco.id, tipo: bloco.tipo });
  }
  return { trechos, saltados };
}

/** Uma fonte de comentário já resolvida: o que acende (foco) e, na relação, o outro lado (ponta). */
export interface FonteAncorada extends FonteDoComentarioV1 {
  foco: AncoraV1;
  ponta: AncoraV1 | null;
}

export interface PausaMontada {
  depois_de: string;
  fontes: FonteAncorada[];
}

/** Posição de leitura de uma âncora: índice do bloco e offset. `null` fora do capítulo. */
function posicaoDe(ordemDosBlocos: ReadonlyMap<Id, number>, ancora: Pick<AncoraV1, 'bloco_id' | 'inicio_utf16' | 'fim_utf16'>, fim: boolean): [number, number] | null {
  const bloco = ordemDosBlocos.get(ancora.bloco_id);
  return bloco === undefined ? null : [bloco, fim ? ancora.fim_utf16 : ancora.inicio_utf16];
}
const antes = (a: [number, number], b: [number, number]): number => a[0] - b[0] || a[1] - b[1];

/**
 * Das duas pontas de uma relação, a que aparece depois no texto é o foco (a leitura chega lá tendo
 * lido a outra); a outra é a ponta. `null` se nenhuma das duas está no capítulo.
 */
export function focoDaRelacao(ordemDosBlocos: ReadonlyMap<Id, number>, a: AncoraV1, b: AncoraV1): { foco: AncoraV1; ponta: AncoraV1 } | null {
  const pa = posicaoDe(ordemDosBlocos, a, true);
  const pb = posicaoDe(ordemDosBlocos, b, true);
  if (!pa && !pb) return null;
  if (!pa) return { foco: b, ponta: a };
  if (!pb) return { foco: a, ponta: b };
  return antes(pa, pb) >= 0 ? { foco: a, ponta: b } : { foco: b, ponta: a };
}

/**
 * O trecho depois do qual a fonte é comentada: o que contém o fim da âncora do foco. Se a âncora cai
 * num bloco saltado (código, tabela), fica depois do último trecho lido antes dele (ou do primeiro,
 * se nada foi lido antes). `null` se a âncora não é do capítulo.
 */
export function trechoDaAncora(trechos: readonly TrechoLidoV1[], ordemDosBlocos: ReadonlyMap<Id, number>, ancora: AncoraV1): string | null {
  const alvo = posicaoDe(ordemDosBlocos, ancora, true);
  if (!alvo || trechos.length === 0) return null;
  let achado: TrechoLidoV1 | null = null;
  for (const trecho of trechos) {
    const inicio: [number, number] = [ordemDosBlocos.get(trecho.bloco_id)!, trecho.inicio_utf16];
    // O último trecho que começa antes do fim da âncora é o que a contém (ou o último lido antes dela).
    if (antes(inicio, [alvo[0], alvo[1] - 1]) <= 0) achado = trecho;
    else break;
  }
  return (achado ?? trechos[0]!).id;
}

/**
 * Agrupa as fontes em pausas: uma por trecho, na ordem da leitura; dentro da pausa, na ordem do texto
 * (início do foco), grifo antes de relação no empate. Fontes fora do capítulo voltam em `fora`.
 */
export function pausasDasFontes(trechos: readonly TrechoLidoV1[], blocos: readonly Pick<Bloco, 'id'>[], fontes: readonly FonteAncorada[]): { pausas: PausaMontada[]; fora: FonteAncorada[] } {
  const ordemDosBlocos = new Map(blocos.map((bloco, i) => [bloco.id, i]));
  const indiceDoTrecho = new Map(trechos.map((trecho, i) => [trecho.id, i]));
  const porTrecho = new Map<string, FonteAncorada[]>();
  const fora: FonteAncorada[] = [];
  for (const fonte of fontes) {
    const trecho = trechoDaAncora(trechos, ordemDosBlocos, fonte.foco);
    if (trecho === null) { fora.push(fonte); continue; }
    porTrecho.set(trecho, [...(porTrecho.get(trecho) ?? []), fonte]);
  }
  const pausas = [...porTrecho.entries()]
    .sort(([a], [b]) => indiceDoTrecho.get(a)! - indiceDoTrecho.get(b)!)
    .map(([depois_de, lista]) => ({
      depois_de,
      fontes: [...lista].sort((x, y) => antes(posicaoDe(ordemDosBlocos, x.foco, false)!, posicaoDe(ordemDosBlocos, y.foco, false)!)
        || (x.tipo === y.tipo ? 0 : x.tipo === 'grifo' ? -1 : 1)),
    }));
  return { pausas, fora };
}

// ---------------------------------------------------------------- linha do tempo

/** Ritmo de leitura em voz alta sem narração (≈ 150 palavras por minuto), como na visita (J91). */
export const PALAVRAS_POR_SEGUNDO_DA_LEITURA = 2.5;
const PAUSA_ENTRE_FRASES_S = 0.35;

export interface EtapaDaLeitura {
  indice: number;
  tipo: 'trecho' | 'pausa';
  id: string;
  trecho: TrechoLidoV1 | null;
  pausa: PausaDaLeituraV1 | null;
  inicio_s: number;
  fim_s: number;
}

export interface SequenciaDaLeitura {
  etapas: EtapaDaLeitura[];
  duracao_s: number;
  narrada: boolean;
  /**
   * Todas as palavras dos trechos lidos com tempo, em ordem de tempo: com narração, o tempo real de cada
   * uma (as que o alinhamento perdeu, interpoladas); sem, estimado dentro da frase pelo tamanho de cada
   * palavra e pela pontuação. O karaokê anda palavra por palavra nos dois casos.
   */
  palavras: readonly TrechoTemporizado[];
}

const contarPalavras = (texto: string): number => (texto.trim() === '' ? 0 : texto.trim().split(/\s+/u).length);

/**
 * A linha do tempo: cada trecho e, depois dele, a sua pausa com fala. Com narração, os tempos vêm dela
 * (uma fala sem tempo invalida a narração inteira, que cai para os tempos estimados).
 */
export function montarSequenciaDaLeitura(leitura: Pick<LeituraComentadaV1, 'id' | 'trechos' | 'pausas'>, narracao: NarracaoDaLeituraV1 | null): SequenciaDaLeitura {
  const depois = new Map(leitura.pausas.filter((p) => p.falado.trim() !== '').map((p) => [p.depois_de, p]));
  const ordem = leitura.trechos.flatMap((trecho) => {
    const pausa = depois.get(trecho.id);
    return pausa ? [{ tipo: 'trecho' as const, trecho, pausa: null }, { tipo: 'pausa' as const, trecho: null, pausa }] : [{ tipo: 'trecho' as const, trecho, pausa: null }];
  });
  const tempos = narracao && narracao.leitura_id === leitura.id ? new Map(narracao.falas.map((f) => [f.fala_id, f])) : null;
  const narrada = tempos !== null && ordem.every((item) => tempos.has((item.trecho ?? item.pausa).id));
  let cursor = 0;
  const etapas = ordem.map((item, indice): EtapaDaLeitura => {
    const id = (item.trecho ?? item.pausa).id;
    if (narrada) {
      const tempo = tempos.get(id)!;
      return { indice, tipo: item.tipo, id, trecho: item.trecho, pausa: item.pausa, inicio_s: tempo.inicio_s, fim_s: tempo.fim_s };
    }
    const texto = item.trecho?.falado ?? item.pausa!.falado;
    const inicio = cursor + (item.tipo === 'pausa' ? 0.6 : 0);
    const fim = inicio + Math.max(0.8, contarPalavras(texto) / PALAVRAS_POR_SEGUNDO_DA_LEITURA);
    cursor = fim + (item.tipo === 'pausa' ? 0.6 : PAUSA_ENTRE_FRASES_S);
    return { indice, tipo: item.tipo, id, trecho: item.trecho, pausa: item.pausa, inicio_s: inicio, fim_s: fim };
  });
  const ultimaFala = etapas.at(-1)?.fim_s ?? 0;
  const frases = etapas.flatMap((e) => (e.trecho ? [{ bloco_id: e.trecho.bloco_id, inicio_utf16: e.trecho.inicio_utf16, fim_utf16: e.trecho.fim_utf16, inicio_s: e.inicio_s, fim_s: e.fim_s, texto: e.trecho.texto }] : []));
  const palavras = narrada ? completarPalavras(frases, narracao!.palavras) : frases.flatMap(estimarPalavras);
  return { etapas, duracao_s: narrada ? Math.max(narracao!.duracao_s, ultimaFala) : ultimaFala, narrada, palavras };
}

/** A etapa que vale no instante: a última que já começou (os silêncios ficam com a anterior). Busca binária. */
export function etapaDaLeituraNoInstante(sequencia: SequenciaDaLeitura, t: number): EtapaDaLeitura | null {
  const { etapas } = sequencia;
  let baixo = 0;
  let alto = etapas.length - 1;
  let achada = -1;
  while (baixo <= alto) {
    const meio = (baixo + alto) >> 1;
    if (etapas[meio]!.inicio_s <= t + 1e-6) { achada = meio; baixo = meio + 1; } else alto = meio - 1;
  }
  return etapas[Math.max(0, achada)] ?? null;
}

/** A palavra em curso (dentro da etapa de leitura), por busca binária nas palavras temporizadas. */
export function palavraNoInstante(sequencia: SequenciaDaLeitura, etapa: EtapaDaLeitura | null, t: number): TrechoTemporizado | null {
  if (!etapa?.trecho) return null;
  return palavraDaFraseNoInstante(sequencia.palavras, etapa.trecho, t);
}

/** Onde o comentário seguinte termina: para "pular comentário" (começa o trecho de depois). */
export function fimDaPausa(sequencia: SequenciaDaLeitura, etapa: EtapaDaLeitura): number {
  const seguinte = sequencia.etapas[etapa.indice + 1];
  return seguinte ? seguinte.inicio_s : sequencia.duracao_s;
}

/** A pausa anterior ao instante (a que está tocando, se já passou mais de 2 s dela, senão a de antes). */
export function pausaAnterior(sequencia: SequenciaDaLeitura, t: number): EtapaDaLeitura | null {
  const atual = etapaDaLeituraNoInstante(sequencia, t);
  if (!atual) return null;
  for (let i = atual.indice; i >= 0; i -= 1) {
    const etapa = sequencia.etapas[i]!;
    if (etapa.tipo !== 'pausa') continue;
    if (i === atual.indice && t - etapa.inicio_s < 2) continue;
    return etapa;
  }
  return null;
}

/** A próxima pausa depois do instante. */
export function proximaPausa(sequencia: SequenciaDaLeitura, t: number): EtapaDaLeitura | null {
  const atual = etapaDaLeituraNoInstante(sequencia, t);
  return sequencia.etapas.slice((atual?.indice ?? -1) + 1).find((etapa) => etapa.tipo === 'pausa') ?? null;
}

/** Frase anterior/seguinte (para ←/→): o começo da etapa de leitura vizinha. */
export function saltarFrase(sequencia: SequenciaDaLeitura, t: number, sentido: 1 | -1): number {
  const atual = etapaDaLeituraNoInstante(sequencia, t);
  if (!atual) return 0;
  if (sentido === -1 && t - atual.inicio_s > 1.5) return atual.inicio_s;
  const destino = sequencia.etapas[atual.indice + sentido];
  return destino ? destino.inicio_s : sentido === 1 ? sequencia.duracao_s : 0;
}
