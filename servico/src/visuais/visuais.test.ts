/**
 * J70 na API e no worker: visuais ancorados (imagem e fluxograma). Postgres de teste, worker
 * de verdade e executor falso determinístico; nenhuma chamada ao Codex.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import type pg from 'pg';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { validarVisual, type AncoraV1, type Bloco, type CanonicoV1, type VisualV1 } from '@margem/contratos';
import { canonicoDeTeste, comBanco } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import { criarExecutorFalso, pngDeTeste, type PassoRoteiro } from '../executor/fake.js';
import type { PedidoExecucao, ResultadoExecutor } from '../executor/tipos.js';
import { criarApi } from '../http/app.js';
import * as documentos from '../repos/documentos.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { Worker } from '../worker/worker.js';
import { dimensoesDoPng } from './arquivos.js';
import { erroDoDiagrama, manipuladoresDosVisuais, resolverNos } from './manipuladores.js';

const temporarios: string[] = [];
let dados = '';
beforeEach(async () => { dados = await mkdtemp(join(tmpdir(), 'margem-j70-dados-')); temporarios.push(dados); process.env.MARGEM_DADOS = dados; });
afterEach(async () => { delete process.env.MARGEM_DADOS; for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true }); });

const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };
function escrever(api: Hono, metodo: string, caminho: string, dado?: unknown): Promise<Response> {
  return Promise.resolve(api.request(caminho, { method: metodo, headers: ESCRITA, ...(dado === undefined ? {} : { body: JSON.stringify(dado) }) }));
}
function ancora(versaoId: string, bloco: Bloco, citacao: string): AncoraV1 {
  const inicio = bloco.texto.indexOf(citacao);
  return { versao_id: versaoId, bloco_id: bloco.id, inicio_utf16: inicio, fim_utf16: inicio + citacao.length,
    citacao, prefixo: bloco.texto.slice(Math.max(0, inicio - 10), inicio), sufixo: bloco.texto.slice(inicio + citacao.length, inicio + citacao.length + 10) };
}

const SONETO = [
  { tipo: 'capitulo' as const, texto: 'Soneto de teste' },
  { tipo: 'estrofe' as const, texto: 'Amor é fogo que arde sem se ver,\né ferida que dói, e não se sente;' },
  { tipo: 'estrofe' as const, texto: 'é um contentamento descontente,\né dor que desatina sem doer.' },
  { tipo: 'estrofe' as const, texto: 'É um não querer mais que bem querer;\né um andar solitário entre a gente;' },
];

async function preparar(banco: pg.Pool): Promise<{ canonico: CanonicoV1; versaoId: string; secaoId: string }> {
  const canonico = canonicoDeTeste({ titulo: 'Sonetos de teste', blocos: SONETO, secoes: [{ nivel: 1, inicio: 0, fim: 3 }] });
  const versaoId = await comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'soneto.md' });
    return (await documentos.criarVersao(cliente, documento.id, canonico)).id;
  });
  return { canonico, versaoId, secaoId: canonico.secoes[0]!.id };
}

function montar(banco: pg.Pool, passos: PassoRoteiro[], depois?: (resultado: ResultadoExecutor) => Promise<ResultadoExecutor>) {
  const pedidos: PedidoExecucao[] = [];
  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); }, intervaloEventosMs: 20 });
  const falso = criarExecutorFalso({ versao: 1, passos });
  const artefatos = join(dados, 'artefatos');
  const executor = async (pedido: PedidoExecucao) => {
    pedidos.push(pedido);
    const resultado = await falso({ ...pedido, diretorioArtefatos: artefatos });
    return depois === undefined ? resultado : depois(resultado);
  };
  const rodar = async (ciclos = 1) => {
    const slots = await mkdtemp(join(tmpdir(), 'margem-j70-slots-'));
    temporarios.push(slots);
    await new Worker({ fila: new FilaPostgres(banco), manipuladores: manipuladoresDosVisuais({ banco, executor, modelo: 'modelo-de-teste', esforco: 'medium', prazoMs: 10_000, diretorioArtefatos: artefatos }),
      slots: 1, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: ciclos, heartbeatMs: 60_000 }).rodar();
  };
  return { api, pedidos, rodar };
}

async function listar(api: Hono, versaoId: string, secaoId: string): Promise<VisualV1[]> {
  const resposta = await api.request(`/api/versoes/${versaoId}/capitulos/${secaoId}/visuais`);
  expect(resposta.status).toBe(200);
  const { visuais } = await resposta.json() as { visuais: VisualV1[] };
  for (const visual of visuais) expect(validarVisual(visual), JSON.stringify(validarVisual.errors)).toBe(true);
  return visuais;
}

test('imagem de um trecho com pedido: fila → Codex (falso) → PNG por hash servido pela API', async () => comBanco('j70_imagem', async (banco) => {
  const { canonico, versaoId, secaoId } = await preparar(banco);
  const { api, pedidos, rodar } = montar(banco, [{ quando: { ordem: 1 }, tipo: 'ok', conteudo: { descricao: 'Um coração em chamas numa gravura.' } }]);
  const trecho = ancora(versaoId, canonico.blocos[1]!, 'Amor é fogo que arde sem se ver');
  const criado = await escrever(api, 'POST', '/api/visuais', { tipo: 'imagem', versao_id: versaoId, secao_id: secaoId, alvo: { tipo: 'trecho', ancora: trecho }, pedido: '  Gravura em metal, sem texto.  ' });
  expect(criado.status).toBe(201);
  const { visual } = await criado.json() as { visual: VisualV1 };
  expect(visual).toMatchObject({ estado: 'pendente', tipo: 'imagem', pedido: 'Gravura em metal, sem texto.', alvo: { tipo: 'trecho' } });
  expect((await listar(api, versaoId, secaoId)).map((v) => v.estado)).toEqual(['pendente']);

  await rodar();
  expect(pedidos).toHaveLength(1);
  expect(pedidos[0]).toMatchObject({ gerarImagem: true, esforco: 'medium' });
  expect(pedidos[0]!.prompt).toContain('Amor é fogo que arde sem se ver');
  expect(pedidos[0]!.prompt).toContain('Gravura em metal, sem texto.');
  expect(pedidos[0]!.prompt).toContain('"Sonetos de teste"');
  expect(pedidos[0]!.prompt).toContain('"Soneto de teste"');
  expect(pedidos[0]!.prompt).toContain('é ferida que dói, e não se sente;');
  expect(pedidos[0]!.prompt).toContain('Nada de texto escrito na imagem');

  const [pronto] = await listar(api, versaoId, secaoId);
  expect(pronto).toMatchObject({ estado: 'pronto', artefato: { tipo: 'png', largura: 9, altura: 6, descricao: 'Um coração em chamas numa gravura.' }, execucao: { modelo: 'modelo-de-teste', esforco: 'medium' } });
  const artefato = pronto!.artefato!;
  if (artefato.tipo !== 'png') throw new Error('esperava png');
  const png = await api.request(`/api/visuais/${pronto!.id}/imagem`);
  expect(png.status).toBe(200);
  expect(png.headers.get('content-type')).toBe('image/png');
  expect(png.headers.get('etag')).toBe(`"${artefato.sha256}"`);
  const bytes = Buffer.from(await png.arrayBuffer());
  expect(bytes.equals(pngDeTeste(9, 6, 10))).toBe(true);
  expect(dimensoesDoPng(bytes)).toEqual({ largura: 9, altura: 6 });
  expect(await readFile(join(dados, 'visuais', `${artefato.sha256}.png`))).toEqual(bytes);
  expect((await api.request(`/api/visuais/${pronto!.id}/imagem`, { headers: { 'If-None-Match': `"${artefato.sha256}"` } })).status).toBe(304);
}));

test('quadro do poema (capítulo) sem imagem gerada falha legível; gerar de novo cria versão nova e a anterior fica; excluir é explícito', async () => comBanco('j70_regerar', async (banco) => {
  const { versaoId, secaoId } = await preparar(banco);
  const { api, pedidos, rodar } = montar(banco, [
    { quando: { ordem: 1 }, tipo: 'ok', conteudo: { descricao: 'Nada.' }, imagens: 0 },
    { quando: { ordem: 2 }, tipo: 'ok', conteudo: { descricao: 'Um quadro do soneto inteiro.' }, imagens: 2 },
  ]);
  const { visual } = await (await escrever(api, 'POST', '/api/visuais', { tipo: 'imagem', versao_id: versaoId, secao_id: secaoId, alvo: { tipo: 'capitulo' } })).json() as { visual: VisualV1 };
  await rodar();
  expect(pedidos[0]!.prompt).toContain('o poema inteiro');
  expect(pedidos[0]!.prompt).toContain('É um não querer mais que bem querer;');
  const [falhou] = await listar(api, versaoId, secaoId);
  expect(falhou).toMatchObject({ id: visual.id, estado: 'falhou', motivo: 'O Codex terminou sem gerar imagem.' });
  expect((await api.request(`/api/visuais/${visual.id}/imagem`)).status).toBe(404);

  const novo = await escrever(api, 'POST', `/api/visuais/${visual.id}/regenerar`, { pedido: 'Óleo sobre tela.' });
  expect(novo.status).toBe(201);
  const { visual: segundo } = await novo.json() as { visual: VisualV1 };
  expect(segundo).toMatchObject({ substitui: visual.id, pedido: 'Óleo sobre tela.', alvo: { tipo: 'capitulo' }, estado: 'pendente' });
  // Em curso não se regenera de novo.
  expect((await escrever(api, 'POST', `/api/visuais/${segundo.id}/regenerar`, {})).status).toBe(409);
  await rodar();
  const depois = await listar(api, versaoId, secaoId);
  expect(depois.map((v) => [v.id, v.estado])).toEqual([[visual.id, 'falhou'], [segundo.id, 'pronto']]);
  expect(depois[1]!.diagnosticos).toEqual([{ codigo: 'varias_imagens', mensagem: 'O Codex gerou 2 imagens; ficou a última.' }]);

  expect((await escrever(api, 'DELETE', `/api/visuais/${visual.id}`)).status).toBe(200);
  expect((await escrever(api, 'DELETE', `/api/visuais/${visual.id}`)).status).toBe(404);
  expect((await listar(api, versaoId, secaoId)).map((v) => v.id)).toEqual([segundo.id]);
}));

test('imagem gerada que não pode ser guardada falha como publicação, com a causa, e não como "sem imagem" (V-W1)', async () => comBanco('j130_publicacao', async (banco) => {
  const { versaoId, secaoId } = await preparar(banco);
  const { api, rodar } = montar(banco, [{ quando: { ordem: 1 }, tipo: 'ok', conteudo: { descricao: 'Um quadro.' } }], async (resultado) => {
    // O Codex gerou, mas o arquivo chega estragado ao guardar (no Windows era o EPERM do fsync).
    if (resultado.estado === 'ok') for (const imagem of resultado.imagens ?? []) await writeFile(imagem, 'não é png');
    return resultado;
  });
  const { visual } = await (await escrever(api, 'POST', '/api/visuais', { tipo: 'imagem', versao_id: versaoId, secao_id: secaoId, alvo: { tipo: 'capitulo' } })).json() as { visual: VisualV1 };
  await rodar();
  const [falhou] = await listar(api, versaoId, secaoId);
  expect(falhou).toMatchObject({ id: visual.id, estado: 'falhou' });
  expect(falhou!.motivo).toBe('A imagem foi gerada, mas não pôde ser guardada: O arquivo gerado não é PNG.');
  const { rows: [job] } = await banco.query<{ error_code: string }>('SELECT j.error_code FROM visual v JOIN job j ON j.id = v.job_id WHERE v.id = $1', [visual.id]);
  expect(job!.error_code).toBe('publicacao');
}));

test('fluxograma do capítulo: Mermaid recusado ganha uma segunda chamada com o erro; citações viram âncoras ou diagnósticos', async () => comBanco('j70_diagrama', async (banco) => {
  const { canonico, versaoId, secaoId } = await preparar(banco);
  const [, b1, b2, b3] = canonico.blocos;
  const nos = [
    { id: 'A', rotulo: 'Amor como fogo', citacao: { bloco_id: b1!.id, texto: 'Amor é fogo que arde sem se ver' } },
    { id: 'B', rotulo: 'Paradoxo', citacao: { bloco_id: b2!.id, texto: 'é' } },
    { id: 'C', rotulo: 'Solidão', citacao: { bloco_id: b3!.id, texto: 'não está no bloco' } },
    { id: 'D', rotulo: 'Síntese', citacao: null },
  ];
  const { api, pedidos, rodar } = montar(banco, [
    { quando: { ordem: 1 }, tipo: 'ok', conteudo: { titulo: 'Ideias', codigo: 'flowchart LR\n A --> B', nos } },
    { quando: { ordem: 2 }, tipo: 'ok', conteudo: { titulo: 'As contradições do amor', codigo: 'flowchart TD\n  A["Amor como fogo"] --> B["Paradoxo"]\n  B --> C["Solidão"]\n  C ==> D(["Síntese"])', nos } },
  ]);
  expect((await escrever(api, 'POST', '/api/visuais', { tipo: 'diagrama', versao_id: versaoId, secao_id: secaoId, alvo: { tipo: 'capitulo' }, pedido: 'Destaque as contradições.' })).status).toBe(201);
  await rodar();
  expect(pedidos).toHaveLength(2);
  expect(pedidos[0]!.gerarImagem).toBeUndefined();
  expect(pedidos[0]!.prompt).toContain(`⟦b:${b1!.id}⟧`);
  expect(pedidos[0]!.prompt).not.toContain('Correção pedida');
  expect(pedidos[1]!.prompt).toContain('Correção pedida');
  expect(pedidos[1]!.prompt).toContain('flowchart LR');
  const schema = JSON.parse(await readFile(pedidos[0]!.schema, 'utf8').catch(() => '{}')) as unknown;
  expect(schema).toBeDefined();
  const [visual] = await listar(api, versaoId, secaoId);
  expect(visual!.estado).toBe('pronto');
  const artefato = visual!.artefato!;
  if (artefato.tipo !== 'mermaid') throw new Error('esperava mermaid');
  expect(artefato.titulo).toBe('As contradições do amor');
  expect(artefato.nos[0]!.ancora).toMatchObject({ bloco_id: b1!.id, inicio_utf16: 0, citacao: 'Amor é fogo que arde sem se ver' });
  expect(artefato.nos.slice(1).map((no) => no.ancora)).toEqual([undefined, undefined, undefined]);
  expect(visual!.diagnosticos.map((d) => d.codigo)).toEqual(['mermaid_corrigido', 'citacao_ambigua', 'citacao_ausente']);
}));

test('fluxograma inválido duas vezes: falha visível; cota adia sem gastar tentativa', async () => comBanco('j70_falhas', async (banco) => {
  const { canonico, versaoId, secaoId } = await preparar(banco);
  const ruim = { titulo: 'x', codigo: 'flowchart TD\n A --> B\n click A "javascript:alert(1)"', nos: [{ id: 'A', rotulo: 'a', citacao: null }, { id: 'B', rotulo: 'b', citacao: null }] };
  const { api, pedidos, rodar } = montar(banco, [
    { quando: { ordem: 1 }, tipo: 'ok', conteudo: ruim },
    { quando: { ordem: 2 }, tipo: 'ok', conteudo: ruim },
    { quando: { ordem: 3 }, tipo: 'cota', not_before: '2099-01-01T00:00:00.000Z' },
  ]);
  const trecho = ancora(versaoId, canonico.blocos[2]!, 'é dor que desatina sem doer.');
  await escrever(api, 'POST', '/api/visuais', { tipo: 'diagrama', versao_id: versaoId, secao_id: secaoId, alvo: { tipo: 'trecho', ancora: trecho } });
  await rodar();
  expect(pedidos).toHaveLength(2);
  const [falhou] = await listar(api, versaoId, secaoId);
  expect(falhou!.estado).toBe('falhou');
  expect(falhou!.motivo).toMatch(/inválido duas vezes.*linha 3: "click" não é aceito/u);

  const bloco = canonico.blocos[3]!;
  const inteira = { versao_id: versaoId, bloco_id: bloco.id, inicio_utf16: 0, fim_utf16: bloco.texto.length, citacao: bloco.texto, prefixo: '', sufixo: '' };
  const { visual } = await (await escrever(api, 'POST', '/api/visuais', { tipo: 'imagem', versao_id: versaoId, secao_id: secaoId, alvo: { tipo: 'bloco', ancora: inteira } })).json() as { visual: VisualV1 };
  await rodar();
  expect(pedidos[2]!.prompt).toContain('a estrofe inteira');
  const adiado = (await listar(api, versaoId, secaoId)).find((v) => v.id === visual.id)!;
  expect(adiado.estado).toBe('pendente');
  expect(adiado.diagnosticos[0]).toMatchObject({ codigo: 'adiado' });
}));

test('a API recusa pedidos fora do texto, do contrato ou com campos desconhecidos', async () => comBanco('j70_recusas', async (banco) => {
  const { canonico, versaoId, secaoId } = await preparar(banco);
  const { api } = montar(banco, []);
  const bloco = canonico.blocos[1]!;
  const trecho = ancora(versaoId, bloco, 'fogo');
  const base = { tipo: 'imagem', versao_id: versaoId, secao_id: secaoId, alvo: { tipo: 'trecho', ancora: trecho } };
  const status = async (corpo: unknown) => (await escrever(api, 'POST', '/api/visuais', corpo)).status;
  expect(await status({ ...base, extra: 1 })).toBe(400);
  expect(await status({ ...base, tipo: 'video' })).toBe(400);
  expect(await status({ ...base, pedido: 'x'.repeat(2001) })).toBe(400);
  expect(await status({ ...base, alvo: { tipo: 'capitulo', ancora: trecho } })).toBe(400);
  expect(await status({ ...base, alvo: { tipo: 'trecho', ancora: { ...trecho, citacao: 'fogO' } } })).toBe(422);
  expect(await status({ ...base, alvo: { tipo: 'bloco', ancora: trecho } })).toBe(422);
  expect(await status({ ...base, secao_id: canonico.blocos[0]!.id })).toBe(404);
  expect(await status(base)).toBe(201);
  expect((await escrever(api, 'POST', `/api/visuais/${'0'.repeat(26)}/regenerar`, {})).status).toBe(404);
  expect((await escrever(api, 'POST', '/api/visuais', { ...base, alvo: { tipo: 'trecho', ancora: { ...trecho, versao_id: '0'.repeat(26) } } })).status).toBe(422);
}));

test('resolução de nós e conferência do diagrama são puras', () => {
  const bloco = { id: '01K0000000000000000000B001', ordem: 0, tipo: 'paragrafo' as const, texto: 'a razão e a razão', inline: [], origens: [] };
  const mapa = new Map<string, Bloco>([[bloco.id, bloco]]);
  const r = resolverNos({ titulo: 't', codigo: '', nos: [
    { id: 'A', rotulo: ' ', citacao: { bloco_id: bloco.id, texto: 'a razão e' } },
    { id: 'B', rotulo: 'b', citacao: { bloco_id: bloco.id, texto: 'razão' } },
    { id: 'C', rotulo: 'c', citacao: { bloco_id: '01K0000000000000000000B999', texto: 'x' } },
  ] }, mapa, new Set([bloco.id]), '01K0000000000000000000V001');
  expect(r.nos[0]).toMatchObject({ id: 'A', rotulo: 'A', ancora: { inicio_utf16: 0, fim_utf16: 9 } });
  expect(r.diagnosticos.map((d) => d.codigo)).toEqual(['citacao_ambigua', 'citacao_fora_do_texto']);
  expect(erroDoDiagrama({ titulo: 't', codigo: 'flowchart TD\nA --> B', nos: [{ id: 'A', rotulo: 'a', citacao: null }] })).toBe('nós do código ausentes de `nos`: B');
  expect(erroDoDiagrama({ titulo: 't', codigo: 'flowchart TD\nA', nos: [{ id: 'A', rotulo: 'a', citacao: null }, { id: 'Z', rotulo: 'z', citacao: null }] })).toBe('nós de `nos` ausentes do código: Z');
  expect(erroDoDiagrama({ titulo: 't', codigo: 'flowchart TD\nA', nos: [{ id: 'A', rotulo: 'a', citacao: null }] })).toBeNull();
});
