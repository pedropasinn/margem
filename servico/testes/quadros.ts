/**
 * Fixtures dos quadros da pessoa (J118): o dossiê do Wikidata e da Wikipédia sem rede e as quatro
 * respostas do Codex para a análise v2 de uma obra enviada ("A Leiteira", com identificadores fictícios).
 */
import { idDeFonte, type Buscar } from '../src/arte/v2/dossie-auto.js';
import type { LeituraVisual, ModeloCandidato, RevisaoDoModelo, RoteiroCandidato } from '../src/arte/v2/tipos.js';

export const EXTRATO_WP = 'A Leiteira é uma pintura a óleo de Johannes Vermeer, pintada por volta de 1658. A tela mostra uma criada que despeja leite numa vasilha de barro, junto a uma janela, e está hoje no Rijksmuseum, em Amsterdã.';
export const URL_WP = 'https://pt.wikipedia.org/wiki/A_Leiteira';
export const FONTE_WP = idDeFonte(URL_WP);

/** Respostas da rede por trecho da URL. Q100 é a obra; Q999, uma cópia de outro artista com título parecido. */
export const RESPOSTAS_DA_REDE: Record<string, unknown> = {
  // V-T2: a conferência procura no Commons quando o Wikidata não acha; aqui, nada.
  'commons.wikimedia.org': { query: { search: [], pages: [] } },
  'list=search': { query: { search: [{ title: 'Q999' }, { title: 'Q100' }] } },
  'wbsearchentities': { search: [{ id: 'Q100' }] },
  'props=labels|aliases|claims&ids=': { entities: {
    Q100: { labels: { pt: { value: 'A Leiteira' }, en: { value: 'The Milkmaid' } }, aliases: { nl: [{ value: 'Het melkmeisje' }] },
      claims: { P170: [{ mainsnak: { datavalue: { value: { id: 'Q200' } } } }], P571: [{ mainsnak: { datavalue: { value: { time: '+1658-00-00T00:00:00Z' } } } }] } },
    Q999: { labels: { pt: { value: 'A Leiteira (cópia)' } }, claims: { P170: [{ mainsnak: { datavalue: { value: { id: 'Q300' } } } }] } },
  } },
  'props=labels|aliases&ids=': { entities: { Q200: { labels: { pt: { value: 'Johannes Vermeer' } }, aliases: { en: [{ value: 'Jan Vermeer' }] } }, Q300: { labels: { pt: { value: 'Han van Meegeren' } } } } },
  'EntityData/Q100': { entities: { Q100: {
    labels: { pt: { value: 'A Leiteira' }, nl: { value: 'Het melkmeisje' } },
    claims: {
      P170: [{ mainsnak: { datavalue: { value: { id: 'Q200' } } } }], P186: [{ mainsnak: { datavalue: { value: { id: 'Q296955' } } } }],
      P195: [{ mainsnak: { datavalue: { value: { id: 'Q190804' } } } }], P571: [{ mainsnak: { datavalue: { value: { time: '+1658-00-00T00:00:00Z' } } } }],
    },
    sitelinks: { ptwiki: { title: 'A Leiteira' } },
  } } },
  'props=labels&languages': { entities: { Q200: { labels: { pt: { value: 'Johannes Vermeer' } } }, Q296955: { labels: { pt: { value: 'tinta a óleo' } } }, Q190804: { labels: { pt: { value: 'Rijksmuseum' } } } } },
  'pt.wikipedia.org': { query: { pages: [{ extract: EXTRATO_WP }] } },
};

/** Rede de mentira: cada URL pedida fica registrada; URL sem resposta falha como a rede fora do ar. */
export function redeDeFixture(urls: string[] = [], respostas = RESPOSTAS_DA_REDE): Buscar {
  return (url) => {
    urls.push(url);
    const chave = Object.keys(respostas).find((k) => url.includes(k));
    return chave ? Promise.resolve(respostas[chave]) : Promise.reject(new Error(`sem fixture: ${url}`));
  };
}

export const identificacaoDoCodex = (reconhecida = true) => ({
  reconhecida, titulo: reconhecida ? 'A Leiteira' : null, titulo_original: reconhecida ? 'Het melkmeisje' : null,
  artista: reconhecida ? 'Johannes Vermeer' : null, ano: reconhecida ? 'c. 1658' : null, confianca: reconhecida ? 'alta' : 'baixa',
  justificativa: reconhecida ? 'A criada despejando leite junto à janela é inconfundível.' : 'Pintura de interior sem traço que a identifique.',
  candidatos: reconhecida ? [{ titulo: 'A Leiteira', titulo_original: 'Het melkmeisje', artista: 'Johannes Vermeer', ano: 'c. 1658', confianca: 'alta', pistas: 'A criada despejando leite junto à janela.' }] : [],
});

