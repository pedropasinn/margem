/**
 * Capturas do README (e do site) com o app de verdade: a API e o worker deste repositório num Postgres
 * descartável (`margem_test_readme_*`, criado e apagado aqui; a produção nunca é tocada) e a interface
 * compilada (`web/dist`). O Codex nunca é chamado: um executor determinístico responde cada chamada
 * pelo schema pedido, com análises escritas para estas capturas sobre textos de domínio público.
 *
 * Material (todo em domínio público, ou escrito para o projeto):
 * - "Um apólogo", de Machado de Assis (Markdown do onboarding);
 * - "Instinto de nacionalidade" (Machado de Assis, 1873), trechos num PDF gerado aqui pelo PyMuPDF;
 * - "Canção do exílio", de Gonçalves Dias (1843);
 * - "Oração aos moços" (Rui Barbosa, 1921), trechos como transcrição de um vídeo gerado aqui pelo ffmpeg;
 * - "Educação Obrigatória" (Briton Rivière, 1887), a obra de exemplo de `web/public/arte/`;
 * - a questão de cálculo do site (`site/public/demo/questao.png`), original do projeto.
 *
 * Uso (depois de `npm run build --workspace web`; para a abertura do site, também `npm run build` em
 * `site/`), de dentro de `servico/`:
 *   node --import tsx src/ferramentas/capturar-readme.ts
 *   node --import tsx src/ferramentas/capturar-readme.ts --so=leitor,video,site
 *   node --import tsx src/ferramentas/capturar-readme.ts --servir
 * Telas: site, quadro, biblioteca, leitor, grifo, leitor-escuro, pdf, relacoes, video, exercicio, perguntar,
 * documento, notas e modelos. Saída: `docs/imagens/readme/<tela>.png` (1600 px de largura, otimizadas). `--saida=<pasta>` troca a
 * pasta; `--servir` semeia e deixa o app no ar em http://127.0.0.1:8771 até Ctrl+C, sem capturar.
 * Precisa de `motor/.venv` (PyMuPDF), `ffmpeg` e do Chromium do Playwright.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { chromium, type Browser, type Page } from 'playwright';
import type pg from 'pg';
import type { AncoraV1 } from '@margem/contratos';

// ---------------------------------------------------------------- opções e ambiente

const raiz = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const argumentos = process.argv.slice(2);
const opcao = (nome: string): string | undefined => argumentos.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3);
const SERVIR = argumentos.includes('--servir');
const SO = opcao('so')?.split(',');
const PASTA = resolve(opcao('saida') ?? join(raiz, 'docs/imagens/readme'));
const PORTA = 8771;
const PORTA_DO_SITE = 8772;
const API = `http://127.0.0.1:${String(PORTA)}`;
const LARGURA = 1600;

const temporaria = mkdtempSync(join(tmpdir(), 'margem-readme-'));
process.env.MARGEM_DADOS = join(temporaria, 'dados');
process.env.MARGEM_ARTEFATOS = join(temporaria, 'artefatos');
process.env.MARGEM_PORTA = String(PORTA);
process.env.MARGEM_PREFETCH = '0';
process.env.MARGEM_ORIGENS = `${API},http://localhost:${String(PORTA)}`;
mkdirSync(process.env.MARGEM_DADOS, { recursive: true });
const PYTHON = join(raiz, 'motor/.venv/bin/python');
assert.ok(existsSync(PYTHON), 'Falta motor/.venv (python3 -m venv motor/.venv && motor/.venv/bin/pip install -r motor/requirements.txt).');
assert.ok(existsSync(join(raiz, 'web/dist/index.html')), 'Falta web/dist: rode `npm run build --workspace web`.');

// ---------------------------------------------------------------- material

const APOLOGO = readFileSync(join(raiz, 'web/src/onboarding/exemplo/um-apologo.md'), 'utf8');

const CANCAO = `# Canção do exílio

Minha terra tem palmeiras,
Onde canta o Sabiá;
As aves, que aqui gorjeiam,
Não gorjeiam como lá.

Nosso céu tem mais estrelas,
Nossas várzeas têm mais flores,
Nossos bosques têm mais vida,
Nossa vida mais amores.

Em cismar, sozinho, à noite,
Mais prazer encontro eu lá;
Minha terra tem palmeiras,
Onde canta o Sabiá.

Minha terra tem primores,
Que tais não encontro eu cá;
Em cismar — sozinho, à noite —
Mais prazer encontro eu lá;
Minha terra tem palmeiras,
Onde canta o Sabiá.

Não permita Deus que eu morra,
Sem que eu volte para lá;
Sem que desfrute os primores
Que não encontro por cá;
Sem qu'inda aviste as palmeiras,
Onde canta o Sabiá.
`;

/** Machado de Assis, "Notícia da atual literatura brasileira — Instinto de nacionalidade" (1873), trechos. */
const ENSAIO = [
  'Quem examina a atual literatura brasileira reconhece-lhe logo, como primeiro traço, certo instinto de nacionalidade.',
  'Devo acrescentar que neste ponto manifesta-se às vezes uma opinião, que tenho por errônea: é a que só reconhece espírito nacional nas obras que tratam de assunto local, doutrina que, a ser exata, limitaria muito os cabedais da nossa literatura.',
  'Perguntarei mais se o Hamlet, o Otelo, o Júlio César, a Julieta e Romeu têm alguma coisa com a história inglesa nem com o território britânico, e se, entretanto, Shakespeare não é, além de um gênio universal, um poeta essencialmente inglês.',
  'Não há dúvida que uma literatura, sobretudo uma literatura nascente, deve principalmente alimentar-se dos assuntos que lhe oferece a sua região; mas não estabeleçamos doutrinas tão absolutas que a empobreçam. O que se deve exigir do escritor antes de tudo, é certo sentimento íntimo, que o torne homem do seu tempo e do seu país, ainda quando trate de assuntos remotos no tempo e no espaço.',
];

/** Rui Barbosa, "Oração aos moços" (1921), trechos: a transcrição do vídeo. */
const ORACAO = [
  'A regra da igualdade não consiste senão em quinhoar desigualmente aos desiguais, na medida em que se desigualam. Nesta desigualdade social, proporcionada à desigualdade natural, é que se acha a verdadeira lei da igualdade. O mais são desvarios da inveja, do orgulho, ou da loucura.',
  'Tratar com desigualdade a iguais, ou a desiguais com igualdade, seria desigualdade flagrante, e não igualdade real. Os apetites humanos conceberam inverter a norma universal da criação, pretendendo, não dar a cada um, na razão do que vale, mas atribuir o mesmo a todos, como se todos se equivalessem.',
  'Mas justiça atrasada não é justiça, senão injustiça qualificada e manifesta. Porque a dilação ilegal nas mãos do julgador contraria o direito escrito das partes, e, assim, as lesa no patrimônio, honra e liberdade.',
];

// ---------------------------------------------------------------- as análises (o que o "Codex" responde)

interface Elemento { ref: string; nucleo: string; papel: string; cita: string; enunciado: string; centralidade: 1 | 2 | 3; nota?: string }
interface Analise {
  tipo: string; elementos: Elemento[];
  relacoes: { origem: string; destino: string; tipo: string; explicacao: string }[];
  dificuldades: { tipo: string; cita: string; descricao: string }[];
  resumo: string; movimento: string;
  passos: { cita: string; observar: string; curta: string; longa: string; pergunta?: string }[];
}

