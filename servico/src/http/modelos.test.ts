/**
 * Configurações → Modelos (V-T10) de ponta a ponta: a API guarda a escolha por categoria em
 * `preferencia_geral`, a lista de modelos vem uma vez e só volta a ser buscada com "Atualizar", e o
 * worker de verdade entrega ao executor falso o modelo e o esforço da categoria do job, com a
 * escolha registrada na auditoria da tentativa.
 */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { afterEach, expect, test } from 'vitest';
import { comBanco } from '../../testes/apoio.js';
import { configurar, livro, rodarUm } from '../../testes/compreensao.js';
import { comTransacao } from '../db/transacao.js';
import { CAUSA_MODELO_INDISPONIVEL } from '../executor/stderr.js';
import type { PedidoExecucao } from '../executor/tipos.js';
import type { CatalogoDeModelos } from '../modelos/catalogo.js';
import { executorComModelos } from '../modelos/executor.js';
import { lerEscolhas } from '../modelos/preferencias.js';
import * as documentos from '../repos/documentos.js';
import { criarApi } from './app.js';

const temporarios: string[] = [];
afterEach(async () => { for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true }); });

const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };
const escrever = (api: Hono, caminho: string, dado: unknown, method = 'PUT') =>
  Promise.resolve(api.request(caminho, { method, headers: ESCRITA, body: JSON.stringify(dado) }));

interface Categoria { id: string; rotulo: string; padrao: { texto: string; esforco: string }; escolha: { modelo: string | null; esforco: string | null } }
interface Resposta { categorias: Categoria[]; esforcos: { id: string; rotulo: string }[]; catalogo: CatalogoDeModelos | null }

const CATALOGO: CatalogoDeModelos = {
  obtido_em: '2026-10-14T12:00:00.000Z', origem: 'conta',
  modelos: [{ id: 'gpt-6-astra', nome: 'GPT-6-Astra', descricao: 'Frontier.', esforcos: ['low', 'medium', 'high'] }],
};

test('a API mostra o padrão de cada categoria, guarda a escolha e recusa o que não é modelo nem esforço', async () => comBanco('modelos_api', async (banco) => {
  let buscas = 0;
  const api = criarApi({
    banco, leitura: () => { throw new Error('não usada'); }, recursos: new Set(['arte']),
    buscarModelos: () => { buscas += 1; return Promise.resolve({ ...CATALOGO, obtido_em: `2026-10-14T12:00:0${String(buscas)}.000Z` }); },
  });
  const primeira = await (await api.request('/api/configuracoes/modelos')).json() as Resposta;
  expect(primeira.categorias.map((c) => c.id)).toEqual(['analise', 'tipo_de_texto', 'perguntas', 'exercicios', 'flashcards', 'visuais', 'quadros', 'videos', 'escaneados', 'guiada']);
  expect(primeira.categorias.every((c) => c.escolha.modelo === null && c.escolha.esforco === null)).toBe(true);
  expect(primeira.esforcos).toEqual([{ id: 'low', rotulo: 'baixo' }, { id: 'medium', rotulo: 'médio' }, { id: 'high', rotulo: 'alto' }]);
  expect(primeira.catalogo?.modelos.map((m) => m.id)).toEqual(['gpt-6-astra']);
  // A segunda visita usa a lista guardada; só "Atualizar" busca de novo.
  await api.request('/api/configuracoes/modelos');
  expect(buscas).toBe(1);
  const atualizada = await (await escrever(api, '/api/configuracoes/modelos/atualizar', {}, 'POST')).json() as Resposta;
  expect(buscas).toBe(2);
  expect(atualizada.catalogo?.obtido_em).toBe('2026-10-14T12:00:02.000Z');

  const gravada = await escrever(api, '/api/configuracoes/modelos', { categorias: { flashcards: { modelo: 'gpt-6-astra', esforco: 'high' }, visuais: { modelo: 'meu-modelo-1', esforco: null } } });
  expect(gravada.status).toBe(200);
  const depois = await gravada.json() as Resposta;
  expect(depois.categorias.find((c) => c.id === 'flashcards')?.escolha).toEqual({ modelo: 'gpt-6-astra', esforco: 'high' });
  expect(depois.categorias.find((c) => c.id === 'visuais')?.escolha).toEqual({ modelo: 'meu-modelo-1', esforco: null });
  // Voltar ao padrão apaga só aquela categoria.
  await escrever(api, '/api/configuracoes/modelos', { categorias: { visuais: { modelo: null, esforco: null } } });
  expect(await lerEscolhas(banco)).toEqual({ flashcards: { modelo: 'gpt-6-astra', esforco: 'high' } });

  for (const ruim of [
    { categorias: { flashcards: { modelo: 'gpt 6; rm', esforco: null } } },
    { categorias: { flashcards: { modelo: null, esforco: 'extremo' } } },
    { categorias: { inventada: { modelo: null, esforco: 'low' } } },
    { categorias: { flashcards: { modelo: null, esforco: 'low', outro: 1 } } },
  ]) expect((await escrever(api, '/api/configuracoes/modelos', ruim)).status).toBe(422);
  expect((await escrever(api, '/api/configuracoes/modelos', { outra: 1 })).status).toBe(400);

  // Gravado torto por fora da API: a tela e o worker veem o padrão.
  await banco.query(`UPDATE preferencia_geral SET valor='{"categorias":{"flashcards":{"modelo":"--sandbox","esforco":"ultra"}}}' WHERE chave='modelos'`);
  const torta = await (await api.request('/api/configuracoes/modelos')).json() as Resposta;
  expect(torta.categorias.find((c) => c.id === 'flashcards')?.escolha).toEqual({ modelo: null, esforco: null });
  expect(await lerEscolhas(banco)).toEqual({});
}));