export const leitura: LeituraVisual = {
  descricao: 'Uma criada de touca branca despeja leite de um jarro numa vasilha sobre a mesa, junto a uma janela.', composicao: 'Diagonal do jarro à vasilha.', luz_e_cor: 'Luz da janela à esquerda.',
  objetos: [
    { rotulo: 'Jarro de leite', descricao: 'Jarro de barro inclinado.', x: 0.42, y: 0.4, largura: 0.12, altura: 0.12, saliencia: 'alta' },
    { rotulo: 'Rosto da criada', descricao: 'Olhar baixo.', x: 0.45, y: 0.18, largura: 0.12, altura: 0.12, saliencia: 'alta' },
  ],
  relacoes: [{ objetos: [0, 1], relacao: 'Ela olha para o fio de leite.' }], incertezas: [],
};

export const candidato: ModeloCandidato = {
  regioes: [
    { rotulo: 'Jarro de leite', objeto: 0, forma: { tipo: 'bbox', x: 0.42, y: 0.4, largura: 0.12, altura: 0.12 } },
    { rotulo: 'Fio de leite', objeto: null, forma: { tipo: 'bbox', x: 0.4, y: 0.45, largura: 0.3, altura: 0.25 } },
    { rotulo: 'Rosto da criada', objeto: 1, forma: { tipo: 'bbox', x: 0.45, y: 0.18, largura: 0.12, altura: 0.12 } },
    { rotulo: 'A cena', objeto: null, forma: { tipo: 'bbox', x: 0, y: 0, largura: 1, altura: 0.9 } },
  ],
  afirmacoes: [
    { texto: 'O jarro inclinado está no centro da mesa.', tipo: 'observacao', dimensao: 'composicao', confianca: 'alta', evidencia: 'Centro da tela.', fontes: [], citacoes: [], regioes: [0], apoios: [] },
    { texto: 'O fio de leite liga o jarro à vasilha enquanto ela olha para baixo.', tipo: 'observacao', dimensao: 'composicao', confianca: 'alta', evidencia: 'Olhar.', fontes: [], citacoes: [], regioes: [1, 2], apoios: [] },
    { texto: 'Vermeer pintou a tela por volta de 1658.', tipo: 'fato', dimensao: 'historia', confianca: 'alta', evidencia: 'Wikipédia.', fontes: [FONTE_WP], citacoes: [{ fonte: FONTE_WP, trecho: 'pintada por volta de 1658' }], regioes: [], apoios: [] },
    { texto: 'Vermeer pintou a criada como retrato da própria mãe.', tipo: 'fato', dimensao: 'artista', confianca: 'alta', evidencia: 'Inventado.', fontes: [FONTE_WP], citacoes: [{ fonte: FONTE_WP, trecho: 'a criada era a mãe do pintor' }], regioes: [], apoios: [] },
    { texto: 'Talvez o gesto lento seja o assunto do quadro.', tipo: 'inferencia_ia', dimensao: 'interpretacoes', confianca: 'media', evidencia: 'Olhar e gesto.', fontes: [], citacoes: [], regioes: [3], apoios: [0, 1] },
    { texto: 'A pintura homenagearia a mãe do pintor.', tipo: 'inferencia_ia', dimensao: 'interpretacoes', confianca: 'baixa', evidencia: 'Do retrato.', fontes: [], citacoes: [], regioes: [], apoios: [3] },
    { texto: 'A luz vem de uma janela à esquerda.', tipo: 'observacao', dimensao: 'tecnica', confianca: 'media', evidencia: 'Sombras.', fontes: [], citacoes: [], regioes: [], apoios: [] },
    { texto: 'Não sabemos o que Vermeer quis dizer com a cena.', tipo: 'intencao_desconhecida', dimensao: 'interpretacoes', confianca: 'alta', evidencia: 'Nenhuma fonte.', fontes: [], citacoes: [], regioes: [], apoios: [] },
  ],
  teses: [{ texto: 'Um gesto doméstico vira o centro de tudo.', afirmacoes: [0, 1, 4], gancho: 'O que está acontecendo?', por_que_interessa: 'Muda o centro.' }],
  limites: ['Foto enviada, sem verso.'],
};

