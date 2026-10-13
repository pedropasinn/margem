import { modeloDoPrompt } from '../leitura/protocolos.js';
/**
 * Prompts da compreensão do capítulo (J29, `docs/desenho/10-MODELO-DO-CAPITULO.md` §4–§5): funções puras
 * que montam o texto e o schema de cada chamada, com a tabela de aliases que o resolvedor usa na volta.
 *
 * O modelo só vê aliases (`B001`, `L01`, `R01`, `D01`, `U1`) e cria `n1`, `n2`… nas respostas. Nada de
 * ULID, offset ou página no prompt.
 */
import type {
  Bloco, Centralidade, Id, ModeloDoCapituloV1, ModoDeLeituraV1, NotaAnaliticaV1, NucleoDoElemento, PerfilDoLeitorV1,
  TipoDificuldadeTextual, TipoRelacaoSemantica,
} from '@margem/contratos';
import { novosAliases, type AliasesDoPrompt, type TabelaDeAliases } from '@margem/core';
import { estimarTokens } from '../leitura/partes.js';
import { ABRE_BLOCO, FECHA_BLOCO } from '../leitura/pacote.js';
import {
  cercar, corpoDoModelo, exigirModoValido, filtrarPorModo, lerPrompt, listaDeFuncoes, ordenar, preencher,
  type BlocoDoPrompt, type SchemaJson,
} from '../leitura/v2/prompt.js';

export const PROMPTS_DA_COMPREENSAO = {
  analise: 'analisar-passagens@2',
  sintese: 'sintetizar-capitulo@2',
  revisao: 'revisar-capitulo@2',
  plano: 'planejar-leitura@3',
} as const;

/** Acima disto (tokens estimados), a síntese e a revisão não levam o texto inteiro do capítulo. */
export const LIMITE_DE_CONTEXTO_TOKENS = 90_000;
/** Enum de aliases de bloco no schema só até aqui; acima, só o padrão. */
export const MAXIMO_ALIASES_NO_ENUM = 400;

// ---------------------------------------------------------------- saídas do modelo

export interface CitacaoGerada { bloco: string; citacao: string; prefixo: string; sufixo: string }
export interface CamposDeElementoGerado {
  nucleo: NucleoDoElemento;
  papel: string | null;
  citacoes: CitacaoGerada[];
  enunciado: string;
  qualificadores: string[];
  centralidade: Centralidade;
  notas: NotaAnaliticaV1[];
}
export interface ElementoGerado extends CamposDeElementoGerado { ref: string }
export interface RelacaoLocalGerada {
  origem: string; destino: string; tipo: TipoRelacaoSemantica; explicacao: string; confianca: 'alta' | 'media' | 'baixa';
}
export interface DificuldadeGerada { tipo: TipoDificuldadeTextual; citacoes: CitacaoGerada[]; descricao: string }
export interface SaidaDaAnalise {
  elementos: ElementoGerado[];
  relacoes: RelacaoLocalGerada[];
  dificuldades: DificuldadeGerada[];
  resumo_da_parte: string;
  limites: string[];
  leitura_integral: boolean;
}
interface OperacaoGeradaBase { motivo: string; evidencia: string[] }
export type OperacaoGerada = OperacaoGeradaBase & (
  | { op: 'promover' | 'rebaixar'; alvo: string; para: Centralidade }
  | { op: 'corrigir_papel'; alvo: string; nucleo: NucleoDoElemento; papel: string | null }
  | { op: 'reescrever_enunciado'; alvo: string; enunciado: string }
  | { op: 'acrescentar_nota'; alvo: string; tipo: NotaAnaliticaV1['tipo']; texto: string }
  | { op: 'fundir'; alvo: string; absorvidos: string[] }
  | { op: 'remover_elemento'; alvo: string }
  | ({ op: 'adicionar_elemento'; ref: string } & CamposDeElementoGerado)
  | { op: 'criar_relacao'; ref: string; origem: string; destino: string; tipo: TipoRelacaoSemantica; explicacao: string;
    confianca: 'alta' | 'media' | 'baixa'; retrospectiva: boolean }
  | { op: 'remover_relacao'; alvo: string }
  | ({ op: 'adicionar_dificuldade' } & DificuldadeGerada)
  | { op: 'remover_dificuldade'; alvo: string }
);
export interface SaidaDaSintese {
  movimento: { texto: string; etapas: { unidades: string[]; descricao: string }[] };
  unidades: { ref: string; inicio: string; titulo: string; funcao_no_capitulo: string }[];
  operacoes: OperacaoGerada[];
}
export interface SaidaDaRevisao { operacoes: OperacaoGerada[]; observacoes: string[] }
export interface SaidaDoPlano {
  passos: {
    inicio: string; foco: string[]; observar: string; explicacao: { curta: string; longa: string }; relacoes: string[];
    parada: { tipo: 'pergunta' | 'pausa'; texto: string } | null;
  }[];
  apoios: { alvo: string; tipo: 'explicar' | 'omitir' | 'exemplo' | 'recordar'; texto: string }[];
}

