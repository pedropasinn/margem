/**
 * Prompt da visita guiada (J91): `roteirizar-visita@2`, função pura. O modelo vê o capítulo como
 * esqueleto e modelo semântico com aliases (`B…`, `L…`, `R…`, `D…`, `U…`), mais as notas do leitor (`N…`)
 * e os visuais (`V…`). Nada de ULID, offset ou página.
 */
import type { AnotacaoV1, Bloco, Id, MarcaV2, ModeloDoCapituloV1, PerfilDoLeitorV1, PlanoPedagogicoV1, VisualV1 } from '@margem/contratos';
import { TabelaDeAliases, novosAliases, type AliasesDoPrompt } from '@margem/core';
import { esqueleto, serializarModelo, serializarPerfil } from '../compreensao/prompts.js';
import { cercar, corpoDoModelo, lerPrompt, preencher, type SchemaJson } from '../leitura/v2/prompt.js';

export const PROMPT_DA_VISITA = 'roteirizar-visita@2';
/** Enum de aliases de bloco no schema só até aqui (como na compreensão). */
const MAXIMO_NO_ENUM = 400;

export type TipoDaParadaGerada = 'tese' | 'conceito' | 'argumento' | 'exemplo' | 'relacao' | 'retorno' | 'dificuldade' | 'visual' | 'nota' | 'pergunta';
export interface ParadaGerada {
  tipo: TipoDaParadaGerada; titulo: string; inicio: string; fim: string;
  elementos: string[]; relacoes: string[]; dificuldades: string[]; notas: string[]; visuais: string[];
  narracao: string; pergunta: string | null; transicao: string;
}
export interface SaidaDaVisita { abertura: string; paradas: ParadaGerada[]; fechamento: string; perguntas: string[]; ponte: string }

/** Uma nota do leitor no capítulo: anotação escrita ou grifo (marca da camada dele). */
export type NotaDoLeitor = { tipo: 'anotacao'; anotacao: AnotacaoV1 } | { tipo: 'grifo'; marca: MarcaV2 };
export function idDaNota(nota: NotaDoLeitor): Id { return nota.tipo === 'anotacao' ? nota.anotacao.id : nota.marca.id; }

export interface CapituloVizinho { titulo: string; movimento: string | null }
export interface EntradaDaVisita {
  livro: string;
  capitulo: string;
  numero: number;
  total: number;
  anterior: CapituloVizinho | null;
  proximo: CapituloVizinho | null;
  blocos: readonly Bloco[];
  modelo: ModeloDoCapituloV1;
  plano: PlanoPedagogicoV1 | null;
  perfil: PerfilDoLeitorV1 | null;
  notas: readonly NotaDoLeitor[];
  /** Só os prontos. */
  visuais: readonly VisualV1[];
}

export interface PromptDaVisita {
  prompt: string;
  schema: SchemaJson;
  prompt_versao: string;
  aliases: AliasesDoPrompt;
  notas: TabelaDeAliases;
  visuais: TabelaDeAliases;
}

function uma(texto: string, limite = 220): string {
  const limpo = texto.replace(/\s+/gu, ' ').trim();
  return limpo.length > limite ? `${limpo.slice(0, limite - 1)}…` : limpo;
}

function contextoDoLivro(entrada: EntradaDaVisita): string {
  const linhas = [`Capítulo ${String(entrada.numero)} de ${String(entrada.total)} do livro.`];
  if (entrada.anterior) {
    linhas.push('', `Capítulo anterior: ${entrada.anterior.titulo}.`);
    if (entrada.anterior.movimento) linhas.push(`O movimento dele: ${uma(entrada.anterior.movimento, 900)}`);
  } else {
    linhas.push('', 'Não há capítulo anterior: esta é a entrada no livro.');
  }
  if (entrada.proximo) {
    linhas.push('', `Próximo capítulo: ${entrada.proximo.titulo}.`);
    if (entrada.proximo.movimento) linhas.push(`O movimento dele: ${uma(entrada.proximo.movimento, 900)}`);
  } else {
    linhas.push('', 'Não há próximo capítulo: a `ponte` fica vazia.');
  }
  return linhas.join('\n');
}

function planoResumido(plano: PlanoPedagogicoV1 | null, aliases: AliasesDoPrompt): string {
  if (!plano) return 'Nenhum plano pedagógico.';
  const comParada = plano.passos.filter((passo) => passo.parada !== null);
  const linhas = [`O plano tem ${String(plano.passos.length)} passos (um por trecho); estes foram marcados como ponto de parada:`];
  if (comParada.length === 0) linhas.push('Nenhum.');
  for (const passo of comParada) {
    linhas.push(`- ${aliases.blocos.registrar(passo.bloco_inicio)}: ${passo.parada!.tipo} — ${uma(passo.parada!.texto, 300)} (observar: ${uma(passo.observar, 200)})`);
  }
  return linhas.join('\n');
}

