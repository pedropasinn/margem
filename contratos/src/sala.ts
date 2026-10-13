/**
 * Sala de teste (beta): documentos da biblioteca abertos a testadores por uma senha, com um
 * formulário de feedback e comentários sobre trechos.
 *
 * - `FormularioDaSalaV1`: perguntas gerais e perguntas repetidas para cada documento da sala.
 * - `RespostaDaSalaV1`: as respostas de um testador (rascunho até o envio; editável enquanto a
 *   sala estiver aberta).
 * - `ComentarioDaSalaV1`: um comentário do testador sobre um trecho literal de um bloco.
 * - `SalaDeTesteV1`: a sala como o dono a vê (sem a senha: só o serviço guarda o hash).
 *
 * Invariantes além do schema estão nas funções `regras*`; a coerência entre uma resposta e o
 * formulário da sala é `conferirRespostas`.
 */
import type { Id } from './tipos';

export type TipoDePerguntaDaSala = 'escala' | 'escolha' | 'texto_curto' | 'texto_longo';
export const TIPOS_DE_PERGUNTA_DA_SALA: readonly TipoDePerguntaDaSala[] = ['escala', 'escolha', 'texto_curto', 'texto_longo'];

export interface PerguntaDaSalaV1 {
  /** Identificador estável da pergunta (minúsculas, dígitos, sublinhado). */
  id: string;
  tipo: TipoDePerguntaDaSala;
  enunciado: string;
  ajuda?: string;
  obrigatoria: boolean;
  /** Só na escolha única: de 2 a 10 opções, sem repetição. */
  opcoes?: string[];
  /** Só na escala: o que significam o 1 e o 5. */
  rotulos?: { minimo: string; maximo: string };
}

export interface FormularioDaSalaV1 {
  versao: 1;
  geral: PerguntaDaSalaV1[];
  /** Repetidas para cada documento da sala; podem faltar. */
  por_documento: PerguntaDaSalaV1[];
}

/** Escala de 1 a 5 ou texto (escolha única, texto curto, texto longo). */
export type ValorDaRespostaDaSala = number | string;

export interface RespostaDaSalaV1 {
  versao: 1;
  estado: 'rascunho' | 'enviada';
  geral: Record<string, ValorDaRespostaDaSala>;
  por_documento: Record<Id, Record<string, ValorDaRespostaDaSala>>;
  atualizada_em: string;
  enviada_em: string | null;
}

export interface ComentarioDaSalaV1 {
  id: Id;
  sala_id: Id;
  testador_id: Id;
  documento_id: Id;
  versao_id: Id;
  bloco_id: Id;
  inicio_utf16: number;
  fim_utf16: number;
  /** O trecho literal do bloco entre `inicio_utf16` e `fim_utf16`. */
  citacao: string;
  texto: string;
  criado_em: string;
}

export interface SalaDeTesteV1 {
  versao: 1;
  id: Id;
  /** Parte pública do link `/t/<slug>`: aleatória, não diz nada do conteúdo. */
  slug: string;
  titulo: string;
  boas_vindas: string;
  documentos: Id[];
  ativa: boolean;
  expira_em: string | null;
  formulario: FormularioDaSalaV1;
  criada_em: string;
  atualizada_em: string;
}

/** Limite do texto curto (o texto longo vai até o limite do schema, 5000). */
export const LIMITE_TEXTO_CURTO = 300;
export const LIMITE_TEXTO_LONGO = 5000;

function perguntasCoerentes(perguntas: readonly PerguntaDaSalaV1[]): boolean {
  const ids = new Set<string>();
  for (const pergunta of perguntas) {
    if (ids.has(pergunta.id)) return false;
    ids.add(pergunta.id);
    const temOpcoes = pergunta.opcoes !== undefined;
    if ((pergunta.tipo === 'escolha') !== temOpcoes) return false;
    if (pergunta.rotulos !== undefined && pergunta.tipo !== 'escala') return false;
    if (pergunta.opcoes && new Set(pergunta.opcoes.map((opcao) => opcao.trim().toLowerCase())).size !== pergunta.opcoes.length) return false;
  }
  return true;
}

/** Ids únicos em cada lista; opções só (e sempre) na escolha; rótulos só na escala. */
export function regrasFormularioDaSala(valor: FormularioDaSalaV1): boolean {
  return perguntasCoerentes(valor.geral) && perguntasCoerentes(valor.por_documento);
}

/** `enviada_em` existe exatamente quando a resposta foi enviada e nunca depois da última edição. */
export function regrasRespostaDaSala(valor: RespostaDaSalaV1): boolean {
  if ((valor.estado === 'enviada') !== (valor.enviada_em !== null)) return false;
  return valor.enviada_em === null || Date.parse(valor.enviada_em) <= Date.parse(valor.atualizada_em);
}

/** O intervalo tem o comprimento UTF-16 da citação. */
export function regrasComentarioDaSala(valor: ComentarioDaSalaV1): boolean {
  return valor.fim_utf16 > valor.inicio_utf16 && valor.fim_utf16 - valor.inicio_utf16 === valor.citacao.length && /\S/.test(valor.texto);
}

/** Documentos sem repetição e formulário coerente. */
export function regrasSalaDeTeste(valor: SalaDeTesteV1): boolean {
  return new Set(valor.documentos).size === valor.documentos.length && regrasFormularioDaSala(valor.formulario);
}

