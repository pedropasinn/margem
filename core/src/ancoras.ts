import type { AncoraV1, Bloco, Faixa, Id, MarcaV1 } from '@margem/contratos';
import { conferirTextoAncora, fronteiraUtf16 } from '@margem/contratos/texto';
import { ehLimiteValido, fatiaSegura } from './texto';

/** O `Bloco` do canônico não carrega a versão; quem resolve precisa dizer a qual versão ele pertence. */
export interface BlocoDeVersao extends Pick<Bloco, 'id' | 'texto'> {
  versao_id: Id;
}

export interface PedidoDeCitacao {
  citacao: string;
  prefixo?: string;
  sufixo?: string;
}

export interface ContextoSugerido {
  prefixo: string;
  sufixo: string;
}

export type MotivoDeCitacao = 'ausente' | 'ambigua' | 'vazia';

export type ResolucaoDeCitacao =
  | { ok: true; ancora: AncoraV1 }
  | { ok: false; motivo: MotivoDeCitacao; ocorrencias: number; sugestao_de_contexto?: ContextoSugerido };

export type MotivoDeSubfaixa = 'vazia' | 'ausente' | 'ambigua' | 'sobreposta' | 'fronteira';

export interface SubfaixaNaoResolvida {
  texto: string;
  motivo: MotivoDeSubfaixa;
}

export interface ResolucaoDeSubfaixas {
  subfaixas: Faixa[];
  nao_resolvidas: SubfaixaNaoResolvida[];
}

export interface Reancoragem {
  validade: MarcaV1['validade'];
  ancora?: AncoraV1;
  candidatos?: Id[];
}

const CONTEXTO_MAXIMO_SUGESTAO = 64;
const CONTEXTO_MAXIMO_SELECAO = 256;

/** Posições em que a citação ocorre literalmente, já filtradas por contexto e por fronteira UTF-16. */
function posicoesDaCitacao(texto: string, citacao: string, prefixo = '', sufixo = ''): number[] {
  const posicoes: number[] = [];
  if (!citacao) return posicoes;
  for (let at = texto.indexOf(citacao); at !== -1; at = texto.indexOf(citacao, at + 1)) {
    const fim = at + citacao.length;
    if (!ehLimiteValido(texto, at) || !ehLimiteValido(texto, fim)) continue;
    if (prefixo && texto.slice(Math.max(0, at - prefixo.length), at) !== prefixo) continue;
    if (sufixo && texto.slice(fim, fim + sufixo.length) !== sufixo) continue;
    posicoes.push(at);
  }
  return posicoes;
}

/** Recorte de contexto que nunca parte um par substituto: encolhe o bastante para cair em fronteira. */
function prefixoDe(texto: string, posicao: number, tamanho: number): string {
  let inicio = Math.max(0, posicao - tamanho);
  if (!fronteiraUtf16(texto, inicio)) inicio += 1;
  return texto.slice(inicio, posicao);
}

function sufixoDe(texto: string, posicao: number, tamanho: number): string {
  let fim = Math.min(texto.length, posicao + tamanho);
  if (!fronteiraUtf16(texto, fim)) fim -= 1;
  return texto.slice(posicao, fim);
}

/** Quantas unidades à esquerda de `a` e de `b` são idênticas (quanto o prefixo precisa crescer). */
function acordoAEsquerda(texto: string, a: number, b: number): number {
  let k = 0;
  while (k < CONTEXTO_MAXIMO_SUGESTAO && k < a && k < b && texto[a - 1 - k] === texto[b - 1 - k]) k += 1;
  return k;
}

function acordoADireita(texto: string, a: number, b: number): number {
  let k = 0;
  while (k < CONTEXTO_MAXIMO_SUGESTAO && a + k < texto.length && b + k < texto.length && texto[a + k] === texto[b + k]) k += 1;
  return k;
}

/**
 * Menor par (prefixo, sufixo) até 64 unidades que tornaria a citação única.
 * O par devolvido é o da primeira ocorrência: é sugestão para o serviço pedir mais contexto
 * ao modelo, nunca uma escolha de ocorrência — a resolução continua `ambigua`.
 */
