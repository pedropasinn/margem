/**
 * Entrada de exemplo da exportação para o Obsidian: um livro curto em PDF com dois capítulos, um grifo
 * do leitor, marcas da IA (uma confirmada, com comentário), notas, uma pergunta com resposta, uma
 * conexão com uma nota do vault, etiqueta "?" e uma estrofe (trecho com quebras de linha). O texto
 * tem de propósito os caracteres que o Markdown do Obsidian interpretaria.
 *
 * Usada pelos testes do exportador e por `npm run exemplo-obsidian`, que grava a saída em
 * `integracoes/obsidian/exemplo/`.
 */
import { conexaoV2ParaV3 } from '@margem/contratos';
import type {
  AncoraV1, AnotacaoV1, Bloco, ConexaoV2, ConexaoV3, ConversaV2, DificuldadeV1, EtiquetaV1, MarcaV2, ResolucaoV2, Secao,
} from '@margem/contratos';
import type { EntradaDaExportacao } from './exportar.js';
import type { CartaoDaExportacao, EntradaDaExportacaoV2, FuncaoDaExportacao } from './exportar-v2.js';

const id = (prefixo: string, numero: number): string => `01K${prefixo}${String(numero).padStart(22 - prefixo.length, '0')}0`;
export const IDS = {
  documento: id('D', 1), versao: id('V', 1), outraVersao: id('V', 2), outroDocumento: id('D', 2),
  camadaIa: id('C', 1), camadaLeitor: id('C', 2),
};

const textos: [Bloco['tipo'], string, number][] = [
  ['capitulo', 'I. Da dúvida', 11],
  ['paragrafo', 'Toda certeza começa por uma suspeita: *nada* do que aprendi resiste a um exame de 100% das razões. #primeiro passo', 11],
  ['paragrafo', 'O cético responde que [[a razão]] não pode julgar a si mesma, e que $x = y$ só vale se aceitarmos as regras do jogo.', 12],
  ['estrofe', 'Ó mar salgado, quanto do teu sal\n   São lágrimas de Portugal!\n> Por te cruzarmos, quantas mães choraram', 13],
  ['capitulo', 'II. Do método', 14],
  ['paragrafo', '1. Dividir cada dificuldade em tantas parcelas quantas for possível; 2. ordenar os pensamentos == começar pelo simples.', 14],
];
const blocos: Bloco[] = textos.map(([tipo, texto, pagina], ordem) => ({
  id: id('B', ordem + 1), ordem, tipo, texto, inline: [],
  origens: [{ tipo: 'pdf', pagina, impressa: String(pagina + 100), bbox: [0, 0, 100, 100] }],
}));
const secoes: Secao[] = [
  { id: id('S', 1), nivel: 1, titulo: 'I. Da dúvida', ordem: 0, bloco_inicio: blocos[0]!.id, bloco_fim: blocos[3]!.id },
  { id: id('S', 2), nivel: 1, titulo: 'II. Do método', ordem: 1, bloco_inicio: blocos[4]!.id, bloco_fim: blocos[5]!.id },
];

function ancora(indice: number, citacao: string, versao = IDS.versao): AncoraV1 {
  const bloco = blocos[indice]!;
  const inicio = bloco.texto.indexOf(citacao);
  if (inicio < 0) throw new Error(`Citação ausente do bloco ${String(indice)}: ${citacao}`);
  return {
    versao_id: versao, bloco_id: bloco.id, inicio_utf16: inicio, fim_utf16: inicio + citacao.length, citacao,
    prefixo: bloco.texto.slice(Math.max(0, inicio - 32), inicio), sufixo: bloco.texto.slice(inicio + citacao.length, inicio + citacao.length + 32),
  };
}

function marca(numero: number, trecho: AncoraV1, extra: Partial<MarcaV2>): MarcaV2 {
  return {
    id: id('M', numero), ancora: trecho, funcao: 'tese', saliencia: 1, subfaixas: [], comentario: null,
    origem: 'parte', validade: 'resolvida', visivel: true, avaliacao: 'nao_avaliada', camada_id: IDS.camadaIa,
    modo: { id: 'filosofica', revisao: 1 }, criada_em: '2026-09-20T13:00:00.000Z', ...extra,
  };
}

