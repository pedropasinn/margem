import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AnaliseCurtaDaObraV1, ModeloDaObraV1 } from '@margem/contratos';
import { validarAnaliseCurtaDaObra, validarModeloDaObra } from '../../../../contratos/src/validadores';
import { conferirAnaliseCurta, conferirModeloDaObra, contemRetangulo, limitesDaRegiao } from '../../../../core/src/arte';
import { criarExecutorFalso } from '../../executor/fake';
import type { PassoRoteiro } from '../../executor/fake';
import type { Executor } from '../../executor/tipos';
import { corpusPorFonte, ligarTextosAsFontes, lerObra, montarDossie } from './acervo';
import { avaliarGeracao, medirCurta, relatorioMarkdown } from './avaliacao';
import { conferirRoteiro, filtrarFinal, semRevisao } from './conferencias';
import { filtroDaImagem, passoDaGrade } from './imagens';
import type { PrepararImagem } from './imagens';
import { criarIds, uniaoQuadrada } from './montagem';
import { gerarQuadroV2 } from './pipeline';
import { trechoPresente } from './texto';
import type { LeituraVisual, ModeloCandidato, RevisaoDoModelo, RoteiroCandidato } from './tipos';

const RELATORIO = '01M3SPS2BG87V4YP5785TJZXGV', HANSARD = '01M3SPS2BH3YZCYQKPEBTVZ6EW';
const TEXTO_HANSARD = 'Mr. MUNDELLA said the Elementary Education Act of 1880 required every school board and attendance committee in England and Wales to make bye-laws for school attendance before the end of the year.';
const lerFixture = async <T>(nome: string): Promise<T> => JSON.parse(await readFile(new URL(`../../../../fixtures/arte/${nome}.json`, import.meta.url), 'utf8')) as T;