function sugerirContexto(texto: string, citacao: string, posicoes: readonly number[]): ContextoSugerido | undefined {
  const fim = (posicao: number): number => posicao + citacao.length;
  const pares: { esquerda: number; direita: number }[] = [];
  // A sugestão se refere à primeira ocorrência: basta distingui-la das demais.
  // Não construir todos os pares (quadrático), nem comparar além do contexto permitido.
  const a = posicoes[0];
  if (a === undefined) return undefined;
  for (let j = 1; j < posicoes.length; j++) {
    const b = posicoes[j]!;
    pares.push({ esquerda: acordoAEsquerda(texto, a, b), direita: acordoADireita(texto, fim(a), fim(b)) });
  }
  let melhor: ContextoSugerido | undefined;
  let melhorTotal = Number.POSITIVE_INFINITY;
  const primeira = posicoes[0];
  if (primeira === undefined) return undefined;
  for (let p = 0; p <= CONTEXTO_MAXIMO_SUGESTAO; p++) {
    let s = 0;
    for (const par of pares) if (par.esquerda >= p) s = Math.max(s, par.direita + 1);
    if (s > CONTEXTO_MAXIMO_SUGESTAO || p + s >= melhorTotal) continue;
    const contexto = { prefixo: prefixoDe(texto, primeira, p), sufixo: sufixoDe(texto, fim(primeira), s) };
    if (posicoesDaCitacao(texto, citacao, contexto.prefixo, contexto.sufixo).length !== 1) continue;
    melhor = contexto;
    melhorTotal = p + s;
  }
  return melhor;
}

/**
 * Resolve a citação literal do modelo numa âncora do bloco. Sem normalização Unicode:
 * a citação precisa bater byte a byte (unidade a unidade). Ocorrência repetida nunca
 * vira a primeira em silêncio; volta `ambigua` com a contagem e uma sugestão de contexto.
 */
export function resolverCitacao(bloco: BlocoDeVersao, pedido: PedidoDeCitacao): ResolucaoDeCitacao {
  const { citacao } = pedido;
  const prefixo = pedido.prefixo ?? '';
  const sufixo = pedido.sufixo ?? '';
  if (!citacao) return { ok: false, motivo: 'vazia', ocorrencias: 0 };
  const posicoes = posicoesDaCitacao(bloco.texto, citacao, prefixo, sufixo);
  if (posicoes.length === 0) return { ok: false, motivo: 'ausente', ocorrencias: 0 };
  if (posicoes.length > 1) {
    const sugestao = sugerirContexto(bloco.texto, citacao, posicoes);
    return sugestao
      ? { ok: false, motivo: 'ambigua', ocorrencias: posicoes.length, sugestao_de_contexto: sugestao }
      : { ok: false, motivo: 'ambigua', ocorrencias: posicoes.length };
  }
  const inicio = posicoes[0] ?? 0;
  return {
    ok: true,
    ancora: {
      versao_id: bloco.versao_id,
      bloco_id: bloco.id,
      citacao,
      prefixo,
      sufixo,
      inicio_utf16: inicio,
      fim_utf16: inicio + citacao.length,
    },
  };
}

/**
 * Localiza cada termo a sublinhar dentro da citação já ancorada. As faixas saem em
 * coordenadas do bloco, iguais às da âncora (convenção de MarcaV1).
 */
