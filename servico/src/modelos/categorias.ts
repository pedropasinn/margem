/**
 * Categorias de execução do Codex para a escolha de modelo e esforço (V-T10).
 *
 * Cada tipo de job que chama o Codex pertence a uma categoria legível; a pessoa escolhe, em
 * Configurações → Modelos, o modelo e o esforço de cada categoria, ou deixa o padrão do Margem.
 * O padrão é o que o serviço sempre fez: `MARGEM_MODELO` (`conta` = o modelo padrão da conta, sem
 * `-m`) e o esforço de cada tipo, com as variáveis `MARGEM_ESFORCO_*` que já existiam.
 *
 * Tipos sem Codex (canonizar, canonizar_revisao, importar_youtube, narrar_audio, narrar_noticias)
 * não entram: não há modelo a escolher. O teste `categorias.test.ts` confere que todo tipo do
 * worker está numa categoria ou na lista dos sem Codex.
 */
import type { Recurso } from '../recursos.js';
import { esforcoDoAgente } from '../agente/manipulador.js';
import { esforcoDosFlashcards } from '../flashcards/manipuladores.js';
import { esforcoDoTipo } from '../tipo-de-texto/identificar.js';
import { esforcoDoSumario } from '../sumario/conferencia.js';
import {
  ESFORCO_DO_PLANO_PADRAO, ESFORCO_PADRAO, MODELO_DA_CONTA, MODELO_PADRAO, esforcoDaLeituraComentada, esforcoDaVisita, esforcoDosVisuais,
} from '../worker/configuracao.js';

export const ESFORCOS = ['low', 'medium', 'high'] as const;
export type Esforco = (typeof ESFORCOS)[number];

export type IdDaCategoria =
  | 'analise' | 'tipo_de_texto' | 'perguntas' | 'exercicios' | 'flashcards' | 'visuais' | 'quadros' | 'videos' | 'escaneados' | 'guiada' | 'noticias';

type Ambiente = NodeJS.ProcessEnv;

/** Um grupo de tipos da categoria com o mesmo esforço padrão; `rotulo` só nos grupos que não são o principal. */
interface GrupoDeTipos {
  tipos: readonly string[];
  esforco: (ambiente: Ambiente) => string;
  rotulo?: string;
}

export interface CategoriaDeExecucao {
  id: IdDaCategoria;
  rotulo: string;
  /** O que a categoria faz, em uma frase curta para a tela. */
  descricao: string;
  /** Só aparece com o recurso ligado (notícias, quadros). */
  recurso?: Recurso;
  grupos: readonly GrupoDeTipos[];
}

const doAmbiente = (nome: string, padrao: string) => (ambiente: Ambiente): string => {
  const valor = ambiente[nome]?.trim();
  return valor === undefined || valor === '' ? padrao : valor;
};
const esforcoDasLeituras = doAmbiente('MARGEM_ESFORCO', ESFORCO_PADRAO);
const esforcoDoPlano = doAmbiente('MARGEM_ESFORCO_PLANO', ESFORCO_DO_PLANO_PADRAO);