export function entradaDeExemplo(): EntradaDaExportacao {
  const marcas: MarcaV2[] = [
    marca(1, ancora(1, 'Toda certeza começa por uma suspeita'), { avaliacao: 'confirmada',
      comentario: { tipo: 'LEITURA', rotulo: 'ponto de partida', texto: 'A dúvida é método, não conclusão.\nVer o capítulo II.' } }),
    marca(2, ancora(2, 'O cético responde que [[a razão]] não pode julgar a si mesma'), { funcao: 'objecao', saliencia: 2 }),
    marca(3, ancora(3, 'Ó mar salgado, quanto do teu sal\n   São lágrimas de Portugal!\n> Por te cruzarmos'), {
      funcao: 'imagem', modo: { id: 'literaria', revisao: 1 }, origem: 'manual', avaliacao: 'confirmada', camada_id: IDS.camadaLeitor,
      criada_em: '2026-09-21T22:30:00.000Z' }),
    marca(4, ancora(5, 'Dividir cada dificuldade em tantas parcelas quantas for possível'), { funcao: 'argumento', origem: 'manual',
      avaliacao: 'confirmada', camada_id: IDS.camadaLeitor, criada_em: '2026-09-22T10:00:00.000Z' }),
  ];
  const anotacoes: AnotacaoV1[] = [
    { versao: 1, revisao_edicao: 1, id: id('N', 1), versao_id: IDS.versao, ancora: marcas[0]!.ancora, tipo: 'impressao', marca_id: marcas[0]!.id,
      texto: 'Parece Agostinho antes de Descartes: *si fallor, sum*.\n\n# isto não é título\n- nem lista',
      criada_em: '2026-09-20T14:00:00.000Z', atualizada_em: '2026-09-23T09:15:00.000Z' },
    { versao: 1, revisao_edicao: 1, id: id('N', 2), versao_id: IDS.versao, ancora: ancora(2, '$x = y$'), tipo: 'duvida',
      texto: 'Que regras? As da lógica ou as da linguagem?', criada_em: '2026-09-20T15:00:00.000Z', atualizada_em: '2026-09-20T15:00:00.000Z' },
    { versao: 1, revisao_edicao: 1, id: id('N', 3), versao_id: IDS.versao, ancora: marcas[3]!.ancora, tipo: 'fonte', marca_id: marcas[3]!.id,
      texto: 'Regra 2 do Discurso.', fonte: { titulo: 'Discurso do método', url: 'https://exemplo.org/discurso', pagina: '47' },
      criada_em: '2026-09-22T10:05:00.000Z', atualizada_em: '2026-09-22T10:05:00.000Z' },
  ];
  const conversas: ConversaV2[] = [
    { versao: 2, id: id('Q', 1), versao_id: IDS.versao, ancora: marcas[1]!.ancora, marca_id: marcas[1]!.id, estado: 'aberta',
      criada_em: '2026-09-20T16:00:00.000Z', mensagens: [
        { id: id('X', 1), autor: 'leitor', texto: 'Essa objeção é a do círculo cartesiano? Quem a formulou primeiro?', criada_em: '2026-09-20T16:00:00.000Z' },
        { id: id('X', 2), autor: 'ia', texto: 'Em parte. O "círculo" é de Arnauld (Quartas Objeções):\nprovar Deus pela clareza e a clareza por Deus.',
          citacoes: [marcas[1]!.ancora], criada_em: '2026-09-20T16:00:30.000Z' },
        { id: id('X', 3), autor: 'leitor', texto: 'E o cético pirrônico?', criada_em: '2026-09-20T16:05:00.000Z' },
        { id: id('X', 4), autor: 'ia', texto: 'Ele suspende o juízo; não afirma que a razão *não pode*.', citacoes: [], criada_em: '2026-09-20T16:05:20.000Z' },
      ] },
  ];
  const conexoes: ConexaoV2[] = [
    { versao: 2, id: id('R', 1), origem: marcas[0]!.ancora, destino: { tipo: 'nota_externa', caminho: 'Zettel/202609201400 Dúvida metódica.md', titulo: 'Dúvida metódica' },
      relacao: 'desenvolve', justificativa: 'Minha nota permanente sobre o tema.', autor: 'leitor', estado: 'aceita',
      criada_em: '2026-09-20T14:10:00.000Z', decidida_em: '2026-09-20T14:10:00.000Z' },
    { versao: 2, id: id('R', 2), origem: marcas[3]!.ancora, destino: { tipo: 'trecho', ancora: marcas[0]!.ancora },
      relacao: 'prerequisito', justificativa: 'O método supõe a dúvida.', autor: 'ia', estado: 'aceita',
      criada_em: '2026-09-22T11:00:00.000Z', decidida_em: '2026-09-22T11:30:00.000Z' },
    { versao: 2, id: id('R', 3), origem: marcas[1]!.ancora, destino: { tipo: 'trecho', ancora: { ...marcas[1]!.ancora, versao_id: IDS.outraVersao } },
      relacao: 'contraste', justificativa: 'Montaigne diz o oposto.', autor: 'ia', estado: 'sugerida', criada_em: '2026-09-22T12:00:00.000Z' },
    { versao: 2, id: id('R', 4), origem: marcas[1]!.ancora, destino: { tipo: 'documento', documento_id: IDS.outroDocumento },
      relacao: 'semelhanca', justificativa: '', autor: 'leitor', estado: 'aceita',
      criada_em: '2026-09-22T12:30:00.000Z', decidida_em: '2026-09-22T12:30:00.000Z' },
  ];
  const etiquetas: EtiquetaV1[] = [
    { versao: 1, id: id('E', 1), versao_id: IDS.versao, alvo: { tipo: 'marca', id: marcas[1]!.id }, nome: 'premissa_implicita', criada_em: '2026-09-20T16:10:00.000Z' },
    { versao: 1, id: id('E', 2), versao_id: IDS.versao, alvo: { tipo: 'anotacao', id: anotacoes[1]!.id }, nome: 'ambiguidade', criada_em: '2026-09-20T16:11:00.000Z' },
  ];
  return {
    documento: { id: IDS.documento, titulo: 'Meditações: um ensaio sobre a dúvida', autor: 'René Descartes', formato: 'pdf',
      criado_em: '2026-09-19T23:30:00.000Z', fonte_url: null },
    versao_id: IDS.versao, secoes, blocos, marcas, anotacoes, conversas, conexoes, etiquetas,
    rotulos: {
      'filosofica@1:tese': 'Tese', 'filosofica@1:objecao': 'Objeção', 'filosofica@1:argumento': 'Argumento', 'literaria@1:imagem': 'Imagem',
    },
    destinos: { [IDS.outroDocumento]: { documento_id: IDS.outroDocumento, titulo: 'Ensaios / Livro I' } },
    url_base: 'https://margem.exemplo.ts.net',
  };
}