const ANALISES: Record<'apologo' | 'ensaio' | 'cancao' | 'oracao', Analise> = {
  apologo: {
    tipo: 'conto',
    elementos: [
      { ref: 'n1', nucleo: 'elemento_textual', papel: 'personagem', cita: 'toda cheia de si, toda enrolada', centralidade: 2,
        enunciado: 'A agulha acusa o novelo de vaidade.', nota: 'O orgulho ganha corpo na forma do novelo: "cheia de si" e "enrolada" valem para a linha e para a pessoa.' },
      { ref: 'n2', nucleo: 'elemento_textual', papel: 'voz', cita: 'Agulha não tem cabeça.', centralidade: 2,
        enunciado: 'A linha responde com um trocadilho.', nota: 'A linha devolve o golpe pela palavra: alfinete tem cabeça, agulha não. A disputa é também de quem fala melhor.' },
      { ref: 'n3', nucleo: 'afirmacao', papel: 'composicao', cita: 'Também os batedores vão adiante do imperador.', centralidade: 1,
        enunciado: 'A linha transforma a costura em hierarquia.', nota: 'A comparação com o cortejo muda a briga: não se discute mais quem trabalha, mas quem manda.' },
      { ref: 'n4', nucleo: 'elemento_textual', papel: 'voz', cita: 'Não sei se disse que isto se passava em casa de uma baronesa', centralidade: 2,
        enunciado: 'O narrador entra na história e finge esquecimento.', nota: 'O narrador se mostra e brinca com a própria desordem: é uma marca de Machado.' },
      { ref: 'n5', nucleo: 'elemento_textual', papel: 'tempo', cita: 'continuou ainda nesse e no outro, até que no quarto acabou a obra', centralidade: 3,
        enunciado: 'Quatro dias de trabalho cabem numa frase.', nota: 'O tempo do trabalho é resumido; o do baile, contado em detalhe.' },
      { ref: 'n6', nucleo: 'afirmacao', papel: 'evento', cita: 'Quem é que vai dançar com ministros e diplomatas', centralidade: 1,
        enunciado: 'No baile, quem aparece é a linha.', nota: 'A virada do conto: o argumento da agulha ("eu vou adiante") se volta contra ela.' },
      { ref: 'n7', nucleo: 'afirmacao', papel: 'personagem', cita: 'Faze como eu, que não abro caminho para ninguém. Onde me espetam, fico.', centralidade: 1,
        enunciado: 'O alfinete tira a lição cínica.', nota: 'A moral não vem do narrador, vem do alfinete: não servir a ninguém.' },
      { ref: 'n8', nucleo: 'afirmacao', papel: 'composicao', cita: 'Também eu tenho servido de agulha a muita linha ordinária!', centralidade: 1,
        enunciado: 'O professor leva a fábula para a própria vida.', nota: 'O fecho tira a história da caixa de costura: o apólogo vira confissão.' },
    ],
    relacoes: [
      { origem: 'n6', destino: 'n3', tipo: 'responde', explicacao: 'O baile responde à imagem dos batedores: quem vai adiante não chega à festa.' },
      { origem: 'n7', destino: 'n6', tipo: 'desenvolve', explicacao: 'O alfinete tira a lição do baile: quem abre caminho não aproveita.' },
      { origem: 'n8', destino: 'n7', tipo: 'ecoa', explicacao: 'O professor repete a queixa da agulha, agora sobre gente.' },
    ],
    dificuldades: [
      { tipo: 'referencia_externa', cita: 'ágeis como os galgos de Diana', descricao: 'Diana, deusa romana da caça, andava com galgos. O próprio narrador ironiza a comparação ("para dar a isto uma cor poética").' },
      { tipo: 'referencia_externa', cita: 'balaio das mucamas', descricao: 'Mucamas eram mulheres escravizadas do serviço doméstico. O detalhe situa a casa da baronesa no Brasil escravista.' },
    ],
    resumo: 'A disputa entre agulha e linha vira uma fábula sobre quem trabalha e quem leva o mérito.',
    movimento: 'Da briga de palavras ao baile, e do baile à confissão do professor.',
    passos: [
      { cita: 'toda cheia de si, toda enrolada', observar: 'Repare em como a acusação descreve o próprio novelo.', curta: 'A briga começa pela vaidade.', longa: 'A agulha ataca o orgulho da linha com palavras que descrevem também a forma do novelo.' },
      { cita: 'Também os batedores vão adiante do imperador.', observar: 'A imagem do cortejo.', curta: 'A costura vira hierarquia.', longa: 'Com os batedores, a linha mostra que ir adiante pode ser servir, não mandar.', pergunta: 'Quem, no conto, ocupa o lugar do imperador?' },
      { cita: 'Quem é que vai dançar com ministros e diplomatas', observar: 'Quem vai ao baile.', curta: 'A virada.', longa: 'O argumento da agulha se volta contra ela: quem foi adiante fica na caixinha.' },
    ],
  },
  ensaio: {
    tipo: 'critica_literaria',
    elementos: [
      { ref: 'n1', nucleo: 'conceito', papel: 'conceito_criterio', cita: 'certo instinto de nacionalidade', centralidade: 2,
        enunciado: 'O ensaio parte de um traço que reconhece na literatura do seu tempo.', nota: 'O ponto de partida é uma constatação; o resto do texto discute o que esse instinto deve exigir.' },
      { ref: 'n2', nucleo: 'objecao', papel: 'interlocucao', cita: 'só reconhece espírito nacional nas obras que tratam de assunto local', centralidade: 1,
        enunciado: 'A posição que o ensaio vai recusar.', nota: 'A doutrina adversária: só seria nacional a obra de assunto local.' },
      { ref: 'n3', nucleo: 'afirmacao', papel: 'juizo', cita: 'limitaria muito os cabedais da nossa literatura', centralidade: 2,
        enunciado: 'O custo da doutrina.', nota: 'Se só valesse o assunto local, a literatura teria menos do que tratar.' },
      { ref: 'n4', nucleo: 'evidencia', papel: 'evidencia_textual', cita: 'Shakespeare não é, além de um gênio universal, um poeta essencialmente inglês', centralidade: 1,
        enunciado: 'O contraexemplo de Shakespeare.', nota: 'O poeta mais inglês escreve sobre a Dinamarca, Veneza e Roma.' },
      { ref: 'n5', nucleo: 'afirmacao', papel: 'tese_critica', cita: 'O que se deve exigir do escritor antes de tudo, é certo sentimento íntimo', centralidade: 1,
        enunciado: 'A nacionalidade está no sentimento do escritor.', nota: 'A tese troca o critério: sai o assunto da obra, entra o sentimento de quem escreve.' },
      { ref: 'n6', nucleo: 'conceito', papel: 'conceito_criterio', cita: 'homem do seu tempo e do seu país', centralidade: 2,
        enunciado: 'O sentimento íntimo, definido pelo efeito.', nota: 'O ensaio não diz o que é o sentimento; diz o que ele produz.' },
    ],
    relacoes: [
      { origem: 'n4', destino: 'n2', tipo: 'responde', explicacao: 'O contraexemplo derruba a doutrina do assunto local.' },
      { origem: 'n5', destino: 'n2', tipo: 'contrasta', explicacao: 'A tese troca o critério da objeção.' },
      { origem: 'n4', destino: 'n5', tipo: 'exemplifica', explicacao: 'Shakespeare é o caso da tese: assuntos remotos, sentimento inglês.' },
      { origem: 'n5', destino: 'n1', tipo: 'desenvolve', explicacao: 'O instinto do começo vira exigência no fim.' },
    ],
    dificuldades: [
      { tipo: 'referencia_externa', cita: 'o Hamlet, o Otelo, o Júlio César, a Julieta e Romeu', descricao: 'Peças de Shakespeare passadas fora da Inglaterra: na Dinamarca, em Veneza, em Roma e em Verona.' },
      { tipo: 'conceito_sem_definicao', cita: 'certo sentimento íntimo', descricao: 'O ensaio não define o sentimento; só diz o que ele faz com o escritor.' },
    ],
    resumo: 'Recusa a doutrina do assunto local e põe a nacionalidade no sentimento do escritor.',
    movimento: 'Da constatação do instinto à recusa da doutrina e à tese do sentimento íntimo.',
    passos: [
      { cita: 'certo instinto de nacionalidade', observar: 'O ponto de partida.', curta: 'Uma constatação.', longa: 'Machado começa reconhecendo um traço, sem julgá-lo ainda.' },
      { cita: 'só reconhece espírito nacional nas obras que tratam de assunto local', observar: 'A posição adversária.', curta: 'A doutrina a recusar.', longa: 'Antes da tese, o ensaio expõe a opinião que vai combater.', pergunta: 'Que exemplo você usaria contra essa doutrina?' },
      { cita: 'O que se deve exigir do escritor antes de tudo, é certo sentimento íntimo', observar: 'A tese.', curta: 'O critério muda.', longa: 'A nacionalidade passa do assunto para o sentimento de quem escreve.' },
    ],
  },
  cancao: {
    tipo: 'poesia',
    elementos: [
      { ref: 'n1', nucleo: 'elemento_textual', papel: 'imagem', cita: 'Minha terra tem palmeiras,', centralidade: 1,
        enunciado: 'Duas imagens condensam a terra distante.', nota: 'A palmeira e o sabiá bastam para evocar o país inteiro.' },
      { ref: 'n2', nucleo: 'elemento_textual', papel: 'forma', cita: 'Não gorjeiam como lá.', centralidade: 2,
        enunciado: 'O par cá/lá organiza o poema.', nota: 'Todas as estrofes medem o aqui pelo lá; o "cá" quase não aparece.' },
      { ref: 'n3', nucleo: 'elemento_textual', papel: 'som_e_ritmo', cita: 'Nosso céu tem mais estrelas,', centralidade: 2,
        enunciado: 'A anáfora acumula a saudade.', nota: 'Quatro versos com a mesma estrutura ("Nosso... Nossas... Nossos... Nossa"): a lista cresce como a saudade.' },
      { ref: 'n4', nucleo: 'afirmacao', papel: 'virada', cita: 'Não permita Deus que eu morra,', centralidade: 1,
        enunciado: 'A saudade vira súplica.', nota: 'Na última estrofe, o poeta deixa de comparar e passa a pedir.' },
    ],
    relacoes: [
      { origem: 'n4', destino: 'n1', tipo: 'retoma', explicacao: 'A súplica fecha com as mesmas palmeiras do primeiro verso.' },
      { origem: 'n3', destino: 'n2', tipo: 'desenvolve', explicacao: 'A lista do "mais" desenvolve a comparação entre cá e lá.' },
    ],
    dificuldades: [
      { tipo: 'conceito_sem_definicao', cita: 'Em cismar, sozinho, à noite,', descricao: 'Cismar: pensar longamente, devanear.' },
    ],
    resumo: 'A terra distante, medida pelo que falta aqui, até virar súplica.',
    movimento: 'Comparação, acumulação e súplica.',
    passos: [
      { cita: 'Minha terra tem palmeiras,', observar: 'As duas imagens.', curta: 'A terra em duas imagens.', longa: 'Palmeira e sabiá condensam o país distante.' },
      { cita: 'Não permita Deus que eu morra,', observar: 'A mudança de tom.', curta: 'A súplica.', longa: 'O poema deixa de comparar e passa a pedir.' },
    ],
  },
  oracao: {
    tipo: 'opiniao',
    elementos: [
      { ref: 'n1', nucleo: 'afirmacao', papel: 'tese', cita: 'A regra da igualdade não consiste senão em quinhoar desigualmente aos desiguais', centralidade: 1,
        enunciado: 'Igualdade não é dar o mesmo a todos.', nota: 'A tese: tratar cada um na medida da sua diferença.' },
      { ref: 'n2', nucleo: 'conceito', papel: 'criterio', cita: 'na medida em que se desigualam', centralidade: 2,
        enunciado: 'O critério da medida.', nota: 'A desigualdade do tratamento tem limite: a diferença real entre as pessoas.' },
      { ref: 'n3', nucleo: 'afirmacao', papel: 'razao', cita: 'Tratar com desigualdade a iguais, ou a desiguais com igualdade, seria desigualdade flagrante', centralidade: 1,
        enunciado: 'Os dois erros simétricos.', nota: 'O argumento funciona nos dois sentidos: errar para mais ou para menos é a mesma injustiça.' },
      { ref: 'n4', nucleo: 'objecao', papel: 'objecao', cita: 'atribuir o mesmo a todos, como se todos se equivalessem', centralidade: 2,
        enunciado: 'A posição recusada: a igualdade aritmética.', nota: 'O alvo do discurso: dar o mesmo a todos.' },
      { ref: 'n5', nucleo: 'afirmacao', papel: 'proposta', cita: 'justiça atrasada não é justiça, senão injustiça qualificada e manifesta', centralidade: 1,
        enunciado: 'A demora do juiz também é injustiça.', nota: 'O princípio vira exigência prática para quem vai julgar.' },
    ],
    relacoes: [
      { origem: 'n3', destino: 'n1', tipo: 'suporta', explicacao: 'Os dois erros simétricos sustentam a regra.' },
      { origem: 'n1', destino: 'n4', tipo: 'contrasta', explicacao: 'A regra se opõe à igualdade aritmética.' },
      { origem: 'n5', destino: 'n1', tipo: 'desenvolve', explicacao: 'Do princípio à prática do juiz.' },
    ],
    dificuldades: [
      { tipo: 'conceito_sem_definicao', cita: 'quinhoar', descricao: 'Quinhoar: repartir em quinhões, em partes.' },
    ],
    resumo: 'A igualdade como medida, e a demora como injustiça.',
    movimento: 'Do princípio da igualdade à exigência de justiça sem demora.',
    passos: [
      { cita: 'A regra da igualdade não consiste senão em quinhoar desigualmente aos desiguais', observar: 'A tese.', curta: 'Igualdade como medida.', longa: 'Rui Barbosa define a igualdade pela proporção, não pela repetição.' },
      { cita: 'justiça atrasada não é justiça, senão injustiça qualificada e manifesta', observar: 'A consequência prática.', curta: 'A demora.', longa: 'O princípio vira cobrança aos futuros juízes.', pergunta: 'Por que a demora seria uma forma de desigualdade?' },
    ],
  },
};

