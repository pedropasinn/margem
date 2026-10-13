/**
 * Entrada de exemplo da exportação para o Obsidian: um livro curto em PDF com dois capítulos, um grifo
 * do leitor, marcas da IA (uma confirmada, com comentário), notas, uma pergunta com resposta, uma
 * conexão com uma nota do vault, etiqueta "?" e uma estrofe (trecho com quebras de linha). O texto
 * tem de propósito os caracteres que o Markdown do Obsidian interpretaria.
 *
 * Usada pelos testes do exportador e por `npm run exemplo-obsidian`, que grava a saída em
 * `integracoes/obsidian/exemplo/`.
 */
import type { AncoraV1, AnotacaoV1, Bloco, ConexaoV2, ConversaV2, EtiquetaV1, MarcaV2, Secao } from '@margem/contratos';
import type { EntradaDaExportacao } from './exportar.js';

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
