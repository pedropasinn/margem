/**
 * Recorte de leitura no formato do app, para a demonstração da página inicial: blocos como os do
 * `CanonicoV1` (id + texto), marcas como as do snapshot do capítulo (função do modo filosófico,
 * saliência, âncora com offsets UTF-16 e citação, comentário) e relações como as da compreensão do
 * capítulo (tipo, âncora de origem e de destino, explicação). Os offsets saem da citação, como em
 * `scripts/capturar-app.mjs`; uma citação que não existe no bloco derruba o build (erro na carga).
 *
 * Texto: Machado de Assis, "Notícia da atual literatura brasileira — Instinto de nacionalidade"
 * (1873), domínio público. Marcas, notas e relações escritas para a página, no estilo da leitura
 * filosófica do Margem.
 */
import type { Funcao, TipoDeRelacao } from '../app/marcador';

export interface Bloco { id: string; texto: string }
export interface Ancora { bloco_id: string; inicio_utf16: number; fim_utf16: number; citacao: string }
export interface MarcaDoRecorte { id: string; funcao: Funcao; saliencia: 1 | 2 | 3; ancora: Ancora; comentario: { texto: string } }
export interface RelacaoDoRecorte { id: string; tipo: TipoDeRelacao; origem: Ancora; destino: Ancora; explicacao: string }

export const TITULO = 'Notícia da atual literatura brasileira';
export const DOCUMENTO = 'Instinto de nacionalidade';
export const FONTE = 'Machado de Assis, 1873 · domínio público';

export const BLOCOS: readonly Bloco[] = [
  { id: 'b1', texto: 'Devo acrescentar que neste ponto manifesta-se às vezes uma opinião, que tenho por errônea: é a que só reconhece espírito nacional nas obras que tratam de assunto local, doutrina que, a ser exata, limitaria muito os cabedais da nossa literatura.' },
  { id: 'b2', texto: 'Perguntarei mais se o Hamlet, o Otelo, o Júlio César, a Julieta e Romeu têm alguma coisa com a história inglesa nem com o território britânico, e se, entretanto, Shakespeare não é, além de um gênio universal, um poeta essencialmente inglês.' },
  { id: 'b3', texto: 'Não há dúvida que uma literatura, sobretudo uma literatura nascente, deve principalmente alimentar-se dos assuntos que lhe oferece a sua região; mas não estabeleçamos doutrinas tão absolutas que a empobreçam. O que se deve exigir do escritor antes de tudo, é certo sentimento íntimo, que o torne homem do seu tempo e do seu país, ainda quando trate de assuntos remotos no tempo e no espaço.' },
];

function ancora(bloco_id: string, citacao: string): Ancora {
  const texto = BLOCOS.find((b) => b.id === bloco_id)?.texto ?? '';
  const inicio = texto.indexOf(citacao);
  if (inicio < 0) throw new Error(`Citação fora do bloco ${bloco_id}: ${citacao}`);
  return { bloco_id, inicio_utf16: inicio, fim_utf16: inicio + citacao.length, citacao };
}

export const MARCAS: readonly MarcaDoRecorte[] = [
  { id: 'm1', funcao: 'objecao', saliencia: 1, ancora: ancora('b1', 'só reconhece espírito nacional nas obras que tratam de assunto local'),
    comentario: { texto: 'A posição que o ensaio vai recusar: só seria nacional a obra de assunto local.' } },
  { id: 'm2', funcao: 'consequencia', saliencia: 2, ancora: ancora('b1', 'limitaria muito os cabedais da nossa literatura'),
    comentario: { texto: 'O custo da doutrina: a literatura teria menos do que tratar.' } },
  { id: 'm3', funcao: 'argumento', saliencia: 1, ancora: ancora('b2', 'Shakespeare não é, além de um gênio universal, um poeta essencialmente inglês'),
    comentario: { texto: 'Contraexemplo: o poeta mais inglês escreve sobre a Dinamarca, Veneza e Roma.' } },
  { id: 'm4', funcao: 'tese', saliencia: 1, ancora: ancora('b3', 'O que se deve exigir do escritor antes de tudo, é certo sentimento íntimo'),
    comentario: { texto: 'A tese: a nacionalidade está no sentimento do escritor, não no assunto que ele escolhe.' } },
  { id: 'm5', funcao: 'conceito', saliencia: 2, ancora: ancora('b3', 'homem do seu tempo e do seu país'),
    comentario: { texto: 'Define o “sentimento íntimo” pelo efeito: situar o escritor no seu tempo e no seu lugar.' } },
  { id: 'm6', funcao: 'distincao', saliencia: 3, ancora: ancora('b3', 'assuntos remotos no tempo e no espaço'),
    comentario: { texto: 'Separa o assunto da obra do lugar de quem escreve.' } },
];

const da = (id: string): Ancora => MARCAS.find((m) => m.id === id)!.ancora;

export const RELACOES: readonly RelacaoDoRecorte[] = [
  { id: 'r1', tipo: 'responde', origem: da('m3'), destino: da('m1'), explicacao: 'O contraexemplo derruba a doutrina: o poeta mais inglês escreveu sobre a Dinamarca, Veneza e Roma.' },
  { id: 'r2', tipo: 'contrasta', origem: da('m4'), destino: da('m1'), explicacao: 'A tese troca o critério da objeção: sai o assunto da obra, entra o sentimento de quem escreve.' },
  { id: 'r3', tipo: 'exemplifica', origem: da('m3'), destino: da('m4'), explicacao: 'Shakespeare é o caso da tese: assuntos remotos, sentimento inglês.' },
];

/** A pergunta do leitor presa ao trecho da objeção, com a resposta que cita o texto. */
export const PERGUNTA = {
  marca: 'm1',
  pergunta: 'O que quer dizer “cabedais” aqui?',
  resposta: 'Recursos, patrimônio. Se só valesse o assunto local, a literatura teria menos do que tratar: é por isso que Machado chama a doutrina de empobrecedora no terceiro parágrafo.',
} as const;

/** Os pedaços de um bloco: texto solto ou trecho com as marcas que o cobrem (como os spans `data-marcas` do leitor). */
export function segmentos(bloco: Bloco, marcas: readonly MarcaDoRecorte[]): { texto: string; marcas: string[] }[] {
  const doBloco = marcas.filter((m) => m.ancora.bloco_id === bloco.id);
  const cortes = [...new Set([0, bloco.texto.length, ...doBloco.flatMap((m) => [m.ancora.inicio_utf16, m.ancora.fim_utf16])])].sort((a, b) => a - b);
  return cortes.slice(0, -1).map((inicio, i) => {
    const fim = cortes[i + 1]!;
    return { texto: bloco.texto.slice(inicio, fim), marcas: doBloco.filter((m) => m.ancora.inicio_utf16 <= inicio && m.ancora.fim_utf16 >= fim).map((m) => m.id) };
  });
}