const leitura: LeituraVisual = {
  descricao: 'Uma menina de vestido branco segura um livro aberto diante de um cão grande.', composicao: 'Diagonal do livro ao rosto.', luz_e_cor: 'Luz da esquerda.',
  objetos: [
    { rotulo: 'Livro aberto', descricao: 'Livro de capa vermelha.', x: 0.3, y: 0.3, largura: 0.28, altura: 0.12, saliencia: 'alta' },
    { rotulo: 'Cabeça do cão', descricao: 'Olhos para cima.', x: 0.45, y: 0.28, largura: 0.2, altura: 0.14, saliencia: 'alta' },
  ],
  relacoes: [{ objetos: [0, 1], relacao: 'O livro está diante do focinho.' }], incertezas: [],
};
const candidato: ModeloCandidato = {
  regioes: [
    { rotulo: 'Livro aberto', objeto: 0, forma: { tipo: 'bbox', x: 0.3, y: 0.3, largura: 0.28, altura: 0.12 } },
    { rotulo: 'Olhar do cão', objeto: 1, forma: { tipo: 'bbox', x: 0.4, y: 0.25, largura: 0.35, altura: 0.25 } },
    { rotulo: 'Rosto da menina', objeto: null, forma: { tipo: 'bbox', x: 0.58, y: 0.19, largura: 0.2, altura: 0.1 } },
    { rotulo: 'A cena', objeto: null, forma: { tipo: 'bbox', x: 0, y: 0, largura: 1, altura: 0.9 } },
  ],
  afirmacoes: [
    { texto: 'O livro aberto fica diante do focinho do cão.', tipo: 'observacao', dimensao: 'composicao', confianca: 'alta', evidencia: 'Centro da tela.', fontes: [], citacoes: [], regioes: [0], apoios: [] },
    { texto: 'O cão olha para cima enquanto a menina baixa a cabeça.', tipo: 'observacao', dimensao: 'composicao', confianca: 'alta', evidencia: 'Olhos.', fontes: [], citacoes: [], regioes: [1, 2], apoios: [] },
    { texto: 'A lei de 1880 obrigou regras locais de frequência escolar.', tipo: 'fato', dimensao: 'contexto', confianca: 'alta', evidencia: 'Hansard.', fontes: [HANSARD], citacoes: [{ fonte: HANSARD, trecho: 'every school board and attendance committee in England and Wales' }], regioes: [], apoios: [] },
    { texto: 'Rivière pintou a cena como protesto contra as escolas.', tipo: 'fato', dimensao: 'artista', confianca: 'alta', evidencia: 'Inventado.', fontes: [HANSARD], citacoes: [{ fonte: HANSARD, trecho: 'the painter hated the new schools deeply' }], regioes: [], apoios: [] },
    { texto: 'Talvez a lição seja dada a um aluno distraído.', tipo: 'inferencia_ia', dimensao: 'interpretacoes', confianca: 'media', evidencia: 'Olhares.', fontes: [], citacoes: [], regioes: [3], apoios: [0, 1] },
    { texto: 'A pintura seria uma crítica direta à lei.', tipo: 'inferencia_ia', dimensao: 'interpretacoes', confianca: 'baixa', evidencia: 'Do protesto.', fontes: [], citacoes: [], regioes: [], apoios: [3] },
    { texto: 'A luz vem de uma janela fora do quadro.', tipo: 'observacao', dimensao: 'tecnica', confianca: 'media', evidencia: 'Sombras.', fontes: [], citacoes: [], regioes: [], apoios: [] },
    { texto: 'Não sabemos se Rivière pensava na lei ao pintar.', tipo: 'intencao_desconhecida', dimensao: 'interpretacoes', confianca: 'alta', evidencia: 'Nenhuma fonte.', fontes: [], citacoes: [], regioes: [], apoios: [] },
  ],
  teses: [{ texto: 'O livro junta as figuras, mas não a atenção.', afirmacoes: [0, 1, 4], gancho: 'Quem está lendo?', por_que_interessa: 'Muda o centro.' }],
  limites: ['Reprodução sem verso.'],
};
const revisao: RevisaoDoModelo = {
  regioes: [
    { indice: 0, veredito: 'manter', forma: null, motivo: 'justa' },
    { indice: 1, veredito: 'ajustar', forma: { tipo: 'bbox', x: 0.45, y: 0.28, largura: 0.2, altura: 0.14 }, motivo: 'larga' },
    { indice: 3, veredito: 'cortar', forma: null, motivo: 'o quadro inteiro não é região' },
  ],
  afirmacoes: [{ indice: 1, veredito: 'corrigir', texto: 'O cão ergue os olhos; a menina inclina a cabeça para o livro.', tipo: null, confianca: null, evidencia: null, motivo: 'mais preciso' }],
  tese: { indice: 0, texto: 'O livro aproxima as duas figuras, mas cada uma olha para um lugar.', motivo: 'nítida' },
};
// Depois dos cortes: afirmações 0,1,2,4,7 → 0..4; regiões 0,1,2 → 0..2.
const roteiro: RoteiroCandidato = {
  tese: 'O livro aproxima as duas figuras, mas cada uma olha para um lugar.', afirmacoes_da_tese: [0, 1, 3], gancho: 'pergunta',
  batidas: [
    { papel: 'abertura', narracao: 'Há um livro aberto entre os dois. Mas quem, de fato, está lendo?', afirmacoes: [0], regiao: null, enquadramento: 'inteiro', novidade: 'pergunta' },
    { papel: 'evidencia_visual', narracao: 'As páginas chegam quase ao focinho, seguras pelas mãos pequenas da menina.', afirmacoes: [0], regiao: 0, enquadramento: 'detalhe', novidade: 'posição' },
    { papel: 'evidencia_visual', narracao: 'O cão ergue os olhos para o alto, longe das letras.', afirmacoes: [1], regiao: 1, enquadramento: 'detalhe', novidade: 'olhar do cão' },
    { papel: 'evidencia_visual', narracao: 'Ela, ao contrário, inclina o rosto e acompanha a página com cuidado.', afirmacoes: [1], regiao: 2, enquadramento: 'meio', novidade: 'olhar dela' },
    { papel: 'contexto', narracao: 'Em 1880, uma lei inglesa passou a exigir regras de frequência escolar em cada distrito.', afirmacoes: [2], regiao: null, enquadramento: 'inteiro', novidade: 'lei' },
    { papel: 'fechamento', narracao: 'A aula acontece, mas só uma das duas cabeças está nela.', afirmacoes: [3], regiao: null, enquadramento: 'inteiro', novidade: 'virada' },
  ],
};