export function resolverSubfaixas(bloco: BlocoDeVersao, ancora: AncoraV1, sublinhar: readonly string[]): ResolucaoDeSubfaixas {
  if (bloco.versao_id !== ancora.versao_id || bloco.id !== ancora.bloco_id || !conferirTextoAncora(bloco, ancora)) {
    throw new Error('Âncora não corresponde ao bloco e à versão das subfaixas.');
  }
  const citacao = ancora.citacao;
  const nao_resolvidas: SubfaixaNaoResolvida[] = [];
  const encontradas: { texto: string; ordem: number; faixa: Faixa }[] = [];
  sublinhar.forEach((texto, ordem) => {
    if (!texto) {
      nao_resolvidas.push({ texto, motivo: 'vazia' });
      return;
    }
    const posicoes: number[] = [];
    for (let at = citacao.indexOf(texto); at !== -1; at = citacao.indexOf(texto, at + 1)) posicoes.push(at);
    if (posicoes.length === 0) {
      nao_resolvidas.push({ texto, motivo: 'ausente' });
      return;
    }
    if (posicoes.length > 1) {
      nao_resolvidas.push({ texto, motivo: 'ambigua' });
      return;
    }
    const inicio = posicoes[0] ?? 0;
    const fim = inicio + texto.length;
    if (!ehLimiteValido(citacao, inicio) || !ehLimiteValido(citacao, fim)) {
      nao_resolvidas.push({ texto, motivo: 'fronteira' });
      return;
    }
    encontradas.push({
      texto,
      ordem,
      faixa: { inicio_utf16: ancora.inicio_utf16 + inicio, fim_utf16: ancora.inicio_utf16 + fim },
    });
  });
  encontradas.sort((a, b) => a.faixa.inicio_utf16 - b.faixa.inicio_utf16 || a.ordem - b.ordem);
  const subfaixas: Faixa[] = [];
  let ultimoFim = -1;
  for (const item of encontradas) {
    if (item.faixa.inicio_utf16 < ultimoFim) {
      nao_resolvidas.push({ texto: item.texto, motivo: 'sobreposta' });
      continue;
    }
    subfaixas.push(item.faixa);
    ultimoFim = item.faixa.fim_utf16;
  }
  return { subfaixas, nao_resolvidas };
}

/**
 * Procura a citação de uma marca nos blocos de outra versão: primeiro com o contexto
 * histórico, depois só com a citação. Não altera a marca recebida.
 */
export function reancorar(blocosNovos: readonly BlocoDeVersao[], marca: MarcaV1): Reancoragem {
  const { citacao, prefixo, sufixo } = marca.ancora;
  for (const contexto of [{ prefixo, sufixo }, { prefixo: '', sufixo: '' }]) {
    const achados: { bloco: BlocoDeVersao; inicio: number }[] = [];
    for (const bloco of blocosNovos) {
      for (const inicio of posicoesDaCitacao(bloco.texto, citacao, contexto.prefixo, contexto.sufixo)) {
        achados.push({ bloco, inicio });
      }
    }
    if (achados.length === 1) {
      const achado = achados[0];
      if (!achado) continue;
      return {
        validade: 'resolvida',
        ancora: ancoraDeSelecao(achado.bloco, achado.inicio, achado.inicio + citacao.length),
      };
    }
    if (achados.length > 1) {
      return { validade: 'ambigua', candidatos: [...new Set(achados.map((achado) => achado.bloco.id))] };
    }
  }
  return { validade: 'orfa' };
}

/**
 * Âncora a partir de uma seleção (offsets do bloco), ampliando o contexto até a citação
 * ficar única ou até 256 unidades de cada lado. Recusa seleção fora do bloco ou que parta
 * um par substituto.
 */
export function ancoraDeSelecao(bloco: BlocoDeVersao, inicio_utf16: number, fim_utf16: number, contexto = 32): AncoraV1 {
  if (!Number.isSafeInteger(contexto) || contexto < 0) throw new Error('Contexto precisa ser inteiro não negativo.');
  if (inicio_utf16 >= fim_utf16) throw new Error('A seleção precisa ser não vazia.');
  const citacao = fatiaSegura(bloco.texto, inicio_utf16, fim_utf16);
  let tamanho = Math.min(contexto, CONTEXTO_MAXIMO_SELECAO);
  let prefixo = prefixoDe(bloco.texto, inicio_utf16, tamanho);
  let sufixo = sufixoDe(bloco.texto, fim_utf16, tamanho);
  while (posicoesDaCitacao(bloco.texto, citacao, prefixo, sufixo).length > 1 && tamanho < CONTEXTO_MAXIMO_SELECAO) {
    tamanho = Math.min(Math.max(tamanho * 2, 1), CONTEXTO_MAXIMO_SELECAO);
    prefixo = prefixoDe(bloco.texto, inicio_utf16, tamanho);
    sufixo = sufixoDe(bloco.texto, fim_utf16, tamanho);
  }
  return { versao_id: bloco.versao_id, bloco_id: bloco.id, citacao, prefixo, sufixo, inicio_utf16, fim_utf16 };
}
