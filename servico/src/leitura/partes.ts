import { ulid } from 'ulid';
import type { Bloco, CanonicoV1, Id, ParteV1, Secao } from '@margem/contratos';
import { comprimentoUtf16 } from '@margem/core';
import { hashDaEntrada, type EsbocoDeParte, type TextosDoPacote, type VersoesDoPacote } from './pacote.js';

/**
 * Tipos de bloco que uma parte pode marcar. Títulos (`capitulo`, `secao`) e `figura`
 * entram apenas como contexto: não há texto próprio para ancorar uma citação.
 */
export const TIPOS_ELEGIVEIS: ReadonlySet<Bloco['tipo']> = new Set([
  'paragrafo', 'lista', 'citacao', 'codigo', 'equacao', 'tabela', 'nota_rodape', 'epigrafe', 'legenda',
]);

/** Leitura V2 (J19): o verso também se marca. Em F1 a lista continua a de cima, sem mudança. */
export const TIPOS_ELEGIVEIS_V2: ReadonlySet<Bloco['tipo']> = new Set([...TIPOS_ELEGIVEIS, 'estrofe']);

export const TIPOS_DE_TITULO: ReadonlySet<Bloco['tipo']> = new Set(['capitulo', 'secao']);

/**
 * Tokens por unidade UTF-16. Medido de olho no corpus inglês do Mixtape (≈ 3,6 caracteres
 * por token em prosa acadêmica); é estimativa para dimensionar a parte, não contagem real.
 * Quando houver telemetria de uso do Codex, substituir pela média medida.
 */
export const UNIDADES_POR_TOKEN = 3.6;

export const TAMANHO_PARTE_PADRAO = 45_000;

/** Quantos blocos imediatamente anteriores acompanham uma parte que continua um capítulo. */
export const BLOCOS_DE_CONTEXTO = 2;

export type ModoDePlano = 'capitulos' | 'sequencial';

export interface ConfiguracaoDoPlano {
  execucao_id: Id;
  versoes: VersoesDoPacote;
  /** Conteúdo de método, prompt e schema: entra no `hash_entrada` de cada parte. */
  textos: TextosDoPacote;
  tamanho_parte_tokens?: number;
  modo?: ModoDePlano;
  /** Tipos de bloco que uma parte pode marcar. Padrão: `TIPOS_ELEGIVEIS` (F1). */
  tiposElegiveis?: ReadonlySet<Bloco['tipo']>;
  /** Injetável para tornar o plano determinístico nos testes. */
  novoId?: () => Id;
}

export function estimarTokens(textos: readonly string[]): number {
  return Math.ceil(textos.reduce((total, texto) => total + comprimentoUtf16(texto), 0) / UNIDADES_POR_TOKEN);
}

interface Grupo {
  /** Índices na lista de blocos do canônico, em ordem. */
  indices: number[];
  /** Seção de nível 1 que define o grupo, quando existe. */
  capitulo?: Secao;
}

function indiceDosBlocos(canonico: CanonicoV1): Map<Id, number> {
  return new Map(canonico.blocos.map((bloco, indice) => [bloco.id, indice]));
}

