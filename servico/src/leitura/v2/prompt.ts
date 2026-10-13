import { modeloDoPrompt } from '../protocolos.js';
import { readFileSync } from 'node:fs';
import type {
  AncoraV1, Bloco, FuncaoDoModo, Id, MensagemV2, ModoDeLeituraV1, Saliencia, TipoComentarioV2, ValorJson,
} from '@margem/contratos';
import { validarAncora, validarModoDeLeitura } from '@margem/contratos';
import { ABRE_BLOCO, FECHA_BLOCO } from '../pacote.js';

/** Schema JSON como dado: o que vai (saneado) para o `--output-schema` e confere a resposta. */
export type SchemaJson = { [chave: string]: ValorJson };

export interface PromptMontado {
  prompt: string;
  schema: SchemaJson;
  prompt_versao: string;
}

export const VERSAO_PROMPT_LEITURA = 'leitor-de-parte@4';
export const VERSAO_PROMPT_RESPOSTA = 'responder@2';
/**
 * Acima disto o `bloco_id` do schema fica só com o padrão ULID: a saída estruturada limita
 * o tamanho total dos `enum` de texto. Abaixo, o enum impede o modelo de inventar um id.
 */
export const MAXIMO_IDS_NO_ENUM = 250;

export type BlocoDoPrompt = Pick<Bloco, 'id' | 'tipo' | 'texto'> & Partial<Pick<Bloco, 'ordem'>>;

const PASTA_PROMPTS = new URL('../../../../prompts/', import.meta.url);
const cache = new Map<string, string>();
export function lerPrompt(nome: string): string {
  let texto = cache.get(nome);
  if (texto === undefined) {
    texto = readFileSync(new URL(nome, PASTA_PROMPTS), 'utf8');
    cache.set(nome, texto);
  }
  return texto;
}

