/**
 * Notas do livro e da biblioteca: lista de anotações e grifos do leitor por documento e de tudo, com filtros,
 * capítulo, bloco, página e link de volta ao trecho; exportação CSV e JSON. Postgres de teste, sem Codex.
 */
import type { Hono } from 'hono';
import { expect, test } from 'vitest';
import { hashEstrutural, type AncoraV1, type Bloco, type CanonicoV1, type MarcaV2 } from '@margem/contratos';
import { canonicoDeTeste, comBanco } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import * as documentos from '../repos/documentos.js';
import type { ItemDeNota } from '../notas/listar.js';
import { criarApi } from './app.js';

const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };
async function escrever<T>(api: Hono, metodo: string, caminho: string, dado: unknown): Promise<T> {
  const resposta = await api.request(caminho, { method: metodo, headers: ESCRITA, body: JSON.stringify(dado) });
  expect(resposta.status, await resposta.clone().text()).toBeLessThan(300);
  return await resposta.json() as T;
}
function ancora(versaoId: string, bloco: Bloco, citacao: string): AncoraV1 {
  const inicio = bloco.texto.indexOf(citacao);
  return { versao_id: versaoId, bloco_id: bloco.id, inicio_utf16: inicio, fim_utf16: inicio + citacao.length,
    citacao, prefixo: bloco.texto.slice(0, inicio), sufixo: bloco.texto.slice(inicio + citacao.length) };
}
async function lista(api: Hono, consulta = ''): Promise<ItemDeNota[]> {
  const resposta = await api.request(`/api/notas${consulta}`);
  expect(resposta.status).toBe(200);
  return (await resposta.json() as { itens: ItemDeNota[] }).itens;
}