/** Um grupo por seção de nível 1; blocos fora de qualquer capítulo formam um grupo próprio. */
function agruparPorCapitulo(canonico: CanonicoV1): Grupo[] {
  const posicao = indiceDosBlocos(canonico);
  const capitulos = canonico.secoes
    .filter((secao) => secao.nivel === 1)
    .map((secao) => ({ secao, inicio: posicao.get(secao.bloco_inicio), fim: posicao.get(secao.bloco_fim) }))
    .filter((item): item is { secao: Secao; inicio: number; fim: number } => item.inicio !== undefined && item.fim !== undefined)
    .sort((a, b) => a.inicio - b.inicio);
  if (capitulos.length === 0) return [{ indices: canonico.blocos.map((_, indice) => indice) }];
  const grupos: Grupo[] = [];
  const primeiro = capitulos[0];
  if (primeiro && primeiro.inicio > 0) {
    grupos.push({ indices: Array.from({ length: primeiro.inicio }, (_, i) => i) });
  }
  for (const capitulo of capitulos) {
    const indices: number[] = [];
    for (let i = capitulo.inicio; i <= capitulo.fim; i++) indices.push(i);
    grupos.push({ indices, capitulo: capitulo.secao });
  }
  const ultimo = capitulos[capitulos.length - 1];
  if (ultimo && ultimo.fim < canonico.blocos.length - 1) {
    const indices: number[] = [];
    for (let i = ultimo.fim + 1; i < canonico.blocos.length; i++) indices.push(i);
    grupos.push({ indices });
  }
  return grupos.filter((grupo) => grupo.indices.length > 0);
}

/** Fronteiras de corte dentro do capítulo: início de cada seção de nível ≥ 2 que caia no grupo. */
function fronteirasDeSecao(canonico: CanonicoV1, grupo: Grupo): Set<number> {
  const posicao = indiceDosBlocos(canonico);
  const dentro = new Set(grupo.indices);
  const fronteiras = new Set<number>();
  for (const secao of canonico.secoes) {
    if (secao.nivel < 2) continue;
    const inicio = posicao.get(secao.bloco_inicio);
    if (inicio !== undefined && dentro.has(inicio)) fronteiras.add(inicio);
  }
  return fronteiras;
}

interface Fatia { indices: number[] }

/**
 * Corta o grupo em fatias que caibam no teto. Prefere fronteira de seção de nível 2;
 * quando uma fatia isolada já estoura o teto (ou não há subseções), corta em fronteira
 * de bloco. Nunca parte um bloco.
 */
function fatiar(canonico: CanonicoV1, grupo: Grupo, teto: number): Fatia[] {
  const texto = (indice: number): string => canonico.blocos[indice]?.texto ?? '';
  if (estimarTokens(grupo.indices.map(texto)) <= teto) return [{ indices: grupo.indices }];
  const fronteiras = fronteirasDeSecao(canonico, grupo);
  // Subgrupos delimitados pelas seções de nível ≥ 2; sem elas, cada bloco é seu próprio subgrupo.
  const subgrupos: number[][] = [];
  for (const indice of grupo.indices) {
    const ultimo = subgrupos[subgrupos.length - 1];
    if (!ultimo || fronteiras.has(indice) || fronteiras.size === 0) subgrupos.push([indice]);
    else ultimo.push(indice);
  }
  const fatias: Fatia[] = [];
  for (const subgrupo of subgrupos) {
    const atual = fatias[fatias.length - 1];
    if (atual && estimarTokens([...atual.indices, ...subgrupo].map(texto)) <= teto) {
      atual.indices.push(...subgrupo);
      continue;
    }
    if (estimarTokens(subgrupo.map(texto)) <= teto || fronteiras.size === 0) {
      fatias.push({ indices: [...subgrupo] });
      continue;
    }
    // Subseção maior que o teto: reparte em fronteira de bloco.
    let corrente: number[] = [];
    for (const indice of subgrupo) {
      if (corrente.length > 0 && estimarTokens([...corrente, indice].map(texto)) > teto) {
        fatias.push({ indices: corrente });
        corrente = [];
      }
      corrente.push(indice);
    }
    if (corrente.length > 0) fatias.push({ indices: corrente });
  }
  return fatias;
}

/** Seções (de qualquer nível) cujos blocos de título devem acompanhar a fatia como contexto. */
function titulosDeContexto(canonico: CanonicoV1, indices: readonly number[]): Id[] {
  const posicao = indiceDosBlocos(canonico);
  const primeiro = indices[0];
  const ultimo = indices[indices.length - 1];
  if (primeiro === undefined || ultimo === undefined) return [];
  const titulos: Id[] = [];
  for (const secao of canonico.secoes) {
    const inicio = posicao.get(secao.bloco_inicio);
    const fim = posicao.get(secao.bloco_fim);
    if (inicio === undefined || fim === undefined) continue;
    if (inicio <= ultimo && fim >= primeiro) titulos.push(secao.bloco_inicio);
  }
  return titulos;
}

