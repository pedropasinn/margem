import type { Bloco, Comentario, Faixa, Funcao, Id, MarcaV1 } from '@margem/contratos';
import type { SnapshotCapitulo } from '../tipos';

/** ULID de teste: 26 caracteres Crockford maiúsculos com o primeiro entre `0` e `7`. */
function identificador(sufixo: string): Id {
  return sufixo.toUpperCase().padStart(26, '0');
}

const VERSAO = identificador('V001');

/**
 * Textos vindos de `contratos/casos/Canonico/valido-unicode.json` (emoji fora do BMP,
 * `café` precomposto e decomposto, ligaturas, aspas curvas). O bloco de título perde o
 * `# ` do Markdown porque o contrato exige `texto === titulo` no bloco que abre a seção.
 */
export const TEXTOS_DO_CANONICO = {
  titulo: 'Leitura e memória 📖',
  emoji: 'O café aparece também como café; o emoji 🧭 ocupa duas unidades UTF-16.',
  ligaturas: 'As ligaturas ﬁ e ﬂ convivem com “aspas curvas” — sem mudar as palavras.',
  ultimo: 'Último parágrafo: ação, coração e uma linha\nque continua no mesmo parágrafo.',
} as const;

/** Localiza um trecho literal e recusa ocorrência ambígua, como manda o método de marcação. */
function faixaDe(texto: string, trecho: string): Faixa {
  const inicio = texto.indexOf(trecho);
  if (inicio < 0) throw new Error(`Trecho ausente no bloco: ${trecho}`);
  if (texto.indexOf(trecho, inicio + 1) >= 0) throw new Error(`Trecho ambíguo no bloco: ${trecho}`);
  return { inicio_utf16: inicio, fim_utf16: inicio + trecho.length };
}

/** Recorta contexto sem partir par substituto (as âncoras proíbem surrogate isolado). */
function contexto(texto: string, inicio: number, fim: number): number[] {
  const recuo = Math.max(0, inicio - 16);
  const avanco = Math.min(texto.length, fim + 16);
  const ehBaixo = (indice: number): boolean => /[\uDC00-\uDFFF]/u.test(texto[indice] ?? '');
  return [ehBaixo(recuo) ? recuo + 1 : recuo, ehBaixo(avanco) ? avanco - 1 : avanco];
}

interface Pedido {
  sufixo: string;
  bloco: Bloco;
  trecho: string;
  funcao: Funcao;
  sublinhados?: string[];
  comentario?: Comentario;
  visivel?: boolean;
  validade?: MarcaV1['validade'];
}

function marcaDe(pedido: Pedido): MarcaV1 {
  const { texto } = pedido.bloco;
  const faixa = faixaDe(texto, pedido.trecho);
  const [recuo, avanco] = contexto(texto, faixa.inicio_utf16, faixa.fim_utf16);
  return {
    id: identificador(pedido.sufixo),
    ancora: {
      versao_id: VERSAO,
      bloco_id: pedido.bloco.id,
      citacao: pedido.trecho,
      prefixo: texto.slice(recuo ?? 0, faixa.inicio_utf16),
      sufixo: texto.slice(faixa.fim_utf16, avanco ?? texto.length),
      inicio_utf16: faixa.inicio_utf16,
      fim_utf16: faixa.fim_utf16,
    },
    funcao: pedido.funcao,
    subfaixas: (pedido.sublinhados ?? []).map((sublinhado) => faixaDe(texto, sublinhado)),
    comentario: pedido.comentario ?? null,
    origem: 'parte',
    validade: pedido.validade ?? 'resolvida',
    visivel: pedido.visivel ?? true,
    avaliacao: 'nao_avaliada',
    criada_em: '2026-09-20T18:00:00Z',
  };
}

let proximaOrdem = 0;