// ---------------------------------------------------------------- o quadro (respostas da análise da obra)

const FONTE_DO_ARTISTA = 'https://en.wikipedia.org/wiki/Briton_Rivi%C3%A8re';

function analiseDoQuadro(idDeFonte: (url: string) => string): unknown[] {
  const fonte = idDeFonte(FONTE_DO_ARTISTA);
  const leitura = {
    descricao: 'Uma menina de vestido branco segura um livro aberto diante de um grande cão, sentado ao lado dela num interior doméstico.',
    composicao: 'O livro fica no centro; a cabeça do cão e a da menina formam uma diagonal acima dele.',
    luz_e_cor: 'Luz suave da esquerda; o branco do vestido contrasta com o pelo escuro do cão.',
    objetos: [
      { rotulo: 'O livro aberto', descricao: 'Livro aberto nas mãos da menina, virado para o cão.', x: 0.28, y: 0.29, largura: 0.32, altura: 0.15, saliencia: 'alta' },
      { rotulo: 'O olhar do cão', descricao: 'O cão olha para cima, longe do livro.', x: 0.45, y: 0.28, largura: 0.23, altura: 0.14, saliencia: 'alta' },
      { rotulo: 'O rosto da menina', descricao: 'Cabeça inclinada para a página.', x: 0.58, y: 0.19, largura: 0.21, altura: 0.1, saliencia: 'media' },
    ],
    relacoes: [{ objetos: [0, 1], relacao: 'O livro é mostrado ao cão, que olha para outro lado.' }],
    incertezas: [],
  };
  const candidato = {
    regioes: [
      { rotulo: 'O livro aberto', objeto: 0, forma: { tipo: 'bbox', x: 0.28, y: 0.29, largura: 0.32, altura: 0.15 } },
      { rotulo: 'O olhar do cão', objeto: 1, forma: { tipo: 'bbox', x: 0.45, y: 0.28, largura: 0.23, altura: 0.14 } },
      { rotulo: 'O rosto da menina', objeto: 2, forma: { tipo: 'bbox', x: 0.58, y: 0.19, largura: 0.21, altura: 0.1 } },
    ],
    afirmacoes: [
      { texto: 'Um livro aberto fica diante do cão, apoiado nas mãos da menina.', tipo: 'observacao', dimensao: 'composicao', confianca: 'alta', evidencia: 'Centro da tela.', fontes: [], citacoes: [], regioes: [0], apoios: [] },
      { texto: 'O cão olha para cima, longe do livro, enquanto a menina inclina a cabeça para a página.', tipo: 'observacao', dimensao: 'composicao', confianca: 'alta', evidencia: 'Direção dos olhares.', fontes: [], citacoes: [], regioes: [1, 2], apoios: [] },
      { texto: 'Briton Rivière expôs pinturas de animais na Royal Academy por muitos anos.', tipo: 'fato', dimensao: 'artista', confianca: 'alta', evidencia: 'Wikipédia em inglês.', fontes: [fonte], citacoes: [{ fonte, trecho: 'He exhibited animal paintings at the Royal Academy for many years.' }], regioes: [], apoios: [] },
      { texto: 'O contraste entre o livro e o olhar do cão faz da cena uma aula em que o aluno pensa em outra coisa.', tipo: 'inferencia_ia', dimensao: 'interpretacoes', confianca: 'media', evidencia: 'Livro e olhares.', fontes: [], citacoes: [], regioes: [0, 1], apoios: [0, 1] },
      { texto: 'O dossiê não traz o que Rivière quis dizer com o título.', tipo: 'intencao_desconhecida', dimensao: 'interpretacoes', confianca: 'alta', evidencia: 'Nenhuma fonte.', fontes: [], citacoes: [], regioes: [], apoios: [] },
    ],
    teses: [{ texto: 'Uma aula em que só a professora presta atenção.', afirmacoes: [0, 1, 3], gancho: 'Quem está aprendendo aqui?', por_que_interessa: 'O título promete escola; a cena mostra distração.' }],
    limites: ['Análise feita a partir da reprodução enviada.'],
  };
  const revisao = {
    regioes: candidato.regioes.map((_, indice) => ({ indice, veredito: 'manter', forma: null, motivo: 'justa' })),
    afirmacoes: candidato.afirmacoes.map((a, indice) => ({ indice, veredito: 'manter', texto: a.texto, tipo: null, confianca: null, evidencia: null, motivo: 'ok' })),
    tese: { indice: 0, texto: 'Uma aula em que só a professora presta atenção.', motivo: 'nítida' },
  };
  const roteiro = {
    tese: 'Uma aula em que só a professora presta atenção.', afirmacoes_da_tese: [0, 1, 3], gancho: 'pergunta',
    batidas: [
      { papel: 'abertura', narracao: 'O livro está aberto. Mas os dois prestam atenção à mesma coisa?', afirmacoes: [0], regiao: null, enquadramento: 'inteiro', novidade: 'pergunta' },
      { papel: 'evidencia_visual', narracao: 'A menina segura o livro bem diante do cão, como quem dá aula.', afirmacoes: [0], regiao: 0, enquadramento: 'detalhe', novidade: 'livro' },
      { papel: 'evidencia_visual', narracao: 'O cão olha para cima, para longe da página.', afirmacoes: [1], regiao: 1, enquadramento: 'detalhe', novidade: 'olhar' },
      { papel: 'contexto', narracao: 'Rivière ficou conhecido justamente por pintar animais.', afirmacoes: [2], regiao: null, enquadramento: 'inteiro', novidade: 'artista' },
      { papel: 'interpretacao', narracao: 'A educação é obrigatória; a atenção, não.', afirmacoes: [3], regiao: null, enquadramento: 'meio', novidade: 'leitura' },
      { papel: 'fechamento', narracao: 'Talvez o título seja a piada: só um dos dois está na escola.', afirmacoes: [3], regiao: null, enquadramento: 'inteiro', novidade: 'virada' },
    ],
  };
  return [leitura, candidato, revisao, roteiro];
}

