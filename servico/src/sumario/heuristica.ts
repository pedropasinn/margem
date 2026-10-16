/**
 * Conferência do sumário, primeira etapa (J164): heurísticas locais e baratas, sem IA.
 *
 * Quando um EPUB ou PDF termina de ser preparado, as seções do canônico passam por estas regras. Nada
 * suspeito: o sumário fica como está e o Codex nem é chamado. Algo suspeito: um job leve do Codex
 * (`conferencia.ts`) olha a lista e pode sugerir outra.
 *
 * Cada regra mira um defeito visto de verdade (o Zero to One no motor antigo: "1" e "THE CHALLENGE OF
 * THE FUTURE" como dois capítulos, o primeiro vazio) e é conservadora: um livro bem estruturado não
 * dispara nenhuma, para não gastar a cota à toa.
 */
import type { Bloco, CanonicoV1, Secao } from '@margem/contratos';

/** O que as regras (e o prompt) sabem de cada seção: posição, título e tamanho, nunca o texto inteiro. */
export interface SecaoResumida {
  nivel: number;
  titulo: string;
  /** Palavras de texto da seção inteira (subseções incluídas), sem contar os títulos. */
  palavras: number;
  /** Palavras de texto antes da próxima seção começar (o que é só desta seção). */
  proprias: number;
}

export interface Suspeita {
  codigo:
    | 'titulo_so_numero' | 'secoes_vazias' | 'capitulos_curtos_seguidos' | 'capitulos_repetidos'
    | 'sumario_raso' | 'numero_seguido_de_titulo' | 'titulos_longos';
  mensagem: string;
  /** Índices (na lista de seções) que dispararam a regra, até dez. */
  secoes: number[];
}

const CAMPOS_DE_TITULO = new Set<Bloco['tipo']>(['capitulo', 'secao']);
const palavrasDe = (texto: string): number => texto.match(/\S+/gu)?.length ?? 0;

/** As seções do canônico, em ordem, com as contagens que as regras usam. */
export function resumirSecoes(canonico: Pick<CanonicoV1, 'blocos' | 'secoes'>): SecaoResumida[] {
  const posicao = new Map(canonico.blocos.map((bloco, indice) => [bloco.id, indice]));
  const palavras = canonico.blocos.map((bloco) => (CAMPOS_DE_TITULO.has(bloco.tipo) ? 0 : palavrasDe(bloco.texto)));
  const acumuladas = [0];
  for (const n of palavras) acumuladas.push((acumuladas.at(-1) ?? 0) + n);
  const soma = (inicio: number, fim: number) => (acumuladas[Math.max(inicio, fim)] ?? 0) - (acumuladas[inicio] ?? 0);
  const secoes = ordenadas(canonico.secoes);
  return secoes.map((secao, indice) => {
    const inicio = posicao.get(secao.bloco_inicio) ?? 0;
    const fim = (posicao.get(secao.bloco_fim) ?? inicio) + 1;
    const seguinte = secoes[indice + 1];
    const proxima = seguinte === undefined ? fim : Math.min(fim, posicao.get(seguinte.bloco_inicio) ?? fim);
    return { nivel: secao.nivel, titulo: secao.titulo, palavras: soma(inicio, fim), proprias: soma(inicio, proxima) };
  });
}

export function ordenadas(secoes: readonly Secao[]): Secao[] {
  return [...secoes].sort((a, b) => a.ordem - b.ordem);
}

/** "1", "II", "12.", "Capítulo 3", "Chapter IV", "Parte 2": título que é só um número. */
const SO_NUMERO = /^\s*(?:(?:cap[íi]tulo|chapter|chap\.?|parte?|part|livro|book|se[çc][ãa]o|section)\s+)?(?:\d{1,3}|[ivxlcdm]{1,7})\s*[.:)]?\s*$/iu;
export const tituloSoNumero = (titulo: string): boolean => SO_NUMERO.test(titulo);

/** Caixa alta: tem letras e nenhuma minúscula. */
const emCaixaAlta = (titulo: string): boolean => /\p{L}/u.test(titulo) && !/\p{Ll}/u.test(titulo);

