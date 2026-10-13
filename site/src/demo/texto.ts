/**
 * Trecho da demonstração: Machado de Assis, "Notícia da atual literatura brasileira — Instinto de
 * nacionalidade" (1873), domínio público. As marcas e as notas foram escritas à mão para a página
 * e reproduzem o tipo de leitura que o Margem faz no modo filosófico.
 */
export type Funcao = 'tese' | 'conceito' | 'argumento' | 'objecao';

export const ROTULO: Record<Funcao, string> = {
  tese: 'Tese',
  conceito: 'Conceito',
  argumento: 'Argumento',
  objecao: 'Objeção',
};

export interface Marca {
  id: string;
  funcao: Funcao;
  /** 1 = essencial, 2 = importante, 3 = detalhe. O leitor escolhe a atenção de 0 a 3. */
  saliencia: 1 | 2 | 3;
  nota: string;
}

export type Segmento = string | { marca: string; texto: string };

export const MARCAS: readonly Marca[] = [
  { id: 'm1', funcao: 'objecao', saliencia: 1, nota: 'A posição que o ensaio vai recusar: só seria nacional a obra de assunto local.' },
  { id: 'm2', funcao: 'argumento', saliencia: 2, nota: 'Contraexemplo: o poeta mais inglês escreve sobre a Dinamarca, Veneza e Roma.' },
  { id: 'm3', funcao: 'tese', saliencia: 1, nota: 'A tese: a nacionalidade está no sentimento do escritor, não no assunto que ele escolhe.' },
  { id: 'm4', funcao: 'conceito', saliencia: 3, nota: 'Define o “sentimento íntimo” pelo efeito: situar o escritor no seu tempo e no seu lugar.' },
];

export const PARAGRAFOS: readonly (readonly Segmento[])[] = [
  [
    'Devo acrescentar que neste ponto manifesta-se às vezes uma opinião, que tenho por errônea: é a que ',
    { marca: 'm1', texto: 'só reconhece espírito nacional nas obras que tratam de assunto local' },
    ', doutrina que, a ser exata, limitaria muito os cabedais da nossa literatura.',
  ],
  [
    'Perguntarei mais se o Hamlet, o Otelo, o Júlio César, a Julieta e Romeu têm alguma coisa com a história inglesa nem com o território britânico, e se, entretanto, ',
    { marca: 'm2', texto: 'Shakespeare não é, além de um gênio universal, um poeta essencialmente inglês' },
    '.',
  ],
  [
    'Não há dúvida que uma literatura, sobretudo uma literatura nascente, deve principalmente alimentar-se dos assuntos que lhe oferece a sua região; mas não estabeleçamos doutrinas tão absolutas que a empobreçam. ',
    { marca: 'm3', texto: 'O que se deve exigir do escritor antes de tudo, é certo sentimento íntimo' },
    ', que o torne ',
    { marca: 'm4', texto: 'homem do seu tempo e do seu país' },
    ', ainda quando trate de assuntos remotos no tempo e no espaço.',
  ],
];

/** A pergunta do leitor e a resposta presa ao trecho, mostradas sob a nota da objeção. */
export const PERGUNTA = {
  marca: 'm1',
  pergunta: 'O que quer dizer “cabedais” aqui?',
  resposta: 'Recursos, patrimônio. Se só valesse o assunto local, a literatura teria menos do que tratar: é por isso que Machado chama a doutrina de empobrecedora no terceiro parágrafo.',
} as const;
