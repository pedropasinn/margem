/**
 * V-T8: cancelar o que se pediu ao Codex sem deixar nada e apagar o que foi feito (um item ou em lote,
 * do Codex ou do leitor), com o executor falso. O cancelamento de um job que demora mata a execução na
 * hora (o vigia do worker acorda com o aviso do banco), e a análise apagada pode ser feita do zero.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import type pg from 'pg';
import { afterEach, expect, test } from 'vitest';
import type { AncoraV1, Bloco, Id } from '@margem/contratos';
import { comBanco } from '../../testes/apoio.js';
import { ROTEIRO, configurar, livro, rodarUm } from '../../testes/compreensao.js';
import { comTransacao } from '../db/transacao.js';
import { executorAuditado } from '../executor/auditoria.js';
import { criarExecutorFalso, type Roteiro } from '../executor/fake.js';
import { manipuladoresDaCompreensao } from '../compreensao/manipuladores.js';
import * as documentos from '../repos/documentos.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { Worker, type AnotacaoWorker } from '../worker/worker.js';
import { ouvinteDoPool } from './ouvinte.js';
import { criarApi } from './app.js';

const temporarios: string[] = [];
afterEach(async () => { for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true }); });

const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };
async function pedir<T>(api: Hono, caminho: string, metodo = 'GET', dado?: unknown, status = 200): Promise<T> {
  const resposta = await api.request(caminho, { method: metodo, ...(metodo === 'GET' ? {} : { headers: ESCRITA }), ...(dado === undefined ? {} : { body: JSON.stringify(dado) }) });
  expect(resposta.status, `${metodo} ${caminho}: ${await resposta.clone().text()}`).toBe(status);
  return (resposta.status === 204 ? null : await resposta.json()) as T;
}
const contar = async (banco: pg.Pool, sql: string, valores: unknown[] = []) => Number((await banco.query<{ n: string }>(sql, valores)).rows[0]?.n ?? 0);

interface Situacao { estado: string; compreensao: { id: Id } | null; capitulos: { secao_id: Id; estado: string; relacoes: number | null }[] }
interface Apagaveis { codex: { chave: string; total: number }[]; leitor: { chave: string; rotulo: string; singular: string; total: number }[] }
const total = (lista: { chave: string; total: number }[], chave: string) => lista.find((item) => item.chave === chave)?.total ?? 0;

function ancora(versaoId: Id, bloco: Bloco, citacao: string): AncoraV1 {
  const inicio = bloco.texto.indexOf(citacao);
  return { versao_id: versaoId, bloco_id: bloco.id, inicio_utf16: inicio, fim_utf16: inicio + citacao.length, citacao,
    prefixo: bloco.texto.slice(0, inicio), sufixo: bloco.texto.slice(inicio + citacao.length) };
}

async function montar(banco: pg.Pool) {
  const canonico = livro();
  const { documento, versao } = await comTransacao(banco, async (cliente) => {
    const criado = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
    return { documento: criado, versao: await documentos.criarVersao(cliente, criado.id, canonico) };
  });
  const { config, auditoria } = await configurar(banco, temporarios);
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); }, compreensao: () => config });
  await pedir(api, `/api/documentos/${documento.id}/tipo-de-texto`, 'PUT', { tipo_id: 'outro' });
  const slots = await mkdtemp(join(tmpdir(), 'margem-apagar-slots-'));
  temporarios.push(slots);
  const blocos = canonico.blocos;
  return { documento, versao, api, config, auditoria, slots, blocos, capitulo1: canonico.secoes[0]!.id, capitulo2: canonico.secoes[2]!.id };
}

test('cancelar a análise no meio não deixa nada; analisar de novo começa do zero', async () => comBanco('apagar_cancelar', async (banco) => {
  const m = await montar(banco);
  const primeira = await pedir<{ compreensao_id: Id }>(m.api, `/api/documentos/${m.documento.id}/preparacao`, 'POST', undefined, 201);
  // Análise local e síntese publicadas; a revisão e o plano ainda na fila.
  for (let i = 0; i < 2; i += 1) await rodarUm(banco, m.config, m.auditoria, m.slots);
  expect(await contar(banco, 'SELECT count(*) AS n FROM modelo_capitulo')).toBeGreaterThan(0);
  expect(await contar(banco, "SELECT count(*) AS n FROM job WHERE estado IN ('fila','adiado','reservado')")).toBeGreaterThan(0);

  const cancelado = await pedir<{ cancelados: number; capitulos_descartados: number; execucoes_descartadas: number }>(
    m.api, `/api/documentos/${m.documento.id}/cancelar`, 'POST', {});
  expect(cancelado.cancelados).toBeGreaterThan(0);
  expect(cancelado.execucoes_descartadas).toBe(1);
  for (const tabela of ['modelo_capitulo', 'analise_local', 'lote_modelo', 'plano_pedagogico', 'preparacao_capitulo', 'parte', 'execucao_leitura', 'marca']) {
    expect(await contar(banco, `SELECT count(*) AS n FROM ${tabela}`), tabela).toBe(0);
  }
  expect(await contar(banco, "SELECT count(*) AS n FROM camada WHERE tipo='execucao'")).toBe(0);
  expect(await contar(banco, "SELECT count(*) AS n FROM job WHERE tipo <> 'identificar_tipo'")).toBe(0);
  expect((await pedir<Situacao>(m.api, `/api/documentos/${m.documento.id}/preparacao`)).estado).toBe('nao_preparada');
  // Nada pendente: cancelar de novo não é erro e não cancela nada.
  expect((await pedir<{ cancelados: number }>(m.api, `/api/documentos/${m.documento.id}/cancelar`, 'POST', {})).cancelados).toBe(0);

  // Analisar de novo: a execução apagada não é reaproveitada.
  const { config, auditoria } = await configurar(banco, temporarios);
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); }, compreensao: () => config });
  const segunda = await pedir<{ compreensao_id: Id; criada: boolean }>(api, `/api/documentos/${m.documento.id}/preparacao`, 'POST', undefined, 201);
  expect(segunda.criada).toBe(true);
  expect(segunda.compreensao_id).not.toBe(primeira.compreensao_id);
  for (let i = 0; i < 4; i += 1) await rodarUm(banco, config, auditoria, m.slots);
  const depois = await pedir<Situacao>(api, `/api/documentos/${m.documento.id}/preparacao`);
  expect(depois.capitulos[0]).toMatchObject({ estado: 'pronto' });
}));

test('cancelar uma etapa pelo aviso cancela o capítulo inteiro e descarta o que já tinha sido gravado', async () => comBanco('apagar_etapa', async (banco) => {
  const m = await montar(banco);
  await pedir(m.api, `/api/documentos/${m.documento.id}/preparacao`, 'POST', undefined, 201);
  await rodarUm(banco, m.config, m.auditoria, m.slots);
  const sintese = (await banco.query<{ id: Id }>("SELECT id FROM job WHERE tipo='sintetizar_capitulo' AND estado='fila'")).rows[0]?.id ?? '';
  expect(sintese).not.toBe('');
  const resposta = await pedir<{ estado: string; alterado: boolean; capitulos_descartados: number }>(m.api, `/api/jobs/${sintese}/cancelar`, 'POST');
  expect(resposta).toMatchObject({ estado: 'cancelado', alterado: true, capitulos_descartados: 1 });
  expect(await contar(banco, 'SELECT count(*) AS n FROM analise_local')).toBe(0);
  expect(await contar(banco, 'SELECT count(*) AS n FROM modelo_capitulo')).toBe(0);
  // O capítulo 2 (prefetch) também estava pedido: ele continua; a execução fica.
  const situacao = await pedir<Situacao>(m.api, `/api/documentos/${m.documento.id}/preparacao`);
  expect(situacao.capitulos[0]?.estado).toBe('nao_preparado');
}));

test('cancelar um job que demora mata a execução na hora e nada é publicado', async () => comBanco('apagar_demora', async (banco) => {
  const m = await montar(banco);
  // A análise local demora 20 s no executor falso; o cancelamento tem de chegar antes, sem a batida (60 s).
  const lento: Roteiro = { versao: 1, passos: [{ ...ROTEIRO.passos[0]!, atraso_ms: 20_000 }] };
  const artefatos = await mkdtemp(join(tmpdir(), 'margem-apagar-art-'));
  temporarios.push(artefatos);
  const falso = criarExecutorFalso(lento);
  let abortado = false;
  const executor = executorAuditado(async (pedido) => {
    pedido.sinal?.addEventListener('abort', () => { abortado = true; }, { once: true });
    return falso({ ...pedido, diretorioArtefatos: artefatos });
  }, { commit: () => 'teste' });
  const config = { ...m.config, executor };
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); }, compreensao: () => config });
  await pedir(api, `/api/documentos/${m.documento.id}/preparacao`, 'POST', undefined, 201);

  const ouvinte = ouvinteDoPool(banco);
  await ouvinte.iniciar();
  const anotacoes: AnotacaoWorker[] = [];
  const worker = new Worker({
    fila: new FilaPostgres(banco), manipuladores: manipuladoresDaCompreensao(config), auditoria: m.auditoria,
    slots: 1, diretorioSlots: m.slots, intervaloMs: 5, maximoCiclos: 1, heartbeatMs: 60_000,
    esperarNovidade: (limite, sinal) => ouvinte.esperar(limite, sinal), anotar: (a) => anotacoes.push(a),
  });
  try {
    const rodando = worker.rodar();
    let job: Id | undefined;
    for (let i = 0; i < 200 && job === undefined; i += 1) {
      job = (await banco.query<{ id: Id }>("SELECT id FROM job WHERE estado='reservado'")).rows[0]?.id;
      if (job === undefined) await new Promise((r) => setTimeout(r, 25));
    }
    expect(job).toBeDefined();
    const inicio = Date.now();
    await pedir(api, `/api/jobs/${job ?? ''}/cancelar`, 'POST');
    await rodando;
    expect(Date.now() - inicio).toBeLessThan(10_000);
    expect(abortado).toBe(true);
  } finally {
    await ouvinte.encerrar();
  }
  expect(anotacoes.some((a) => a.evento === 'publicado')).toBe(false);
  expect(await contar(banco, 'SELECT count(*) AS n FROM analise_local')).toBe(0);
  // O capítulo 1 voltou a "não preparado"; o 2 (pedido junto, em segundo plano) segue na fila.
  const situacao = await pedir<Situacao>(api, `/api/documentos/${m.documento.id}/preparacao`);
  expect(situacao.capitulos.map((c) => c.estado)).toEqual(['nao_preparado', 'preparando']);
}));

test('apagar a análise do Codex conta antes, apaga tudo dele e deixa o que é do leitor', async () => comBanco('apagar_codex', async (banco) => {
  const m = await montar(banco);
  const { compreensao_id: compreensao } = await pedir<{ compreensao_id: Id }>(m.api, `/api/documentos/${m.documento.id}/preparacao`, 'POST', undefined, 201);
  for (let i = 0; i < 4; i += 1) await rodarUm(banco, m.config, m.auditoria, m.slots);
  // O leitor grifa e anota no capítulo 2 e escreve um flashcard.
  const b6 = m.blocos[6]!;
  await pedir(m.api, '/api/grifos', 'POST', { ancora: ancora(m.versao.id, b6, 'Outro capítulo'), funcao: 'nenhuma' }, 201);
  await pedir(m.api, '/api/anotacoes', 'POST', { ancora: ancora(m.versao.id, b6, 'lido depois'), tipo: 'nota', texto: 'Minha nota.' }, 201);
  await pedir(m.api, '/api/flashcards', 'POST', { ancora: ancora(m.versao.id, b6, 'lido depois'), frente: 'Frente?', verso: 'Verso.' }, 201);
  // E uma sugestão de conexão do Codex não decidida.
  const conta = await pedir<Apagaveis>(m.api, `/api/documentos/${m.documento.id}/apagaveis`);
  expect(total(conta.codex, 'grifos')).toBeGreaterThan(0);
  expect(total(conta.codex, 'relacoes')).toBeGreaterThan(0);
  expect(total(conta.codex, 'dificuldades')).toBeGreaterThan(0);
  expect(conta.leitor.map((item) => [item.chave, item.total])).toEqual([['grifos', 1], ['notas', 1], ['dificuldades', 0], ['conexoes', 0], ['flashcards', 1]]);
  expect(conta.leitor[1]).toMatchObject({ rotulo: 'notas', singular: 'nota' });
  // Por capítulo: o capítulo 2 não tem nada do Codex.
  const doCapitulo2 = await pedir<Apagaveis>(m.api, `/api/documentos/${m.documento.id}/apagaveis?secao=${m.capitulo2}`);
  expect(total(doCapitulo2.codex, 'grifos')).toBe(0);
  expect(total(doCapitulo2.leitor, 'notas')).toBe(1);

  const resposta = await pedir<{ apagados: { codex: Record<string, number> } }>(m.api, `/api/documentos/${m.documento.id}/apagar`, 'POST', { quem: 'codex' });
  expect(resposta.apagados.codex.grifos).toBe(total(conta.codex, 'grifos'));
  const depois = await pedir<Apagaveis>(m.api, `/api/documentos/${m.documento.id}/apagaveis`);
  expect(depois.codex.every((item) => item.total === 0)).toBe(true);
  expect(depois.leitor.map((item) => item.total)).toEqual([1, 1, 0, 0, 1]);
  expect(await contar(banco, 'SELECT count(*) AS n FROM execucao_leitura WHERE id=$1', [compreensao])).toBe(0);
  // A exportação para o Obsidian não mostra o que foi apagado: só o grifo e a nota do leitor.
  const obsidian = await pedir<{ notas: { conteudo: string; caminho: string }[] }>(m.api, `/api/obsidian/v2/documentos/${m.documento.id}`);
  const tudo = obsidian.notas.map((nota) => nota.conteudo).join('\n');
  expect(tudo).not.toContain('somente com preços rígidos');
  expect(tudo).toContain('Minha nota.');
  // Analisar de novo cria outra execução.
  const de_novo = await pedir<{ criada: boolean }>(m.api, `/api/documentos/${m.documento.id}/preparacao`, 'POST', undefined, 201);
  expect(de_novo.criada).toBe(true);
}));

test('apagar tudo meu; "apagar tudo" exige a confirmação digitada', async () => comBanco('apagar_meu', async (banco) => {
  const m = await montar(banco);
  const b6 = m.blocos[6]!;
  await pedir(m.api, '/api/grifos', 'POST', { ancora: ancora(m.versao.id, b6, 'Outro capítulo'), funcao: 'nenhuma' }, 201);
  await pedir(m.api, '/api/anotacoes', 'POST', { ancora: ancora(m.versao.id, b6, 'lido depois'), tipo: 'nota', texto: 'Minha nota.' }, 201);
  expect((await m.api.request(`/api/documentos/${m.documento.id}/apagar`, { method: 'POST', headers: ESCRITA, body: JSON.stringify({ quem: 'tudo' }) })).status).toBe(422);
  expect((await m.api.request(`/api/documentos/${m.documento.id}/apagar`, { method: 'POST', headers: ESCRITA, body: JSON.stringify({ quem: 'outro' }) })).status).toBe(400);
  const resposta = await pedir<{ apagados: { leitor: Record<string, number> } }>(m.api, `/api/documentos/${m.documento.id}/apagar`, 'POST', { quem: 'leitor' });
  expect(resposta.apagados.leitor).toMatchObject({ grifos: 1, notas: 1 });
  expect(await contar(banco, 'SELECT count(*) AS n FROM anotacao')).toBe(0);
  expect(await contar(banco, "SELECT count(*) AS n FROM marca")).toBe(0);
  const tudo = await pedir<{ apagados: { codex: Record<string, number>; leitor: Record<string, number> } }>(m.api,
    `/api/documentos/${m.documento.id}/apagar`, 'POST', { quem: 'tudo', confirmacao: 'apagar tudo' });
  expect(Object.keys(tudo.apagados)).toEqual(['codex', 'leitor']);
}));

test('apagar um item: relação, grifo do Codex e a análise de um capítulo', async () => comBanco('apagar_item', async (banco) => {
  const m = await montar(banco);
  const { compreensao_id: compreensao } = await pedir<{ compreensao_id: Id }>(m.api, `/api/documentos/${m.documento.id}/preparacao`, 'POST', undefined, 201);
  for (let i = 0; i < 4; i += 1) await rodarUm(banco, m.config, m.auditoria, m.slots);
  const base = `/api/compreensoes/${compreensao}/capitulos/${m.capitulo1}`;
  const { relacoes } = await pedir<{ relacoes: { relacao: { id: Id } }[] }>(m.api, `${base}/relacoes?filtro=todas`);
  expect(relacoes.length).toBeGreaterThan(0);
  const alvo = relacoes[0]!.relacao.id;
  // A página Notas (J145) lista as relações da análise com onde apagá-las, e não mostra o que foi apagado.
  const daCentral = async () => (await pedir<{ itens: { id: Id; estado: string | null; analise: { execucao_id: Id; secao_id: Id } | null }[] }>(
    m.api, `/api/notas/central?tipo=relacao&documento=${m.documento.id}&limite=200`)).itens.filter((item) => item.estado === 'da_leitura');
  expect((await daCentral()).find((item) => item.id === alvo)?.analise).toEqual({ execucao_id: compreensao, secao_id: m.capitulo1 });
  expect(await pedir<{ tipo: string }>(m.api, `${base}/itens/${alvo}`, 'DELETE')).toMatchObject({ tipo: 'relacao' });
  expect((await daCentral()).map((item) => item.id)).not.toContain(alvo);
  const depois = await pedir<{ relacoes: { relacao: { id: Id } }[] }>(m.api, `${base}/relacoes?filtro=todas`);
  expect(depois.relacoes.map((r) => r.relacao.id)).not.toContain(alvo);
  const capitulo = await pedir<{ modelo: { relacoes: { id: Id }[] } }>(m.api, base);
  expect(capitulo.modelo.relacoes.map((r) => r.id)).not.toContain(alvo);
  expect((await m.api.request(`${base}/itens/${'0'.repeat(26)}`, { method: 'DELETE', headers: ESCRITA })).status).toBe(404);

  // Um grifo do Codex: some do capítulo e as relações que o tocam também.
  const snapshot = await pedir<{ marcas: { id: Id; origem: string }[] }>(m.api, `/api/versoes/${m.versao.id}/capitulos/${m.capitulo1}`);
  const grifo = snapshot.marcas.find((marca) => marca.origem === 'projecao');
  expect(grifo).toBeDefined();
  await pedir(m.api, `/api/marcas/${grifo?.id ?? ''}`, 'DELETE');
  const semGrifo = await pedir<{ marcas: { id: Id }[] }>(m.api, `/api/versoes/${m.versao.id}/capitulos/${m.capitulo1}`);
  expect(semGrifo.marcas.map((marca) => marca.id)).not.toContain(grifo?.id);
  // Nas Notas, as relações da leitura do capítulo são as que o capítulo ainda mostra (sem as que tocavam o grifo).
  const vivas = (await pedir<{ modelo: { relacoes: { id: Id }[] } }>(m.api, base)).modelo.relacoes.map((r) => r.id);
  const doCapitulo = (await daCentral()).filter((item) => item.analise?.secao_id === m.capitulo1).map((item) => item.id);
  expect(doCapitulo.every((id) => vivas.includes(id))).toBe(true);
  expect((await m.api.request(`/api/marcas/${grifo?.id ?? ''}`, { method: 'DELETE', headers: ESCRITA })).status).toBe(404);

  // A análise do capítulo 1 inteira: volta a "não preparado" e pode ser preparada de novo.
  await pedir(m.api, `/api/documentos/${m.documento.id}/apagar`, 'POST', { quem: 'codex', secao_id: m.capitulo1 });
  expect(await contar(banco, 'SELECT count(*) AS n FROM modelo_capitulo WHERE secao_id=$1', [m.capitulo1])).toBe(0);
  expect(await contar(banco, 'SELECT count(*) AS n FROM elemento_apagado')).toBe(0);
  const situacao = await pedir<Situacao>(m.api, `/api/documentos/${m.documento.id}/preparacao`);
  expect(situacao.capitulos.find((c) => c.secao_id === m.capitulo1)?.estado).toBe('nao_preparado');
  expect((await m.api.request(`/api/documentos/${m.documento.id}/apagaveis?secao=${'0'.repeat(26)}`)).status).toBe(404);
}));

test('modelo D: o grifo apagado leva a nota e os sinais; os lotes levam as dificuldades de cada um', async () => comBanco('apagar_modelo_d', async (banco) => {
  const m = await montar(banco);
  const { compreensao_id: compreensao } = await pedir<{ compreensao_id: Id }>(m.api, `/api/documentos/${m.documento.id}/preparacao`, 'POST', undefined, 201);
  for (let i = 0; i < 4; i += 1) await rodarUm(banco, m.config, m.auditoria, m.slots);
  const base = `/api/compreensoes/${compreensao}/capitulos/${m.capitulo1}`;
  const capitulo = await pedir<{ modelo: { id: Id; dificuldades: { id: Id }[] } }>(m.api, base);
  const sugeridas = capitulo.modelo.dificuldades;
  expect(sugeridas.length).toBeGreaterThan(0);
  const snapshot = await pedir<{ marcas: { id: Id; origem: string }[] }>(m.api, `/api/versoes/${m.versao.id}/capitulos/${m.capitulo1}`);
  const doCodex = snapshot.marcas.filter((marca) => marca.origem === 'projecao');
  expect(doCodex.length).toBeGreaterThan(1);

  // 1. Grifo do Codex com a nota do leitor e um sinal dele: apagar o grifo leva os dois.
  const alvo = doCodex[0]!.id;
  await pedir(m.api, `/api/marcas/${alvo}/nota-do-leitor`, 'PUT', { texto: 'Nota no grifo do Codex.' });
  const marca = (await banco.query<{ bloco_id: Id; inicio_utf16: number; fim_utf16: number; citacao: string; prefixo: string; sufixo: string }>(
    'SELECT bloco_id, inicio_utf16, fim_utf16, citacao, prefixo, sufixo FROM marca WHERE id=$1', [alvo])).rows[0]!;
  const ancoraDoGrifo = { versao_id: m.versao.id, ...marca, inicio_utf16: Number(marca.inicio_utf16), fim_utf16: Number(marca.fim_utf16) };
  await pedir(m.api, '/api/dificuldades', 'POST', { ancora: ancoraDoGrifo, marca_id: alvo }, 201);
  expect(await contar(banco, 'SELECT count(*) AS n FROM anotacao WHERE marca_id=$1', [alvo])).toBe(1);
  await pedir(m.api, `/api/marcas/${alvo}`, 'DELETE');
  expect(await contar(banco, 'SELECT count(*) AS n FROM anotacao')).toBe(0);
  expect(await contar(banco, 'SELECT count(*) AS n FROM dificuldade')).toBe(0);
  const notas = await pedir<{ itens: unknown[] }>(m.api, `/api/notas?documento=${m.documento.id}`);
  expect(JSON.stringify(notas.itens)).not.toContain('Nota no grifo do Codex.');

  // 2. Apagar a dificuldade do Codex (item da análise) leva a decisão do leitor sobre ela.
  const primeira = sugeridas[0]!.id;
  await pedir(m.api, '/api/dificuldades/codex', 'POST', { modelo_id: capitulo.modelo.id, dificuldade_id: primeira, estado: 'confirmada' });
  expect(await contar(banco, "SELECT count(*) AS n FROM dificuldade WHERE origem='codex'")).toBe(1);
  expect(await pedir<{ tipo: string }>(m.api, `${base}/itens/${primeira}`, 'DELETE')).toMatchObject({ tipo: 'dificuldade' });
  expect(await contar(banco, "SELECT count(*) AS n FROM dificuldade WHERE origem='codex'")).toBe(0);
  const semEla = await pedir<{ modelo: { dificuldades: { id: Id }[] } }>(m.api, base);
  expect(semEla.modelo.dificuldades.map((d) => d.id)).not.toContain(primeira);

  // 3. Lotes: "tudo meu" leva as dificuldades do leitor; "a análise do Codex" leva as decisões sobre as dele,
  //    e avisa da nota que o leitor pôs num grifo do Codex (que sai com o grifo).
  const outro = doCodex[1]!.id;
  await pedir(m.api, `/api/marcas/${outro}/nota-do-leitor`, 'PUT', { texto: 'Outra nota.' });
  const b6 = m.blocos[6]!;
  await pedir(m.api, '/api/dificuldades', 'POST', { ancora: ancora(m.versao.id, b6, 'lido depois') }, 201);
  if (sugeridas[1]) await pedir(m.api, '/api/dificuldades/codex', 'POST', { modelo_id: capitulo.modelo.id, dificuldade_id: sugeridas[1].id, estado: 'descartada' });
  const conta = await pedir<Apagaveis>(m.api, `/api/documentos/${m.documento.id}/apagaveis`);
  expect(total(conta.leitor, 'dificuldades')).toBe(1);
  expect(total(conta.leitor, 'notas')).toBe(1);
  expect(total(conta.codex, 'do_leitor_nos_grifos')).toBe(1);
  await pedir(m.api, `/api/documentos/${m.documento.id}/apagar`, 'POST', { quem: 'leitor' });
  expect(await contar(banco, "SELECT count(*) AS n FROM dificuldade WHERE origem='leitor'")).toBe(0);
  expect(await contar(banco, 'SELECT count(*) AS n FROM anotacao')).toBe(0);
  await pedir(m.api, `/api/documentos/${m.documento.id}/apagar`, 'POST', { quem: 'codex' });
  expect(await contar(banco, 'SELECT count(*) AS n FROM dificuldade')).toBe(0);
  const obsidian = await pedir<{ notas: { conteudo: string }[] }>(m.api, `/api/obsidian/v2/documentos/${m.documento.id}`);
  const tudo = obsidian.notas.map((nota) => nota.conteudo).join('\n');
  expect(tudo).not.toContain('Outra nota.');
  expect(tudo).not.toContain('## Dificuldades');
}));