function blocoDe(
  sufixo: string,
  tipo: Bloco['tipo'],
  texto: string,
  extras: Partial<Pick<Bloco, 'inline' | 'asset_id'>> = {},
): Bloco {
  const ordem = proximaOrdem++;
  return {
    id: identificador(sufixo),
    ordem,
    tipo,
    texto,
    inline: extras.inline ?? [],
    origens: [{ tipo: 'texto', linha_inicio: ordem + 1, linha_fim: ordem + 1 }],
    ...(extras.asset_id === undefined ? {} : { asset_id: extras.asset_id }),
  };
}

const ASSET_EQUACAO = identificador('A001');
const ASSET_FIGURA = identificador('A002');

const titulo = blocoDe('B001', 'capitulo', TEXTOS_DO_CANONICO.titulo);
const epigrafe = blocoDe('B002', 'epigrafe', 'A margem é o lugar onde o leitor responde.');
const emoji = blocoDe('B003', 'paragrafo', TEXTOS_DO_CANONICO.emoji);

const textoLigaturas = TEXTOS_DO_CANONICO.ligaturas;
const ligaturas = blocoDe('B004', 'paragrafo', textoLigaturas, {
  inline: [
    // O itálico começa antes da âncora de M04 e termina dentro dela: inline cruzando marca.
    { inicio: faixaDe(textoLigaturas, 'ﬂ convivem com “aspas').inicio_utf16, fim: faixaDe(textoLigaturas, 'ﬂ convivem com “aspas').fim_utf16, estilo: 'italico' },
    { inicio: faixaDe(textoLigaturas, 'curvas”').inicio_utf16, fim: faixaDe(textoLigaturas, 'curvas”').fim_utf16, estilo: 'negrito' },
  ],
});

const listaUm = blocoDe('B005', 'lista', 'Marcar é escolher o que merece releitura.');
const listaDois = blocoDe('B006', 'lista', 'Comentar é responder ao autor.');
const citacao = blocoDe('B007', 'citacao', 'O texto não muda; muda a atenção que lhe damos.');
const codigo = blocoDe('B008', 'codigo', "segmentar(bloco, marcas).map((s) => s.texto).join('') === bloco.texto");
const equacao = blocoDe('B009', 'equacao', 'E = m c²', { asset_id: ASSET_EQUACAO });
const figura = blocoDe('B010', 'figura', 'Diagrama das três funções: tese, conceito e justificativa.', { asset_id: ASSET_FIGURA });
const tabela = blocoDe('B011', 'tabela', 'Função e sublinhado: tese fino, conceito fino, justificativa fino.');
// O id da nota é conhecido antes do bloco: a chamada vem antes da nota no texto.
const ID_NOTA = identificador('B013');

const textoFidelidade = 'A fidelidade do texto é a regra mais simples do leitor.¹';
const fidelidade = blocoDe('B012', 'paragrafo', textoFidelidade, {
  inline: [
    { inicio: faixaDe(textoFidelidade, 'fidelidade do texto').inicio_utf16, fim: faixaDe(textoFidelidade, 'fidelidade do texto').fim_utf16, estilo: 'codigo' },
    { inicio: textoFidelidade.length - 1, fim: textoFidelidade.length, estilo: 'nota_ref', ref: ID_NOTA },
  ],
});

const notaRodape = blocoDe('B013', 'nota_rodape', '¹ Nada do modelo vira HTML: o texto do bloco chega ao DOM como texto.');
const literal = blocoDe('B014', 'paragrafo', 'Conteúdo hostil fica literal: <script>alert(1)</script> e <img src=x onerror=alert(2)>.');
const ultimo = blocoDe('B015', 'paragrafo', TEXTOS_DO_CANONICO.ultimo);

const blocos: Bloco[] = [
  titulo, epigrafe, emoji, ligaturas, listaUm, listaDois, citacao,
  codigo, equacao, figura, tabela, fidelidade, notaRodape, literal, ultimo,
];

