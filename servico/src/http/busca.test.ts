import { describe, expect, test } from 'vitest';
import { canonicoDeTeste, comBanco } from '../../testes/apoio';
import { comTransacao } from '../db/transacao';
import * as documentos from '../repos/documentos';
import { criarApi } from './app';
import { ocorrenciasDaFrase, ocorrenciasDoRealce, padraoDaFrase, trechoEmSegmentos, type RespostaDaBusca } from './rotas-busca';

describe('realce e recorte', () => {
  test('converte os marcadores do ts_headline em offsets UTF-16 e confere o texto', () => {
    const texto = 'Ação 😀 e razão, de novo razão.';
    const realce = texto.replace(/razão/g, '\u0001razão\u0002');
    const faixas = ocorrenciasDoRealce(realce, texto)!;
    expect(faixas.map((f) => texto.slice(f.inicio_utf16, f.fim_utf16))).toEqual(['razão', 'razão']);
    // Se o realce não reconstrói o texto, nada é marcado.
    expect(ocorrenciasDoRealce('outro \u0001texto\u0002', texto)).toBeNull();
  });

  test('mais de uma palavra é frase literal, sem maiúsculas nem acentos, atravessando quebra de linha', () => {
    const texto = 'Tanto Um homem real como um ho\u00ADmem em pintura; um\nhomem e uma homem-aranha. Própria razão.';
    const achados = (consulta: string) => ocorrenciasDaFrase(padraoDaFrase(consulta)!, texto).map((f) => texto.slice(f.inicio_utf16, f.fim_utf16));
    expect(achados('um homem')).toEqual(['Um homem', 'um\nhomem']);
    expect(achados('"propria razao"')).toEqual(['Própria razão']);
    expect(achados('ho mem')).toEqual(['ho\u00ADmem']);
    // Uma palavra só e sintaxe de busca seguem pelo tsvector.
    expect(padraoDaFrase('homem')).toBeNull();
    expect(padraoDaFrase('razão -caniço')).toBeNull();
    expect(padraoDaFrase('razão or caniço')).toBeNull();
    // Caracteres especiais são literais.
    expect(ocorrenciasDaFrase(padraoDaFrase('a.b (c)')!, 'a.b (c) axb c')).toEqual([{ inicio_utf16: 0, fim_utf16: 7 }]);
  });

  test('recorta em volta da primeira ocorrência, sem cortar palavra, com reticências', () => {
    const texto = `${'palavra '.repeat(30)}achado no meio ${'resto '.repeat(60)}`.trim();
    const inicio = texto.indexOf('achado');
    const segmentos = trechoEmSegmentos(texto, [{ inicio_utf16: inicio, fim_utf16: inicio + 6 }]);
    expect(segmentos[0]!.texto.startsWith('…palavra')).toBe(true);
    expect(segmentos.at(-1)!.texto.endsWith('resto…')).toBe(true);
    expect(segmentos.filter((s) => s.marcado).map((s) => s.texto)).toEqual(['achado']);
    // Texto curto e sem ocorrência conferida: o bloco inteiro, sem marca.
    expect(trechoEmSegmentos('curto', [])).toEqual([{ texto: 'curto', marcado: false }]);
  });
});

async function json(resposta: Response): Promise<RespostaDaBusca> {
  expect(resposta.status).toBe(200);
  return resposta.json() as Promise<RespostaDaBusca>;
}

