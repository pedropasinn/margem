/**
 * J34 na API: recortar um exercício, resolvê-lo passo a passo e perguntar sobre a resolução, com o
 * worker e o executor falso (nenhuma chamada ao Codex).
 */
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { ResolucaoGeradaV1, ResolucaoV2 } from '@margem/contratos';
import { canonicoDeTeste, comBanco } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import { criarExecutorFalso } from '../executor/fake.js';
import type { PedidoExecucao } from '../executor/tipos.js';
import * as documentos from '../repos/documentos.js';
import { manipuladoresDaResolucao } from '../resolucao/pipeline.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { Worker } from '../worker/worker.js';
import { criarApi } from './app.js';

const temporarios: string[] = [];
let dadosAntes: string | undefined;
beforeEach(async () => {
  dadosAntes = process.env.MARGEM_DADOS;
  const dados = await mkdtemp(join(tmpdir(), 'margem-resolucao-dados-'));
  temporarios.push(dados);
  process.env.MARGEM_DADOS = dados;
});
afterEach(async () => {
  if (dadosAntes === undefined) delete process.env.MARGEM_DADOS; else process.env.MARGEM_DADOS = dadosAntes;
  for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true });
});

const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };
function escrever(api: Hono, metodo: string, caminho: string, dado?: unknown): Promise<Response> {
  return Promise.resolve(api.request(caminho, { method: metodo, headers: ESCRITA, ...(dado === undefined ? {} : { body: JSON.stringify(dado) }) }));
}
async function ler<T>(api: Hono, caminho: string): Promise<T> {
  const resposta = await api.request(caminho);
  expect(resposta.status, caminho).toBe(200);
  return await resposta.json() as T;
}