export function ehObjeto(valor: unknown): valor is SchemaJson {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function lerSchema(nome: string): SchemaJson {
  const valor: unknown = JSON.parse(lerPrompt(nome));
  if (!ehObjeto(valor)) throw new Error(`Schema ${nome} não é um objeto.`);
  return valor;
}

/** Schema versionado do leitor V2, sem a especialização por modo (a régua local genérica). */
export function schemaDoLeitorV2(): SchemaJson { return lerSchema(`${VERSAO_PROMPT_LEITURA}.schema.json`); }
/** Schema versionado do responder, sem a especialização pelos blocos recebidos. */
export function schemaDoResponder(): SchemaJson { return lerSchema(`${VERSAO_PROMPT_RESPOSTA}.schema.json`); }

/** Desce no schema por nomes de propriedade ou índices; lança se o caminho não existir. */
export function em(schema: SchemaJson, ...caminho: (string | number)[]): SchemaJson {
  let atual: ValorJson = schema;
  for (const passo of caminho) {
    const proximo: ValorJson | undefined = typeof passo === 'number'
      ? (Array.isArray(atual) ? atual[passo] : undefined)
      : (ehObjeto(atual) ? atual[passo] : undefined);
    if (proximo === undefined) throw new Error(`Caminho ausente no schema: ${caminho.join('/')}`);
    atual = proximo;
  }
  if (!ehObjeto(atual)) throw new Error(`Caminho do schema não é objeto: ${caminho.join('/')}`);
  return atual;
}

/** O texto do prompt é o que vem depois da primeira linha `---`; o cabeçalho é para quem mantém. */
export function corpoDoModelo(texto: string): string {
  const corte = texto.indexOf('\n---\n');
  if (corte === -1) throw new Error('Prompt versionado sem a linha `---` que separa o cabeçalho.');
  return texto.slice(corte + 5).replace(/^\n+/u, '');
}

/** Mantém os trechos `so-no-modo` do modo pedido e tira os outros, antes de qualquer substituição. */
export function filtrarPorModo(texto: string, modoId: string): string {
  return texto
    .replace(/<!-- so-no-modo: ([a-z0-9_]+) -->\n([\s\S]*?)<!-- \/so-no-modo -->\n?/gu,
      (_trecho, id: string, conteudo: string) => (id === modoId ? conteudo : ''))
    .replace(/\n{3,}/gu, '\n\n');
}

/**
 * Troca cada `{{campo}}` numa única passagem (um valor que contenha `{{x}}` não é expandido de novo).
 * Campo sem valor e valor sem campo são erro: o modelo e o código andam juntos.
 */
export function preencher(modelo: string, valores: Readonly<Record<string, string>>): string {
  const usados = new Set<string>();
  const texto = modelo.replace(/\{\{([a-z_]+)\}\}/gu, (_trecho, campo: string) => {
    const valor = valores[campo];
    if (valor === undefined) throw new Error(`Campo sem valor no prompt: ${campo}`);
    usados.add(campo);
    return valor;
  });
  const sobrando = Object.keys(valores).filter((campo) => !usados.has(campo));
  if (sobrando.length > 0) throw new Error(`Valores sem campo no prompt: ${sobrando.join(', ')}`);
  return texto;
}

/** Cerca com crases o bastante para que nenhuma sequência do conteúdo feche a cerca. */
export function cercar(texto: string): string {
  const maior = Math.max(2, ...[...texto.matchAll(/`+/gu)].map((trecho) => trecho[0].length));
  const cerca = '`'.repeat(maior + 1);
  return `${cerca}\n${texto}\n${cerca}`;
}

export function ordenar<T extends BlocoDoPrompt>(blocos: readonly T[]): T[] {
  return blocos.map((bloco, indice) => ({ bloco, indice }))
    .sort((a, b) => (a.bloco.ordem ?? a.indice) - (b.bloco.ordem ?? b.indice) || a.indice - b.indice)
    .map(({ bloco }) => bloco);
}

/**
 * Blocos numerados como em F1 (`pacote.ts`): abertura com id e rótulo, o texto intacto
 * (a `estrofe` mantém os `\n` entre versos) e o fechamento, seguidos de linha em branco.
 */
export function serializarBlocos(blocos: readonly BlocoDoPrompt[], rotulo: (bloco: BlocoDoPrompt) => string): string {
  const linhas: string[] = [];
  for (const bloco of blocos) linhas.push(`${ABRE_BLOCO}${bloco.id}⟧ [${rotulo(bloco)}]`, bloco.texto, FECHA_BLOCO, '');
  return linhas.join('\n');
}

function exigirIdsUnicos(blocos: readonly BlocoDoPrompt[]): void {
  const ids = blocos.map((bloco) => bloco.id);
  if (new Set(ids).size !== ids.length) throw new Error('Bloco repetido na entrada do prompt.');
}

export function exigirModoValido(modo: ModoDeLeituraV1): void {
  if (!validarModoDeLeitura(modo)) throw new Error('Modo de leitura inválido.');
}

export function listaDeFuncoes(funcoes: readonly FuncaoDoModo[]): string {
  return funcoes.map((funcao) => `- \`${funcao.chave}\` — **${funcao.rotulo}**. ${funcao.pergunta} ${funcao.descricao}`).join('\n');
}

/** Legenda das vozes do método (`metodo-leitor.md`, seção 4), mais os dois tipos de F2. */
const USO_DO_COMENTARIO: Readonly<Record<TipoComentarioV2, string>> = {
  AUTOR: 'paráfrase fiel do texto, sem acrescentar nada. Rótulo `AUTOR · <o quê>` (por exemplo `AUTOR · DEFINIÇÃO`, `AUTOR · TESE`, `AUTOR · IMAGEM`).',
  LEITURA: 'consequência ou síntese inferencial sua, com as condições de que depende; nunca conclusão do autor. Rótulo `→ LEITURA`.',
  INVESTIGAR: 'dúvida, dificuldade ou hipótese a examinar, com uma pergunta específica que oriente a releitura. Rótulo `? INVESTIGAR`.',
  OBJECAO: 'objeção fundamentada: qual premissa, inferência ou evidência é problemática e por quê. Rótulo `× OBJEÇÃO`.',
  CONEXAO: 'relação com outra ideia deste texto: dizer qual e por quê. Rótulo `↔ CONEXÃO SUGERIDA`.',
  TENSAO: 'dois trechos, duas imagens ou duas exigências que puxam em direções diferentes sem que o texto resolva. Rótulo `TENSÃO`.',
  PREREQUISITO: 'o que é preciso saber ou ter lido antes para acompanhar o trecho. Rótulo `PRÉ-REQUISITO`.',
};

function listaDeComentarios(tipos: readonly TipoComentarioV2[]): string {
  return tipos.map((tipo) => `- \`${tipo}\`: ${USO_DO_COMENTARIO[tipo]}`).join('\n');
}

function percentual(fracao: number): string { return `${String(Math.round(fracao * 100))}%`; }

function alvosAteONivel(modo: ModoDeLeituraV1, nivel: Saliencia): string {
  const alvo = modo.saliencia.alvo_por_nivel;
  const frases = ([1, 2, 3] as const).filter((n) => n <= nivel).map((n) => {
    const fatia = percentual(alvo[String(n) as '1' | '2' | '3']);
    return n === 1 ? `no nível 1, cerca de ${fatia} do texto dos blocos a marcar coberto por marcas de saliência 1`
      : `no nível ${String(n)}, cerca de ${fatia} coberto por marcas de saliência até ${String(n)}`;
  });
  return `${frases.join('; ')}.`;
}

function enumDeIds(ids: readonly Id[]): SchemaJson {
  return ids.length > 0 && ids.length <= MAXIMO_IDS_NO_ENUM
    ? { type: 'string', enum: [...ids] }
    : { type: 'string', pattern: '^[0-7][0-9A-HJKMNP-TV-Z]{25}$' };
}

/**
 * Especializa o schema do leitor para a execução: funções do modo (mais `nenhuma`), saliência de 1
 * ao nível alvo, tipos de comentário do modo e, quando cabe, os ids dos blocos responsáveis.
 * Continua um subconjunto estrito de `MarcaGeradaV2`.
 */
export function schemaDaLeitura(modo: ModoDeLeituraV1, nivel: Saliencia, responsaveis: readonly Id[]): SchemaJson {
  const schema = schemaDoLeitorV2();
  const marca = em(schema, 'properties', 'marcas', 'items');
  const propriedades = em(marca, 'properties');
  propriedades.bloco_id = enumDeIds(responsaveis);
  propriedades.funcao = { type: 'string', enum: [...modo.funcoes.map((funcao) => funcao.chave), 'nenhuma'] };
  propriedades.saliencia = { type: 'integer', enum: [1, 2, 3].filter((n) => n <= nivel) };
  em(propriedades, 'comentario', 'anyOf', 1, 'properties').tipo = { type: 'string', enum: [...modo.comentarios] };
  return schema;
}

export interface EntradaDaLeitura {
  prompt_versao?: string;
  modo: ModoDeLeituraV1;
  /** Nível de atenção alvo da execução: a saliência máxima pedida. */
  nivel: Saliencia;
  /** Blocos responsáveis e de contexto da parte; vão para o prompt na ordem do canônico. */
  blocos: readonly BlocoDoPrompt[];
  /** Ids dos blocos que o modelo pode marcar; os demais saem como `[contexto · tipo]`. */
  responsaveis: readonly Id[];
  /** Resumo das partes anteriores do capítulo (`continuidade.ts`). */
  continuidade?: string;
}

/** Prompt e schema do leitor de parte V2 para um modo e um nível de atenção. Função pura. */
export function montarPromptDeLeitura(entrada: EntradaDaLeitura): PromptMontado {
  const { modo, nivel, blocos, responsaveis, continuidade } = entrada;
  const versao = entrada.prompt_versao ?? VERSAO_PROMPT_LEITURA;
  if (!['leitor-de-parte@2', 'leitor-de-parte@3', VERSAO_PROMPT_LEITURA].includes(versao)) throw new Error('Versão de leitura desconhecida.');
  exigirModoValido(modo);
  if (![1, 2, 3].includes(nivel)) throw new Error('Nível de atenção alvo fora de 1 a 3.');
  exigirIdsUnicos(blocos);
  const doPrompt = new Set(blocos.map((bloco) => bloco.id));
  const marcaveis = new Set(responsaveis);
  if (marcaveis.size === 0) throw new Error('A parte precisa de ao menos um bloco responsável.');
  for (const id of marcaveis) if (!doPrompt.has(id)) throw new Error(`Bloco responsável ${id} fora da entrada.`);
  const ordenados = ordenar(blocos);
  const texto = serializarBlocos(ordenados, (bloco) => (marcaveis.has(bloco.id) ? bloco.tipo : `contexto · ${bloco.tipo}`));
  const temContinuidade = continuidade !== undefined && /\S/u.test(continuidade);
  const prompt = preencher(filtrarPorModo(corpoDoModelo(modeloDoPrompt(versao, modo)), modo.id), {
    modo_nome: modo.nome,
    modo_ref: `${modo.id}@${String(modo.revisao)}`,
    modo_descricao: modo.descricao,
    funcoes: listaDeFuncoes(modo.funcoes),
    nivel: String(nivel),
    alvos: alvosAteONivel(modo, nivel),
    comentarios: listaDeComentarios(modo.comentarios),
    continuidade: temContinuidade
      ? `## O que as partes anteriores deste capítulo registraram\n\nÉ o resumo que elas deixaram, não texto a marcar.\n\n${cercar(continuidade.trim())}\n\n`
      : '',
    texto,
  });
  const ids = ordenados.filter((bloco) => marcaveis.has(bloco.id)).map((bloco) => bloco.id);
  return { prompt, schema: schemaDaLeitura(modo, nivel, ids), prompt_versao: versao };
}

/** Especializa o schema do responder com os ids dos blocos recebidos, quando cabem num enum. */
export function schemaDaResposta(ids: readonly Id[]): SchemaJson {
  const schema = schemaDoResponder();
  for (const ramo of [0, 1]) {
    em(schema, 'properties', 'pontos', 'items', 'anyOf', ramo, 'properties', 'apoios', 'items', 'properties').bloco_id = enumDeIds(ids);
  }
  em(schema, 'properties', 'sugestoes_de_conexao', 'items', 'properties').destino_bloco_id = enumDeIds(ids);
  return schema;
}

export interface EntradaDaResposta {
  pergunta: string;
  /** Âncora da conversa: o trecho sobre o qual o leitor pergunta. */
  ancora: AncoraV1;
  /** Mensagens anteriores da conversa; se a última for a própria pergunta, ela não se repete. */
  historico: readonly MensagemV2[];
  /** O bloco da âncora e, se couber, o anterior e o seguinte. */
  blocos_nucleo: readonly BlocoDoPrompt[];
  /** O resto do capítulo, já cortado pelo serviço. */
  blocos_contexto: readonly BlocoDoPrompt[];
  modo: ModoDeLeituraV1;
}

function serializarHistorico(historico: readonly MensagemV2[]): string {
  if (historico.length === 0) return 'Esta é a primeira pergunta da conversa.';
  return historico.map((mensagem) => `**${mensagem.autor === 'leitor' ? 'Leitor' : 'Você (resposta anterior)'}**\n\n${cercar(mensagem.texto)}`).join('\n\n');
}

/** Prompt e schema do responder, com o contexto em camadas. Função pura. */
export function montarPromptDeResposta(entrada: EntradaDaResposta): PromptMontado {
  const { pergunta, ancora, blocos_nucleo, blocos_contexto, modo } = entrada;
  exigirModoValido(modo);
  if (!/\S/u.test(pergunta)) throw new Error('Pergunta vazia.');
  if (!validarAncora(ancora)) throw new Error('Âncora da pergunta inválida.');
  exigirIdsUnicos([...blocos_nucleo, ...blocos_contexto]);
  const blocoDaAncora = blocos_nucleo.find((bloco) => bloco.id === ancora.bloco_id);
  if (!blocoDaAncora) throw new Error('O bloco da âncora precisa estar no núcleo.');
  if (blocoDaAncora.texto.slice(ancora.inicio_utf16, ancora.fim_utf16) !== ancora.citacao) {
    throw new Error('A âncora não corresponde ao texto do bloco.');
  }
  const ultima = entrada.historico.at(-1);
  const historico = ultima?.autor === 'leitor' && ultima.texto === pergunta ? entrada.historico.slice(0, -1) : entrada.historico;
  const nucleo = ordenar(blocos_nucleo);
  const contexto = ordenar(blocos_contexto);
  const prompt = preencher(filtrarPorModo(corpoDoModelo(lerPrompt(`${VERSAO_PROMPT_RESPOSTA}.md`)), modo.id), {
    modo_nome: modo.nome,
    modo_ref: `${modo.id}@${String(modo.revisao)}`,
    ancora_bloco: ancora.bloco_id,
    ancora_citacao: cercar(ancora.citacao),
    funcoes: listaDeFuncoes(modo.funcoes),
    historico: serializarHistorico(historico),
    pergunta: cercar(pergunta),
    nucleo: serializarBlocos(nucleo, (bloco) => `núcleo · ${bloco.tipo}`),
    contexto: contexto.length > 0
      ? serializarBlocos(contexto, (bloco) => `capítulo · ${bloco.tipo}`)
      : 'Nenhum bloco além do núcleo.\n',
  });
  return {
    prompt,
    schema: schemaDaResposta([...nucleo, ...contexto].map((bloco) => bloco.id)),
    prompt_versao: VERSAO_PROMPT_RESPOSTA,
  };
}