// ---------------------------------------------------------------- a questão (resolução e conversa)

const RESOLUCAO_DA_QUESTAO = {
  enunciado: '7. Calcule as integrais.\n(a) $\\int_0^1 x\\,e^x\\,dx$\n(b) $\\int x\\ln x\\,dx$, para $x > 0$.',
  legibilidade: 'boa',
  itens: [
    {
      rotulo: 'a', enunciado: '$\\int_0^1 x\\,e^x\\,dx$',
      estrategia: 'Integração por partes com $u = x$ e $dv = e^x\\,dx$: derivar $x$ simplifica o integrando, e $e^x$ não muda ao integrar.',
      passos: [
        { texto: 'Com $du = dx$ e $v = e^x$, a fórmula $\\int u\\,dv = uv - \\int v\\,du$ dá', calculo: '$$\\int x\\,e^x\\,dx = x\\,e^x - \\int e^x\\,dx = (x - 1)\\,e^x + C$$' },
        { texto: 'Nos limites de $0$ a $1$:', calculo: '$$\\Big[(x - 1)\\,e^x\\Big]_0^1 = 0 - (-1) = 1$$' },
      ],
      resposta: '$\\int_0^1 x\\,e^x\\,dx = 1$.',
      verificacao: 'Derivando $(x - 1)\\,e^x$, volta-se ao integrando: $e^x + (x - 1)\\,e^x = x\\,e^x$.',
    },
    {
      rotulo: 'b', enunciado: '$\\int x\\ln x\\,dx$, para $x > 0$',
      estrategia: 'De novo por partes, agora com $u = \\ln x$, que fica mais simples ao derivar, e $dv = x\\,dx$.',
      passos: [
        { texto: 'Então $du = \\frac{1}{x}\\,dx$ e $v = \\frac{x^2}{2}$:', calculo: '$$\\int x\\ln x\\,dx = \\frac{x^2}{2}\\ln x - \\int \\frac{x}{2}\\,dx$$' },
        { texto: 'A integral que sobrou é imediata:', calculo: '$$\\int \\frac{x}{2}\\,dx = \\frac{x^2}{4} + C$$' },
      ],
      resposta: '$\\int x\\ln x\\,dx = \\frac{x^2}{2}\\ln x - \\frac{x^2}{4} + C$.',
      verificacao: 'Derivando: $x\\ln x + \\frac{x^2}{2}\\cdot\\frac{1}{x} - \\frac{x}{2} = x\\ln x$.',
    },
  ],
  conceitos: ['Integração por partes', 'Integral definida', 'Teorema fundamental do cálculo'],
  observacao: null,
};

// ---------------------------------------------------------------- utilidades

const ESCRITA = { 'X-Margem': '1' };
const esperar = (ms: number) => new Promise<void>((pronto) => { setTimeout(pronto, ms); });
async function ate<T>(rotulo: string, tentar: () => Promise<T | null | undefined | false>, prazoMs = 120_000): Promise<T> {
  const limite = Date.now() + prazoMs;
  for (;;) {
    const valor = await tentar();
    if (valor) return valor;
    if (Date.now() > limite) throw new Error(`Tempo esgotado: ${rotulo}`);
    await esperar(300);
  }
}

/** Os blocos do prompt (`⟦b:B001⟧ [rótulo]` + texto) ou do esqueleto (`- B001 [tipo] começo…`). */
function blocosDoPrompt(prompt: string): { alias: string; texto: string; inteiro: boolean }[] {
  const blocos: { alias: string; texto: string; inteiro: boolean }[] = [];
  for (const m of prompt.matchAll(/⟦b:(B\d+)⟧[^\n]*\n([\s\S]*?)\n⟦\/b⟧/gu)) blocos.push({ alias: m[1]!, texto: m[2]!, inteiro: true });
  if (blocos.length === 0) {
    for (const m of prompt.matchAll(/^- (B\d+) \[[^\]]*\] (.*)$/gmu)) blocos.push({ alias: m[1]!, texto: m[2]!.replace(/ …$/u, ''), inteiro: false });
  }
  return blocos;
}

function aliasDoTrecho(blocos: ReturnType<typeof blocosDoPrompt>, trecho: string): string | null {
  const exato = blocos.find((b) => b.inteiro && b.texto.includes(trecho));
  if (exato) return exato.alias;
  const normal = (t: string) => t.replace(/\s+/gu, ' ').trim();
  const inicio = blocos.find((b) => !b.inteiro && (normal(trecho).startsWith(normal(b.texto)) || normal(b.texto).includes(normal(trecho))));
  return inicio?.alias ?? null;
}

/** Os elementos do modelo serializado (`- L01 · … ` + `citação (B003): “…”`). */
function elementosDoPrompt(prompt: string): { alias: string; bloco: string; citacao: string }[] {
  return [...prompt.matchAll(/^- (L\d+) ·[^\n]*\n(?: {2}(?!citação)[^\n]*\n)* {2}citação \((B\d+)\): “([^”]*)”/gmu)].map((m) => ({ alias: m[1]!, bloco: m[2]!, citacao: m[3]! }));
}

function qualAnalise(prompt: string): Analise | null {
  for (const analise of Object.values(ANALISES)) {
    if (analise.elementos.some((e) => prompt.includes(e.cita) || prompt.includes(e.cita.split(' ').slice(0, 5).join(' ')))) return analise;
  }
  return null;
}

// ---------------------------------------------------------------- o executor determinístico

interface Ids { versoes: Map<string, { versao_id: string; blocos: { id: string; texto: string }[] }> }
const IDS: Ids = { versoes: new Map() };

function citacaoDoAgente(chave: string, ref: string, trecho: string): { ref: string; versao_id: string; bloco_id: string; texto: string } {
  const doc = IDS.versoes.get(chave);
  if (!doc) throw new Error(`Documento ${chave} sem versão`);
  const bloco = doc.blocos.find((b) => b.texto.includes(trecho));
  if (!bloco) throw new Error(`Trecho fora de ${chave}: ${trecho}`);
  return { ref, versao_id: doc.versao_id, bloco_id: bloco.id, texto: trecho };
}