export interface PromptDaCompreensao {
  prompt: string;
  schema: SchemaJson;
  prompt_versao: string;
  aliases: AliasesDoPrompt;
}

// ---------------------------------------------------------------- peças comuns

function lerSchemaDoPrompt(nome: string): SchemaJson {
  const valor: unknown = JSON.parse(lerPrompt(`${nome}.schema.json`));
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) throw new Error(`Schema ${nome} não é objeto.`);
  return valor as SchemaJson;
}

function corpo(nome: string, modo: ModoDeLeituraV1): string {
  return filtrarPorModo(corpoDoModelo(modeloDoPrompt(nome, modo)), modo.id);
}

function comunsDoModo(modo: ModoDeLeituraV1): Record<string, string> {
  return {
    modo_nome: modo.nome,
    modo_ref: `${modo.id}@${String(modo.revisao)}`,
    modo_descricao: modo.descricao,
    funcoes: listaDeFuncoes(modo.funcoes),
  };
}

/** `papel` do schema: as funções do modo ou `null`. Troca em todo lugar onde o papel aparece. */
function especializarPapeis(valor: unknown, papeis: readonly string[]): void {
  if (Array.isArray(valor)) { valor.forEach((item) => { especializarPapeis(item, papeis); }); return; }
  if (typeof valor !== 'object' || valor === null) return;
  const objeto = valor as Record<string, unknown>;
  const propriedades = objeto.properties;
  if (typeof propriedades === 'object' && propriedades !== null && 'papel' in propriedades) {
    (propriedades as Record<string, unknown>).papel = { anyOf: [{ type: 'null' }, { type: 'string', enum: [...papeis] }] };
  }
  for (const item of Object.values(objeto)) especializarPapeis(item, papeis);
}

/** Troca o padrão de alias de bloco por um enum, quando cabe. */
function especializarBlocos(valor: unknown, aliases: readonly string[]): void {
  if (aliases.length === 0 || aliases.length > MAXIMO_ALIASES_NO_ENUM) return;
  if (Array.isArray(valor)) { valor.forEach((item) => { especializarBlocos(item, aliases); }); return; }
  if (typeof valor !== 'object' || valor === null) return;
  const objeto = valor as Record<string, unknown>;
  for (const [chave, item] of Object.entries(objeto)) {
    if (typeof item === 'object' && item !== null && (item as Record<string, unknown>).pattern === '^B[0-9]{3,}$') {
      objeto[chave] = { type: 'string', enum: [...aliases] };
    } else {
      especializarBlocos(item, aliases);
    }
  }
}

function schemaEspecializado(nome: string, modo: ModoDeLeituraV1, aliasesDeBloco: readonly string[]): SchemaJson {
  const schema = lerSchemaDoPrompt(nome);
  especializarPapeis(schema, modo.funcoes.map((funcao) => funcao.chave));
  especializarBlocos(schema, aliasesDeBloco);
  return schema;
}

/** Blocos com aliases, no formato de sempre: abertura, texto intacto, fechamento. */
export function serializarComAliases(
  blocos: readonly BlocoDoPrompt[], tabela: TabelaDeAliases, rotulo: (bloco: BlocoDoPrompt) => string,
): string {
  const linhas: string[] = [];
  for (const bloco of ordenar(blocos)) {
    linhas.push(`${ABRE_BLOCO}${tabela.registrar(bloco.id)}⟧ [${rotulo(bloco)}]`, bloco.texto, FECHA_BLOCO, '');
  }
  return linhas.join('\n');
}

const PALAVRAS_DO_ESQUELETO = 14;
/** Uma linha por bloco: alias, tipo e o começo do texto. Registra os aliases de todos os blocos. */
export function esqueleto(blocos: readonly BlocoDoPrompt[], tabela: TabelaDeAliases): string {
  return ordenar(blocos).map((bloco) => {
    const palavras = bloco.texto.replace(/\s+/gu, ' ').trim().split(' ');
    const inicio = palavras.slice(0, PALAVRAS_DO_ESQUELETO).join(' ');
    return `- ${tabela.registrar(bloco.id)} [${bloco.tipo}] ${inicio}${palavras.length > PALAVRAS_DO_ESQUELETO ? ' …' : ''}`;
  }).join('\n');
}