export const revisao: RevisaoDoModelo = {
  regioes: [
    { indice: 0, veredito: 'manter', forma: null, motivo: 'justa' },
    { indice: 1, veredito: 'ajustar', forma: { tipo: 'bbox', x: 0.44, y: 0.48, largura: 0.1, altura: 0.12 }, motivo: 'larga' },
    { indice: 3, veredito: 'cortar', forma: null, motivo: 'o quadro inteiro não é região' },
  ],
  afirmacoes: [{ indice: 1, veredito: 'corrigir', texto: 'O fio de leite liga o jarro à vasilha; ela acompanha com os olhos.', tipo: null, confianca: null, evidencia: null, motivo: 'mais preciso' }],
  tese: { indice: 0, texto: 'Um gesto doméstico, feito devagar, vira o centro de tudo.', motivo: 'nítida' },
};

// Depois dos cortes: afirmações 0,1,2,4,7 → 0..4; regiões 0,1,2 → 0..2.
export const roteiro: RoteiroCandidato = {
  tese: 'Um gesto doméstico, feito devagar, vira o centro de tudo.', afirmacoes_da_tese: [0, 1, 3], gancho: 'pergunta',
  batidas: [
    { papel: 'abertura', narracao: 'Uma mulher despeja leite numa vasilha. Por que isso merece um quadro inteiro?', afirmacoes: [0], regiao: null, enquadramento: 'inteiro', novidade: 'pergunta' },
    { papel: 'evidencia_visual', narracao: 'O jarro de barro fica bem no meio da mesa, inclinado com cuidado.', afirmacoes: [0], regiao: 0, enquadramento: 'detalhe', novidade: 'jarro' },
    { papel: 'evidencia_visual', narracao: 'Um fio fino de leite desce do jarro e quase não se move.', afirmacoes: [1], regiao: 1, enquadramento: 'detalhe', novidade: 'fio' },
    { papel: 'evidencia_visual', narracao: 'Ela baixa os olhos e acompanha o fio, sem pressa nenhuma.', afirmacoes: [1], regiao: 2, enquadramento: 'meio', novidade: 'olhar' },
    { papel: 'contexto', narracao: 'Vermeer pintou esta tela por volta de 1658, em Delft, na Holanda.', afirmacoes: [2], regiao: null, enquadramento: 'inteiro', novidade: 'data' },
    { papel: 'fechamento', narracao: 'O assunto não é o leite: é o tempo que ela leva para despejá-lo.', afirmacoes: [3], regiao: null, enquadramento: 'inteiro', novidade: 'virada' },
  ],
};

/** As quatro respostas da análise, na ordem das chamadas. */
export const ANALISE = [leitura, candidato, revisao, roteiro] as const;

/**
 * V-W5: o roteiro de uma obra não identificada, analisada só pela imagem. Com o mesmo candidato, o modo
 * "só pela imagem" corta os fatos, a intenção e a inferência que se apoiava num fato: ficam as afirmações
 * 0 e 1 (observações) e 4 (inferência), renumeradas 0..2; regiões 0, 1 e 2.
 */
export const roteiroSoPelaImagem: RoteiroCandidato = {
  tese: 'Um gesto doméstico, feito devagar, vira o centro de tudo.', afirmacoes_da_tese: [0, 1, 2], gancho: 'pergunta',
  batidas: [
    { papel: 'abertura', narracao: 'Uma mulher despeja leite numa vasilha. Por que isso merece um quadro inteiro?', afirmacoes: [0], regiao: null, enquadramento: 'inteiro', novidade: 'pergunta' },
    { papel: 'evidencia_visual', narracao: 'O jarro de barro fica bem no meio da mesa, inclinado com cuidado.', afirmacoes: [0], regiao: 0, enquadramento: 'detalhe', novidade: 'jarro' },
    { papel: 'evidencia_visual', narracao: 'Um fio fino de leite desce do jarro e quase não se move.', afirmacoes: [1], regiao: 1, enquadramento: 'detalhe', novidade: 'fio' },
    { papel: 'evidencia_visual', narracao: 'Ela baixa os olhos e acompanha o fio, sem pressa nenhuma.', afirmacoes: [1], regiao: 2, enquadramento: 'meio', novidade: 'olhar' },
    { papel: 'interpretacao', narracao: 'Talvez o gesto lento seja o verdadeiro assunto desta cena doméstica.', afirmacoes: [2], regiao: null, enquadramento: 'inteiro', novidade: 'leitura' },
    { papel: 'fechamento', narracao: 'O assunto não é o leite: é o tempo que ela leva para despejá-lo.', afirmacoes: [2], regiao: null, enquadramento: 'inteiro', novidade: 'virada' },
  ],
};