function respostaPeloSchema(schema: Record<string, unknown>, prompt: string, analiseDoQuadroAtual: unknown[], quadroChamadas: { n: number }): unknown {
  const req = new Set((schema.required as string[] | undefined) ?? []);
  const blocos = blocosDoPrompt(prompt);
  if (req.has('tipo_id')) {
    const analise = qualAnalise(prompt);
    return { tipo_id: analise?.tipo ?? 'outro', confianca: 'alta', justificativa: 'Identificado pelas capturas do README.', alternativas: [] };
  }
  if (req.has('elementos')) {
    const a = qualAnalise(prompt);
    if (!a) throw new Error('Análise pedida para um texto sem roteiro.');
    const cit = (trecho: string) => {
      const alias = aliasDoTrecho(blocos, trecho);
      if (!alias) throw new Error(`Citação fora do texto: ${trecho}`);
      return { bloco: alias, citacao: trecho, prefixo: '', sufixo: '' };
    };
    return {
      elementos: a.elementos.map((e) => ({ ref: e.ref, nucleo: e.nucleo, papel: e.papel, citacoes: [cit(e.cita)], enunciado: e.enunciado, qualificadores: [], centralidade: e.centralidade,
        notas: e.nota ? [{ tipo: 'LEITURA', texto: e.nota }] : [] })),
      relacoes: a.relacoes.map((r) => ({ ...r, confianca: 'alta' })),
      dificuldades: a.dificuldades.map((d) => ({ tipo: d.tipo, citacoes: [cit(d.cita)], descricao: d.descricao })),
      resumo_da_parte: a.resumo, limites: [], leitura_integral: true,
    };
  }
  if (req.has('movimento')) {
    const a = qualAnalise(prompt);
    const primeiro = blocos[0]?.alias ?? 'B001';
    return {
      movimento: { texto: a?.movimento ?? 'O capítulo avança em uma só etapa.', etapas: [{ unidades: ['U1'], descricao: a?.resumo ?? 'O capítulo inteiro.' }] },
      unidades: [{ ref: 'U1', inicio: primeiro, titulo: 'O texto inteiro', funcao_no_capitulo: a?.resumo ?? 'O capítulo inteiro.' }],
      operacoes: [],
    };
  }
  if (req.has('observacoes')) return { operacoes: [], observacoes: ['Densidade equilibrada.'] };
  if (req.has('passos') && req.has('apoios')) {
    const a = qualAnalise(prompt);
    const elementos = elementosDoPrompt(prompt);
    const passos = (a?.passos ?? []).map((p) => {
      const doTrecho = elementos.filter((e) => e.citacao.includes(p.cita) || p.cita.includes(e.citacao));
      const alias = doTrecho[0]?.bloco ?? aliasDoTrecho(blocos, p.cita) ?? blocos[0]?.alias ?? 'B001';
      const foco = doTrecho.map((e) => e.alias);
      return { inicio: alias, foco: foco.length ? foco : [elementos[0]?.alias ?? 'L01'], observar: p.observar, explicacao: { curta: p.curta, longa: p.longa },
        relacoes: [], parada: p.pergunta ? { tipo: 'pergunta', texto: p.pergunta } : null };
    });
    return { passos, apoios: [] };
  }
  if (req.has('legibilidade')) return RESOLUCAO_DA_QUESTAO;
  if (req.has('resposta') && req.has('artefatos')) {
    return {
      resposta: [
        'Os dois textos tratam de quem trabalha e de quem leva o reconhecimento, mas por caminhos opostos.',
        'No conto, a agulha abre o caminho e a linha fica com a glória: no baile, é a linha que vai no corpo da baronesa, "fazendo parte do vestido e da elegância" [c1]. O alfinete tira daí uma lição cínica [c2], e o narrador fecha levando a fábula para a vida, com o professor que também serviu "de agulha a muita linha ordinária" [c3].',
        'Rui Barbosa parte de um princípio: tratar igualmente quem é desigual é injusto [c4]; a igualdade verdadeira dá a cada um "na razão do que vale" [c5]. Lido ao lado do conto, o discurso dá nome ao que a agulha sente: o trabalho dela não foi medido pelo que vale.',
        'A diferença é de tom. Machado não propõe regra; mostra a injustiça com ironia. Rui Barbosa formula a regra e a cobra de quem vai julgar.',
      ].join('\n\n'),
      citacoes: [
        citacaoDoAgente('apologo', 'c1', 'fazendo parte do vestido e da elegância'),
        citacaoDoAgente('apologo', 'c2', 'Faze como eu, que não abro caminho para ninguém'),
        citacaoDoAgente('apologo', 'c3', 'Também eu tenho servido de agulha a muita linha ordinária'),
        citacaoDoAgente('oracao', 'c4', 'Tratar com desigualdade a iguais, ou a desiguais com igualdade, seria desigualdade flagrante'),
        citacaoDoAgente('oracao', 'c5', 'não dar a cada um, na razão do que vale'),
      ],
      artefatos: [{
        tipo: 'quadro', titulo: 'Trabalho e reconhecimento nos dois textos', versao_id: null, secao_id: null, mermaid: '', nos: [],
        markdown: '| | Um apólogo | Oração aos moços |\n|---|---|---|\n| Quem trabalha | a agulha, que abre caminho [c1] | quem é desigual e recebe o mesmo [c4] |\n| O que pede | nada; o alfinete ensina a não servir [c2] | dar a cada um na razão do que vale [c5] |\n| Tom | ironia | princípio e cobrança |',
      }],
    };
  }
  // Vídeo: a transcrição já vem limpa (nada a trocar); partes e um momento sobre o vídeo.
  if (req.size === 1 && req.has('paragrafos')) return { paragrafos: [] };
  if (req.has('partes') && req.has('momentos')) {
    const p = (trecho: string) => [...prompt.matchAll(/\[(P\d+) · [^\]]*\] ([^\n]*)/gu)].find((m) => m[2]!.includes(trecho))?.[1] ?? 'P1';
    return {
      partes: [
        { paragrafo: p('A regra da igualdade'), titulo: 'A regra da igualdade', resumo: 'Igualdade como proporção: tratar cada um na medida da sua diferença.' },
        { paragrafo: p('justiça atrasada'), titulo: 'Justiça atrasada', resumo: 'O princípio aplicado ao juiz: a demora também é injustiça.' },
      ],
      momentos: [
        { paragrafo: p('quinhoar'), citacao: 'quinhoar desigualmente aos desiguais', tipo: 'conceito', titulo: 'Quinhoar', curto: 'Quinhoar',
          explicacao: 'Repartir em quinhões, em partes. A igualdade, para Rui Barbosa, é dar a cada um a parte proporcional ao que ele é, não a mesma parte a todos.' },
      ],
    };
  }
  if (req.has('descricao') && req.has('composicao')) { quadroChamadas.n += 1; return analiseDoQuadroAtual[0]; }
  if (req.has('teses')) return analiseDoQuadroAtual[1];
  if (req.has('tese') && req.has('regioes')) return analiseDoQuadroAtual[2];
  if (req.has('batidas')) return analiseDoQuadroAtual[3];
  throw new Error(`Chamada sem resposta nas capturas: ${[...req].join(', ')}`);
}

// ---------------------------------------------------------------- arquivos gerados (PDF e vídeo)

function gerarPdf(destino: string): void {
  const paragrafos = ENSAIO.map((p, i) => (i === 1 ? `<p class="corte">(...)</p><p>${p}</p>` : `<p>${p}</p>`)).join('');
  const html = `<h1>Notícia da atual literatura brasileira</h1><h2>Instinto de nacionalidade</h2><p class="autor">Machado de Assis, 1873</p>${paragrafos}`;
  const css = 'h1{font-family:serif;font-size:21px;margin:0 0 4px} h2{font-family:serif;font-size:15px;font-style:italic;font-weight:normal;margin:0 0 6px} .autor{font-family:serif;font-size:11px;color:#555;margin:0 0 22px} p{font-family:serif;font-size:12.5px;line-height:1.6;text-align:justify;text-indent:22px;margin:0 0 10px} .corte{text-align:center;text-indent:0;color:#777}';
  execFileSync(PYTHON, ['-c', `
import sys, pymupdf
doc = pymupdf.open()
pagina = doc.new_page(width=595, height=842)
pagina.insert_htmlbox(pymupdf.Rect(80, 90, 515, 780), sys.argv[2], css=sys.argv[3])
doc.set_metadata({'title': 'Instinto de nacionalidade', 'author': 'Machado de Assis'})
doc.save(sys.argv[1])
`, destino, html, css], { stdio: 'pipe' });
}

interface Transcricao { paragrafos: string[]; palavras: { texto: string; inicio_s: number; fim_s: number }[]; capitulos: { inicio_s: number; titulo: string }[]; duracao: number }
function transcricao(): Transcricao {
  const palavras: Transcricao['palavras'] = [];
  const capitulos: Transcricao['capitulos'] = [];
  let t = 1.5;
  ORACAO.forEach((paragrafo, i) => {
    if (i === 0) capitulos.push({ inicio_s: 0, titulo: 'A regra da igualdade' });
    if (i === 2) capitulos.push({ inicio_s: Number(t.toFixed(2)), titulo: 'Justiça atrasada' });
    for (const texto of paragrafo.split(/\s+/u).filter(Boolean)) {
      const fim = t + 0.28 + texto.length * 0.035;
      palavras.push({ texto, inicio_s: Number(t.toFixed(2)), fim_s: Number(fim.toFixed(2)) });
      t = fim + 0.06;
    }
    t += 0.9;
  });
  return { paragrafos: ORACAO, palavras, capitulos, duracao: Math.ceil(t + 1) };
}

function gerarVideo(destino: string, duracao: number): void {
  const fonte = spawnSync('fc-match', ['-f', '%{file}', 'serif'], { encoding: 'utf8' }).stdout.trim();
  const texto = join(temporaria, 'titulo.txt');
  const sub = join(temporaria, 'subtitulo.txt');
  writeFileSync(texto, 'Oração aos moços');
  writeFileSync(sub, 'Rui Barbosa, 1921 · leitura de trechos');
  const desenho = fonte
    ? `,drawtext=fontfile=${fonte}:textfile=${texto}:fontcolor=0xf3ead8:fontsize=64:x=(w-text_w)/2:y=h/2-70,drawtext=fontfile=${fonte}:textfile=${sub}:fontcolor=0xc9b994:fontsize=30:x=(w-text_w)/2:y=h/2+20`
    : '';
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x2b2620:s=1280x720:d=${String(duracao)}:r=12`, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
    '-t', String(duracao), '-vf', `format=yuv420p${desenho}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-c:a', 'aac', '-b:a', '32k', '-shortest', destino]);
}

// ---------------------------------------------------------------- otimização das imagens

function otimizar(arquivo: string): void {
  const tem = (programa: string) => spawnSync(programa, ['--version'], { stdio: 'ignore' }).status === 0;
  if (tem('pngquant')) spawnSync('pngquant', ['--quality=75-95', '--skip-if-larger', '--force', '--ext', '.png', arquivo]);
  else {
    // Sem pngquant: paleta de 256 cores pelo ffmpeg (a interface tem poucas cores; o texto fica nítido).
    const saida = `${arquivo}.tmp.png`;
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', arquivo, '-vf', 'split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a', saida]);
    if (r.status === 0 && statSync(saida).size < statSync(arquivo).size) execFileSync('mv', [saida, arquivo]);
    else rmSync(saida, { force: true });
  }
  if (tem('oxipng')) spawnSync('oxipng', ['-o', '3', '--strip', 'safe', arquivo]);
}

// ---------------------------------------------------------------- servidor estático do site (abertura)