export interface ProblemaDaResposta {
  /** `geral.<id>` ou `por_documento.<documento>.<id>`. */
  campo: string;
  codigo: 'pergunta_inexistente' | 'documento_fora_da_sala' | 'tipo_errado' | 'opcao_inexistente' | 'longo_demais' | 'obrigatoria_sem_resposta';
}

function vazio(valor: ValorDaRespostaDaSala | undefined): boolean {
  return valor === undefined || (typeof valor === 'string' && valor.trim() === '');
}

function conferirGrupo(
  perguntas: readonly PerguntaDaSalaV1[], respostas: Readonly<Record<string, ValorDaRespostaDaSala>>, prefixo: string, final: boolean,
): ProblemaDaResposta[] {
  const problemas: ProblemaDaResposta[] = [];
  const porId = new Map(perguntas.map((pergunta) => [pergunta.id, pergunta]));
  for (const [id, valor] of Object.entries(respostas)) {
    const pergunta = porId.get(id);
    const campo = `${prefixo}.${id}`;
    if (!pergunta) { problemas.push({ campo, codigo: 'pergunta_inexistente' }); continue; }
    if (pergunta.tipo === 'escala') {
      if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 1 || valor > 5) problemas.push({ campo, codigo: 'tipo_errado' });
      continue;
    }
    if (typeof valor !== 'string') { problemas.push({ campo, codigo: 'tipo_errado' }); continue; }
    if (pergunta.tipo === 'escolha' && valor !== '' && !(pergunta.opcoes ?? []).includes(valor)) problemas.push({ campo, codigo: 'opcao_inexistente' });
    if (pergunta.tipo === 'texto_curto' && valor.length > LIMITE_TEXTO_CURTO) problemas.push({ campo, codigo: 'longo_demais' });
    if (pergunta.tipo === 'texto_longo' && valor.length > LIMITE_TEXTO_LONGO) problemas.push({ campo, codigo: 'longo_demais' });
  }
  if (final) {
    for (const pergunta of perguntas) {
      if (pergunta.obrigatoria && vazio(respostas[pergunta.id])) problemas.push({ campo: `${prefixo}.${pergunta.id}`, codigo: 'obrigatoria_sem_resposta' });
    }
  }
  return problemas;
}

/**
 * Confere as respostas contra o formulário e os documentos da sala. Num rascunho só os valores
 * presentes são conferidos; no envio, as perguntas obrigatórias também precisam de resposta.
 */
export function conferirRespostas(
  formulario: FormularioDaSalaV1, documentos: readonly Id[],
  respostas: Pick<RespostaDaSalaV1, 'geral' | 'por_documento'>, final: boolean,
): ProblemaDaResposta[] {
  const problemas = conferirGrupo(formulario.geral, respostas.geral, 'geral', final);
  for (const [documento, grupo] of Object.entries(respostas.por_documento)) {
    if (!documentos.includes(documento)) { problemas.push({ campo: `por_documento.${documento}`, codigo: 'documento_fora_da_sala' }); continue; }
    problemas.push(...conferirGrupo(formulario.por_documento, grupo, `por_documento.${documento}`, false));
  }
  if (final && formulario.por_documento.length > 0) {
    for (const documento of documentos) {
      problemas.push(...conferirGrupo(formulario.por_documento, respostas.por_documento[documento] ?? {}, `por_documento.${documento}`, true)
        .filter((problema) => problema.codigo === 'obrigatoria_sem_resposta'));
    }
  }
  return problemas;
}

/** O modelo pronto do leitor: entra em toda sala nova e pode ser editado. */
export const FORMULARIO_PADRAO_DA_SALA: FormularioDaSalaV1 = {
  versao: 1,
  geral: [
    { id: 'primeira_impressao', tipo: 'escala', enunciado: 'Qual foi a sua primeira impressão do Margem?', obrigatoria: true,
      rotulos: { minimo: 'Ruim', maximo: 'Ótima' } },
    { id: 'marcas_ajudaram', tipo: 'escala', enunciado: 'As marcas e as notas ajudaram você a entender o texto?', obrigatoria: true,
      rotulos: { minimo: 'Nada', maximo: 'Muito' } },
    { id: 'o_que_confundiu', tipo: 'texto_longo', enunciado: 'O que confundiu você?', obrigatoria: false,
      ajuda: 'Um botão, uma marca, uma nota, o jeito de navegar. Pode ser curto.' },
    { id: 'o_que_faltou', tipo: 'texto_longo', enunciado: 'O que faltou?', obrigatoria: false },
    { id: 'usaria_de_novo', tipo: 'escolha', enunciado: 'Você usaria de novo para ler algo seu?', obrigatoria: true,
      opcoes: ['Sim', 'Talvez', 'Não'] },
    { id: 'comentario_livre', tipo: 'texto_longo', enunciado: 'Quer dizer mais alguma coisa?', obrigatoria: false },
  ],
  por_documento: [],
};

/** Perguntas por documento sugeridas quando o leitor liga essa parte. */
export const PERGUNTAS_POR_DOCUMENTO_SUGERIDAS: PerguntaDaSalaV1[] = [
  { id: 'clareza', tipo: 'escala', enunciado: 'As notas deste texto foram claras?', obrigatoria: false,
    rotulos: { minimo: 'Confusas', maximo: 'Claras' } },
  { id: 'nota_mais_util', tipo: 'texto_curto', enunciado: 'Qual nota ou marca foi a mais útil?', obrigatoria: false },
];