/** As quatro respostas da análise só pela imagem. */
export const ANALISE_SO_PELA_IMAGEM = [leitura, candidato, revisao, roteiroSoPelaImagem] as const;

/** O que o Codex respondeu no teste de 14/10 para "Educação Obrigatória", de Briton Rivière. */
export const IDENTIFICACAO_DO_TESTE_DE_14_10 = {
  reconhecida: false, titulo: null, titulo_original: null, artista: null, ano: null, confianca: 'baixa',
  justificativa: 'A imagem mostra uma menina de vestido branco e faixa azul segurando um livro aberto e abraçando um grande cão, em um interior doméstico. A pintura lembra cenas sentimentais britânicas do final do século XIX, mas esses elementos não bastam para identificar com segurança a obra e seu autor.',
  // O prompt antigo (arte-identificacao@1) não pedia candidatos: a resposta ficou sem nenhum.
  candidatos: [],
};

/**
 * V-T2: a rede de verdade para "Educação Obrigatória" (Briton Rivière, 1887), copiada das respostas de
 * 14/10/2026: o Wikidata não tem item da obra (a busca volta vazia), o Commons tem a reprodução, sem
 * dados estruturados, e liga o artigo da Wikipédia em inglês sobre o artista.
 */
export const ARQUIVO_DA_EDUCACAO = 'File:Briton Rivière Compulsory Education.jpg';
export const MINIATURA_DA_EDUCACAO = 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Briton_Rivi%C3%A8re_Compulsory_Education.jpg/640px-Briton_Rivi%C3%A8re_Compulsory_Education.jpg';
export const EXTRATO_DO_ARTISTA = 'Briton Rivière RA (14 August 1840 – 20 April 1920) was a British artist of Huguenot descent. He exhibited animal paintings at the Royal Academy for many years.';
const META_DA_EDUCACAO = {
  ObjectName: { value: '<div class="fn"><div style="font-weight:bold;display:inline-block;">Compulsory Education</div></div>' },
  Artist: { value: '<bdi><a href="https://en.wikipedia.org/wiki/en:Briton_Rivi%C3%A8re" class="extiw" title="w:en:Briton Rivière"><span title="British artist of Huguenot descent (1840-1920)">Briton Rivière</span></a></bdi>' },
  DateTimeOriginal: { value: '1887<div style="display: none;">date QS:P571,+1887-00-00T00:00:00Z/9</div>' },
  ImageDescription: { value: 'See source for more info.' },
  Credit: { value: "Sotheby's, London, 16 December 2010" },
  LicenseShortName: { value: 'Public domain' },
};
export const REDE_DA_EDUCACAO: Record<string, unknown> = {
  'www.wikidata.org': { query: { search: [] }, search: [], entities: {} },
  'list=search&srnamespace=6': { query: { search: [{ title: ARQUIVO_DA_EDUCACAO }, { title: 'File:A guide to Hayti (IA bdb76f7e).pdf' }] } },
  'iiprop=url|extmetadata': { query: { pages: [{ pageid: 50410103, title: ARQUIVO_DA_EDUCACAO, imageinfo: [{ thumburl: MINIATURA_DA_EDUCACAO, url: MINIATURA_DA_EDUCACAO, extmetadata: META_DA_EDUCACAO }] }] } },
  'iiprop=extmetadata': { query: { pages: [{ pageid: 50410103, title: ARQUIVO_DA_EDUCACAO, imageinfo: [{ extmetadata: META_DA_EDUCACAO }] }] } },
  'iiprop=url&': { query: { pages: [{ pageid: 50410103, title: ARQUIVO_DA_EDUCACAO, imageinfo: [{ thumburl: MINIATURA_DA_EDUCACAO }] }] } },
  'ids=M50410103': { entities: { M50410103: { statements: {} } } },
  'en.wikipedia.org': { query: { pages: [{ extract: EXTRATO_DO_ARTISTA }] } },
};