function servirSite(pasta: string): Promise<Server> {
  const tipos: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon' };
  const servidor = createServer((pedido, resposta) => {
    let caminho = join(pasta, decodeURIComponent(new URL(pedido.url ?? '/', 'http://x').pathname));
    if (existsSync(caminho) && statSync(caminho).isDirectory()) caminho = join(caminho, 'index.html');
    if (!caminho.startsWith(pasta) || !existsSync(caminho)) { resposta.statusCode = 404; resposta.end(); return; }
    resposta.setHeader('Content-Type', tipos[extname(caminho)] ?? 'application/octet-stream');
    createReadStream(caminho).pipe(resposta);
  });
  return new Promise((pronto) => { servidor.listen(PORTA_DO_SITE, '127.0.0.1', () => { pronto(servidor); }); });
}

// ---------------------------------------------------------------- as capturas

async function capturar(ids: Record<string, string>): Promise<void> {
  mkdirSync(PASTA, { recursive: true });
  const navegador: Browser = await chromium.launch();
  const feitas: string[] = [];
  const quer = (nome: string) => !SO || SO.includes(nome);
  try {
    const abrir = async (tema: 'claro' | 'escuro', altura = 1000): Promise<Page> => {
      const contexto = await navegador.newContext({ viewport: { width: LARGURA, height: altura }, colorScheme: tema === 'claro' ? 'light' : 'dark', reducedMotion: 'reduce', deviceScaleFactor: 1 });
      await contexto.addInitScript((t) => {
        try {
          localStorage.setItem('margem:aparencia.tema', t);
          localStorage.setItem('margem:onboarding:v2:local', JSON.stringify({ versao: 2, boas_vindas: 'concluida', tela: 0,
            primeiro_documento: { estado: 'concluida', origem: 'importado', documento_id: null }, exemplo_id: null,
            tours: { texto: 'concluida', video: 'concluida', quadro: 'concluida' }, dicas: { texto: 0, video: 0, quadro: 0 }, levar: 'concluida',
            atualizado_em: '2026-10-01T12:00:00.000Z' }));
        } catch { /* sem storage */ }
      }, tema);
      // Os avisos do canto (execuções que acabaram) não entram nas capturas.
      // (Código do navegador como texto: o servico compila sem os tipos do DOM.)
      await contexto.addInitScript(`document.addEventListener('DOMContentLoaded', () => {
        const estilo = document.createElement('style');
        estilo.textContent = '[aria-label="Execuções do Codex"]{visibility:hidden !important}';
        document.head.append(estilo);
      });`);
      const pagina = await contexto.newPage();
      pagina.on('pageerror', (erro) => { console.log('erro no navegador:', erro.message); });
      return pagina;
    };
    const foto = async (pagina: Page, nome: string) => {
      const arquivo = join(PASTA, `${nome}.png`);
      await pagina.screenshot({ path: arquivo });
      otimizar(arquivo);
      feitas.push(`${nome}.png ${String(Math.round(statSync(arquivo).size / 1024))} KB`);
    };
    const ir = async (pagina: Page, caminho: string, espera = 1500) => { await pagina.goto(`${API}${caminho}`); await pagina.waitForLoadState('networkidle').catch(() => undefined); await pagina.waitForTimeout(espera); };

    for (const [nome, tema, tela] of TELAS) {
      if (!quer(nome)) continue;
      const pagina = await abrir(tema);
      try {
        await tela(pagina, ids, ir);
        await foto(pagina, nome);
      } catch (erro) {
        console.log(`tela ${nome} falhou:`, erro instanceof Error ? erro.message : erro);
      } finally { await pagina.context().close(); }
    }

    // As telas do site: a clara é a mesma do README; a escura só vai para o site.
    const doSite = join(raiz, 'site/public/app');
    for (const nome of DO_SITE) {
      const claro = join(PASTA, `${nome}.png`);
      const escuro = join(PASTA, `${nome}-escuro-site.png`);
      if (existsSync(claro)) copyFileSync(claro, join(doSite, `${nome}-claro.png`));
      if (existsSync(escuro)) { copyFileSync(escuro, join(doSite, `${nome}-escuro.png`)); rmSync(escuro); }
    }

    // A abertura do site (o herói de margem.dev), quando o site foi compilado.
    const site = join(raiz, 'site/dist');
    if (quer('site') && existsSync(join(site, 'index.html'))) {
      const servidor = await servirSite(site);
      try {
        const pagina = await abrir('claro', 900);
        await pagina.goto(`http://127.0.0.1:${String(PORTA_DO_SITE)}/`);
        await pagina.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
        await pagina.waitForTimeout(2500);
        const heroi = pagina.locator('section.heroi');
        await heroi.screenshot({ path: join(PASTA, 'site.png') });
        otimizar(join(PASTA, 'site.png'));
        feitas.push(`site.png ${String(Math.round(statSync(join(PASTA, 'site.png')).size / 1024))} KB`);
        await pagina.context().close();
      } finally { servidor.close(); }
    }
  } finally {
    await navegador.close();
  }
  console.log(`Em ${PASTA}:\n${feitas.join('\n')}`);
}

type Ir = (pagina: Page, caminho: string, espera?: number) => Promise<void>;
type Tela = [nome: string, tema: 'claro' | 'escuro', (pagina: Page, ids: Record<string, string>, ir: Ir) => Promise<void>];

/** O leitor no nível de atenção mais alto (todas as marcas) e sem os avisos do canto. */
async function lerNoNivelMaximo(p: Page, caminho: string, ir: Ir): Promise<void> {
  await ir(p, caminho, 3000);
  const atencao = p.getByRole('button', { name: /^Atenção/ });
  if (await atencao.count()) {
    await atencao.first().click();
    await p.getByRole('radio', { name: /Aprofundar/ }).click();
    await p.keyboard.press('Escape');
  }
  await p.evaluate('document.activeElement?.blur()');
  await p.mouse.move(5, 700);
  await p.waitForTimeout(600);
}
async function rolarAte(p: Page, texto: string, folga = 260): Promise<void> {
  await p.getByText(texto, { exact: false }).first().scrollIntoViewIfNeeded();
  await p.evaluate(`(() => {
    const alvo = [...document.querySelectorAll('p, span')].find((e) => e.textContent.includes(${JSON.stringify(texto)}));
    alvo?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -${String(folga)});
  })()`);
  await p.waitForTimeout(500);
}

const TELAS: Tela[] = [
  // A obra enviada fica de fora da lista: o acervo de exemplo já traz "Educação Obrigatória".
  ['quadro', 'claro', async (p, ids, ir) => { await ir(p, `/quadros/${ids.slug!}`, 3500); }],
  ['biblioteca', 'claro', async (p, ids, ir) => {
    await p.goto(`${API}/biblioteca`);
    await p.evaluate(async (slug) => { await fetch(`/api/arte/${slug}`, { method: 'DELETE', headers: { 'X-Margem': '1' } }); }, ids.slug!);
    await ir(p, '/biblioteca', 2000);
  }],
  ['leitor', 'claro', async (p, ids, ir) => {
    await lerNoNivelMaximo(p, `/ler/${ids.apologo!}`, ir);
    await rolarAte(p, 'Sim, mas que vale isso?', 120);
    await p.getByRole('button', { name: /^Nota 3/ }).click();
    await p.waitForTimeout(700);
  }],
  ['grifo', 'claro', async (p, ids, ir) => {
    await lerNoNivelMaximo(p, `/ler/${ids.apologo!}`, ir);
    await rolarAte(p, 'Sim, mas que vale isso?', 120);
    await p.locator('span.segmento', { hasText: 'Eu é que prendo, ligo, ajunto' }).first().click();
    await p.waitForTimeout(800);
  }],
  ['leitor-escuro', 'escuro', async (p, ids, ir) => {
    await lerNoNivelMaximo(p, `/ler/${ids.apologo!}`, ir);
    await rolarAte(p, 'A linha não respondia nada', 60);
    await p.getByRole('button', { name: /^Nota 6/ }).click().catch(() => undefined);
    await p.waitForTimeout(700);
  }],
  ['pdf', 'claro', async (p, ids, ir) => {
    await lerNoNivelMaximo(p, `/ler/${ids.ensaio!}`, ir);
    await p.evaluate('window.scrollBy(0, 140)');
    await p.waitForTimeout(400);
    await p.getByRole('button', { name: /^Nota 5/ }).click();
    await p.waitForTimeout(700);
  }],
  ['relacoes', 'claro', async (p, ids, ir) => {
    await lerNoNivelMaximo(p, `/ler/${ids.ensaio!}`, ir);
    // As pontas da linha da tese se abrem em leque ao passar o cursor; a de "contrasta com" acende a relação.
    const pilha = p.getByRole('button', { name: /pontas de relações/ });
    if (await pilha.count()) { await pilha.last().hover(); await p.waitForTimeout(600); }
    await p.getByRole('button', { name: /^Saída: contrasta com/ }).first().click();
    await p.mouse.move(5, 700);
    await p.waitForTimeout(900);
  }],
  ['video', 'claro', async (p, ids, ir) => {
    await lerNoNivelMaximo(p, `/ler/${ids.oracao!}`, ir);
    // O instante do momento "Quinhoar": a palavra falada acende e o momento aparece sobre o vídeo.
    await p.evaluate("{ const v = document.querySelector('video'); if (v) v.currentTime = 6.5; }");
    await p.waitForTimeout(1500);
    await p.getByRole('button', { name: /Quinhoar/ }).first().click().catch(() => undefined);
    await p.waitForTimeout(800);
  }],
  ['exercicio', 'claro', async (p, ids, ir) => {
    await ir(p, `/ler/${ids.questao!}`, 3500);
    await p.getByText('Exercício resolvido', { exact: false }).first().click();
    await p.waitForTimeout(1200);
    await p.getByRole('button', { name: 'Mostrar o primeiro passo' }).click().catch(() => undefined);
    await p.waitForTimeout(400);
    await p.getByRole('button', { name: /próximo passo/i }).click().catch(() => undefined);
    await p.waitForTimeout(900);
  }],
  ['perguntar', 'claro', async (p, ids, ir) => {
    await ir(p, `/perguntar/${ids.agente!}`, 2500);
    await p.evaluate(`for (const e of document.querySelectorAll('*')) if (e.scrollHeight > e.clientHeight + 10 && getComputedStyle(e).overflowY !== 'visible') e.scrollTop = 0;
      window.scrollTo(0, 0);`);
    await p.waitForTimeout(500);
  }],
  ['documento', 'claro', async (p, ids, ir) => { await ir(p, `/documentos/${ids.apologo!}`, 2500); }],
  ['notas', 'claro', async (p, _ids, ir) => { await ir(p, '/notas', 2000); }],
  ['modelos', 'claro', async (p, _ids, ir) => {
    await ir(p, '/configuracoes', 2000);
    await p.evaluate(`{ const h = [...document.querySelectorAll('h2')].find((e) => e.textContent.includes('Modelos')); h?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -30); }`);
    await p.waitForTimeout(600);
  }],
];