export interface PlanoDeLeitura {
  partes: ParteV1[];
  /** Ordens das partes que continuam um capítulo cortado (recebem continuidade). */
  continuacoes: Set<number>;
  /** Ordem da parte → identificador do capítulo, quando há um. */
  capituloDaParte: Map<number, Id>;
}

/**
 * Plano de partes de um canônico. Uma parte por capítulo enquanto couber no teto;
 * acima dele, corte em fronteira de seção (ou de bloco), com os dois blocos anteriores
 * como contexto. Todo bloco elegível tem exatamente uma parte responsável.
 */
export function planejarLeitura(canonico: CanonicoV1, config: ConfiguracaoDoPlano): PlanoDeLeitura {
  const teto = config.tamanho_parte_tokens ?? TAMANHO_PARTE_PADRAO;
  if (!Number.isSafeInteger(teto) || teto <= 0) throw new Error('tamanho_parte_tokens deve ser inteiro positivo.');
  const novoId = config.novoId ?? ulid;
  const elegiveis = config.tiposElegiveis ?? TIPOS_ELEGIVEIS;
  const partes: ParteV1[] = [];
  const continuacoes = new Set<number>();
  const capituloDaParte = new Map<number, Id>();
  let ordem = 0;
  for (const grupo of agruparPorCapitulo(canonico)) {
    const fatias = fatiar(canonico, grupo, teto);
    let primeiraDoCapitulo = true;
    for (const fatia of fatias) {
      const responsaveis = fatia.indices.filter((indice) => {
        const bloco = canonico.blocos[indice];
        return bloco !== undefined && elegiveis.has(bloco.tipo);
      });
      if (responsaveis.length === 0) continue;
      const idsResponsaveis = new Set(responsaveis.map((indice) => canonico.blocos[indice]?.id ?? ''));
      const contexto: Id[] = [...titulosDeContexto(canonico, fatia.indices)];
      if (!primeiraDoCapitulo) {
        const inicio = fatia.indices[0] ?? 0;
        for (let i = Math.max(0, inicio - BLOCOS_DE_CONTEXTO); i < inicio; i++) {
          const bloco = canonico.blocos[i];
          if (bloco) contexto.push(bloco.id);
        }
      }
      const blocos_contexto = [...new Set(contexto)].filter((id) => !idsResponsaveis.has(id));
      const esboco: EsbocoDeParte = {
        ordem,
        blocos_responsaveis: responsaveis.map((indice) => canonico.blocos[indice]?.id ?? ''),
        blocos_contexto,
      };
      partes.push({
        id: novoId(),
        execucao_id: config.execucao_id,
        ordem,
        blocos_responsaveis: esboco.blocos_responsaveis,
        blocos_contexto,
        hash_entrada: hashDaEntrada(canonico, esboco, config.versoes, config.textos),
      });
      if (!primeiraDoCapitulo || (config.modo === 'sequencial' && ordem > 0)) continuacoes.add(ordem);
      if (grupo.capitulo) capituloDaParte.set(ordem, grupo.capitulo.id);
      primeiraDoCapitulo = false;
      ordem += 1;
    }
  }
  if (partes.length === 0) throw new Error('O canônico não tem nenhum bloco elegível para leitura.');
  return { partes, continuacoes, capituloDaParte };
}

/** Compatibilidade com a assinatura do SPEC: só as partes. */
export function planejar(canonico: CanonicoV1, config: ConfiguracaoDoPlano): ParteV1[] {
  return planejarLeitura(canonico, config).partes;
}