/** Comparável: sem acento, caixa, pontuação e número inicial ("1. Prefácio" ~ "PREFÁCIO"). */
export function comparavel(titulo: string): string {
  return titulo.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Títulos de capítulo que se repetem de propósito (cada parte tem as suas notas). */
const REPETIVEIS = /^(?:notas?|notes?|refer[eê]ncias|references|bibliografia|bibliography|exerc[ií]cios|exercises|resumo|summary|conclus[aã]o|conclusion|introdu[cç][aã]o|introduction)$/u;

/** Limites das regras: abaixo disto um capítulo é "curto"; abaixo daquilo, o livro é "curto". */
export const LIMITES = Object.freeze({
  capituloCurto: 40,
  curtosSeguidos: 3,
  livroLongo: 15_000,
  vaziasMinimas: 2,
  tituloLongo: 160,
  titulosLongosMinimos: 3,
});

const ate10 = (lista: number[]) => lista.slice(0, 10);

/**
 * As suspeitas sobre o sumário; lista vazia = nada suspeito. `palavras` é o total do livro (quando a
 * lista de seções não cobre o começo do texto, o total ainda vale para "livro longo").
 */
export function suspeitasDoSumario(secoes: readonly SecaoResumida[], palavras: number): Suspeita[] {
  const suspeitas: Suspeita[] = [];
  const indices = secoes.map((_, i) => i);
  const capitulos = indices.filter((i) => secoes[i]?.nivel === 1);

  // Título que é só um número, sem texto próprio: o número e o nome do capítulo viraram duas seções.
  const numeros = indices.filter((i) => tituloSoNumero(secoes[i]?.titulo ?? '') && (secoes[i]?.proprias ?? 0) < LIMITES.capituloCurto);
  if (numeros.length > 0) {
    suspeitas.push({ codigo: 'titulo_so_numero', mensagem: `${String(numeros.length)} seções têm só um número como título e quase nenhum texto.`, secoes: ate10(numeros) });
  }

  // Número seguido, na mesma altura, de um título em caixa alta: "1" + "THE CHALLENGE OF THE FUTURE".
  const pares = indices.filter((i) => {
    const atual = secoes[i];
    const seguinte = secoes[i + 1];
    return atual !== undefined && seguinte !== undefined && tituloSoNumero(atual.titulo) && seguinte.nivel === atual.nivel
      && emCaixaAlta(seguinte.titulo) && atual.proprias < LIMITES.capituloCurto;
  });
  if (pares.length > 0) {
    suspeitas.push({ codigo: 'numero_seguido_de_titulo', mensagem: `${String(pares.length)} vezes um número vem separado do título do capítulo logo abaixo.`, secoes: ate10(pares) });
  }

  // Seções sem nenhum texto (nem nas subseções): um título solto.
  const vazias = indices.filter((i) => (secoes[i]?.palavras ?? 0) === 0);
  if (vazias.length >= LIMITES.vaziasMinimas) {
    suspeitas.push({ codigo: 'secoes_vazias', mensagem: `${String(vazias.length)} seções não têm texto nenhum.`, secoes: ate10(vazias) });
  }

  // Três ou mais capítulos curtos seguidos num livro longo.
  if (palavras >= LIMITES.livroLongo) {
    const seguidos: number[] = [];
    let corrida: number[] = [];
    for (const i of capitulos) {
      if ((secoes[i]?.palavras ?? 0) < LIMITES.capituloCurto) { corrida.push(i); continue; }
      if (corrida.length >= LIMITES.curtosSeguidos) seguidos.push(...corrida);
      corrida = [];
    }
    if (corrida.length >= LIMITES.curtosSeguidos) seguidos.push(...corrida);
    if (seguidos.length > 0) {
      suspeitas.push({ codigo: 'capitulos_curtos_seguidos', mensagem: `${String(seguidos.length)} capítulos seguidos têm menos de ${String(LIMITES.capituloCurto)} palavras.`, secoes: ate10(seguidos) });
    }
  }

  // O mesmo título em dois capítulos (fora os que se repetem de propósito, como "Notas").
  const vistos = new Map<string, number>();
  const repetidos: number[] = [];
  for (const i of capitulos) {
    const chave = comparavel(secoes[i]?.titulo ?? '');
    if (chave === '' || REPETIVEIS.test(chave) || tituloSoNumero(chave)) continue;
    if (vistos.has(chave)) repetidos.push(i); else vistos.set(chave, i);
  }
  if (repetidos.length > 0) {
    suspeitas.push({ codigo: 'capitulos_repetidos', mensagem: `${String(repetidos.length)} capítulos repetem o título de outro.`, secoes: ate10(repetidos) });
  }

  // Um livro longo com um capítulo só (ou nenhum): o sumário não foi achado.
  if (palavras >= LIMITES.livroLongo && capitulos.length <= 1) {
    suspeitas.push({ codigo: 'sumario_raso', mensagem: `O texto tem ${String(palavras)} palavras e ${capitulos.length === 0 ? 'nenhum capítulo' : 'um capítulo só'}.`, secoes: capitulos });
  }

  // Parágrafos inteiros tomados por título.
  const longos = indices.filter((i) => (secoes[i]?.titulo.length ?? 0) > LIMITES.tituloLongo);
  if (longos.length >= LIMITES.titulosLongosMinimos) {
    suspeitas.push({ codigo: 'titulos_longos', mensagem: `${String(longos.length)} títulos parecem parágrafos (mais de ${String(LIMITES.tituloLongo)} caracteres).`, secoes: ate10(longos) });
  }
  return suspeitas;
}
