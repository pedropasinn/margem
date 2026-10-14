/**
 * "Preparar leitura" (v0.1, V-A1): um clique só cria (ou reaproveita) a compreensão e enfileira na hora;
 * com o executor falso, o primeiro capítulo chega a grifos e relações. Clicar de novo não cria execução.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { afterEach, expect, test } from 'vitest';
import { canonicoDeTeste, comBanco } from '../../testes/apoio.js';
import { configurar, livro, rodarUm } from '../../testes/compreensao.js';
import { comTransacao } from '../db/transacao.js';
import * as documentos from '../repos/documentos.js';
import { criarApi } from './app.js';

const temporarios: string[] = [];
afterEach(async () => { for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true }); });

const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };
function escrever(api: Hono, caminho: string, dado?: unknown, method = 'POST'): Promise<Response> {
  return Promise.resolve(api.request(caminho, { method, headers: ESCRITA, ...(dado === undefined ? {} : { body: JSON.stringify(dado) }) }));
}
/** O tipo escolhido pela pessoa dispensa a identificação: a preparação começa no clique. */
async function escolherTipo(api: Hono, documentoId: string, tipo = 'outro'): Promise<void> {
  expect((await escrever(api, `/api/documentos/${documentoId}/tipo-de-texto`, { tipo_id: tipo }, 'PUT')).status).toBe(200);
}
async function ler<T>(api: Hono, caminho: string): Promise<T> {
  const resposta = await api.request(caminho);
  expect(resposta.status, caminho).toBe(200);
  return await resposta.json() as T;
}

interface Situacao {
  estado: string;
  tipo: { tipo_id: string; rotulo: string; grupo: string; origem: string } | null;
  compreensao: { id: string; modo: { id: string; revisao: number } } | null;
  capitulos: { secao_id: string; titulo: string; estado: string; etapa: string; relacoes: number | null }[];
  erro: { codigo: string; mensagem: string } | null;
}
interface Resposta { compreensao_id: string; criada: boolean; enfileirados: number; devolvidos: number; situacao: Situacao }

async function documentoDoLivro(banco: Parameters<Parameters<typeof comBanco>[1]>[0]) {
  const canonico = livro();
  return comTransacao(banco, async (cliente) => {
    const criado = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
    await documentos.criarVersao(cliente, criado.id, canonico);
    return criado;
  });
}