function aspas(texto: string): string { return `“${texto.replace(/\s+/gu, ' ')}”`; }

/**
 * O modelo do capítulo como texto para o prompt, com aliases. Cada elemento leva a citação principal
 * (o pacote de evidências): a síntese nunca trabalha só sobre resumos.
 */
export function serializarModelo(modelo: Pick<ModeloDoCapituloV1, 'movimento' | 'unidades' | 'elementos' | 'relacoes' | 'dificuldades'>, aliases: AliasesDoPrompt): string {
  const linhas: string[] = [];
  if (modelo.movimento) {
    linhas.push('### Movimento', '', modelo.movimento.texto, '');
  }
  if (modelo.unidades.length > 0) {
    linhas.push('### Unidades de leitura', '');
    for (const unidade of modelo.unidades) {
      linhas.push(`- ${aliases.unidades.registrar(unidade.id)} · ${aliases.blocos.registrar(unidade.bloco_inicio)}–${aliases.blocos.registrar(unidade.bloco_fim)} · ${unidade.titulo} — ${unidade.funcao_no_capitulo}`);
    }
    linhas.push('');
    if (modelo.movimento && modelo.movimento.etapas.length > 0) {
      linhas.push('Etapas do movimento:', '');
      for (const etapa of modelo.movimento.etapas) {
        linhas.push(`- ${etapa.unidade_ids.map((id) => aliases.unidades.registrar(id)).join(', ')}: ${etapa.descricao}`);
      }
      linhas.push('');
    }
  }
  linhas.push('### Elementos', '');
  if (modelo.elementos.length === 0) linhas.push('Nenhum.', '');
  for (const elemento of modelo.elementos) {
    const alias = aliases.elementos.registrar(elemento.id);
    linhas.push(`- ${alias} · ${elemento.nucleo} · papel: ${elemento.papel ?? 'null'} · centralidade ${String(elemento.centralidade)}`);
    linhas.push(`  enunciado: ${elemento.enunciado}`);
    elemento.ancoras.forEach((ancora, indice) => {
      linhas.push(`  ${indice === 0 ? 'citação' : 'outra citação'} (${aliases.blocos.registrar(ancora.bloco_id)}): ${aspas(ancora.citacao)}`);
    });
    if (elemento.qualificadores.length > 0) linhas.push(`  qualificadores: ${elemento.qualificadores.map(aspas).join(', ')}`);
    for (const nota of elemento.notas) linhas.push(`  nota [${nota.tipo}]: ${nota.texto}`);
  }
  linhas.push('', '### Relações', '');
  if (modelo.relacoes.length === 0) linhas.push('Nenhuma.');
  for (const relacao of modelo.relacoes) {
    linhas.push(`- ${aliases.relacoes.registrar(relacao.id)} · ${aliases.elementos.registrar(relacao.origem_id)} ${relacao.tipo} ${aliases.elementos.registrar(relacao.destino_id)}`
      + ` · confiança ${relacao.confianca}${relacao.retrospectiva ? ' · retrospectiva' : ''} — ${relacao.explicacao}`);
  }
  linhas.push('', '### Dificuldades do texto', '');
  if (modelo.dificuldades.length === 0) linhas.push('Nenhuma.');
  for (const dificuldade of modelo.dificuldades) {
    const ancora = dificuldade.ancoras[0];
    linhas.push(`- ${aliases.dificuldades.registrar(dificuldade.id)} · ${dificuldade.tipo}`
      + `${ancora ? ` · ${aliases.blocos.registrar(ancora.bloco_id)} ${aspas(ancora.citacao)}` : ''} — ${dificuldade.descricao}`);
  }
  return linhas.join('\n');
}

export function cabeNoContexto(blocos: readonly Pick<Bloco, 'texto'>[], extra: string): boolean {
  return estimarTokens([...blocos.map((bloco) => bloco.texto), extra]) <= LIMITE_DE_CONTEXTO_TOKENS;
}

// ---------------------------------------------------------------- análise local

export interface EntradaDaAnalise {
  prompt_versao?: string;
  modo: ModoDeLeituraV1;
  /** Responsáveis e de contexto, em qualquer ordem. */
  blocos: readonly BlocoDoPrompt[];
  responsaveis: readonly Id[];
  continuidade?: string;
}