export const CATEGORIAS: readonly CategoriaDeExecucao[] = Object.freeze([
  {
    id: 'analise', rotulo: 'Análise de textos', descricao: 'Grifos, relações e o plano de cada capítulo.',
    grupos: [
      { tipos: ['analisar_passagens', 'sintetizar_capitulo', 'revisar_capitulo', 'ler_parte', 'revisar_consistencia'], esforco: esforcoDasLeituras },
      { tipos: ['planejar_leitura'], esforco: esforcoDoPlano, rotulo: 'o plano do capítulo' },
    ],
  },
  {
    id: 'tipo_de_texto', rotulo: 'Tipo de texto e sumário', descricao: 'Reconhecer se é romance, artigo, Escritura… para escolher como ler, e conferir o sumário de um livro novo.',
    grupos: [
      { tipos: ['identificar_tipo'], esforco: esforcoDoTipo },
      { tipos: ['conferir_sumario'], esforco: esforcoDoSumario, rotulo: 'o sumário' },
    ],
  },
  {
    id: 'perguntas', rotulo: 'Perguntas', descricao: 'Responder no leitor e em Perguntar, e revisar as suas notas.',
    grupos: [
      { tipos: ['responder_agente'], esforco: esforcoDoAgente },
      { tipos: ['responder'], esforco: esforcoDasLeituras, rotulo: 'perguntas sobre um trecho' },
      { tipos: ['revisar_anotacao'], esforco: esforcoDoPlano, rotulo: 'revisão de notas' },
    ],
  },
  {
    id: 'exercicios', rotulo: 'Exercícios e resoluções', descricao: 'Resolver exercícios e explicar a resolução.',
    grupos: [
      { tipos: ['resolver_exercicio'], esforco: esforcoDasLeituras },
      { tipos: ['explicar_resolucao'], esforco: esforcoDoPlano, rotulo: 'explicações' },
    ],
  },
  {
    id: 'flashcards', rotulo: 'Flashcards', descricao: 'Cartões de estudo de cada capítulo.',
    grupos: [{ tipos: ['gerar_flashcards'], esforco: esforcoDosFlashcards }],
  },
  {
    id: 'visuais', rotulo: 'Imagens e diagramas', descricao: 'Imagens, fluxogramas e mapas do capítulo.',
    grupos: [{ tipos: ['gerar_imagem', 'gerar_diagrama', 'gerar_esquema'], esforco: esforcoDosVisuais }],
  },
  {
    id: 'quadros', rotulo: 'Quadros', descricao: 'Reconhecer e analisar as obras que você adiciona.', recurso: 'arte',
    grupos: [{ tipos: ['preparar_quadro'], esforco: esforcoDosVisuais }],
  },
  {
    id: 'videos', rotulo: 'Vídeos', descricao: 'Passar a transcrição a limpo e os conceitos que aparecem sobre o vídeo.',
    grupos: [
      { tipos: ['conceitos_do_video'], esforco: esforcoDosVisuais },
      // A limpeza da transcrição (J142): `medium` por padrão, como `esforcoDaLimpeza` em midia/limpeza-da-transcricao.ts.
      { tipos: ['revisar_transcricao'], esforco: doAmbiente('MARGEM_ESFORCO_LIMPEZA', 'medium'), rotulo: 'a transcrição' },
    ],
  },
  {
    id: 'escaneados', rotulo: 'Páginas escaneadas', descricao: 'Ler o texto de páginas que são só imagem.',
    grupos: [{ tipos: ['transcrever_escaneado'], esforco: esforcoDosVisuais }],
  },
  {
    id: 'guiada', rotulo: 'Visita guiada e leitura comentada', descricao: 'Roteiros e falas que acompanham a leitura.',
    grupos: [
      { tipos: ['roteirizar_visita'], esforco: esforcoDaVisita },
      { tipos: ['comentar_leitura'], esforco: esforcoDaLeituraComentada, rotulo: 'leitura comentada' },
    ],
  },
  {
    id: 'noticias', rotulo: 'Notícias', descricao: 'Edição e capas das notícias do dia.', recurso: 'noticias',
    grupos: [{ tipos: ['editar_noticias', 'ilustrar_noticias'], esforco: esforcoDoPlano }],
  },
] satisfies CategoriaDeExecucao[]);

/** Tipos de job do worker que não chamam o Codex. */
export const TIPOS_SEM_CODEX: readonly string[] = Object.freeze(['canonizar', 'canonizar_revisao', 'importar_youtube', 'narrar_audio', 'narrar_noticias']);

const PELO_TIPO: ReadonlyMap<string, CategoriaDeExecucao> = new Map(CATEGORIAS.flatMap((categoria) => categoria.grupos.flatMap((grupo) => grupo.tipos.map((tipo) => [tipo, categoria] as const))));

export function categoriaDoTipo(tipo: string): CategoriaDeExecucao | undefined {
  return PELO_TIPO.get(tipo);
}

export function idDeCategoria(valor: string): valor is IdDaCategoria {
  return CATEGORIAS.some((categoria) => categoria.id === valor);
}

const NOME_DO_ESFORCO: Readonly<Record<string, string>> = { low: 'baixo', medium: 'médio', high: 'alto', xhigh: 'muito alto', minimal: 'mínimo' };
export function nomeDoEsforco(esforco: string): string {
  return NOME_DO_ESFORCO[esforco] ?? esforco;
}

/** O modelo que o Margem usa sem escolha da pessoa: `MARGEM_MODELO`, ou o padrão do serviço. */
export function modeloPadrao(ambiente: Ambiente = process.env): string {
  const valor = ambiente.MARGEM_MODELO?.trim();
  return valor === undefined || valor === '' ? MODELO_PADRAO : valor;
}

/**
 * Uma linha que explica o padrão da categoria, ex.: "o modelo padrão da sua conta, esforço alto
 * (o plano do capítulo: médio)". Os quadros sempre usam o modelo da conta (o preparo não passa `-m`).
 */
export function padraoDaCategoria(categoria: CategoriaDeExecucao, ambiente: Ambiente = process.env): { modelo: string | null; esforco: string; texto: string } {
  const modelo = categoria.id === 'quadros' ? MODELO_DA_CONTA : modeloPadrao(ambiente);
  const [principal, ...outros] = categoria.grupos;
  const esforco = principal?.esforco(ambiente) ?? ESFORCO_PADRAO;
  const excecoes = outros
    .map((grupo) => ({ rotulo: grupo.rotulo ?? '', esforco: grupo.esforco(ambiente) }))
    .filter((grupo) => grupo.esforco !== esforco)
    .map((grupo) => `${grupo.rotulo}: ${nomeDoEsforco(grupo.esforco)}`);
  const nomeDoModelo = modelo === MODELO_DA_CONTA ? 'o modelo padrão da sua conta' : modelo;
  const texto = `${nomeDoModelo}, esforço ${nomeDoEsforco(esforco)}${excecoes.length === 0 ? '' : ` (${excecoes.join('; ')})`}`;
  return { modelo: modelo === MODELO_DA_CONTA ? null : modelo, esforco, texto };
}