/**
 * A mesma leitura no formato 2 da exportação, já no modelo D (depois da migração 0032): as conexões em
 * V3 (uma adotada da compreensão, com o tipo fino), uma relação que chega de outro documento, uma
 * etiqueta livre, um flashcard e um exercício resolvido. As notas ligadas a grifos são as notas do
 * leitor (sem tipo; a da fonte com a referência por extenso no texto, como a migração a deixa), o
 * leitor anotou também um grifo do Codex, e a "Dúvida" solta ficou como nota antiga. As etiquetas de
 * dificuldade viraram sinais (`DificuldadeV1`), e há sinais do Codex: um confirmado, um sugerido e um
 * descartado. Usada pelos testes de ouro de `exportar-v2.ts` e por `npm run exemplo-obsidian`.
 */
export function entradaDeExemploV2(): EntradaDaExportacaoV2 {
  const v1 = entradaDeExemplo();
  const [m1, m2, m3, m4] = v1.marcas;
  const conexoes: ConexaoV3[] = v1.conexoes.map((conexao) => conexaoV2ParaV3(conexao));
  // A relação de pré-requisito veio da compreensão do capítulo (`pressupoe`).
  conexoes[1] = conexaoV2ParaV3(v1.conexoes[1]!, {
    relacao_semantica: 'pressupoe', origem_compreensao: { modelo_id: id('L', 1), relacao_id: id('Y', 1) },
  });
  // De outro documento (Ensaios) para a objeção daqui: a nota da relação mora na pasta do outro documento.
  const trechoDeFora: AncoraV1 = {
    versao_id: IDS.outraVersao, bloco_id: id('B', 90), inicio_utf16: 0, fim_utf16: 41,
    citacao: 'Que sei eu? A razão é um instrumento dúctil', prefixo: '', sufixo: '.',
  };
  conexoes.push({
    versao: 3, id: id('R', 5), origem: trechoDeFora, destino: { tipo: 'trecho', ancora: m2!.ancora }, relacao: 'tensao',
    relacao_semantica: 'responde', justificativa: 'Montaigne **responde** à objeção:\n\n- a razão cede\n- e o juízo se suspende',
    autor: 'leitor', estado: 'aceita', criada_em: '2026-09-23T08:00:00.000Z', decidida_em: '2026-09-23T08:00:00.000Z',
  });
  const etiquetas: EtiquetaV1[] = [...v1.etiquetas,
    { versao: 1, id: id('E', 3), versao_id: IDS.versao, alvo: { tipo: 'marca', id: m1!.id }, nome: 'Para a tese', criada_em: '2026-09-20T16:12:00.000Z' }];
  const flashcards: CartaoDaExportacao[] = [{
    id: id('F', 1), ancora: m4!.ancora, frente: 'Qual é a **segunda** regra do método?', verso: 'Dividir cada dificuldade em parcelas.\n\n> Discurso, parte II',
    origem: 'ia', criado_em: '2026-09-22T12:00:00.000Z', atualizado_em: '2026-09-22T12:10:00.000Z',
  }];
  const resolucoes: ResolucaoV2[] = [{
    versao: 2, id: id('Z', 1), documento_id: IDS.documento, versao_id: IDS.versao,
    origem: { tipo: 'trecho', ancora: m4!.ancora }, texto_extraido: 'Divida 12 em parcelas iguais.',
    exercicio: { capitulo: 'II', secao: null, numero: '2.1', ordem: 1 },
    resolucao: {
      enunciado: 'Divida $12$ em três parcelas iguais.', legibilidade: 'boa', conceitos: ['divisão'], observacao: null,
      itens: [{ rotulo: '', enunciado: '', estrategia: 'Dividir pelo número de parcelas.', passos: [{ texto: 'Divida 12 por 3.', calculo: '12 / 3 = 4' }],
        resposta: 'Cada parcela vale $4$.', verificacao: '$3 \\cdot 4 = 12$.' }],
    },
    execucao: { modelo: 'gpt-x', esforco: 'medium' },
    mensagens: [{ id: id('X', 9), autor: 'leitor', texto: 'E se fossem *quatro*?', criada_em: '2026-09-22T13:00:00.000Z' }],
    criada_em: '2026-09-22T12:30:00.000Z',
  }];
  const [n1, n2, n3] = v1.anotacoes;
  const anotacoes: AnotacaoV1[] = [
    n1!,
    n2!,
    { ...n3!, texto: 'Regra 2 do Discurso.\n\nFonte: Discurso do método, p. 47 — https://exemplo.org/discurso' },
    { versao: 1, revisao_edicao: 2, id: id('N', 4), versao_id: IDS.versao, ancora: m2!.ancora, tipo: 'nota', marca_id: m2!.id,
      texto: 'É o círculo: a razão julga a razão.', criada_em: '2026-09-20T16:20:00.000Z', atualizada_em: '2026-09-20T16:30:00.000Z',
      revisao: { autor: 'codex', texto_anterior: 'é o circulo, a razao julga a razao', motivo: 'Acentos e pontuação.', em: '2026-09-20T16:30:00.000Z' } },
  ];
  const dificuldade = (numero: number, trecho: AncoraV1, extra: Partial<DificuldadeV1>): DificuldadeV1 => ({
    versao: 1, id: id('G', numero), versao_id: IDS.versao, ancora: trecho, origem: 'leitor', estado: 'confirmada',
    criada_em: '2026-09-20T16:10:00.000Z', atualizada_em: '2026-09-20T16:10:00.000Z', ...extra,
  });
  const dificuldades: DificuldadeV1[] = [
    // As duas etiquetas "?" antigas, convertidas pela migração (a etiqueta continua no banco).
    dificuldade(1, m2!.ancora, { tipo: 'premissa_implicita', marca_id: m2!.id }),
    dificuldade(2, n2!.ancora, { tipo: 'ambiguidade', criada_em: '2026-09-20T16:11:00.000Z', atualizada_em: '2026-09-20T16:11:00.000Z' }),
    // Do leitor, sem categoria, num grifo dele.
    dificuldade(3, m3!.ancora, { marca_id: m3!.id, criada_em: '2026-09-21T22:40:00.000Z', atualizada_em: '2026-09-21T22:40:00.000Z' }),
    // Do Codex: confirmada (num trecho dentro do grifo), sugerida de novo e descartada (esta não sai).
    dificuldade(4, ancora(5, 'tantas parcelas quantas for possível'), {
      origem: 'codex', tipo: 'salto_argumentativo', marca_id: m4!.id, descricao: 'Não diz como saber quantas parcelas são "possíveis".',
      codex: { modelo_id: id('L', 1), dificuldade_id: id('W', 1) }, criada_em: '2026-09-22T10:30:00.000Z', atualizada_em: '2026-09-22T10:31:00.000Z' }),
    dificuldade(5, ancora(1, 'resiste a um exame de 100% das razões'), {
      origem: 'codex', estado: 'sugerida', tipo: 'conceito_sem_definicao', descricao: '"Exame" aqui é técnico.',
      codex: { modelo_id: id('L', 1), dificuldade_id: id('W', 2) }, criada_em: '2026-09-22T10:32:00.000Z', atualizada_em: '2026-09-22T10:33:00.000Z' }),
    dificuldade(6, m1!.ancora, {
      origem: 'codex', estado: 'descartada', tipo: 'ambiguidade', marca_id: m1!.id, descricao: 'Descartada pelo leitor.',
      codex: { modelo_id: id('L', 1), dificuldade_id: id('W', 3) }, criada_em: '2026-09-22T10:34:00.000Z', atualizada_em: '2026-09-22T10:35:00.000Z' }),
  ];
  const funcoes: Record<string, FuncaoDaExportacao> = {
    'filosofica@1:tese': { rotulo: 'Tese', cor: '#E8B04B' }, 'filosofica@1:objecao': { rotulo: 'Objeção', cor: '#E06C75' },
    'filosofica@1:argumento': { rotulo: 'Argumento', cor: '#61AFEF' }, 'literaria@1:imagem': { rotulo: 'Imagem', cor: null },
  };
  return {
    documento: v1.documento, versao_id: v1.versao_id, secoes: v1.secoes, blocos: v1.blocos, marcas: v1.marcas,
    anotacoes, conversas: v1.conversas, conexoes, etiquetas, dificuldades, flashcards, resolucoes, funcoes,
    destinos: { ...v1.destinos, [IDS.outraVersao]: { documento_id: IDS.outroDocumento, titulo: 'Ensaios / Livro I' } },
    marcas_externas: [{ id: id('M', 9), ancora: trechoDeFora, funcao: 'tese', modo: { id: 'filosofica', revisao: 1 } }],
    url_base: v1.url_base,
  };
}