/** As telas que o site (margem.dev) também usa, em claro e escuro: vão para `site/public/app/<tela>-<tema>.png`. */
const DO_SITE = ['grifo', 'pdf', 'video', 'notas'] as const;
for (const nome of DO_SITE) {
  const tela = TELAS.find(([n]) => n === nome);
  if (tela) TELAS.push([`${nome}-escuro-site`, 'escuro', tela[2]]);
}

// ---------------------------------------------------------------- principal

const { comBancoDeTeste } = await import('../db/conexao.js');
const { migrar } = await import('../db/migrar.js');

await comBancoDeTeste('readme', async (banco: pg.Pool) => {
  await migrar(banco);
  const { criarApi } = await import('../http/app.js');
  const { servirWeb } = await import('../http/estatico.js');
  const { FilaPostgres } = await import('../worker/fila-postgres.js');
  const { Worker } = await import('../worker/worker.js');
  const { todosOsManipuladores } = await import('../worker/main.js');
  const { configuracaoDaCompreensao, configuracaoDaLeitura } = await import('../worker/configuracao.js');
  const { criarExecutorFalso } = await import('../executor/fake.js');
  const { manipuladoresDosQuadros } = await import('../arte/preparo.js');
  const { idDeFonte } = await import('../arte/v2/dossie-auto.js');
  const { TIPO_RESPONDER, manipuladorResponder } = await import('../conversa/responder.js');
  const { REDE_DA_EDUCACAO, redeDeFixture } = await import('../../testes/quadros.js');
  type Executor = import('../executor/tipos.js').Executor;
  type Responder = import('../conversa/responder.js').Responder;

  const quadro = analiseDoQuadro(idDeFonte);
  const chamadasDoQuadro = { n: 0 };
  const executor: Executor = async (pedido) => {
    const schema = JSON.parse(readFileSync(pedido.schema, 'utf8')) as Record<string, unknown>;
    let prompt = pedido.prompt;
    // O texto da parte pode ir num arquivo da entrada, não no prompt.
    if (!prompt.includes('⟦b:')) {
      for (const nome of readdirSync(pedido.diretorioEntrada)) {
        const caminho = join(pedido.diretorioEntrada, nome);
        if (statSync(caminho).isFile() && /\.(md|txt)$/u.test(nome)) prompt += `\n${readFileSync(caminho, 'utf8')}`;
      }
    }
    const conteudo = respostaPeloSchema(schema, prompt, quadro, chamadasDoQuadro);
    return criarExecutorFalso({ versao: 1, passos: [{ tipo: 'ok', conteudo }] })(pedido);
  };

  const responder: Responder = (entrada) => Promise.resolve({
    texto: 'Porque ele mesmo desmonta a comparação que acabou de fazer. Os galgos de Diana são os cães de caça da deusa: uma imagem clássica, elevada demais para os dedos de uma costureira. Ao avisar que é só uma "cor poética", o narrador ri do próprio enfeite, como ri da vaidade da agulha e da linha.',
    citacoes: [entrada.conversa.ancora], sugestoes: [], diagnosticos: [], modelo: 'codex', esforco: 'medium',
  });

  const compreensao = configuracaoDaCompreensao({ banco, executor });
  const api = criarApi({
    banco, leitura: () => configuracaoDaLeitura({ banco, executor }), compreensao: () => compreensao,
    buscarModelos: () => Promise.resolve(null),
  });
  servirWeb(api, join(raiz, 'web/dist'));
  const manipuladores = {
    ...todosOsManipuladores(banco, executor),
    ...manipuladoresDosQuadros({ banco, executor, buscar: redeDeFixture([], REDE_DA_EDUCACAO), compararComCodex: false, baixar: () => Promise.reject(new Error('sem rede')) }),
    [TIPO_RESPONDER]: manipuladorResponder({ banco, responder, diretorioArtefatos: join(temporaria, 'respostas') }),
  };
  const worker = new Worker({ fila: new FilaPostgres(banco), manipuladores, slots: 1, diretorioSlots: join(temporaria, 'vagas'), intervaloMs: 50, intervaloMaximoMs: 200, heartbeatMs: 60_000 });
  mkdirSync(join(temporaria, 'vagas'), { recursive: true });
  const laco = worker.rodar();
  let fechar = (): void => undefined;
  try {

  async function pedir<T = Record<string, unknown>>(caminho: string, metodo = 'GET', corpo?: unknown): Promise<T> {
    const inicio: RequestInit = { method: metodo, headers: metodo === 'GET' ? {} : { ...ESCRITA, ...(corpo instanceof FormData || corpo === undefined ? {} : { 'Content-Type': 'application/json' }) } };
    if (corpo !== undefined) inicio.body = corpo instanceof FormData ? corpo : corpo instanceof Uint8Array ? new Blob([corpo]) : JSON.stringify(corpo);
    const resposta = await api.request(caminho, inicio);
    const texto = await resposta.text();
    if (resposta.status >= 400) throw new Error(`${metodo} ${caminho} → ${String(resposta.status)} ${texto.slice(0, 400)}`);
    return (texto === '' ? null : JSON.parse(texto)) as T;
  }

  interface Doc { id: string; versao_id: string; secao_id: string; blocos: { id: string; texto: string }[] }
  async function enviar(chave: string, nome: string, formato: string, tipo: string, conteudo: Buffer | string, titulo: string, autor: string): Promise<Doc> {
    const f = new FormData();
    f.set('titulo', titulo); f.set('formato', formato); f.set('autor', autor);
    f.set('arquivo', new File([conteudo], nome, { type: tipo }));
    const { documento_id } = await pedir<{ documento_id: string }>('/api/documentos', 'POST', f);
    const versao_id = await ate(`canonização de ${titulo}`, async () => (await pedir<{ versao_id: string | null }>(`/api/documentos/${documento_id}`)).versao_id);
    const secoes = await pedir<{ capitulos: { id: string }[] }>(`/api/versoes/${versao_id}/secoes`);
    const secao_id = secoes.capitulos[0]!.id;
    const snap = await pedir<{ blocos: { id: string; texto: string }[] }>(`/api/versoes/${versao_id}/capitulos/${secao_id}`);
    const doc = { id: documento_id, versao_id, secao_id, blocos: snap.blocos.map((b) => ({ id: b.id, texto: b.texto })) };
    IDS.versoes.set(chave, { versao_id, blocos: doc.blocos });
    return doc;
  }
  async function preparar(doc: Doc, tipo: string): Promise<string> {
    await pedir(`/api/documentos/${doc.id}/tipo-de-texto`, 'PUT', { tipo_id: tipo });
    const { compreensao_id } = await pedir<{ compreensao_id: string }>(`/api/documentos/${doc.id}/preparacao`, 'POST', { itens: ['grifos_relacoes'] });
    await ate(`preparação de ${doc.id}`, async () => {
      const s = await pedir<{ capitulos: { estado: string }[]; erro?: unknown }>(`/api/documentos/${doc.id}/preparacao`);
      if (s.capitulos.some((c) => c.estado === 'falhou')) throw new Error(`Preparação falhou: ${JSON.stringify(s)}`);
      return s.capitulos.length > 0 && s.capitulos.every((c) => c.estado === 'pronto');
    });
    return compreensao_id;
  }
  function ancora(doc: Doc, trecho: string): AncoraV1 {
    const bloco = doc.blocos.find((b) => b.texto.includes(trecho));
    if (!bloco) throw new Error(`Trecho não achado: ${trecho}`);
    const inicio = bloco.texto.indexOf(trecho);
    return { versao_id: doc.versao_id, bloco_id: bloco.id, inicio_utf16: inicio, fim_utf16: inicio + trecho.length, citacao: trecho,
      prefixo: bloco.texto.slice(Math.max(0, inicio - 32), inicio), sufixo: bloco.texto.slice(inicio + trecho.length, inicio + trecho.length + 32) };
  }

  // 1. Biblioteca: quatro textos, preparados pelo "Codex".
  await pedir('/api/configuracoes/preparacao', 'PUT', { ao_importar: false, itens: ['grifos_relacoes'] });
  const pdf = join(temporaria, 'instinto-de-nacionalidade.pdf');
  gerarPdf(pdf);
  const t = transcricao();
  const ensaio = await enviar('ensaio', 'instinto-de-nacionalidade.pdf', 'pdf', 'application/pdf', readFileSync(pdf), 'Instinto de nacionalidade', 'Machado de Assis');
  const apologo = await enviar('apologo', 'um-apologo.md', 'md', 'text/markdown', APOLOGO, 'Um apólogo', 'Machado de Assis');
  const cancao = await enviar('cancao', 'cancao-do-exilio.md', 'md', 'text/markdown', CANCAO, 'Canção do exílio', 'Gonçalves Dias');
  const oracao = await enviar('oracao', 'oracao-aos-mocos.txt', 'txt', 'text/plain', `${t.paragrafos.join('\n\n')}\n`, 'Oração aos moços (trechos)', 'Rui Barbosa');
  for (const [doc, analise] of [[ensaio, ANALISES.ensaio], [apologo, ANALISES.apologo], [cancao, ANALISES.cancao]] as const) await preparar(doc, analise.tipo);

  // 2. O vídeo: arquivo próprio + a transcrição com tempos; depois, a análise própria do vídeo.
  const video = join(temporaria, 'oracao-aos-mocos.mp4');
  gerarVideo(video, t.duracao);
  const arquivo = await pedir<{ sha256: string }>('/api/midia/arquivos', 'PUT', new Uint8Array(readFileSync(video)));
  const { midia } = await pedir<{ midia: { id: string } }>(`/api/documentos/${oracao.id}/midias`, 'POST', {
    versao_id: oracao.versao_id, sha256: arquivo.sha256, titulo: 'Oração aos moços (trechos)', capitulos: t.capitulos,
    transcricao: { motor: 'whisper', idioma: 'pt', palavras: t.palavras },
  });
  await preparar(oracao, ANALISES.oracao.tipo);
  await ate('momentos do vídeo', async () => {
    const c = JSON.stringify(await pedir(`/api/midias/${midia.id}/conceitos`));
    if (/"falhou"/u.test(c)) throw new Error(`Momentos do vídeo falharam: ${c.slice(0, 400)}`);
    return c.includes('Quinhoar');
  });

  // 3. A questão colada como print: vira uma página, e a resolução entra na fila.
  const fq = new FormData();
  fq.set('titulo', 'Lista 4, questão 7');
  fq.set('arquivo', new File([readFileSync(join(raiz, 'site/public/demo/questao.png'))], 'questao.png', { type: 'image/png' }));
  const questao = await pedir<{ documento_id: string }>('/api/importacoes/questao', 'POST', fq);
  const sessao = await ate('resolução da questão', async () => {
    const r = await pedir<{ resolucoes: { resolucao: { id: string }; estado: string }[] }>(`/api/documentos/${questao.documento_id}/resolucoes`);
    if (r.resolucoes.some((s) => s.estado === 'falhou')) throw new Error(`Resolução falhou: ${JSON.stringify(r).slice(0, 400)}`);
    return r.resolucoes.find((s) => s.estado === 'pronta')?.resolucao.id;
  });

  // 4. O quadro: a obra de exemplo, reconhecida pelo acervo; a análise vem do "Codex".
  const fa = new FormData();
  fa.set('arquivo', new File([readFileSync(join(raiz, 'web/public/arte/educacao.jpg'))], 'educacao.jpg', { type: 'image/jpeg' }));
  const { slug } = await pedir<{ slug: string }>('/api/arte', 'POST', fa);
  await ate('análise do quadro', async () => {
    const lista = await pedir<{ obras: { slug: string; analises: unknown[] }[]; preparando: unknown[] }>('/api/arte');
    return lista.preparando.length === 0 && (lista.obras.find((o) => o.slug === slug)?.analises.length ?? 0) > 0;
  }, 180_000);

  // 5. O que a pessoa faz: grifos com nota, uma conexão, uma pergunta ao trecho, uma pergunta à biblioteca.
  async function grifar(doc: Doc, trecho: string, funcao: string, modo: { id: string; revisao: number }, nota: string): Promise<string> {
    const { marca } = await pedir<{ marca: { id: string } }>('/api/grifos', 'POST', { ancora: ancora(doc, trecho), funcao, modo });
    await pedir(`/api/marcas/${marca.id}/nota-do-leitor`, 'PUT', { texto: nota });
    return marca.id;
  }
  await grifar(apologo, 'Eu é que prendo, ligo, ajunto', 'personagem', { id: 'ficcao_narrativa', revisao: 1 }, 'A linha se define pelo que une. No fim, é ela que vai ao baile: comparar com a fala do alfinete.');
  await grifar(ensaio, 'deve principalmente alimentar-se dos assuntos que lhe oferece a sua região', 'juizo', { id: 'critica_literaria', revisao: 1 }, 'Machado concede antes de recusar: o assunto local vale, só não pode virar regra.');
  await grifar(oracao, 'O mais são desvarios da inveja, do orgulho, ou da loucura.', 'razao', { id: 'opinativa', revisao: 1 }, 'Forte: quem discorda vira invejoso. Retórica de tribuna, não argumento.');
  await pedir('/api/conexoes', 'POST', { origem: ancora(apologo, 'Também os batedores vão adiante do imperador.'),
    destino: { tipo: 'trecho', ancora: ancora(oracao, 'quinhoar desigualmente aos desiguais') }, relacao: 'tensao',
    justificativa: 'A linha defende a hierarquia de quem aparece; Rui Barbosa, a medida do que cada um vale.' });
  const conversa = await pedir<{ conversa: { id: string } }>('/api/conversas', 'POST', { ancora: ancora(apologo, 'ágeis como os galgos de Diana — para dar a isto uma cor poética'), pergunta: 'Por que o narrador diz "para dar a isto uma cor poética"?' });
  await ate('resposta da pergunta ao trecho', async () => {
    const c = await pedir<{ conversa: { mensagens: { autor: string }[] } }>(`/api/conversas/${conversa.conversa.id}`);
    return c.conversa.mensagens.some((m) => m.autor === 'ia');
  });
  const { conversa: agente } = await pedir<{ conversa: { id: string } }>('/api/agente/conversas', 'POST', { pergunta: 'O que "Um apólogo" e a "Oração aos moços" dizem sobre quem faz o trabalho e quem leva o mérito?' });
  await ate('resposta do Perguntar', async () => {
    const fio = await pedir<{ mensagens: { autor: string; estado?: string }[] }>(`/api/agente/conversas/${agente.id}`);
    if (fio.mensagens.some((m) => m.estado === 'falhou')) throw new Error(`Perguntar falhou: ${JSON.stringify(fio).slice(0, 600)}`);
    return fio.mensagens.some((m) => m.autor !== 'leitor');
  });
  await pedir('/api/estado-instalacao/concluir', 'POST');
  await pedir('/api/configuracoes/preparacao', 'PUT', { ao_importar: true, itens: ['grifos_relacoes'] });

  const ids = { ensaio: ensaio.id, apologo: apologo.id, cancao: cancao.id, oracao: oracao.id, questao: questao.documento_id, sessao, slug, agente: agente.id };
  const servidor = await new Promise<ReturnType<typeof serve>>((pronto) => { const s = serve({ fetch: api.fetch, hostname: '127.0.0.1', port: PORTA }, () => { pronto(s); }); });
  fechar = () => { servidor.close(); };
  console.log(JSON.stringify({ api: API, ...ids }, null, 2));

  if (SERVIR) {
    console.log('No ar. Ctrl+C encerra e apaga o banco de teste.');
    await new Promise<void>((pronto) => { process.once('SIGINT', () => { pronto(); }); process.once('SIGTERM', () => { pronto(); }); });
  } else {
    await capturar(ids);
  }
  } catch (erro) {
    const falhas = await banco.query<{ tipo: string; error_code: string | null; diagnosticos: unknown }>("SELECT tipo, error_code, diagnosticos FROM job WHERE estado='falhou'");
    console.error('Jobs que falharam:', JSON.stringify(falhas.rows, null, 2).slice(0, 4000));
    throw erro;
  } finally {
    fechar();
    worker.pedirParada();
    await laco;
  }
});
rmSync(temporaria, { recursive: true, force: true });
process.exit(0);