export function montarPromptDeAnalise(entrada: EntradaDaAnalise): PromptDaCompreensao {
  exigirModoValido(entrada.modo);
  const versao = entrada.prompt_versao ?? PROMPTS_DA_COMPREENSAO.analise;
  if (![PROMPTS_DA_COMPREENSAO.analise, PROMPTS_DA_COMPREENSAO.analise.replace('@2', '@1')].includes(versao)) throw new Error('Versão de analise desconhecida.');
  const marcaveis = new Set(entrada.responsaveis);
  if (marcaveis.size === 0) throw new Error('A parte precisa de ao menos um bloco responsável.');
  const aliases = novosAliases();
  const texto = serializarComAliases(entrada.blocos, aliases.blocos,
    (bloco) => (marcaveis.has(bloco.id) ? bloco.tipo : `contexto · ${bloco.tipo}`));
  const continuidade = entrada.continuidade !== undefined && /\S/u.test(entrada.continuidade)
    ? `## O que as partes anteriores deste capítulo registraram\n\nÉ o resumo que elas deixaram, não texto a analisar.\n\n${cercar(entrada.continuidade.trim())}\n\n`
    : '';
  const prompt = preencher(corpo(versao, entrada.modo), { ...comunsDoModo(entrada.modo), continuidade, texto });
  const marcaveisComAlias = ordenar(entrada.blocos).filter((bloco) => marcaveis.has(bloco.id))
    .map((bloco) => aliases.blocos.alias(bloco.id) ?? '');
  return {
    prompt, schema: schemaEspecializado(versao, entrada.modo, marcaveisComAlias),
    prompt_versao: versao, aliases,
  };
}

// ---------------------------------------------------------------- síntese

export interface EntradaDaSintese {
  prompt_versao?: string;
  modo: ModoDeLeituraV1;
  /** Todos os blocos do capítulo, na ordem. */
  blocos: readonly BlocoDoPrompt[];
  /** A revisão r0 (união das análises locais). */
  modelo: ModeloDoCapituloV1;
}

export function montarPromptDeSintese(entrada: EntradaDaSintese): PromptDaCompreensao & { com_texto: boolean } {
  exigirModoValido(entrada.modo);
  const versao = entrada.prompt_versao ?? PROMPTS_DA_COMPREENSAO.sintese;
  if (![PROMPTS_DA_COMPREENSAO.sintese, PROMPTS_DA_COMPREENSAO.sintese.replace('@2', '@1')].includes(versao)) throw new Error('Versão de sintese desconhecida.');
  const aliases = novosAliases();
  const esq = esqueleto(entrada.blocos, aliases.blocos);
  const modelo = serializarModelo(entrada.modelo, aliases);
  const comTexto = cabeNoContexto(entrada.blocos, modelo);
  const texto = comTexto
    ? `## Texto do capítulo\n\n${serializarComAliases(entrada.blocos, aliases.blocos, (bloco) => bloco.tipo)}`
    : '';
  const prompt = preencher(corpo(versao, entrada.modo), {
    ...comunsDoModo(entrada.modo),
    sobre_o_texto: comTexto
      ? 'O texto inteiro do capítulo também está no fim, em blocos: volte a ele sempre que uma decisão depender da redação.'
      : 'O texto inteiro não coube nesta chamada: trabalhe com o esqueleto e com as citações dos elementos.',
    sobre_adicionar: comTexto
      ? 'Você tem o texto inteiro: use isto para o que nenhuma parte viu.'
      : 'Sem o texto inteiro, só adicione quando a citação estiver no esqueleto ou nas citações que você recebeu.',
    esqueleto: esq, modelo, texto,
  });
  return {
    prompt, schema: schemaEspecializado(versao, entrada.modo, aliases.blocos.entradas().map((item) => item.alias)),
    prompt_versao: versao, aliases, com_texto: comTexto,
  };
}

// ---------------------------------------------------------------- revisão global

export interface EntradaDaRevisao {
  prompt_versao?: string;
  modo: ModoDeLeituraV1;
  /** Todos os blocos do capítulo, para os aliases ficarem estáveis dentro do prompt. */
  blocosDoCapitulo: readonly BlocoDoPrompt[];
  /** Os blocos da janela (o capítulo inteiro, quando cabe). */
  janela: readonly BlocoDoPrompt[];
  /** A revisão r1. */
  modelo: ModeloDoCapituloV1;
  /** Elementos ancorados na janela, os únicos em que a revisão pode operar. */
  elementosDaJanela: readonly Id[];
  inteira: boolean;
}