const prepararFalso: PrepararImagem = async (_origem, destino) => { await writeFile(destino, 'jpg'); };
let raiz: string;
beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), 'arte-v2-'));
  const pasta = join(raiz, 'educacao');
  await mkdir(join(pasta, 'fontes'), { recursive: true });
  const bytes = Buffer.from('imagem de teste');
  await writeFile(join(pasta, 'imagem.jpg'), bytes);
  const referencia = await lerFixture<ModeloDaObraV1>('educacao.modelo');
  referencia.imagem.sha256 = createHash('sha256').update(bytes).digest('hex');
  for (const r of referencia.regioes) r.imagem_sha256 = referencia.imagem.sha256;
  await writeFile(join(pasta, 'esperado.modelo.json'), JSON.stringify(referencia));
  const curta = await lerFixture<AnaliseCurtaDaObraV1>('educacao.curta');
  await writeFile(join(pasta, 'esperado.curta.json'), JSON.stringify({ ...curta, imagem_sha256: referencia.imagem.sha256 }));
  await writeFile(join(pasta, 'fontes', `${HANSARD}.txt`), TEXTO_HANSARD);
});
afterEach(async () => { await rm(raiz, { recursive: true, force: true }); });

const passos = (...conteudos: unknown[]): PassoRoteiro[] => conteudos.map((conteudo, i) => ({ quando: { ordem: i + 1 }, tipo: 'ok', conteudo }));
const config = (executor: Executor, extra = {}) => ({ executor, rotulo: 'v2-teste', raiz, preparar: prepararFalso, dimensoes: () => Promise.resolve({ largura: 2826, altura: 3992 }), agora: () => 1_790_000_000_000, ...extra });