test('um clique prepara o primeiro capítulo até grifos e relações; o segundo clique não cria nada', async () => comBanco('prep_um_clique', async (banco) => {
  const documento = await documentoDoLivro(banco);
  const { config, auditoria } = await configurar(banco, temporarios);
  const api = criarApi({ banco, leitura: () => { throw new Error('A leitura antiga não é usada.'); }, compreensao: () => config });

  await escolherTipo(api, documento.id);
  const antes = await ler<Situacao>(api, `/api/documentos/${documento.id}/preparacao`);
  expect(antes).toMatchObject({ estado: 'nao_preparada', compreensao: null, capitulos: [], tipo: { tipo_id: 'outro', origem: 'escolhido' } });

  const primeiro = await escrever(api, `/api/documentos/${documento.id}/preparacao`);
  expect(primeiro.status).toBe(201);
  const criado = await primeiro.json() as Resposta;
  expect(criado).toMatchObject({ criada: true, devolvidos: 0 });
  expect(criado.enfileirados).toBeGreaterThan(0);
  expect(criado.situacao.estado).toBe('preparando');
  expect(criado.situacao.capitulos.map((item) => [item.titulo, item.estado])).toEqual([['Capítulo um', 'preparando'], ['Capítulo dois', 'preparando']]);
  // A compreensão vira a camada padrão do documento.
  const { preferencias } = await ler<{ preferencias: { camada_padrao: string | null } }>(api, `/api/documentos/${documento.id}/camadas`);
  expect(preferencias.camada_padrao).toBe(criado.compreensao_id);

  // Nenhuma leitura antiga: nem `ler_parte` nem `revisar_consistencia`.
  const tipos = (await banco.query<{ tipo: string }>('SELECT DISTINCT tipo FROM job ORDER BY tipo')).rows.map((linha) => linha.tipo);
  expect(tipos).toEqual(['analisar_passagens']);

  const slots = await mkdtemp(join(tmpdir(), 'margem-preparacao-slots-'));
  temporarios.push(slots);
  for (let i = 0; i < 4; i += 1) await rodarUm(banco, config, auditoria, slots);

  const depois = await ler<Situacao>(api, `/api/documentos/${documento.id}/preparacao`);
  const [cap1, cap2] = depois.capitulos;
  expect(cap1).toMatchObject({ titulo: 'Capítulo um', estado: 'pronto', etapa: 'pronto' });
  expect(cap1?.relacoes).toBeGreaterThanOrEqual(1);
  expect(cap2).toMatchObject({ titulo: 'Capítulo dois', estado: 'preparando', relacoes: null });
  expect(depois.estado).toBe('preparando');
  const relacoes = await ler<{ relacoes: unknown[] }>(api, `/api/compreensoes/${criado.compreensao_id}/capitulos/${cap1?.secao_id ?? ''}/relacoes?filtro=todas`);
  expect(relacoes.relacoes.length).toBeGreaterThanOrEqual(1);
  // Os grifos projetados estão na camada padrão (o snapshot sem ?camada= a usa).
  const versaoId = (await banco.query<{ id: string }>('SELECT id FROM versao_texto WHERE documento_id=$1', [documento.id])).rows[0]?.id ?? '';
  const snapshot = await ler<{ camada: string; marcas: { origem: string }[] }>(api, `/api/versoes/${versaoId}/capitulos/${cap1?.secao_id ?? ''}`);
  expect(snapshot.camada).toBe(criado.compreensao_id);
  expect(snapshot.marcas.filter((marca) => marca.origem === 'projecao').length).toBeGreaterThan(0);

  // Segundo clique: mesma compreensão, nenhuma execução nem job novo.
  const execucoes = async () => Number((await banco.query<{ n: string }>('SELECT count(*) AS n FROM execucao_leitura')).rows[0]?.n);
  const jobs = async () => Number((await banco.query<{ n: string }>('SELECT count(*) AS n FROM job')).rows[0]?.n);
  const [execucoesAntes, jobsAntes] = [await execucoes(), await jobs()];
  const segundo = await escrever(api, `/api/documentos/${documento.id}/preparacao`);
  expect(segundo.status).toBe(200);
  expect(await segundo.json()).toMatchObject({ compreensao_id: criado.compreensao_id, criada: false, devolvidos: 0 });
  expect(await execucoes()).toBe(execucoesAntes);
  expect(await jobs()).toBe(jobsAntes);
}));

test('"todos os capítulos" enfileira o livro inteiro; erros de pedido', async () => comBanco('prep_todos', async (banco) => {
  const documento = await documentoDoLivro(banco);
  const { config } = await configurar(banco, temporarios);
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); }, compreensao: () => config });
  await escolherTipo(api, documento.id);
  expect((await escrever(api, `/api/documentos/${documento.id}/preparacao`, { todos: 'sim' })).status).toBe(400);
  expect((await escrever(api, `/api/documentos/${documento.id}/preparacao`, { outro: true })).status).toBe(400);
  expect((await escrever(api, '/api/documentos/01J000000000000000000000ZZ/preparacao')).status).toBe(404);
  const resposta = await escrever(api, `/api/documentos/${documento.id}/preparacao`, { todos: true });
  expect(resposta.status).toBe(201);
  const pedidos = (await banco.query<{ prioridade: number }>("SELECT prioridade FROM job WHERE tipo='analisar_passagens' ORDER BY prioridade DESC")).rows;
  expect(pedidos.map((linha) => linha.prioridade)).toEqual([100, 50]);
}));

test('documento sem capítulos responde 409 sem criar execução', async () => comBanco('prep_sem_cap', async (banco) => {
  const canonico = canonicoDeTeste({ blocos: [{ tipo: 'paragrafo', texto: 'Só um parágrafo, sem capítulo.' }] });
  const documento = await comTransacao(banco, async (cliente) => {
    const criado = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
    await documentos.criarVersao(cliente, criado.id, canonico);
    return criado;
  });
  const { config } = await configurar(banco, temporarios);
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); }, compreensao: () => config });
  await escolherTipo(api, documento.id);
  const resposta = await escrever(api, `/api/documentos/${documento.id}/preparacao`);
  expect(resposta.status).toBe(409);
  expect(Number((await banco.query<{ n: string }>('SELECT count(*) AS n FROM execucao_leitura')).rows[0]?.n)).toBe(0);
}));