test('notas do livro e da biblioteca: anotações e grifos com capítulo, página, filtros, link e exportação', async () => comBanco('notas_lista', async (banco) => {
  const livro = canonicoDeTeste({ titulo: 'Tratado', blocos: [
    { tipo: 'capitulo', texto: 'Da razão' },
    { tipo: 'paragrafo', texto: 'A razão comum basta para ver que a ordem do mundo pede explicação.' },
    { tipo: 'capitulo', texto: 'Da vontade' },
    { tipo: 'paragrafo', texto: 'A vontade segue o bem apreendido, diz ele, "sempre".' },
  ], secoes: [{ nivel: 1, inicio: 0, fim: 1 }, { nivel: 1, inicio: 2, fim: 3 }] });
  // O segundo capítulo veio de um PDF com numeração impressa; o primeiro, da página 7 do arquivo.
  const comPaginas: CanonicoV1 = { ...livro, blocos: livro.blocos.map((bloco, indice) => ({ ...bloco,
    origens: [indice < 2 ? { tipo: 'pdf' as const, pagina: 7, bbox: [0, 0, 1, 1] as [number, number, number, number] }
      : { tipo: 'pdf' as const, pagina: 9, impressa: 'xii', bbox: [0, 0, 1, 1] as [number, number, number, number] }] })) };
  comPaginas.hash_estrutural = hashEstrutural(comPaginas.blocos);
  const ensaio = canonicoDeTeste({ titulo: 'Ensaio', blocos: [{ tipo: 'paragrafo', texto: 'Um ensaio curto sem capítulos.' }] });
  const [versaoLivro, livroId, versaoEnsaio, ensaioId] = await comTransacao(banco, async (cliente) => {
    const a = await documentos.criar(cliente, { ...comPaginas.documento, autor: 'Tomás', origem_caminho: 'tratado.pdf' });
    const b = await documentos.criar(cliente, { ...ensaio.documento, origem_caminho: 'ensaio.md' });
    return [(await documentos.criarVersao(cliente, a.id, comPaginas)).id, a.id, (await documentos.criarVersao(cliente, b.id, ensaio)).id, b.id];
  });
  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); } });
  expect(await lista(api)).toEqual([]);

  const [, p1, , p2] = comPaginas.blocos as [Bloco, Bloco, Bloco, Bloco];
  const { marca } = await escrever<{ marca: MarcaV2 }>(api, 'POST', '/api/grifos', { ancora: ancora(versaoLivro, p1, 'A razão comum basta'), funcao: 'tese' });
  await escrever(api, 'PUT', `/api/marcas/${marca.id}/nota`, { texto: 'O ponto de partida.' });
  await escrever(api, 'POST', '/api/anotacoes', { ancora: ancora(versaoLivro, p2, 'diz ele, "sempre"'), tipo: 'duvida', texto: 'Sempre, mesmo?' });
  await escrever(api, 'POST', '/api/anotacoes', { ancora: ancora(versaoEnsaio, ensaio.blocos[0]!, 'ensaio curto'), tipo: 'observacao', texto: 'Curto, mas denso.' });

  // A biblioteca: por título do documento, depois na ordem do texto.
  const todas = await lista(api);
  expect(todas.map((item) => [item.documento.titulo, item.especie, item.tipo])).toEqual([
    ['Ensaio', 'anotacao', 'observacao'], ['Tratado', 'grifo', 'tese'], ['Tratado', 'anotacao', 'duvida'],
  ]);
  const [observacao, grifo, duvida] = todas as [ItemDeNota, ItemDeNota, ItemDeNota];
  expect(grifo).toMatchObject({ id: marca.id, rotulo: 'Tese', nota: 'O ponto de partida.', citacao: 'A razão comum basta',
    documento: { id: livroId, titulo: 'Tratado', autor: 'Tomás' }, capitulo: { id: livro.secoes[0]!.id, titulo: 'Da razão' },
    bloco_id: p1.id, pagina: '7', link: `/ler/${livroId}/${livro.secoes[0]!.id}?bloco=${p1.id}` });
  expect(grifo.cor?.claro).toMatch(/^#/);
  expect(duvida).toMatchObject({ rotulo: 'Dúvida', nota: 'Sempre, mesmo?', citacao: 'diz ele, "sempre"', pagina: 'xii', cor: null,
    capitulo: { titulo: 'Da vontade' }, link: `/ler/${livroId}/${livro.secoes[1]!.id}?bloco=${p2.id}` });
  expect(Date.parse(duvida.criada_em)).not.toBeNaN();
  // Sem capítulo e sem PDF: sem página, e o link vai ao documento.
  expect(observacao).toMatchObject({ capitulo: null, pagina: null, link: `/ler/${ensaioId}?bloco=${ensaio.blocos[0]!.id}` });

  // Filtros: documento, espécie, tipo (a "cor") e texto no trecho ou na nota.
  expect((await lista(api, `?documento=${livroId}`)).map((item) => item.id)).toEqual([grifo.id, duvida.id]);
  expect((await lista(api, '?especie=grifo')).map((item) => item.id)).toEqual([grifo.id]);
  expect((await lista(api, '?tipo=duvida')).map((item) => item.id)).toEqual([duvida.id]);
  expect((await lista(api, '?texto=PONTO de')).map((item) => item.id)).toEqual([grifo.id]);
  expect((await lista(api, `?texto=ensaio&documento=${livroId}`))).toEqual([]);
  expect((await api.request('/api/notas?documento=xyz')).status).toBe(400);
  expect((await api.request('/api/notas?especie=conversa')).status).toBe(400);
  expect((await api.request(`/api/notas?texto=${'a'.repeat(201)}`)).status).toBe(400);

  // Exportação: CSV com BOM e aspas escapadas; JSON com o mesmo recorte.
  const csv = await api.request(`/api/notas/exportacao.csv?documento=${livroId}`);
  expect(csv.status).toBe(200);
  expect(csv.headers.get('content-type')).toContain('text/csv');
  expect(csv.headers.get('content-disposition')).toMatch(/^attachment; filename="margem-notas-tratado-\d{4}-\d{2}-\d{2}\.csv"$/);
  const bytes = new Uint8Array(await csv.arrayBuffer());
  expect([...bytes.slice(0, 3)]).toEqual([0xEF, 0xBB, 0xBF]);
  const linhas = new TextDecoder().decode(bytes).trimEnd().split('\r\n');
  expect(linhas[0]).toBe('documento,autor,capitulo,pagina,especie,tipo,citacao,nota,criada_em,atualizada_em,link,documento_id,bloco_id,id');
  expect(linhas).toHaveLength(3);
  expect(linhas[2]).toContain('Tratado,Tomás,Da vontade,xii,anotacao,Dúvida,"diz ele, ""sempre""","Sempre, mesmo?",');
  const json = await api.request('/api/notas/exportacao.json?especie=anotacao');
  expect(json.headers.get('content-disposition')).toMatch(/filename="margem-notas-\d{4}-\d{2}-\d{2}\.json"/);
  const corpo = await json.json() as { versao: number; total: number; filtro: unknown; itens: ItemDeNota[] };
  expect(corpo).toMatchObject({ versao: 1, total: 2, filtro: { especie: 'anotacao' } });
  expect(corpo.itens.map((item) => item.id)).toEqual([observacao.id, duvida.id]);
}));