export function montarPromptDeRevisao(entrada: EntradaDaRevisao): PromptDaCompreensao {
  exigirModoValido(entrada.modo);
  const versao = entrada.prompt_versao ?? PROMPTS_DA_COMPREENSAO.revisao;
  if (![PROMPTS_DA_COMPREENSAO.revisao, PROMPTS_DA_COMPREENSAO.revisao.replace('@2', '@1')].includes(versao)) throw new Error('Versão de revisao desconhecida.');
  const aliases = novosAliases();
  for (const bloco of ordenar(entrada.blocosDoCapitulo)) aliases.blocos.registrar(bloco.id);
  const modelo = serializarModelo(entrada.modelo, aliases);
  const lista = entrada.elementosDaJanela.length === 0
    ? 'Nenhum elemento ancorado nesta janela: só adicione o que for essencial.'
    : entrada.elementosDaJanela.map((id) => aliases.elementos.registrar(id)).join(', ');
  const prompt = preencher(corpo(versao, entrada.modo), {
    ...comunsDoModo(entrada.modo),
    sobre_a_janela: entrada.inteira ? 'do capítulo inteiro' : 'de uma parte do capítulo (a janela abaixo)',
    modelo, elementos_da_janela: lista,
    texto: serializarComAliases(entrada.janela, aliases.blocos, (bloco) => bloco.tipo),
  });
  const daJanela = ordenar(entrada.janela).map((bloco) => aliases.blocos.alias(bloco.id) ?? '');
  return {
    prompt, schema: schemaEspecializado(versao, entrada.modo, daJanela),
    prompt_versao: versao, aliases,
  };
}

// ---------------------------------------------------------------- plano pedagógico

const NIVEIS: Record<PerfilDoLeitorV1['areas'][number]['nivel'], string> = {
  basico: 'básico', intermediario: 'intermediário', avancado: 'avançado',
};

export function serializarPerfil(perfil: PerfilDoLeitorV1 | null): string {
  if (perfil === null || (perfil.areas.length === 0 && perfil.preferencias.length === 0 && perfil.observacoes.trim() === '')) {
    return 'O leitor ainda não preencheu o perfil. Explique no nível de um leitor adulto atento, sem supor formação específica.';
  }
  const linhas: string[] = [];
  if (perfil.areas.length > 0) {
    linhas.push('Conhecimento:');
    for (const area of perfil.areas) linhas.push(`- ${area.nome}: ${NIVEIS[area.nivel]}`);
  }
  if (perfil.preferencias.length > 0) {
    linhas.push('', 'Preferências:');
    for (const preferencia of perfil.preferencias) linhas.push(`- ${preferencia}`);
  }
  if (perfil.observacoes.trim() !== '') linhas.push('', 'Observações do leitor:', cercar(perfil.observacoes.trim()));
  return linhas.join('\n');
}

export interface EntradaDoPlano {
  prompt_versao?: string;
  modo: ModoDeLeituraV1;
  blocos: readonly BlocoDoPrompt[];
  modelo: ModeloDoCapituloV1;
  perfil: PerfilDoLeitorV1 | null;
}

export function montarPromptDoPlano(entrada: EntradaDoPlano): PromptDaCompreensao {
  exigirModoValido(entrada.modo);
  const versao = entrada.prompt_versao ?? PROMPTS_DA_COMPREENSAO.plano;
  if (![PROMPTS_DA_COMPREENSAO.plano, 'planejar-leitura@2', 'planejar-leitura@1'].includes(versao)) throw new Error('Versão de plano desconhecida.');
  const aliases = novosAliases();
  const esq = esqueleto(entrada.blocos, aliases.blocos);
  const prompt = preencher(corpo(versao, entrada.modo), {
    modo_nome: entrada.modo.nome, modo_ref: `${entrada.modo.id}@${String(entrada.modo.revisao)}`,
    perfil: serializarPerfil(entrada.perfil), esqueleto: esq, modelo: serializarModelo(entrada.modelo, aliases),
  });
  const schema = lerSchemaDoPrompt(versao);
  especializarBlocos(schema, aliases.blocos.entradas().map((item) => item.alias));
  return { prompt, schema, prompt_versao: versao, aliases };
}

/** Para testes e para o auditor: o schema de uma etapa sem especialização. */
export function schemaDaEtapa(etapa: keyof typeof PROMPTS_DA_COMPREENSAO): SchemaJson {
  return lerSchemaDoPrompt(PROMPTS_DA_COMPREENSAO[etapa]);
}
