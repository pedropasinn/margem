/**
 * Notas do livro e da biblioteca (modelo D): um item por grifo, com a nota do leitor e o comentário do Codex, e as
 * notas antigas soltas; por documento e de tudo, com filtros,
 * capítulo, bloco, página e link de volta ao trecho; exportação CSV e JSON. Postgres de teste, sem Codex.
 */
import type { Hono } from 'hono';
import { expect, test } from 'vitest';
import { ulid } from 'ulid';
import { hashEstrutural, type AncoraV1, type Bloco, type CanonicoV1, type MarcaV2 } from '@margem/contratos';
import { canonicoDeTeste, comBanco } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import * as anotacoesRepo from '../repos/anotacoes.js';
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

test('notas do livro e da biblioteca (modelo D): um item por grifo com a nota do leitor, filtros, link e exportação', async () => comBanco('notas_lista', async (banco) => {
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
  // Um grifo "Tese" no modo padrão, com a nota do leitor; outro "Tese" no modo Geral, sem nota (dois modos no mesmo livro).
  const { marca } = await escrever<{ marca: MarcaV2 }>(api, 'POST', '/api/grifos', { ancora: ancora(versaoLivro, p1, 'A razão comum basta'), funcao: 'tese' });
  await escrever(api, 'PUT', `/api/marcas/${marca.id}/nota-do-leitor`, { texto: 'O ponto de partida.' });
  const { marca: geral } = await escrever<{ marca: MarcaV2 }>(api, 'POST', '/api/grifos', {
    ancora: ancora(versaoLivro, p1, 'a ordem do mundo'), funcao: 'tese', modo: { id: 'geral', revisao: 1 } });
  // Um grifo sem função, que vira uma "marca do Codex" com comentário (como se fosse da leitura) e ganha nota do leitor.
  const { marca: doCodex } = await escrever<{ marca: MarcaV2 }>(api, 'POST', '/api/grifos', { ancora: ancora(versaoLivro, p2, 'diz ele, "sempre"'), funcao: 'nenhuma' });
  const { nota: notaDoCodex } = await escrever<{ nota: { id: string } }>(api, 'PUT', `/api/marcas/${doCodex.id}/nota-do-leitor`, { texto: 'Sempre, mesmo?' });
  // Uma nota antiga solta e uma fundida pela migração (essa não aparece).
  const [antigaId, fundidaId] = await comTransacao(banco, async (cliente) => {
    await cliente.query(`UPDATE marca SET origem='parte', comentario=$2::jsonb WHERE id=$1`,
      [doCodex.id, JSON.stringify({ tipo: 'LEITURA', rotulo: '', texto: 'O autor exagera de propósito.' })]);
    const base = { versao: 1 as const, revisao_edicao: 1, versao_id: versaoEnsaio, tipo: 'observacao' as const,
      ancora: ancora(versaoEnsaio, ensaio.blocos[0]!, 'ensaio curto'), criada_em: '2026-09-30T12:00:00.000Z', atualizada_em: '2026-09-30T12:00:00.000Z' };
    const antiga = await anotacoesRepo.criar(cliente, { ...base, id: ulid(), texto: 'Curto, mas denso.' });
    const fundida = await anotacoesRepo.criar(cliente, { ...base, id: ulid(), texto: 'Juntada à outra.' });
    await cliente.query(`UPDATE anotacao SET fundida_em=$2, modelo_d='fundida' WHERE id=$1`, [fundida.id, antiga.id]);
    return [antiga.id, fundida.id];
  });

  // A biblioteca: por título do documento, depois na ordem do texto. Nenhuma anotação ligada a grifo vira item.
  const todas = await lista(api);
  expect(todas.map((item) => [item.documento.titulo, item.especie, item.rotulo])).toEqual([
    ['Ensaio', 'nota_antiga', 'Nota antiga'], ['Tratado', 'grifo', 'Tese'], ['Tratado', 'grifo', 'Tese'], ['Tratado', 'grifo', 'Grifo'],
  ]);
  expect(todas.some((item) => item.id === fundidaId)).toBe(false);
  const [antiga, tese, teseGeral, codex] = todas as [ItemDeNota, ItemDeNota, ItemDeNota, ItemDeNota];
  expect(tese).toMatchObject({ id: marca.id, funcao: 'tese', modo: { id: 'argumentativa', revisao: 1, nome: 'Argumentativa' }, autoria: 'leitor',
    nota: 'O ponto de partida.', comentario_codex: null, citacao: 'A razão comum basta',
    documento: { id: livroId, titulo: 'Tratado', autor: 'Tomás' }, capitulo: { id: livro.secoes[0]!.id, titulo: 'Da razão' },
    bloco_id: p1.id, pagina: '7', link: `/ler/${livroId}/${livro.secoes[0]!.id}?bloco=${p1.id}` });
  expect(tese.nota_id).toMatch(/^[0-9A-Z]{26}$/);
  expect(tese.cor?.claro).toMatch(/^#/);
  expect(teseGeral).toMatchObject({ id: geral.id, modo: { id: 'geral', nome: 'Geral' }, nota: null, nota_id: null });
  expect(codex).toMatchObject({ id: doCodex.id, funcao: 'nenhuma', rotulo: 'Grifo', cor: null, autoria: 'codex', nota: 'Sempre, mesmo?',
    nota_id: notaDoCodex.id, comentario_codex: 'O autor exagera de propósito.', pagina: 'xii', capitulo: { titulo: 'Da vontade' },
    link: `/ler/${livroId}/${livro.secoes[1]!.id}?bloco=${p2.id}` });
  expect(Date.parse(codex.criada_em)).not.toBeNaN();
  // Nota antiga: sem capítulo e sem PDF, sem página, e o link vai ao documento; sem tipo antigo.
  expect(antiga).toMatchObject({ id: antigaId, funcao: null, modo: null, nota: 'Curto, mas denso.', nota_id: antigaId,
    capitulo: null, pagina: null, link: `/ler/${ensaioId}?bloco=${ensaio.blocos[0]!.id}` });
  expect(JSON.stringify(todas)).not.toMatch(/Observação|observacao|"tipo"/);

  // Filtros: documento, com nota, só grifos (sem nota), função (e modo) e texto no trecho, na nota ou no comentário.
  expect((await lista(api, `?documento=${livroId}`)).map((item) => item.id)).toEqual([tese.id, teseGeral.id, codex.id]);
  expect((await lista(api, '?mostrar=com_nota')).map((item) => item.id)).toEqual([antiga.id, tese.id, codex.id]);
  expect((await lista(api, '?mostrar=grifos')).map((item) => item.id)).toEqual([teseGeral.id]);
  expect((await lista(api, '?funcao=tese')).map((item) => item.id)).toEqual([tese.id, teseGeral.id]);
  expect((await lista(api, '?funcao=tese&modo=geral')).map((item) => item.id)).toEqual([teseGeral.id]);
  expect((await lista(api, '?texto=PONTO de')).map((item) => item.id)).toEqual([tese.id]);
  expect((await lista(api, '?texto=exagera')).map((item) => item.id)).toEqual([codex.id]);
  expect((await lista(api, `?texto=ensaio&documento=${livroId}`))).toEqual([]);
  expect((await api.request('/api/notas?documento=xyz')).status).toBe(400);
  expect((await api.request('/api/notas?mostrar=anotacao')).status).toBe(400);
  expect((await api.request('/api/notas?funcao=Tese!')).status).toBe(400);
  expect((await api.request(`/api/notas?texto=${'a'.repeat(201)}`)).status).toBe(400);

  // Exportação: CSV com BOM e aspas escapadas; JSON com o mesmo recorte.
  const csv = await api.request(`/api/notas/exportacao.csv?documento=${livroId}`);
  expect(csv.status).toBe(200);
  expect(csv.headers.get('content-type')).toContain('text/csv');
  expect(csv.headers.get('content-disposition')).toMatch(/^attachment; filename="margem-notas-tratado-\d{4}-\d{2}-\d{2}\.csv"$/);
  const bytes = new Uint8Array(await csv.arrayBuffer());
  expect([...bytes.slice(0, 3)]).toEqual([0xEF, 0xBB, 0xBF]);
  const linhas = new TextDecoder().decode(bytes).trimEnd().split('\r\n');
  expect(linhas[0]).toBe('documento,autor,capitulo,pagina,especie,funcao,modo,citacao,nota,comentario_codex,criada_em,atualizada_em,link,documento_id,bloco_id,id');
  expect(linhas).toHaveLength(4);
  expect(linhas[3]).toContain('Tratado,Tomás,Da vontade,xii,grifo,Grifo,Argumentativa,"diz ele, ""sempre""","Sempre, mesmo?",O autor exagera de propósito.,');
  const json = await api.request('/api/notas/exportacao.json?mostrar=com_nota');
  expect(json.headers.get('content-disposition')).toMatch(/filename="margem-notas-\d{4}-\d{2}-\d{2}\.json"/);
  const corpo = await json.json() as { versao: number; total: number; filtro: unknown; itens: ItemDeNota[] };
  expect(corpo).toMatchObject({ versao: 2, total: 3, filtro: { mostrar: 'com_nota' } });
  expect(corpo.itens.map((item) => item.id)).toEqual([antiga.id, tese.id, codex.id]);
}));