test('busca na biblioteca e no documento, com capítulo, bloco, página, trecho marcado e paginação', async () => comBanco('busca_texto', async (banco) => {
  const livro = canonicoDeTeste({
    titulo: 'Pensamentos', idioma: 'pt-BR',
    blocos: [
      { tipo: 'capitulo', texto: 'Primeira parte' },
      { tipo: 'paragrafo', texto: 'O coração tem razões que a própria razão desconhece.' },
      { tipo: 'paragrafo', texto: 'Nada aqui interessa à busca.' },
      { tipo: 'capitulo', texto: 'Segunda parte' },
      { tipo: 'paragrafo', texto: 'Um caniço pensante: a <b>razão</b> é fraca.' },
      { tipo: 'paragrafo', texto: 'Mais uma razão.' },
      { tipo: 'paragrafo', texto: 'E outra razão ainda.' },
    ],
    secoes: [{ nivel: 1, inicio: 0, fim: 2 }, { nivel: 1, inicio: 3, fim: 6 }],
  });
  const ingles = canonicoDeTeste({ titulo: 'Essays', idioma: 'en', blocos: [{ tipo: 'paragrafo', texto: 'Reason runs ahead; the runner reasons.' }] });
  const arquivado = canonicoDeTeste({ titulo: 'Guardado', blocos: [{ tipo: 'paragrafo', texto: 'Uma razão arquivada.' }] });
  const ids = await comTransacao(banco, async (tx) => {
    const d1 = await documentos.criar(tx, { ...livro.documento, origem_caminho: 'pensamentos.txt' });
    // Duas versões: só a última conta.
    await documentos.criarVersao(tx, d1.id, canonicoDeTeste({ titulo: 'Pensamentos', blocos: [{ tipo: 'paragrafo', texto: 'Versão antiga com razão.' }] }));
    const v1 = await documentos.criarVersao(tx, d1.id, livro);
    const d2 = await documentos.criar(tx, { ...ingles.documento, origem_caminho: 'essays.txt' });
    await documentos.criarVersao(tx, d2.id, ingles);
    const d3 = await documentos.criar(tx, { ...arquivado.documento, origem_caminho: 'guardado.txt' });
    await documentos.criarVersao(tx, d3.id, arquivado);
    await documentos.arquivar(tx, d3.id);
    const vazio = await documentos.criar(tx, { ...arquivado.documento, origem_caminho: 'vazio.txt' });
    return { d1: d1.id, v1: v1.id, d2: d2.id, d3: d3.id, vazio: vazio.id };
  });
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); } });

  // Biblioteca: só a última versão e só os não arquivados; o português acha "razão" (e não "razões").
  const biblioteca = await json(await api.request('/api/busca?q=raz%C3%A3o'));
  expect(biblioteca.total).toBe(4);
  expect(new Set(biblioteca.resultados.map((r) => r.documento_id))).toEqual(new Set([ids.d1]));
  expect(biblioteca.resultados.every((r) => r.versao_id === ids.v1)).toBe(true);
  for (const resultado of biblioteca.resultados) {
    const bloco = livro.blocos.find((b) => b.id === resultado.bloco_id)!;
    expect(resultado.ocorrencias.length).toBeGreaterThan(0);
    for (const faixa of resultado.ocorrencias) expect(bloco.texto.slice(faixa.inicio_utf16, faixa.fim_utf16)).toBe('razão');
    expect(resultado.trecho.map((s) => s.texto).join('')).toBe(bloco.texto);
    expect(resultado.trecho.filter((s) => s.marcado).every((s) => s.texto === 'razão')).toBe(true);
    expect(resultado.pagina).toBeNull();
  }
  const primeiro = biblioteca.resultados.find((r) => r.bloco_id === livro.blocos[1]!.id)!;
  expect(primeiro.capitulo).toEqual({ id: livro.secoes[0]!.id, titulo: 'Primeira parte' });
  // O texto do bloco volta como texto: a tag do original é só texto, sem HTML do banco.
  const comTag = biblioteca.resultados.find((r) => r.bloco_id === livro.blocos[4]!.id)!;
  expect(comTag.capitulo?.id).toBe(livro.secoes[1]!.id);
  expect(comTag.trecho.map((s) => s.texto).join('')).toContain('<b>');

  // Inglês com o stemmer inglês.
  const emIngles = await json(await api.request('/api/busca?q=run'));
  expect(emIngles.resultados.map((r) => r.documento_id)).toEqual([ids.d2]);
  // "runs" vira "run"; "runner" não.
  const [faixa] = emIngles.resultados[0]!.ocorrencias;
  expect(emIngles.resultados[0]!.ocorrencias).toHaveLength(1);
  expect(ingles.blocos[0]!.texto.slice(faixa!.inicio_utf16, faixa!.fim_utf16)).toBe('runs');

  // Sintaxe de busca na web: frase entre aspas e exclusão.
  expect((await json(await api.request(`/api/busca?q=${encodeURIComponent('"própria razão"')}`))).total).toBe(1);
  expect((await json(await api.request(`/api/busca?q=${encodeURIComponent('razão -caniço')}`))).total).toBe(3);
  // Frase sem aspas casa o texto literal, inclusive com palavra vazia ("a") e sem acento.
  const frase = await json(await api.request(`/api/busca?q=${encodeURIComponent('a propria razao')}`));
  expect(frase.total).toBe(1);
  expect(frase.resultados[0]!.trecho.filter((s) => s.marcado).map((s) => s.texto)).toEqual(['a própria razão']);
  expect((await json(await api.request(`/api/documentos/${ids.d1}/busca?q=${encodeURIComponent('mais uma')}`))).total).toBe(1);
  // Texto hostil é só texto.
  expect((await json(await api.request(`/api/busca?q=${encodeURIComponent("' OR 1=1 --")}`))).total).toBe(0);

  // Dentro do documento, na ordem do texto, com paginação simples.
  const pagina1 = await json(await api.request(`/api/documentos/${ids.d1}/busca?q=raz%C3%A3o&limite=3`));
  expect(pagina1.total).toBe(4);
  expect(pagina1.resultados.map((r) => r.bloco_id)).toEqual([1, 4, 5].map((i) => livro.blocos[i]!.id));
  expect(pagina1.proximo).toBe(3);
  const pagina2 = await json(await api.request(`/api/documentos/${ids.d1}/busca?q=raz%C3%A3o&limite=3&deslocamento=3`));
  expect(pagina2.resultados.map((r) => r.bloco_id)).toEqual([livro.blocos[6]!.id]);
  expect(pagina2.proximo).toBeNull();
  // O arquivado some da biblioteca, mas se busca dentro dele.
  expect((await json(await api.request(`/api/documentos/${ids.d3}/busca?q=raz%C3%A3o`))).total).toBe(1);

  // Erros.
  expect((await api.request('/api/busca?q=')).status).toBe(400);
  expect((await api.request(`/api/busca?q=${'a'.repeat(201)}`)).status).toBe(400);
  expect((await api.request('/api/busca?q=x&limite=0')).status).toBe(400);
  expect((await api.request('/api/busca?q=x&deslocamento=-1')).status).toBe(400);
  expect((await api.request('/api/documentos/nao-e-ulid/busca?q=x')).status).toBe(400);
  expect((await api.request(`/api/documentos/${'0'.repeat(25)}Z/busca?q=x`)).status).toBe(404);
  expect((await api.request(`/api/documentos/${ids.vazio}/busca?q=x`)).status).toBe(409);
}));

test('a página do PDF vem da origem do bloco', async () => comBanco('busca_pdf', async (banco) => {
  const base = canonicoDeTeste({ titulo: 'Artigo', blocos: [{ tipo: 'paragrafo', texto: 'A tese central do artigo.' }] });
  const pdf = { ...base, documento: { ...base.documento, formato: 'pdf' as const },
    blocos: base.blocos.map((b) => ({ ...b, origens: [{ tipo: 'pdf' as const, pagina: 7, bbox: [0, 0, 10, 10] as [number, number, number, number] }] })) };
  const id = await comTransacao(banco, async (tx) => {
    const d = await documentos.criar(tx, { ...pdf.documento, origem_caminho: 'artigo.pdf' });
    await documentos.criarVersao(tx, d.id, pdf);
    return d.id;
  });
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); } });
  const resposta = await json(await api.request(`/api/documentos/${id}/busca?q=tese`));
  expect(resposta.resultados[0]).toMatchObject({ pagina: 7, formato: 'pdf' });
}));