describe('algoritmo v2: pipeline com executor falso', () => {
  it('quatro chamadas; corta o que não se sustenta, ajusta região, calcula câmera e tempo', async () => {
    const executor = criarExecutorFalso({ versao: 1, passos: passos(leitura, candidato, revisao, roteiro) });
    const r = await gerarQuadroV2('educacao', config(executor));
    expect(executor.chamadas).toBe(4);
    expect(validarModeloDaObra(r.modelo)).toBe(true); expect(conferirModeloDaObra(r.modelo)).toEqual([]);
    expect(validarAnaliseCurtaDaObra(r.curta)).toBe(true); expect(conferirAnaliseCurta(r.curta, r.modelo)).toEqual([]);
    const textos = r.modelo.afirmacoes.map((a) => a.texto);
    expect(textos).not.toContain(candidato.afirmacoes[3]!.texto); // citação inventada
    expect(textos).not.toContain(candidato.afirmacoes[5]!.texto); // inferência apoiada nela, em cascata
    expect(textos).not.toContain(candidato.afirmacoes[6]!.texto); // observação sem região
    expect(textos).toContain('O cão ergue os olhos; a menina inclina a cabeça para o livro.');
    expect(r.modelo.afirmacoes.find((a) => a.tipo === 'intencao_desconhecida')!.confianca).toBe('nao_aplicavel');
    expect(r.modelo.afirmacoes.find((a) => a.tipo === 'fato' && a.proveniencia.autor === 'ia')!.evidencia).toContain('every school board');
    expect(r.modelo.regioes.map((x) => x.rotulo)).toEqual(['Livro aberto', 'Olhar do cão', 'Rosto da menina']);
    const transportada = r.modelo.afirmacoes.find((a) => a.texto.includes('consta nas aquisições'));
    expect(transportada?.proveniencia.autor).toBe('curadoria'); // pesquisa curada que o Codex não repetiu
    expect(r.modelo.afirmacoes.filter((a) => a.texto.startsWith('A lei de 1880'))).toHaveLength(1); // a repetida não duplica
    expect(r.modelo.regioes[1]!.forma).toEqual({ tipo: 'bbox', x: 0.45, y: 0.28, largura: 0.2, altura: 0.14 });
    expect(r.registro.diagnosticos.cortes.map((c) => c.motivo)).toEqual(expect.arrayContaining(['citacao_nao_encontrada', 'inferencia_sem_apoio', 'observacao_sem_regiao']));
    for (const b of r.curta.batidas.filter((x) => x.regiao_id)) {
      const regiao = r.modelo.regioes.find((x) => x.id === b.regiao_id)!;
      expect(contemRetangulo(b.camera.para, limitesDaRegiao(regiao.forma))).toBe(true);
    }
    expect(r.curta.batidas[0]!.camera.de).toEqual({ x: 0, y: 0, largura: 1, altura: 1 });
    expect(r.curta.batidas.at(-1)!.camera.para).toEqual({ x: 0, y: 0, largura: 1, altura: 1 });
    expect(r.curta.batidas.every((b) => b.legenda === b.narracao)).toBe(true);
    const pasta = join(raiz, 'educacao', 'geracoes', 'v2-teste');
    for (const nome of ['modelo.json', 'curta.json', 'registro.json', 'avaliacao.json', 'avaliacao.md', 'brutos/leitura.json', 'brutos/modelo.dados.json', 'brutos/roteiro.json'])
      expect(existsSync(join(pasta, nome)), nome).toBe(true);
    const dadosModelo = await readFile(join(pasta, 'brutos/modelo.dados.json'), 'utf8');
    expect(dadosModelo).toContain('every school board'); // texto da fonte vai no dossiê
    expect(dadosModelo).not.toContain('Os olhos do cão se orientam'); // observação da referência nunca vai
  });

  it('retoma sem chamar o Codex e remonta os mesmos arquivos', async () => {
    await gerarQuadroV2('educacao', config(criarExecutorFalso({ versao: 1, passos: passos(leitura, candidato, revisao, roteiro) })));
    const pasta = join(raiz, 'educacao', 'geracoes', 'v2-teste');
    const antes = await readFile(join(pasta, 'modelo.json'), 'utf8');
    const nunca: Executor = () => Promise.reject(new Error('não devia chamar'));
    const r = await gerarQuadroV2('educacao', config(nunca, { agora: () => 1 }));
    expect(r.registro.etapas.every((e) => e.estado === 'retomada')).toBe(true);
    expect(r.registro.chamadas_nesta_execucao).toBe(0); expect(r.registro.chamadas).toBe(4);
    expect(await readFile(join(pasta, 'modelo.json'), 'utf8')).toBe(antes);
  });

  it('cota no meio: guarda o que fez, não escreve modelo; a retomada só faz o que falta', async () => {
    const cota = criarExecutorFalso({ versao: 1, passos: [{ quando: { ordem: 1 }, tipo: 'ok', conteudo: leitura }, { quando: { ordem: 2 }, tipo: 'cota', not_before: '2026-10-01T10:00:00Z' }] });
    await expect(gerarQuadroV2('educacao', config(cota))).rejects.toThrow(/etapa_modelo_adiado/u);
    const pasta = join(raiz, 'educacao', 'geracoes', 'v2-teste');
    expect(existsSync(join(pasta, 'brutos/leitura.json'))).toBe(true);
    expect(existsSync(join(pasta, 'modelo.json'))).toBe(false);
    const resto = criarExecutorFalso({ versao: 1, passos: passos(candidato, revisao, roteiro) });
    await gerarQuadroV2('educacao', config(resto));
    expect(resto.chamadas).toBe(3);
  });

  it('roteiro com problema grave ganha uma chamada de reparo, que é usada quando melhora', async () => {
    const ruim: RoteiroCandidato = { ...roteiro, batidas: [roteiro.batidas[0]!, { ...roteiro.batidas[1]!, narracao: 'Segundo a IA, as páginas (abertas) chegam ao focinho.' }, roteiro.batidas[5]!] };
    const executor = criarExecutorFalso({ versao: 1, passos: passos(leitura, candidato, revisao, ruim, roteiro) });
    const r = await gerarQuadroV2('educacao', config(executor));
    expect(executor.chamadas).toBe(5);
    expect(r.registro.diagnosticos.roteiro.map((d) => d.codigo)).toEqual(expect.arrayContaining(['numero_de_batidas', 'metalinguagem', 'dificil_de_falar']));
    expect(r.registro.diagnosticos.roteiro_escolhido).toBe('reparo');
    expect(r.curta.batidas).toHaveLength(6);
    const dados = JSON.parse(await readFile(join(raiz, 'educacao/geracoes/v2-teste/brutos/roteiro-reparo.dados.json'), 'utf8')) as { problemas: { codigo: string }[] };
    expect(dados.problemas.map((p) => p.codigo)).toContain('metalinguagem');
  });

  it('sem reparo, o roteiro com problema é escrito e acusado', async () => {
    const ruim: RoteiroCandidato = { ...roteiro, batidas: roteiro.batidas.map((b, i) => (i === 2 ? { ...b, narracao: 'Volte ao conjunto e veja o cão.' } : b)) };
    const executor = criarExecutorFalso({ versao: 1, passos: passos(leitura, candidato, revisao, ruim) });
    const r = await gerarQuadroV2('educacao', config(executor, { reparo: false }));
    expect(executor.chamadas).toBe(4);
    expect(r.registro.diagnosticos.roteiro.map((d) => d.codigo)).toContain('cliche');
  });
  it('com dossiê automático: identidade e fontes vêm do dossie-auto.json, citação de fonte curada cai', async () => {
    const pasta = join(raiz, 'educacao');
    const wd = { id: '01AUT0WIKIDATA0000000000000', titulo: 'Wikidata — Q1', url: 'https://www.wikidata.org/wiki/Q1', categoria: 'catalogo', consultado_em: '2026-09-30', arquivo: 'auto-wikidata.txt' };
    const cm = { id: '01AUT0COMMONS00000000000000', titulo: 'Commons', url: 'https://commons.wikimedia.org/wiki/File:X.jpg', categoria: 'secundaria', consultado_em: '2026-09-30', arquivo: 'auto-commons.txt' };
    await writeFile(join(pasta, 'imagem.json'), JSON.stringify({ credito: 'Domínio público' }));
    await writeFile(join(pasta, 'fontes/auto-wikidata.txt'), 'criador: Briton Rivière');
    await writeFile(join(pasta, 'fontes/auto-commons.txt'), 'ObjectName: Compulsory Education');
    await writeFile(join(pasta, 'dossie-auto.json'), JSON.stringify({ versao: 1, gerado_em: '2026-09-30', qid: 'Q1', identidade: { titulo: 'Compulsory Education', titulo_original: 'Compulsory Education', artista: 'Briton Rivière', data: '1887', tecnica: 'óleo', fontes: [wd.id] }, localizacao: { instituicao_proprietaria: null, fontes: [] }, fontes: [cm, wd] }));
    const executor = criarExecutorFalso({ versao: 1, passos: passos(leitura, candidato, revisao, { ...roteiro, batidas: roteiro.batidas.filter((b) => b.papel !== 'contexto').map((b) => ({ ...b, afirmacoes: b.afirmacoes.map((a) => (a >= 2 ? a - 1 : a)) })), afirmacoes_da_tese: [0, 1, 2] }) });
    const r = await gerarQuadroV2('educacao', config(executor, { dossie: 'auto' }));
    expect(r.modelo.identidade.artista).toBe('Briton Rivière');
    expect(r.modelo.fontes.map((f) => f.id)).toEqual([cm.id, wd.id]);
    expect(r.modelo.afirmacoes.some((a) => a.tipo === 'fato' && a.proveniencia.metodo !== 'dossie-automatico/1')).toBe(false);
    expect(conferirModeloDaObra(r.modelo)).toEqual([]);
    expect(r.registro.dossie).toBe('auto');
  });
});