function notasSerializadas(notas: readonly NotaDoLeitor[], tabela: TabelaDeAliases, aliases: AliasesDoPrompt): string {
  if (notas.length === 0) return 'O leitor ainda não anotou nem grifou nada neste capítulo.';
  return notas.map((nota) => {
    const alias = tabela.registrar(idDaNota(nota));
    if (nota.tipo === 'anotacao') {
      const a = nota.anotacao;
      return `- ${alias} · anotação (${a.tipo}) em ${aliases.blocos.registrar(a.ancora.bloco_id)} sobre “${uma(a.ancora.citacao, 200)}”:\n${cercar(uma(a.texto, 800))}`;
    }
    const m = nota.marca;
    return `- ${alias} · grifo (${m.funcao}) em ${aliases.blocos.registrar(m.ancora.bloco_id)}: “${uma(m.ancora.citacao, 240)}”`;
  }).join('\n');
}

function visuaisSerializados(visuais: readonly VisualV1[], tabela: TabelaDeAliases, aliases: AliasesDoPrompt): string {
  if (visuais.length === 0) return 'Nenhum visual neste capítulo.';
  return visuais.map((visual) => {
    const alias = tabela.registrar(visual.id);
    const onde = visual.alvo.tipo === 'capitulo' ? 'o capítulo inteiro' : `${aliases.blocos.registrar(visual.alvo.ancora.bloco_id)} (“${uma(visual.alvo.ancora.citacao, 160)}”)`;
    const artefato = visual.artefato;
    const descricao = !artefato ? '' : artefato.tipo === 'png' ? artefato.descricao : `${artefato.titulo}: ${artefato.nos.map((no) => no.rotulo).join(' → ')}`;
    return `- ${alias} · ${visual.tipo === 'imagem' ? 'imagem' : 'fluxograma'} sobre ${onde}: ${uma(descricao, 400)}`;
  }).join('\n');
}

function lerSchema(): SchemaJson {
  const valor: unknown = JSON.parse(lerPrompt(`${PROMPT_DA_VISITA}.schema.json`));
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) throw new Error('Schema da visita não é objeto.');
  return valor as SchemaJson;
}

/** Troca o padrão de alias de bloco por um enum (como na compreensão), e restringe N/V aos recebidos. */
function especializar(schema: SchemaJson, blocos: readonly string[], notas: readonly string[], visuais: readonly string[]): SchemaJson {
  const copia = structuredClone(schema);
  const parada = ((copia.properties as SchemaJson).paradas as SchemaJson).items as SchemaJson;
  const props = parada.properties as Record<string, SchemaJson>;
  if (blocos.length > 0 && blocos.length <= MAXIMO_NO_ENUM) {
    props.inicio = { type: 'string', enum: [...blocos] };
    props.fim = { type: 'string', enum: [...blocos] };
  }
  props.notas = notas.length === 0 ? { type: 'array', maxItems: 0, items: { type: 'string' } } : { type: 'array', items: { type: 'string', enum: [...notas] }, uniqueItems: true };
  props.visuais = visuais.length === 0 ? { type: 'array', maxItems: 0, items: { type: 'string' } } : { type: 'array', items: { type: 'string', enum: [...visuais] }, uniqueItems: true };
  return copia;
}

export function montarPromptDaVisita(entrada: EntradaDaVisita): PromptDaVisita {
  if (entrada.blocos.length === 0) throw new Error('Capítulo sem blocos.');
  const aliases = novosAliases();
  const notas = new TabelaDeAliases('N', 1);
  const visuais = new TabelaDeAliases('V', 1);
  const esq = esqueleto(entrada.blocos, aliases.blocos);
  const doCapitulo = aliases.blocos.entradas().map((item) => item.alias);
  const prompt = preencher(corpoDoModelo(lerPrompt(`${PROMPT_DA_VISITA}.md`)), {
    livro: uma(entrada.livro, 300),
    capitulo: uma(entrada.capitulo, 300),
    posicao: `capítulo ${String(entrada.numero)} de ${String(entrada.total)}`,
    contexto_do_livro: contextoDoLivro(entrada),
    perfil: serializarPerfil(entrada.perfil),
    plano: planoResumido(entrada.plano, aliases),
    notas: notasSerializadas(entrada.notas, notas, aliases),
    visuais: visuaisSerializados(entrada.visuais, visuais, aliases),
    esqueleto: esq,
    modelo: serializarModelo(entrada.modelo, aliases),
  });
  const schema = especializar(lerSchema(), doCapitulo, notas.entradas().map((e) => e.alias), visuais.entradas().map((e) => e.alias));
  return { prompt, schema, prompt_versao: PROMPT_DA_VISITA, aliases, notas, visuais };
}
