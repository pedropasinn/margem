/**
 * J30 na API: compreensão do capítulo de ponta a ponta pelas rotas, com o worker e o executor falso.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { afterEach, expect, test } from 'vitest';
import {
  validarApresentacao, validarConexaoV2, validarConexaoV3, type ApresentacaoDoPlanoV1, type ExecucaoCompreensaoV1, type ModeloDoCapituloV1, type PlanoPedagogicoV1,
} from '@margem/contratos';
import { canonicoDeTeste, comBanco } from '../../testes/apoio.js';
import { configurar, livro, rodarUm } from '../../testes/compreensao.js';
import { comTransacao } from '../db/transacao.js';
import * as conexoesRepo from '../repos/conexoes.js';
import * as documentos from '../repos/documentos.js';
import { criarApi } from './app.js';

const temporarios: string[] = [];
afterEach(async () => { for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true }); });

const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };
function escrever(api: Hono, metodo: string, caminho: string, dado?: unknown): Promise<Response> {
  return Promise.resolve(api.request(caminho, { method: metodo, headers: ESCRITA, ...(dado === undefined ? {} : { body: JSON.stringify(dado) }) }));
}
async function ler<T>(api: Hono, caminho: string): Promise<T> {
  const resposta = await api.request(caminho);
  expect(resposta.status, caminho).toBe(200);
  return await resposta.json() as T;
}

interface Capitulos { capitulos: { secao_id: string; titulo: string; estado: string; visivel: string; plano_id: string | null }[] }
interface Relacoes { relacoes: { relacao: { id: string; tipo: string; retrospectiva: boolean }; relevante: boolean; conexao_id: string | null }[] }

test('criar, preparar, acompanhar, ver relações, adotar, apresentar e trocar o perfil', async () => comBanco('compreensao_api', async (banco) => {
  const canonico = livro();
  const documento = await comTransacao(banco, async (cliente) => {
    const criado = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
    await documentos.criarVersao(cliente, criado.id, canonico);
    return criado;
  });
  const { config, auditoria } = await configurar(banco, temporarios);
  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura V2 não usada.'); }, compreensao: () => config, intervaloEventosMs: 20, recursos: new Set(['eink'] as const) });

  expect((await escrever(api, 'POST', `/api/documentos/${documento.id}/compreensoes`, { modo_de_leitura: 'x' })).status).toBe(400);
  expect((await escrever(api, 'POST', `/api/documentos/${documento.id}/compreensoes`, { modo_de_leitura: { id: 'nenhum', revisao: 1 } })).status).toBe(422);
  const criada = await escrever(api, 'POST', `/api/documentos/${documento.id}/compreensoes`, { modo_de_leitura: { id: 'argumentativa', revisao: 1 } });
  expect(criada.status).toBe(201);
  const { compreensao } = await criada.json() as { compreensao: ExecucaoCompreensaoV1 };
  expect((await ler<{ compreensoes: ExecucaoCompreensaoV1[] }>(api, `/api/documentos/${documento.id}/compreensoes`)).compreensoes.map((item) => item.id)).toEqual([compreensao.id]);

  const inicio = await ler<Capitulos>(api, `/api/compreensoes/${compreensao.id}/capitulos`);
  expect(inicio.capitulos.map((item) => [item.titulo, item.visivel])).toEqual([['Capítulo um', 'nao_preparado'], ['Capítulo dois', 'nao_preparado']]);
  const [cap1, cap2] = inicio.capitulos;
  if (!cap1 || !cap2) throw new Error('dois capítulos');

  const pedido = await escrever(api, 'POST', `/api/compreensoes/${compreensao.id}/capitulos/${cap1.secao_id}/preparar`);
  expect(pedido.status).toBe(202);
  expect(await pedido.json()).toMatchObject({ seguinte: cap2.secao_id, visivel: 'preparando' });
  expect((await escrever(api, 'GET', `/api/compreensoes/${compreensao.id}/capitulos/${cap1.secao_id}/relacoes`)).status).toBe(409);

  const slots = await mkdtemp(join(tmpdir(), 'margem-compreensao-api-slots-'));
  temporarios.push(slots);
  for (let i = 0; i < 4; i += 1) await rodarUm(banco, config, auditoria, slots);
  const depois = await ler<Capitulos>(api, `/api/compreensoes/${compreensao.id}/capitulos`);
  expect(depois.capitulos.map((item) => item.visivel)).toEqual(['pronto', 'preparando']);

  const capitulo = await ler<{ visivel: string; modelo: ModeloDoCapituloV1; plano: PlanoPedagogicoV1; plano_do_perfil_atual: boolean }>(
    api, `/api/compreensoes/${compreensao.id}/capitulos/${cap1.secao_id}`);
  expect(capitulo).toMatchObject({ visivel: 'pronto', plano_do_perfil_atual: true });
  expect(capitulo.modelo.revisao).toBe(2);
  const revisoes = await ler<{ revisoes: ModeloDoCapituloV1[]; lotes: unknown[] }>(api, `/api/compreensoes/${compreensao.id}/capitulos/${cap1.secao_id}/revisoes`);
  expect(revisoes.revisoes).toHaveLength(3);
  expect(revisoes.lotes).toHaveLength(2);

  // As marcas projetadas não cabem no lote V1: remover e desfazer pelo balão vão direto à marca.
  const projetada = (await banco.query<{ id: string }>("SELECT id FROM marca WHERE origem='projecao' ORDER BY id LIMIT 1")).rows[0]?.id ?? '';
  expect(projetada).not.toBe('');
  const removida = await escrever(api, 'PATCH', `/api/marcas/${projetada}`, { avaliacao: 'rejeitada' });
  expect(removida.status).toBe(200);
  expect(await removida.json()).toMatchObject({ estado: 'aplicado', marca: { id: projetada, avaliacao: 'rejeitada' } });
  expect(await (await escrever(api, 'PATCH', `/api/marcas/${projetada}`, { avaliacao: 'nao_avaliada' })).json()).toMatchObject({ marca: { avaliacao: 'nao_avaliada' } });
  expect(await (await escrever(api, 'PATCH', `/api/marcas/${projetada}`, { visivel: false })).json()).toMatchObject({ marca: { visivel: false } });
  expect((await escrever(api, 'PATCH', `/api/marcas/${projetada}`, { visivel: true, avaliacao: 'confirmada' })).status).toBe(400);

  // Tempos: o capítulo 1 foi medido (4 jobs publicados); o 2 é estimado pela taxa do 1; a simulação diz quanto se esperaria.
  const tempos = await ler<{ capitulos: { titulo: string; jobs: number; estimado: boolean; preparo_s: number | null; leitura_s: number }[]; simulacoes: { profundidade: number; esperas_s: number[] }[]; recomendada: { profundidade: number } | null; profundidade_atual: number }>(
    api, `/api/compreensoes/${compreensao.id}/tempos`);
  expect(tempos.capitulos.map((item) => [item.titulo, item.jobs, item.estimado])).toEqual([['Capítulo um', 4, false], ['Capítulo dois', 0, true]]);
  expect(tempos.capitulos.every((item) => item.preparo_s !== null && item.leitura_s > 0)).toBe(true);
  expect(tempos.simulacoes.map((item) => item.profundidade)).toEqual([0, 1, 2, 3]);
  expect(tempos.simulacoes.every((item) => item.esperas_s.length === 2)).toBe(true);
  expect(tempos.profundidade_atual).toBe(1);
  expect((await escrever(api, 'GET', `/api/compreensoes/${compreensao.id}/tempos?segundos_por_mil=-1`)).status).toBe(400);

  // Relações: a retrospectiva é relevante; a de exemplo (ponta rebaixada a 3) só aparece em "todas".
  const relevantes = await ler<Relacoes>(api, `/api/compreensoes/${compreensao.id}/capitulos/${cap1.secao_id}/relacoes`);
  expect(relevantes.relacoes.map((item) => item.relacao.tipo)).toEqual(['pressupoe']);
  const todas = await ler<Relacoes>(api, `/api/compreensoes/${compreensao.id}/capitulos/${cap1.secao_id}/relacoes?filtro=todas`);
  expect(todas.relacoes.map((item) => [item.relacao.tipo, item.relevante]).sort()).toEqual([['exemplifica', false], ['pressupoe', true]]);
  expect((await escrever(api, 'GET', `/api/compreensoes/${compreensao.id}/capitulos/${cap1.secao_id}/relacoes?filtro=x`)).status).toBe(400);

  // Adotar cria uma conexão do leitor; adotar de novo devolve a mesma.
  const retrospectiva = relevantes.relacoes[0]?.relacao.id ?? '';
  const adotar = `/api/compreensoes/${compreensao.id}/capitulos/${cap1.secao_id}/relacoes/${retrospectiva}/adotar`;
  const primeira = await escrever(api, 'POST', adotar);
  expect(primeira.status).toBe(201);
  const { conexao_id } = await primeira.json() as { conexao_id: string };
  expect((await escrever(api, 'POST', adotar)).status).toBe(200);
  const conexao = await comTransacao(banco, (cliente) => conexoesRepo.obter(cliente, conexao_id));
  expect(validarConexaoV2(conexao)).toBe(true);
  expect(conexao).toMatchObject({ autor: 'leitor', estado: 'aceita', relacao: 'prerequisito', justificativa: 'A conclusão usa a rigidez.' });
  // Sem perda: a conexão guarda o tipo fino e a relação de onde veio (ConexaoV3).
  const v3 = await comTransacao(banco, (cliente) => conexoesRepo.obterV3(cliente, conexao_id));
  expect(validarConexaoV3(v3), JSON.stringify(validarConexaoV3.errors)).toBe(true);
  expect(v3).toMatchObject({ versao: 3, relacao: 'prerequisito', relacao_semantica: 'pressupoe', origem_compreensao: { relacao_id: retrospectiva } });
  expect((await ler<Relacoes>(api, `/api/compreensoes/${compreensao.id}/capitulos/${cap1.secao_id}/relacoes`)).relacoes[0]?.conexao_id).toBe(conexao_id);

  // Apresentação: os três dispositivos, os mesmos passos.
  for (const dispositivo of ['desktop', 'eink', 'audio']) {
    const { apresentacao } = await ler<{ apresentacao: ApresentacaoDoPlanoV1 }>(api, `/api/planos/${capitulo.plano.id}/apresentacao?dispositivo=${dispositivo}`);
    expect(validarApresentacao(apresentacao)).toBe(true);
    expect([...new Set(apresentacao.telas.map((tela) => tela.passo))]).toEqual([0, 1]);
  }
  expect((await escrever(api, 'GET', `/api/planos/${capitulo.plano.id}/apresentacao?dispositivo=kindle`)).status).toBe(400);
  // O mesmo roteiro do e-ink, como EPUB para o aparelho: um zip que começa pelo mimetype.
  const epub = await escrever(api, 'GET', `/api/planos/${capitulo.plano.id}/eink.epub`);
  expect(epub.status).toBe(200);
  expect(epub.headers.get('content-type')).toBe('application/epub+zip');
  expect(epub.headers.get('content-disposition')).toMatch(/^attachment; filename=".+\.epub"/);
  expect(Buffer.from(await epub.arrayBuffer()).subarray(30, 58).toString('latin1')).toBe('mimetypeapplication/epub+zip');

  // Perfil novo: o plano atual deixa de ser do perfil, e preparar de novo pede só um plano novo.
  expect((await ler<{ perfil: null }>(api, '/api/perfil')).perfil).toBeNull();
  expect((await escrever(api, 'PUT', '/api/perfil', { areas: [{ nome: 'Economia', nivel: 'mestre' }] })).status).toBe(422);
  const perfil = await escrever(api, 'PUT', '/api/perfil', { areas: [{ nome: 'Economia', nivel: 'avancado' }], preferencias: ['exemplos concretos'] });
  expect(perfil.status).toBe(200);
  expect(await perfil.json()).toMatchObject({ perfil: { revisao: 0, preferencias: ['exemplos concretos'] } });
  expect((await ler<{ plano_do_perfil_atual: boolean }>(api, `/api/compreensoes/${compreensao.id}/capitulos/${cap1.secao_id}`)).plano_do_perfil_atual).toBe(false);
  const denovo = await escrever(api, 'POST', `/api/compreensoes/${compreensao.id}/capitulos/${cap1.secao_id}/preparar`, { prefetch: false });
  expect(await denovo.json()).toMatchObject({ seguinte: null });
  const planejar = (await banco.query<{ tipo: string }>(`SELECT tipo FROM job WHERE estado='fila' ORDER BY prioridade DESC, criado_em`)).rows.map((linha) => linha.tipo);
  expect(planejar).toEqual(['planejar_leitura', 'analisar_passagens']);
}));

test('documento sem capítulos não tem compreensão', async () => comBanco('compr_sem_cap', async (banco) => {
  const canonico = canonicoDeTeste({ blocos: [{ tipo: 'paragrafo', texto: 'Só um parágrafo, sem capítulo.' }] });
  const documento = await comTransacao(banco, async (cliente) => {
    const criado = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
    await documentos.criarVersao(cliente, criado.id, canonico);
    return criado;
  });
  const { config } = await configurar(banco, temporarios);
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); }, compreensao: () => config });
  const resposta = await escrever(api, 'POST', `/api/documentos/${documento.id}/compreensoes`, { modo_de_leitura: { id: 'argumentativa', revisao: 1 } });
  expect(resposta.status).toBe(409);
  expect(await resposta.json()).toMatchObject({ erro: 'sem_capitulos' });
}));