describe('algoritmo v2: peças determinísticas', () => {
  it('citação: só trecho literal (sem contar caixa, acento e pontuação) de quatro palavras ou mais', () => {
    expect(trechoPresente('every school board and attendance', TEXTO_HANSARD)).toBe(true);
    expect(trechoPresente('Every  School-Board and Attendance', TEXTO_HANSARD)).toBe(true);
    expect(trechoPresente('every school', TEXTO_HANSARD)).toBe(false);
    expect(trechoPresente('every school board in Scotland', TEXTO_HANSARD)).toBe(false);
  });

  it('liga arquivos de fontes por id, pela URL citada no texto e pelo nome', async () => {
    const m = await lerFixture<ModeloDaObraV1>('educacao.modelo');
    const fontes = [...m.fontes, { id: 'WP', titulo: 'Wikipedia (pt)', url: 'https://pt.wikipedia.org/wiki/X', categoria: 'secundaria' as const, consultado_em: '2026-09-30' }];
    const textos = new Map([[`${HANSARD}.txt`, 'a'], ['relatorio.txt', `Fonte: ${m.fontes[0]!.url}\ntexto`], ['wp-pt.txt', 'b'], ['wp_pt_artista.txt', 'c'], ['solto.txt', 'd']]);
    const l = ligarTextosAsFontes(fontes, textos);
    expect(l.get(HANSARD)).toBe(`${HANSARD}.txt`);
    expect(l.get(RELATORIO)).toBe('relatorio.txt');
    expect(l.get('WP')).toBe('wp-pt.txt');
    expect([...l.values()]).not.toContain('solto.txt');
  });

  it('dossiê leva identidade, fatos curados e texto das fontes; corpus permite citar a pesquisa', async () => {
    const obra = await lerObra('educacao', raiz);
    const d = montarDossie(obra);
    expect(d.pesquisa.every((p) => p.tipo === 'fato' || p.tipo === 'interpretacao_documentada')).toBe(true);
    expect(d.fontes.find((f) => f.id === HANSARD)!.texto).toBe(TEXTO_HANSARD);
    const corpus = corpusPorFonte(d);
    expect(trechoPresente('consta nas aquisições do relatório', corpus.get(RELATORIO)!)).toBe(true);
  });

  it('portão final: apoio cíclico cai, e a inferência que fica sem apoio cai em cascata', async () => {
    const obra = await lerObra('educacao', raiz);
    const d = montarDossie(obra);
    const c = semRevisao({ ...candidato, afirmacoes: [
      candidato.afirmacoes[0]!,
      { ...candidato.afirmacoes[4]!, apoios: [2], regioes: [] },
      { ...candidato.afirmacoes[4]!, texto: 'Outra leitura sobre o livro e o cão.', apoios: [1], regioes: [] },
    ] });
    const { candidato: f, cortes } = filtrarFinal(c, d, corpusPorFonte(d));
    expect(f.afirmacoes.every((a) => a.tipo !== 'inferencia_ia' || a.apoios.length > 0)).toBe(true);
    expect(cortes.some((x) => x.motivo === 'inferencia_sem_apoio')).toBe(true);
  });

  it('conferência do roteiro acusa repetição, ressalvas empilhadas e duração', () => {
    const c = semRevisao(candidato);
    const repetido: RoteiroCandidato = { ...roteiro, batidas: roteiro.batidas.map((b, i) => (i === 3 ? { ...b, narracao: roteiro.batidas[2]!.narracao } : b)) };
    expect(conferirRoteiro(repetido, c).map((x) => x.codigo)).toContain('repeticao');
    const ressalvas: RoteiroCandidato = { ...roteiro, batidas: roteiro.batidas.map((b, i) => (i === 5 ? { ...b, narracao: 'Não sabemos, não é possível afirmar e a imagem não comprova nada disso.' } : b)) };
    expect(conferirRoteiro(ressalvas, c).find((x) => x.codigo === 'ressalvas')?.gravidade).toBe('grave');
    const longo: RoteiroCandidato = { ...roteiro, batidas: roteiro.batidas.map((b) => ({ ...b, narracao: `${b.narracao} ${b.narracao} ${b.narracao}` })) };
    expect(conferirRoteiro(longo, c).map((x) => x.codigo)).toEqual(expect.arrayContaining(['duracao', 'batida_longa']));
    expect(conferirRoteiro(roteiro, c).filter((x) => x.gravidade === 'grave')).toEqual([]);
  });

  it('grade em coordenadas da obra inteira, com passo pelo tamanho do recorte', () => {
    expect(passoDaGrade({ x: 0, y: 0, largura: 1, altura: 1 })).toBe(0.1);
    expect(passoDaGrade({ x: 0, y: 0, largura: 0.6, altura: 0.6 })).toBe(0.05);
    expect(passoDaGrade({ x: 0, y: 0, largura: 0.2, altura: 0.25 })).toBe(0.02);
    const { filtro, saida } = filtroDaImagem({ largura: 2000, altura: 1000 }, { recorte: { x: 0.5, y: 0, largura: 0.5, altura: 1 }, ladoMax: 1000, grade: true, caixas: [{ retangulo: { x: 0.6, y: 0.1, largura: 0.1, altura: 0.2 }, rotulo: 'R0 rosto' }] });
    expect(filtro.startsWith('crop=1000:1000:1000:0,scale=1000:1000')).toBe(true);
    expect(filtro).toContain("text='0.60'");
    expect(filtro).not.toContain('drawbox=x=-1:'); // a borda do recorte não ganha linha
    expect(filtro).toContain('drawbox=x=200:y=100:w=200:h=200:color=yellow');
    expect(saida).toEqual({ largura: 1000, altura: 1000 });
  });

  it('IDs determinísticos são ULIDs e a união quadrada contém os dois retângulos', () => {
    const id = criarIds(1_790_000_000_000, 'educacao/v2');
    expect(id('modelo')).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/u);
    expect(id('modelo')).toBe(criarIds(1_790_000_000_000, 'educacao/v2')('modelo'));
    expect(id('modelo')).not.toBe(id('regiao/0'));
    const a = { x: 0.1, y: 0.1, largura: 0.2, altura: 0.2 }, b = { x: 0.5, y: 0.3, largura: 0.1, altura: 0.1 };
    const u = uniaoQuadrada(a, b);
    expect(contemRetangulo(u, a) && contemRetangulo(u, b)).toBe(true);
  });
});