/** Um PNG de 1 × 1 pixel. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const RESOLUCAO: ResolucaoGeradaV1 = {
  enunciado: 'Resolva 2x + 3 = 11.', legibilidade: 'boa',
  itens: [{ rotulo: '', enunciado: '2x + 3 = 11', estrategia: 'Isolar x.',
    passos: [{ texto: 'Subtraia 3 dos dois lados.', calculo: '2x = 8' }, { texto: 'Divida por 2.', calculo: 'x = 4' }],
    resposta: 'x = 4', verificacao: '2·4 + 3 = 11' }],
  conceitos: ['equação do 1º grau'], observacao: null,
};

test('recortar, resolver passo a passo e perguntar sobre a resolução', async () => comBanco('resolucao_api', async (banco) => {
  const canonico = canonicoDeTeste({ titulo: 'Álgebra', blocos: [{ tipo: 'paragrafo', texto: '3. Resolva 2x + 3 = 11.' }], secoes: [] });
  const documento = await comTransacao(banco, async (cliente) => {
    const criado = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/algebra.txt' });
    await documentos.criarVersao(cliente, criado.id, canonico);
    return criado;
  });
  const artefatos = await mkdtemp(join(tmpdir(), 'margem-resolucao-art-'));
  const slots = await mkdtemp(join(tmpdir(), 'margem-resolucao-slots-'));
  temporarios.push(artefatos, slots);
  const pedidos: { pedido: PedidoExecucao; imagemNaEntrada: boolean }[] = [];
  const falso = criarExecutorFalso({ versao: 1, passos: [
    { quando: { ordem: 1 }, tipo: 'ok', conteudo: RESOLUCAO },
    { quando: { ordem: 2 }, tipo: 'ok', conteudo: { texto: 'Para manter a igualdade: o mesmo dos dois lados.', passos: [{ texto: 'Balança em equilíbrio.', calculo: null }] } },
  ] });
  const executor = (pedido: PedidoExecucao) => {
    pedidos.push({ pedido, imagemNaEntrada: existsSync(join(pedido.diretorioEntrada, 'recorte.png')) });
    return falso({ ...pedido, diretorioArtefatos: artefatos });
  };
  const config = { banco, executor, modelo: 'modelo-de-teste', esforco: 'alto', esforcoDaExplicacao: 'medio', prazoMs: 10_000 };
  const rodar = () => new Worker({ fila: new FilaPostgres(banco), manipuladores: manipuladoresDaResolucao(config), slots: 1, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: 1, heartbeatMs: 60_000 }).rodar();
  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); }, intervaloEventosMs: 20 });

  // Recortes inválidos são recusados antes de gravar qualquer coisa.
  const url = `/api/documentos/${documento.id}/resolucoes`;
  const recorte = { tipo: 'recorte', pagina: 3, retangulo: { x: 0.1, y: 0.2, largura: 0.8, altura: 0.3 }, imagem_png: PNG };
  expect((await escrever(api, 'POST', url, { origem: { ...recorte, imagem_png: Buffer.from('não é png').toString('base64') } })).status).toBe(400);
  expect((await escrever(api, 'POST', url, { origem: { ...recorte, retangulo: { x: 0.5, y: 0, largura: 0.8, altura: 0.2 } } })).status).toBe(422);
  expect((await escrever(api, 'POST', url, { origem: recorte, extra: 1 })).status).toBe(400);

  const criada = await escrever(api, 'POST', url, { origem: recorte, texto_extraido: '3. Resolva 2x + 3 = 11.' });
  expect(criada.status).toBe(201);
  const { resolucao } = await criada.json() as { resolucao: ResolucaoV2 };
  expect(resolucao.origem).toMatchObject({ tipo: 'recorte', pagina: 3 });
  expect((await api.request(`/api/resolucoes/${resolucao.id}/imagem`)).headers.get('content-type')).toBe('image/png');
  expect((await ler<{ estado: string }>(api, `/api/resolucoes/${resolucao.id}`)).estado).toBe('resolvendo');
  // Perguntar antes da resolução ficar pronta: não.
  expect((await escrever(api, 'POST', `/api/resolucoes/${resolucao.id}/perguntas`, { texto: 'E aí?' })).status).toBe(409);

  await rodar();
  expect(pedidos[0]?.pedido.imagens).toEqual(['recorte.png']);
  expect(pedidos[0]?.imagemNaEntrada).toBe(true);
  expect(pedidos[0]?.pedido.esforco).toBe('alto');
  expect(pedidos[0]?.pedido.prompt).toContain('3. Resolva 2x + 3 = 11.');
  const pronta = await ler<{ resolucao: ResolucaoV2; estado: string }>(api, `/api/resolucoes/${resolucao.id}`);
  expect(pronta.estado).toBe('pronta');
  expect(pronta.resolucao.resolucao?.itens[0]?.passos).toHaveLength(2);
  expect(pronta.resolucao.execucao).toEqual({ modelo: 'modelo-de-teste', esforco: 'alto' });

  const pergunta = await escrever(api, 'POST', `/api/resolucoes/${resolucao.id}/perguntas`, { texto: 'Por que subtrair 3 dos dois lados?' });
  expect(pergunta.status).toBe(202);
  expect((await escrever(api, 'POST', `/api/resolucoes/${resolucao.id}/perguntas`, { texto: 'E outra?' })).status).toBe(409);
  await rodar();
  expect(pedidos[1]?.pedido.esforco).toBe('medio');
  expect(pedidos[1]?.pedido.prompt).toContain('Passo 1: Subtraia 3 dos dois lados.');
  const respondida = await ler<{ resolucao: ResolucaoV2; estado: string }>(api, `/api/resolucoes/${resolucao.id}`);
  expect(respondida.estado).toBe('pronta');
  expect(respondida.resolucao.mensagens.map((mensagem) => mensagem.autor)).toEqual(['leitor', 'ia']);

  // Um trecho do texto também vira sessão (sem imagem).
  const bloco = canonico.blocos[0];
  if (!bloco) throw new Error('bloco');
  const trecho = await escrever(api, 'POST', url, { origem: { tipo: 'trecho', ancora: {
    versao_id: canonico.blocos.length > 0 ? (await ler<{ versao_id: string }>(api, `/api/documentos/${documento.id}`)).versao_id : '',
    bloco_id: bloco.id, inicio_utf16: 0, fim_utf16: bloco.texto.length, citacao: bloco.texto, prefixo: '', sufixo: '' } } });
  expect(trecho.status).toBe(201);
  const lista = await ler<{ resolucoes: { resolucao: ResolucaoV2; estado: string }[] }>(api, url);
  expect(lista.resolucoes.map((item) => [item.resolucao.origem.tipo, item.estado])).toEqual([['trecho', 'resolvendo'], ['recorte', 'pronta']]);

  // Remover: a pronta sai da lista; remover de novo dá 404. A que está resolvendo também sai (V-T8): o
  // job do Codex é cancelado antes e nada dela fica.
  const { resolucao: doTrecho } = await trecho.json() as { resolucao: ResolucaoV2 };
  expect((await escrever(api, 'DELETE', `/api/resolucoes/${resolucao.id}`, undefined)).status).toBe(204);
  expect((await escrever(api, 'DELETE', `/api/resolucoes/${resolucao.id}`, undefined)).status).toBe(404);
  const depois = await ler<{ resolucoes: { resolucao: ResolucaoV2 }[] }>(api, url);
  expect(depois.resolucoes.map((item) => item.resolucao.id)).toEqual([doTrecho.id]);
  expect((await escrever(api, 'DELETE', `/api/resolucoes/${doTrecho.id}`, undefined)).status).toBe(204);
  expect((await ler<{ resolucoes: unknown[] }>(api, url)).resolucoes).toEqual([]);
  expect((await banco.query("SELECT 1 FROM job WHERE dedup_key=$1 AND estado IN ('fila','reservado','adiado')", [`resolver:${doTrecho.id}`])).rowCount).toBe(0);
}));