test('"Tentar de novo" devolve à fila a análise que falhou e o capítulo chega a pronto', async () => comBanco('prep_de_novo', async (banco) => {
  const documento = await documentoDoLivro(banco);
  const { config, auditoria } = await configurar(banco, temporarios);
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); }, compreensao: () => config });
  await escolherTipo(api, documento.id);
  const { compreensao_id: compreensao } = await (await escrever(api, `/api/documentos/${documento.id}/preparacao`)).json() as Resposta;
  const detalhe = async () => ler<{ estado: string; detalhe: string | null }>(api, `/api/documentos/${documento.id}`);
  const naLista = async () => (await ler<{ documentos: { id: string; estado: string; detalhe: string | null }[] }>(api, '/api/documentos')).documentos
    .find((item) => item.id === documento.id);
  // A análise do capítulo um falha (como um `codex exec` que sai com código 1).
  await banco.query(`UPDATE job SET estado='falhou', error_code='processo', attempt=attempt+1 WHERE tipo='analisar_passagens' AND prioridade=100`);
  const falhou = await ler<Situacao>(api, `/api/documentos/${documento.id}/preparacao`);
  // O capítulo 2 (prefetch) ainda está na fila: a biblioteca mostra "preparando"; sem ele, a falha.
  expect((await naLista())?.estado).toBe('preparando');
  await banco.query(`UPDATE job SET estado='cancelado' WHERE tipo='analisar_passagens' AND prioridade<100`);
  expect(await naLista()).toMatchObject({ estado: 'falhou', detalhe: 'A preparação foi cancelada.' });
  await banco.query(`UPDATE job SET estado='fila' WHERE tipo='analisar_passagens' AND prioridade<100`);
  expect(falhou).toMatchObject({ estado: 'falhou', erro: { codigo: 'processo', mensagem: 'O Codex parou com erro.' } });
  const cap1 = falhou.capitulos[0]?.secao_id ?? '';
  expect(falhou.capitulos[0]?.estado).toBe('falhou');

  // Preparar sem tentar de novo não ressuscita a falha.
  await escrever(api, `/api/compreensoes/${compreensao ?? ''}/capitulos/${cap1}/preparar`, { prefetch: false });
  expect((await ler<Situacao>(api, `/api/documentos/${documento.id}/preparacao`)).capitulos[0]?.estado).toBe('falhou');
  // O botão do leitor: tentar_de_novo devolve o job à fila e o estado deixa de ser "falhou" na hora.
  const denovo = await escrever(api, `/api/compreensoes/${compreensao ?? ''}/capitulos/${cap1}/preparar`, { prefetch: false, tentar_de_novo: true });
  expect(await denovo.json()).toMatchObject({ visivel: 'preparando' });
  expect((await banco.query<{ estado: string }>(`SELECT estado FROM job WHERE tipo='analisar_passagens' AND prioridade=100`)).rows).toEqual([{ estado: 'fila' }]);
  const eventos = (await banco.query<{ tipo: string }>(`SELECT e.tipo FROM evento_job e JOIN job j ON j.id=e.job_id WHERE j.prioridade=100 AND j.tipo='analisar_passagens' ORDER BY e.id`)).rows.map((linha) => linha.tipo);
  expect(eventos).toContain('reenfileirado');

  // A biblioteca e o detalhe contam a compreensão: falha vira "Requer atenção" com a frase humana.
  expect(await detalhe()).toMatchObject({ estado: 'preparando', detalhe: 'capítulo 1 de 2' });
  const slots = await mkdtemp(join(tmpdir(), 'margem-prep-denovo-'));
  temporarios.push(slots);
  for (let i = 0; i < 4; i += 1) await rodarUm(banco, config, auditoria, slots);
  expect((await ler<Situacao>(api, `/api/documentos/${documento.id}/preparacao`)).capitulos[0]?.estado).toBe('pronto');
}));