describe('avaliação contra a referência', () => {
  it('a referência contra si mesma: regiões com IoU 1 e todas as afirmações cobertas', async () => {
    const m = await lerFixture<ModeloDaObraV1>('educacao.modelo'), c = await lerFixture<AnaliseCurtaDaObraV1>('educacao.curta');
    const comoIa = { ...m, afirmacoes: m.afirmacoes.map((x) => ({ ...x, proveniencia: { autor: 'ia' as const, metodo: 'teste' } })) };
    const a = avaliarGeracao({ esperado: { modelo: m, curta: c }, gerado: { modelo: comoIa, curta: c }, registro: null });
    expect(a.contrato.falhas_modelo).toEqual([]); expect(a.contrato.falhas_curta).toEqual([]);
    expect(a.regioes!.iou_medio_casado).toBe(1); expect(a.regioes!.recall_iou_0_5).toBe(m.regioes.length);
    expect(a.afirmacoes!.cobertas).toBe(a.afirmacoes!.total);
    expect(a.curta.gerada!.batidas).toBe(c.batidas.length);
    const md = relatorioMarkdown('educacao', 'auto', a, { modelo: m, curta: c }, c);
    expect(md).toContain('# Avaliação — educacao · auto'); expect(md).toContain(c.tese);
  });

  it('obra nova, sem referência: só as réguas da geração', async () => {
    const m = await lerFixture<ModeloDaObraV1>('educacao.modelo'), c = await lerFixture<AnaliseCurtaDaObraV1>('educacao.curta');
    const a = avaliarGeracao({ esperado: null, gerado: { modelo: m, curta: c }, registro: null });
    expect(a.regioes).toBeNull(); expect(a.afirmacoes).toBeNull(); expect(a.fontes.esperado).toBeNull();
    expect(a.curta.gerada!.batidas).toBe(c.batidas.length);
    expect(relatorioMarkdown('nova', 'auto', a, { modelo: m, curta: c })).toContain('Obra sem referência curada');
  });

  it('mede repetição, ressalvas e metalinguagem do roteiro', async () => {
    const m = await lerFixture<ModeloDaObraV1>('educacao.modelo'), c = await lerFixture<AnaliseCurtaDaObraV1>('educacao.curta');
    const repetida = { ...c, batidas: c.batidas.map((b) => ({ ...b, narracao: 'O cão olha o livro aberto; a IA não comprova nada.' })) };
    const medida = medirCurta(repetida, m);
    expect(medida.repeticao.jaccard_max).toBe(1);
    expect(medida.metalinguagem).toBe(c.batidas.length);
    expect(medida.ressalvas).toBe(c.batidas.length);
    expect(medida.dificil_de_falar).toBe(c.batidas.length);
  });
});