test('sem lista de modelos da conta, a tela ainda abre e "Atualizar" explica', async () => comBanco('modelos_sem_lista', async (banco) => {
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); }, recursos: new Set(), buscarModelos: () => Promise.resolve(null) });
  const resposta = await (await api.request('/api/configuracoes/modelos')).json() as Resposta;
  expect(resposta.catalogo).toBeNull();
  expect(resposta.categorias.some((c) => c.id === 'quadros' || c.id === 'noticias')).toBe(false);
  const atualizar = await escrever(api, '/api/configuracoes/modelos/atualizar', {}, 'POST');
  expect(atualizar.status).toBe(502);
}));

test('o worker entrega ao executor o modelo e o esforço escolhidos para a análise de textos, e a auditoria registra', async () => comBanco('modelos_worker', async (banco) => {
  const canonico = livro();
  const documento = await comTransacao(banco, async (cliente) => {
    const criado = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
    await documentos.criarVersao(cliente, criado.id, canonico);
    return criado;
  });
  const { config, auditoria } = await configurar(banco, temporarios);
  const pedidos: PedidoExecucao[] = [];
  const base = config.executor;
  const comModelos = { ...config, executor: executorComModelos((pedido) => { pedidos.push(pedido); return base(pedido); }, () => lerEscolhas(banco)) };
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); }, compreensao: () => comModelos, buscarModelos: () => Promise.resolve(null) });

  expect((await escrever(api, '/api/configuracoes/modelos', { categorias: { analise: { modelo: 'gpt-6-astra', esforco: 'medium' }, flashcards: { modelo: 'outro-1', esforco: 'low' } } })).status).toBe(200);
  expect((await escrever(api, `/api/documentos/${documento.id}/tipo-de-texto`, { tipo_id: 'outro' })).status).toBe(200);
  expect((await escrever(api, `/api/documentos/${documento.id}/preparacao`, {}, 'POST')).status).toBe(201);

  const slots = await mkdtemp(join(tmpdir(), 'margem-modelos-slots-'));
  temporarios.push(slots);
  await rodarUm(banco, comModelos, auditoria, slots);
  expect(pedidos.length).toBeGreaterThan(0);
  // Sem a escolha, a configuração pediria `modelo-de-teste` com esforço `alto`.
  for (const pedido of pedidos) expect([pedido.modelo, pedido.esforco]).toEqual(['gpt-6-astra', 'medium']);

  const jobs = await readdir(join(auditoria, 'jobs'));
  expect(jobs).toHaveLength(1);
  const tentativa = join(auditoria, 'jobs', jobs[0]!, (await readdir(join(auditoria, 'jobs', jobs[0]!)))[0]!);
  const metadados = JSON.parse(await readFile(join(tentativa, 'metadados.json'), 'utf8')) as Record<string, unknown>;
  expect(metadados).toMatchObject({ tipo: 'analisar_passagens', modelo_pedido: 'gpt-6-astra', esforco_pedido: 'medium', preferencia: { categoria: 'analise', modelo: 'gpt-6-astra', esforco: 'medium' } });
  const resultado = JSON.parse(await readFile(join(tentativa, 'resultado.json'), 'utf8')) as Record<string, unknown>;
  expect(resultado).toMatchObject({ estado: 'ok', esforco: 'medium' });
}));

test('modelo recusado pela conta: a preparação falha dizendo qual modelo e como voltar ao padrão', async () => comBanco('modelos_recusado', async (banco) => {
  const canonico = livro();
  const documento = await comTransacao(banco, async (cliente) => {
    const criado = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
    await documentos.criarVersao(cliente, criado.id, canonico);
    return criado;
  });
  const { config, auditoria } = await configurar(banco, temporarios);
  // O `codex exec` real sai com código 1 e `ERROR: model_not_found`; o executor reconhece a causa.
  const recusa = (pedido: PedidoExecucao) => Promise.resolve({
    estado: 'falhou' as const, codigo: 'processo' as const, mensagem: CAUSA_MODELO_INDISPONIVEL, duracao_ms: 3,
    detalhe: { codigo_saida: 1, classe: 'processo', stderr_resumo: `ERROR: model_not_found ${pedido.modelo ?? ''}`, causa: CAUSA_MODELO_INDISPONIVEL },
  });
  const comModelos = { ...config, executor: executorComModelos(recusa, () => lerEscolhas(banco)) };
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); }, compreensao: () => comModelos, buscarModelos: () => Promise.resolve(null) });
  await escrever(api, '/api/configuracoes/modelos', { categorias: { analise: { modelo: 'gpt-9-inexistente', esforco: null } } });
  await escrever(api, `/api/documentos/${documento.id}/tipo-de-texto`, { tipo_id: 'outro' });
  await escrever(api, `/api/documentos/${documento.id}/preparacao`, {}, 'POST');
  const slots = await mkdtemp(join(tmpdir(), 'margem-modelos-slots-'));
  temporarios.push(slots);
  await rodarUm(banco, comModelos, auditoria, slots);

  const frase = 'O modelo gpt-9-inexistente não está disponível na sua conta. Em Configurações → Modelos, volte ao Padrão do Margem.';
  const situacao = await (await api.request(`/api/documentos/${documento.id}/preparacao`)).json() as { estado: string; erro: { codigo: string; mensagem: string } | null };
  expect(situacao).toMatchObject({ estado: 'falhou', erro: { codigo: 'processo', mensagem: frase } });
  // E o aviso "Codex · falhou" da lista de execuções.
  const { execucoes } = await (await api.request('/api/execucoes/ativas')).json() as { execucoes: { estado: string; mensagem: string | null }[] };
  expect(execucoes.find((execucao) => execucao.estado === 'falhou')?.mensagem).toBe(frase);
}));