const marcas: MarcaV1[] = [
  marcaDe({
    sufixo: 'M01', bloco: emoji, trecho: 'O café aparece também como café', funcao: 'tese',
    sublinhados: ['também'],
    comentario: { tipo: 'AUTOR', rotulo: 'Tese do trecho', texto: 'Duas grafias de “café” convivem sem normalização Unicode.' },
  }),
  // Âncora que termina logo depois do emoji: limite fora do BMP no fim da marca.
  marcaDe({
    sufixo: 'M02', bloco: emoji, trecho: 'o emoji 🧭', funcao: 'conceito',
    comentario: { tipo: 'LEITURA', rotulo: 'Unidade UTF-16', texto: 'O emoji ocupa duas unidades; o corte respeita o par substituto.' },
  }),
  marcaDe({
    sufixo: 'M03', bloco: emoji, trecho: 'duas unidades UTF-16', funcao: 'justificativa',
    comentario: { tipo: 'INVESTIGAR', rotulo: 'Offsets', texto: 'Por que a contagem é UTF-16 e não por grafema?' },
  }),
  marcaDe({
    sufixo: 'M04', bloco: ligaturas, trecho: 'convivem com “aspas curvas”', funcao: 'conceito',
    sublinhados: ['aspas curvas'],
    comentario: { tipo: 'AUTOR', rotulo: 'Ligaturas', texto: 'A fonte muda o desenho; o texto canônico não muda.' },
  }),
  marcaDe({
    sufixo: 'M05', bloco: citacao, trecho: 'muda a atenção', funcao: 'nenhuma',
    comentario: { tipo: 'CONEXAO', rotulo: 'Comentário literal', texto: 'Comentário com <script>alert(1)</script> dentro, que precisa aparecer como texto.' },
  }),
  marcaDe({
    sufixo: 'M06', bloco: codigo, trecho: 'bloco.texto', funcao: 'tese',
    comentario: { tipo: 'LEITURA', rotulo: 'Invariante', texto: 'A concatenação dos segmentos devolve o texto do bloco.' },
  }),
  marcaDe({
    sufixo: 'M07', bloco: fidelidade, trecho: 'a regra mais simples do leitor', funcao: 'justificativa',
    sublinhados: ['regra', 'simples'],
    comentario: { tipo: 'OBJECAO', rotulo: 'Duas subfaixas', texto: 'Subfaixas usam coordenadas do bloco, não da citação.' },
  }),
  // Oculta: não deve produzir classe de marca nenhuma no DOM.
  marcaDe({ sufixo: 'M08', bloco: listaUm, trecho: 'merece releitura', funcao: 'conceito', visivel: false }),
  // Ambígua: idem, a apresentação nunca escolhe uma localização em silêncio.
  marcaDe({ sufixo: 'M09', bloco: listaDois, trecho: 'responder ao autor', funcao: 'tese', validade: 'ambigua' }),
];

const svg = (corpo: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120" role="img">${corpo}</svg>`)}`;

/** Capítulo de exemplo usado pela página `/dev` e pelos testes. Sem rede: assets são data URI. */
export const capituloExemplo = {
  versao_id: VERSAO,
  secao: {
    id: identificador('S001'),
    nivel: 1,
    titulo: TEXTOS_DO_CANONICO.titulo,
    ordem: 0,
    bloco_inicio: titulo.id,
    bloco_fim: ultimo.id,
  },
  blocos,
  marcas,
  assets: {
    [ASSET_EQUACAO]: svg('<text x="10" y="70" font-family="serif" font-size="44" fill="#8b8b8b">E = m c²</text>'),
    [ASSET_FIGURA]: svg('<rect x="8" y="16" width="304" height="88" fill="none" stroke="#8b8b8b"/><text x="24" y="66" font-family="sans-serif" font-size="20" fill="#8b8b8b">tese · conceito · justificativa</text>'),
  },
} satisfies SnapshotCapitulo;
