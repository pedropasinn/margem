/**
 * J14: rotas de operação e proveniência, contra o Postgres de teste (`margem_test_*`) e o
 * executor falso. Nenhuma chamada real ao Codex.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import pg from 'pg';
import type { Hono } from 'hono';
import type { CanonicoV1, Id } from '@margem/contratos';
import { conferirGeometria, validarGeometria } from '@margem/contratos';
import {
  caminhoDoRoteiro, caminhoDoSchemaDoLeitor, canonicoDeTeste, comBanco,
  textosDaRevisao, textosDoPrompt, VERSOES,
} from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import { carregarRoteiro, criarExecutorFalso, type PassoRoteiro, type Roteiro } from '../executor/fake.js';
import * as documentos from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import * as marcasRepo from '../repos/marcas.js';
import { iniciarExecucao, TIPO_LER_PARTE, TIPO_REVISAR, type ConfiguracaoDaLeitura } from '../leitura/manipuladores.js';
import { manipuladorCanonizar, TIPO_CANONIZAR } from '../worker/canonizar.js';
import { manipuladoresDaLeitura } from '../worker/manipuladores-leitura.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { Worker, type AnotacaoWorker } from '../worker/worker.js';
import { pastaDaVersao, raizDoRepositorio } from '../dados.js';
import { criarApi, lerFaixaDePaginas } from './app.js';
import { OuvinteDeEventos, ouvinteDoPool } from './ouvinte.js';

const temporarios: string[] = [];
const dadosOriginais = process.env.MARGEM_DADOS;
const ESCRITA = { 'X-Margem': '1' };

afterEach(async () => {
  for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true });
  if (dadosOriginais === undefined) delete process.env.MARGEM_DADOS;
  else process.env.MARGEM_DADOS = dadosOriginais;
});

async function temporario(prefixo: string): Promise<string> {
  const diretorio = await mkdtemp(join(tmpdir(), prefixo));
  temporarios.push(diretorio);
  return diretorio;
}

async function passosDe(nome: string): Promise<PassoRoteiro> {
  const passo = (await carregarRoteiro(caminhoDoRoteiro(nome))).passos[0];
  if (!passo) throw new Error(`Roteiro ${nome} vazio.`);
  return passo;
}

async function configurar(banco: pg.Pool, roteiro: Roteiro): Promise<ConfiguracaoDaLeitura> {
  return {
    banco,
    executor: criarExecutorFalso(roteiro),
    versoes: VERSOES,
    textos: textosDoPrompt(),
    caminhoSchemaLeitor: caminhoDoSchemaDoLeitor(),
    revisao: textosDaRevisao(),
    modelo: 'modelo-pedido',
    esforco: 'alto',
    diretorioArtefatos: await temporario('margem-j14-artefatos-'),
    prazoMs: 20_000,
  };
}

async function rodarWorker(
  banco: pg.Pool, config: ConfiguracaoDaLeitura, ciclos: number, anotacoes: AnotacaoWorker[] = [],
): Promise<void> {
  const worker = new Worker({
    fila: new FilaPostgres(banco),
    manipuladores: {
      [TIPO_CANONIZAR]: manipuladorCanonizar({ banco, raiz: raizDoRepositorio(), prazoMs: 120_000 }),
      ...manipuladoresDaLeitura(config),
    },
    diretorioSlots: await temporario('margem-j14-vagas-'),
    slots: 1,
    intervaloMs: 5,
    heartbeatMs: 60_000,
    maximoCiclos: ciclos,
    anotar: (anotacao) => { anotacoes.push(anotacao); },
  });
  await worker.rodar();
}

/** Um capítulo ou dois; com dois, o plano tem duas partes. */
function livro(capitulos: 1 | 2): CanonicoV1 {
  return canonicoDeTeste({
    titulo: 'Livro de teste',
    blocos: [
      { tipo: 'capitulo', texto: 'Capítulo um' },
      { tipo: 'paragrafo', texto: 'Uma tese central organiza o argumento do capítulo.' },
      { tipo: 'paragrafo', texto: 'Um conceito vale somente sob certas condições declaradas.' },
      { tipo: capitulos === 2 ? 'capitulo' : 'secao', texto: 'Segunda parte' },
      { tipo: 'paragrafo', texto: 'A justificativa aparece com uma evidência decisiva.' },
    ],
    secoes: capitulos === 2
      ? [{ nivel: 1, inicio: 0, fim: 2 }, { nivel: 1, inicio: 3, fim: 4 }]
      : [{ nivel: 1, inicio: 0, fim: 4 }, { nivel: 2, inicio: 3, fim: 4 }],
  });
}

async function publicarLivro(banco: pg.Pool, canonico: CanonicoV1): Promise<documentos.VersaoTexto> {
  return comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
    return documentos.criarVersao(cliente, documento.id, canonico);
  });
}

async function corpo<T>(resposta: Response): Promise<T> {
  return await resposta.json() as T;
}

async function job(banco: pg.Pool, id: Id): Promise<jobsRepo.Job> {
  const linha = await comTransacao(banco, (cliente) => jobsRepo.obter(cliente, id));
  if (!linha) throw new Error('job sumiu');
  return linha;
}

async function eventos(banco: pg.Pool, jobId: Id): Promise<{ tipo: string; detalhe: Record<string, unknown> }[]> {
  return (await banco.query<{ tipo: string; detalhe: Record<string, unknown> }>(
    'SELECT tipo, detalhe FROM evento_job WHERE job_id=$1 ORDER BY id', [jobId])).rows;
}

async function ate(condicao: () => Promise<boolean> | boolean, prazoMs = 10_000): Promise<void> {
  const limite = Date.now() + prazoMs;
  while (!(await condicao())) {
    if (Date.now() > limite) throw new Error('condição não chegou no prazo');
    await new Promise((resolver) => setTimeout(resolver, 20));
  }
}

// ---------------------------------------------------------------- 1. faixa de páginas

test('faixa de páginas: validação da forma a-b', () => {
  expect(lerFaixaDePaginas(undefined)).toBeNull();
  expect(lerFaixaDePaginas('')).toBeNull();
  expect(lerFaixaDePaginas('2-3')).toEqual({ inicio: 2, fim: 3 });
  expect(lerFaixaDePaginas('7-7')).toEqual({ inicio: 7, fim: 7 });
  for (const ruim of ['0-3', '3-1', '-1-2', '2', 'a-b', '1-2-3', '1.5-2', '1 - 2', '99999999999-99999999999']) {
    expect(() => lerFaixaDePaginas(ruim), ruim).toThrow();
  }
});

test('PDF com paginas=2-3 é canonizado só nessas páginas; faixa ruim ou formato errado dão 400', async () =>
  comBanco('j14_paginas', async (banco) => {
    process.env.MARGEM_DADOS = await temporario('margem-j14-dados-');
    const pasta = await temporario('margem-j14-pdf-');
    const pdf = join(pasta, 'quatro.pdf');
    // PDF sintético de quatro páginas, gerado pelo pymupdf do próprio motor (sem rede).
    execFileSync(join(raizDoRepositorio(), 'motor/.venv/bin/python'), ['-c', [
      'import sys, pymupdf',
      'd = pymupdf.open()',
      'for n in range(1, 5):',
      '    p = d.new_page()',
      '    p.insert_text((72, 100), f"Texto da pagina numero {n} com frase completa.", fontsize=12)',
      'd.save(sys.argv[1])',
    ].join('\n'), pdf]);
    const bytes = await readFile(pdf);
    const config = await configurar(banco, { versao: 1, passos: [await passosDe('leitor-ok')] });
    const api = criarApi({ banco, leitura: () => config, intervaloEventosMs: 20 });
    const formulario = (paginas: string | null, formato = 'pdf') => {
      const f = new FormData();
      f.set('titulo', 'Quatro páginas');
      f.set('formato', formato);
      if (paginas !== null) f.set('paginas', paginas);
      f.set('arquivo', new File([bytes], 'quatro.pdf', { type: formato === 'pdf' ? 'application/pdf' : 'text/plain' }));
      return f;
    };

    for (const ruim of ['3-2', '0-1', 'x', '2-']) {
      const resposta = await api.request('/api/documentos', { method: 'POST', headers: ESCRITA, body: formulario(ruim) });
      expect(resposta.status, ruim).toBe(400);
      expect(await corpo<{ erro: string }>(resposta)).toMatchObject({ erro: 'paginas_invalidas' });
    }
    const txt = await api.request('/api/documentos', { method: 'POST', headers: ESCRITA, body: formulario('1-2', 'txt') });
    expect(txt.status).toBe(400);
    expect(await corpo<{ erro: string }>(txt)).toMatchObject({ erro: 'paginas_so_pdf' });
    // Nada foi gravado pelos pedidos recusados.
    expect((await banco.query('SELECT count(*)::int AS n FROM documento')).rows[0]).toEqual({ n: 0 });

    const envio = await api.request('/api/documentos', { method: 'POST', headers: ESCRITA, body: formulario('2-3') });
    expect(envio.status).toBe(202);
    const { documento_id, paginas } = await corpo<{ documento_id: Id; paginas: string }>(envio);
    expect(paginas).toBe('2-3');
    expect((await banco.query('SELECT paginas_inicio, paginas_fim FROM documento WHERE id=$1', [documento_id])).rows[0])
      .toEqual({ paginas_inicio: 2, paginas_fim: 3 });

    await rodarWorker(banco, config, 2);
    const versao = (await banco.query<{ id: Id; canonico: CanonicoV1 }>(
      'SELECT id, canonico FROM versao_texto WHERE documento_id=$1', [documento_id])).rows[0];
    expect(versao).toBeDefined();
    if (!versao) throw new Error('Versão não publicada.');
    const pastaPublicada = pastaDaVersao(documento_id, versao.id);
    const geometriaTexto = await readFile(join(pastaPublicada, 'geometria.json'), 'utf8');
    const geometria: unknown = JSON.parse(geometriaTexto);
    expect(validarGeometria(geometria)).toBe(true);
    if (!validarGeometria(geometria)) throw new Error('Geometria inválida.');
    expect(geometria.versao_id).toBe(versao.id);
    expect(conferirGeometria(geometria, versao.canonico)).toBe(true);
    // O original mantém todas as páginas; só as palavras pertencem à faixa canonizada.
    expect(geometria.paginas.map((pagina) => pagina.numero)).toEqual([1, 2, 3, 4]);
    expect([...new Set(geometria.palavras.map((palavra) => palavra.pagina))]).toEqual([2, 3]);
    const manifesto = JSON.parse(await readFile(join(pastaPublicada, 'manifesto.json'), 'utf8')) as {
      versao_id: string; arquivos: { caminho: string; sha256: string }[];
    };
    expect(manifesto.versao_id).toBe(versao.id);
    expect(manifesto.arquivos).toContainEqual({ caminho: 'geometria.json', sha256: createHash('sha256').update(geometriaTexto).digest('hex') });
    const recorte = await api.request(`/api/versoes/${versao.id}/geometria?paginas=2-2`);
    expect(recorte.status).toBe(200);
    const corpoRecorte = await corpo<{ palavras: { pagina: number }[] }>(recorte);
    expect(corpoRecorte.palavras.length).toBeGreaterThan(0);
    expect(corpoRecorte.palavras.every((palavra) => palavra.pagina === 2)).toBe(true);
    const original = await api.request(`/api/documentos/${documento_id}/original`);
    expect(Buffer.from(await original.arrayBuffer())).toEqual(bytes);
    const texto = versao?.canonico.blocos.map((bloco) => bloco.texto).join('\n') ?? '';
    expect(texto).toContain('numero 2');
    expect(texto).toContain('numero 3');
    expect(texto).not.toContain('numero 1');
    expect(texto).not.toContain('numero 4');
    expect(versao?.canonico.canonizacao.config).toMatchObject({ paginas: [2, 3] });

    // Sem a faixa, o mesmo PDF é canonizado inteiro.
    const inteiro = await api.request('/api/documentos', { method: 'POST', headers: ESCRITA, body: formulario(null) });
    const outro = (await corpo<{ documento_id: Id }>(inteiro)).documento_id;
    await rodarWorker(banco, config, 2);
    const todo = (await banco.query<{ canonico: CanonicoV1 }>(
      'SELECT canonico FROM versao_texto WHERE documento_id=$1', [outro])).rows[0];
    const textoTodo = todo?.canonico.blocos.map((bloco) => bloco.texto).join('\n') ?? '';
    expect(textoTodo).toContain('numero 1');
    expect(textoTodo).toContain('numero 4');
  }));

// ---------------------------------------------------------------- 2. arquivar

test('arquivar e desarquivar são idempotentes; a biblioteca esconde os arquivados por padrão', async () =>
  comBanco('j14_arquivar', async (banco) => {
    const config = await configurar(banco, { versao: 1, passos: [await passosDe('leitor-ok')] });
    const api = criarApi({ banco, leitura: () => config, intervaloEventosMs: 20 });
    const a = await publicarLivro(banco, livro(1));
    const b = await publicarLivro(banco, livro(1));
    const ids = async (consulta = '') => (await corpo<{ documentos: { id: Id; arquivado_em: string | null }[] }>(
      await api.request(`/api/documentos${consulta}`))).documentos.map((item) => item.id);

    expect((await ids()).sort()).toEqual([a.documento_id, b.documento_id].sort());
    expect(await ids('?arquivados=1')).toEqual([]);

    const primeiro = await api.request(`/api/documentos/${a.documento_id}/arquivar`, { method: 'POST', headers: ESCRITA });
    expect(primeiro.status).toBe(200);
    const arquivado = await corpo<{ arquivado: boolean; arquivado_em: string }>(primeiro);
    expect(arquivado.arquivado).toBe(true);
    const segundo = await corpo<{ arquivado_em: string }>(
      await api.request(`/api/documentos/${a.documento_id}/arquivar`, { method: 'POST', headers: ESCRITA }));
    // Idempotente: a data do primeiro arquivamento não muda.
    expect(segundo.arquivado_em).toBe(arquivado.arquivado_em);

    expect(await ids()).toEqual([b.documento_id]);
    expect(await ids('?arquivados=1')).toEqual([a.documento_id]);
    // O detalhe continua acessível e nada foi apagado.
    const detalhe = await corpo<{ arquivado_em: string | null; texto_disponivel: boolean }>(
      await api.request(`/api/documentos/${a.documento_id}`));
    expect(detalhe).toMatchObject({ texto_disponivel: true });
    expect(detalhe.arquivado_em).not.toBeNull();
    expect((await banco.query('SELECT count(*)::int AS n FROM versao_texto')).rows[0]).toEqual({ n: 2 });

    for (let vez = 0; vez < 2; vez += 1) {
      const volta = await api.request(`/api/documentos/${a.documento_id}/desarquivar`, { method: 'POST', headers: ESCRITA });
      expect(volta.status).toBe(200);
      expect(await corpo<{ arquivado: boolean; arquivado_em: null }>(volta)).toMatchObject({ arquivado: false, arquivado_em: null });
    }
    expect((await ids()).sort()).toEqual([a.documento_id, b.documento_id].sort());

    const inexistente = await api.request(`/api/documentos/${'0'.repeat(26)}/arquivar`, { method: 'POST', headers: ESCRITA });
    expect(inexistente.status).toBe(404);
    const semCabecalho = await api.request(`/api/documentos/${a.documento_id}/arquivar`, { method: 'POST' });
    expect(semCabecalho.status).toBe(403);
  }));

// ---------------------------------------------------------------- 3. cancelar e reenfileirar

test('cancelar aceita pendente e adiado; reenfileirar aceita falhou e cancelado; o resto é 409', async () =>
  comBanco('j14_cancelar', async (banco) => {
    const config = await configurar(banco, { versao: 1, passos: [await passosDe('leitor-ok')] });
    const api = criarApi({ banco, leitura: () => config, intervaloEventosMs: 20 });
    const versao = await publicarLivro(banco, livro(1));
    const inicio = await iniciarExecucao(config, versao.id);
    const parte = inicio.jobs.find((item) => item.tipo === TIPO_LER_PARTE)?.id ?? '';
    const revisao = inicio.jobs.find((item) => item.tipo === TIPO_REVISAR)?.id ?? '';
    const post = (caminho: string) => api.request(caminho, { method: 'POST', headers: ESCRITA });

    // A revisão está `fila` com not_before (rede de segurança); a parte, `fila`.
    const cancelada = await post(`/api/jobs/${parte}/cancelar`);
    expect(cancelada.status).toBe(200);
    expect(await corpo<Record<string, unknown>>(cancelada)).toMatchObject({ estado: 'cancelado', alterado: true, estado_anterior: 'fila' });
    // Repetir não é erro: já está cancelado.
    expect(await corpo<Record<string, unknown>>(await post(`/api/jobs/${parte}/cancelar`)))
      .toMatchObject({ estado: 'cancelado', alterado: false });
    expect((await job(banco, parte)).estado).toBe('cancelado');
    // Um job cancelado não é reservado por ninguém.
    expect(await jobsRepo.reservar(banco, 'teste-j14', [TIPO_LER_PARTE])).toBeNull();

    await banco.query(`UPDATE job SET estado='adiado', not_before=now() + interval '1 hour' WHERE id=$1`, [revisao]);
    expect((await post(`/api/jobs/${revisao}/cancelar`)).status).toBe(200);

    // Reenfileirar: tentativa nova, sem not_before e sem pedido de cancelamento.
    const antes = await job(banco, parte);
    const volta = await post(`/api/jobs/${parte}/reenfileirar`);
    expect(volta.status).toBe(200);
    expect(await corpo<Record<string, unknown>>(volta)).toMatchObject({ estado: 'fila', attempt: antes.attempt + 1, estado_anterior: 'cancelado' });
    const depois = await job(banco, parte);
    expect(depois).toMatchObject({ estado: 'fila', not_before: null, cancel_requested_at: null, attempt: antes.attempt + 1 });
    expect((await eventos(banco, parte)).map((evento) => evento.tipo)).toEqual(['enfileirado', 'cancelado', 'reenfileirado']);

    // Reenfileirar o que está na fila é 409; cancelar um `ok` também.
    const naFila = await post(`/api/jobs/${parte}/reenfileirar`);
    expect(naFila.status).toBe(409);
    expect(await corpo<{ erro: string }>(naFila)).toMatchObject({ erro: 'job_nao_reenfileiravel' });
    await banco.query(`UPDATE job SET estado='falhou', error_code='processo', diagnosticos=$2 WHERE id=$1`,
      [revisao, JSON.stringify([{ nivel: 'erro', codigo: 'processo', mensagem: 'A CLI terminou com código 1.' }])]);
    const deFalhou = await post(`/api/jobs/${revisao}/reenfileirar`);
    expect(deFalhou.status).toBe(200);
    const revisaoDepois = await job(banco, revisao);
    expect(revisaoDepois).toMatchObject({ estado: 'fila', not_before: null, error_code: null, diagnosticos: [] });
    // O diagnóstico da tentativa encerrada vai para o histórico.
    const reenfileirado = (await eventos(banco, revisao)).find((evento) => evento.tipo === 'reenfileirado');
    expect(reenfileirado?.detalhe).toMatchObject({ estado_anterior: 'falhou', error_code: 'processo', diagnosticos: [{ codigo: 'processo' }] });

    await banco.query(`UPDATE job SET estado='ok' WHERE id=$1`, [revisao]);
    const deOk = await post(`/api/jobs/${revisao}/cancelar`);
    expect(deOk.status).toBe(409);
    expect(await corpo<{ erro: string }>(deOk)).toMatchObject({ erro: 'job_nao_cancelavel' });
    expect((await post(`/api/jobs/${revisao}/reenfileirar`)).status).toBe(409);

    expect((await post(`/api/jobs/${'0'.repeat(26)}/cancelar`)).status).toBe(404);
    expect((await post(`/api/jobs/${'0'.repeat(26)}/reenfileirar`)).status).toBe(404);
    expect((await post('/api/jobs/nao-e-ulid/cancelar')).status).toBe(400);
  }));

test('cancelar um job em execução: o worker não publica marca nenhuma; reenfileirado, publica e libera a revisão', async () =>
  comBanco('j14_cancelar_exec', async (banco) => {
    const leitor = await passosDe('leitor-ok');
    const config = await configurar(banco, {
      versao: 1,
      passos: [
        // A primeira chamada demora: dá tempo de cancelar enquanto o "Codex" trabalha.
        { ...leitor, quando: { ordem: 1 }, atraso_ms: 1_500 },
        { ...leitor, quando: { ordem: 2 } },
        { ...(await passosDe('revisao-ok')), quando: { ordem: 3 } },
      ],
    });
    const api = criarApi({ banco, leitura: () => config, intervaloEventosMs: 20 });
    const versao = await publicarLivro(banco, livro(1));
    const inicio = await iniciarExecucao(config, versao.id);
    const parte = inicio.jobs.find((item) => item.tipo === TIPO_LER_PARTE)?.id ?? '';
    const revisao = inicio.jobs.find((item) => item.tipo === TIPO_REVISAR)?.id ?? '';

    const anotacoes: AnotacaoWorker[] = [];
    const rodando = rodarWorker(banco, config, 2, anotacoes);
    await ate(async () => (await job(banco, parte)).estado === 'reservado');
    const tokenDoWorker = (await job(banco, parte)).lease_token;
    expect(tokenDoWorker).not.toBeNull();
    const pedido = await api.request(`/api/jobs/${parte}/cancelar`, { method: 'POST', headers: ESCRITA });
    expect(await corpo<Record<string, unknown>>(pedido)).toMatchObject({ estado: 'cancelado', estado_anterior: 'reservado' });
    await rodando;

    // O executor terminou "ok", mas a publicação foi recusada pelo lease_token revogado.
    expect(anotacoes.map((anotacao) => anotacao.evento)).toContain('concessao_perdida');
    expect(anotacoes.map((anotacao) => anotacao.evento)).not.toContain('publicado');
    expect(await comTransacao(banco, (cliente) => marcasRepo.listarPorVersao(cliente, versao.id))).toEqual([]);
    expect((await job(banco, parte))).toMatchObject({ estado: 'cancelado', lease_token: null, output_artifact_hash: null });
    expect((await eventos(banco, parte)).map((evento) => evento.tipo)).not.toContain('publicado');
    expect((await banco.query('SELECT estado FROM parte')).rows).toEqual([{ estado: 'fila' }]);

    // Reenfileirado, o mesmo job roda de novo, publica e libera a revisão sem esperar os 30 min.
    expect((await api.request(`/api/jobs/${parte}/reenfileirar`, { method: 'POST', headers: ESCRITA })).status).toBe(200);
    await rodarWorker(banco, config, 3);
    expect((await job(banco, parte)).estado).toBe('ok');
    expect(await comTransacao(banco, (cliente) => marcasRepo.listarPorVersao(cliente, versao.id))).toHaveLength(3);
    expect((await eventos(banco, revisao)).map((evento) => evento.tipo)).toContain('revisao_liberada');
    expect((await job(banco, revisao)).estado).toBe('ok');
  }));

// ---------------------------------------------------------------- 4. diagnósticos

test('um job que termina ok guarda só os diagnósticos da tentativa vencedora', async () =>
  comBanco('j14_diagnosticos', async (banco) => {
    const config = await configurar(banco, {
      versao: 1,
      passos: [
        { tipo: 'cota', quando: { ordem: 1 }, not_before: '2026-09-21T10:27:00.000Z', mensagem: 'Cota esgotada.' },
        { ...(await passosDe('leitor-ok')), quando: { ordem: 2 } },
      ],
    });
    const versao = await publicarLivro(banco, livro(1));
    const inicio = await iniciarExecucao(config, versao.id);
    const parte = inicio.jobs.find((item) => item.tipo === TIPO_LER_PARTE)?.id ?? '';

    await rodarWorker(banco, config, 1);
    expect(await job(banco, parte)).toMatchObject({ estado: 'adiado', error_code: 'cota' });
    expect((await job(banco, parte)).diagnosticos.map((item) => item.codigo)).toEqual(['cota']);

    await rodarWorker(banco, config, 1);
    const final = await job(banco, parte);
    expect(final.estado).toBe('ok');
    expect(final.diagnosticos.map((item) => item.codigo)).not.toContain('cota');
    // O histórico continua contando a tentativa adiada.
    const historico = await eventos(banco, parte);
    expect(historico.find((evento) => evento.tipo === 'adiado')?.detalhe).toMatchObject({ diagnosticos: [{ codigo: 'cota' }] });
    expect(historico.find((evento) => evento.tipo === 'publicado')?.detalhe).toMatchObject({ diagnosticos_anteriores: [{ codigo: 'cota' }] });
  }));

// ---------------------------------------------------------------- 5 e 6. proveniência e disparo da revisão

test('proveniência vem do executor; parte divergente fica visível; a última parte dispara a revisão', async () =>
  comBanco('j14_proveniencia', async (banco) => {
    const leitor = await passosDe('leitor-ok');
    const config = await configurar(banco, {
      versao: 1,
      passos: [
        { ...leitor, quando: { ordem: 1 }, modelo: 'gpt-6-astra', esforco: 'medio' },
        { ...leitor, quando: { ordem: 2 }, modelo: 'gpt-6-astra', esforco: 'alto' },
        { ...(await passosDe('revisao-ok')), quando: { ordem: 3 }, modelo: 'gpt-6-astra', esforco: 'medio' },
      ],
    });
    const api = criarApi({ banco, leitura: () => config, intervaloEventosMs: 20 });
    const versao = await publicarLivro(banco, livro(2));
    const antes = Date.now();
    const inicio = await iniciarExecucao(config, versao.id);
    expect(inicio.partes).toHaveLength(2);
    const [parte1, parte2] = inicio.jobs.filter((item) => item.tipo === TIPO_LER_PARTE).map((item) => item.id);
    const revisao = inicio.jobs.find((item) => item.tipo === TIPO_REVISAR)?.id ?? '';

    // A revisão nasce esperando a rede de segurança (30 min), não mais 5 min em 5 min.
    const espera = (await job(banco, revisao)).not_before?.getTime() ?? 0;
    expect(espera - antes).toBeGreaterThanOrEqual(30 * 60_000 - 1_000);
    expect(espera - antes).toBeLessThanOrEqual(30 * 60_000 + 5_000);
    const execucao = async () => (await banco.query<{
      modelo: string; esforco: string; modelo_pedido: string; esforco_pedido: string; proveniencia: string; divergencias: unknown[];
    }>('SELECT modelo, esforco, modelo_pedido, esforco_pedido, proveniencia, divergencias FROM execucao_leitura WHERE id=$1',
      [inicio.execucao.id])).rows[0];
    expect(await execucao()).toMatchObject({
      modelo: 'modelo-pedido', esforco: 'alto', modelo_pedido: 'modelo-pedido', proveniencia: 'configuracao',
    });

    // Primeira parte: a execução passa a registrar o que o executor declarou; ter rodado com
    // outro esforço que o pedido também é divergência (o pedido não pode sumir em silêncio).
    await rodarWorker(banco, config, 1);
    expect((await job(banco, parte1 ?? '')).estado).toBe('ok');
    const divergenciaDoPedido = {
      papel: 'parte', job_id: parte1, parte_id: inicio.partes[0]?.id, modelo: 'gpt-6-astra', esforco: 'medio',
      esperado: { modelo: 'gpt-6-astra', esforco: 'alto' },
    };
    expect(await execucao()).toMatchObject({
      modelo: 'gpt-6-astra', esforco: 'medio', modelo_pedido: 'modelo-pedido', esforco_pedido: 'alto',
      proveniencia: 'executor', divergencias: [divergenciaDoPedido],
    });
    // Ainda falta uma parte: a revisão continua esperando.
    expect((await job(banco, revisao)).not_before).not.toBeNull();
    expect((await eventos(banco, revisao)).map((evento) => evento.tipo)).not.toContain('revisao_liberada');

    // Segunda parte (a última): diverge no esforço e libera a revisão; o worker a roda em seguida.
    await rodarWorker(banco, config, 2);
    const segunda = await job(banco, parte2 ?? '');
    expect(segunda.estado).toBe('ok');
    expect(segunda.diagnosticos.find((item) => item.codigo === 'proveniencia_divergente')?.mensagem)
      .toContain('gpt-6-astra (alto)');
    const final = await execucao();
    expect(final?.modelo).toBe('gpt-6-astra');
    expect(final?.esforco).toBe('medio');
    expect(final?.divergencias).toEqual([divergenciaDoPedido, {
      papel: 'parte', job_id: parte2, parte_id: inicio.partes[1]?.id, modelo: 'gpt-6-astra', esforco: 'alto',
      esperado: { modelo: 'gpt-6-astra', esforco: 'medio' },
    }]);
    const liberada = (await eventos(banco, revisao)).find((evento) => evento.tipo === 'revisao_liberada');
    expect(liberada?.detalhe).toMatchObject({ execucao_id: inicio.execucao.id, pela_parte: parte2 });
    expect((await job(banco, revisao)).estado).toBe('ok');

    // O detalhe do documento mostra a divergência e o diagnóstico do job.
    const detalhe = await corpo<{
      execucoes: { modelo: string; proveniencia: string; divergencias: unknown[] }[];
      jobs: { id: Id; diagnosticos: { codigo: string }[] }[];
    }>(await api.request(`/api/documentos/${versao.documento_id}`));
    expect(detalhe.execucoes[0]).toMatchObject({ modelo: 'gpt-6-astra', proveniencia: 'executor' });
    expect(detalhe.execucoes[0]?.divergencias).toHaveLength(2);
    expect(detalhe.jobs.find((item) => item.id === parte2)?.diagnosticos.map((item) => item.codigo))
      .toContain('proveniencia_divergente');
  }));

test('o worker roda as partes e a revisão com o esforço pedido pela execução, não com o próprio padrão', async () =>
  comBanco('esforco_pedido', async (banco) => {
    const leitor = await passosDe('leitor-ok');
    // O worker está configurado com `alto`; a execução pediu `medium`. O executor declara o que recebeu.
    const doWorker = await configurar(banco, {
      versao: 1,
      passos: [
        { ...leitor, quando: { ordem: 1 } },
        { ...(await passosDe('revisao-ok')), quando: { ordem: 2 } },
      ],
    });
    const recebidos: (string | undefined)[] = [];
    const executor = doWorker.executor;
    const config: ConfiguracaoDaLeitura = { ...doWorker, executor: (pedido) => { recebidos.push(pedido.esforco); return executor(pedido); } };
    const versao = await publicarLivro(banco, livro(1));
    const inicio = await iniciarExecucao({ ...config, esforco: 'medium' }, versao.id);
    await rodarWorker(banco, config, 2);
    expect(recebidos).toEqual(['medium', 'medium']);
    const linha = (await banco.query<{ esforco: string; esforco_pedido: string; divergencias: unknown[] }>(
      'SELECT esforco, esforco_pedido, divergencias FROM execucao_leitura WHERE id=$1', [inicio.execucao.id])).rows[0];
    expect(linha).toEqual({ esforco: 'medium', esforco_pedido: 'medium', divergencias: [] });
  }));

// ---------------------------------------------------------------- 7. SSE com LISTEN/NOTIFY

interface LeitorSse {
  /** Espera um evento do tipo pedido que ainda não foi consumido. */
  esperar: (tipo: string, prazoMs: number) => Promise<{ id: string; tipo: string }>;
  fechar: () => Promise<void>;
}

async function abrirSse(api: Hono, desde: string): Promise<LeitorSse> {
  const resposta = await api.request('/api/eventos', { headers: { 'last-event-id': desde } });
  const leitor = resposta.body?.getReader();
  if (!leitor) throw new Error('SSE sem corpo');
  const decodificador = new TextDecoder();
  const recebidos: { id: string; tipo: string }[] = [];
  let bruto = '';
  let fim = false;
  const bombear = (async () => {
    for (;;) {
      const passo: { done: boolean; value?: Uint8Array } = await leitor.read()
        .catch(() => ({ done: true, value: undefined }));
      if (passo.done || passo.value === undefined) { fim = true; return; }
      bruto += decodificador.decode(passo.value, { stream: true });
      const blocos = bruto.split('\n\n');
      bruto = blocos.pop() ?? '';
      for (const bloco of blocos) {
        const id = /^id:\s*(\d+)$/m.exec(bloco)?.[1];
        const tipo = /^event:\s*(\S+)$/m.exec(bloco)?.[1];
        if (id !== undefined && tipo !== undefined) recebidos.push({ id, tipo });
      }
    }
  })();
  return {
    esperar: async (tipo, prazoMs) => {
      const limite = Date.now() + prazoMs;
      for (;;) {
        const indice = recebidos.findIndex((evento) => evento.tipo === tipo);
        if (indice >= 0) return recebidos.splice(indice, 1)[0] ?? { id: '', tipo };
        if (fim || Date.now() > limite) throw new Error(`evento ${tipo} não chegou em ${String(prazoMs)} ms`);
        await new Promise((resolver) => setTimeout(resolver, 10));
      }
    },
    fechar: async () => { await leitor.cancel(); await bombear; },
  };
}

async function novoJob(banco: pg.Pool, chave: string): Promise<Id> {
  return (await comTransacao(banco, (cliente) => jobsRepo.enfileirar(cliente, {
    tipo: 'teste_j14', dedup_key: chave, input_snapshot_hash: 'b'.repeat(64),
  }))).id;
}

test('SSE por LISTEN/NOTIFY: o evento chega sem esperar a varredura, rollback não avisa e a queda reconecta', async () =>
  comBanco('j14_notify', async (banco) => {
    const config = await configurar(banco, { versao: 1, passos: [await passosDe('leitor-ok')] });
    const ouvinte = ouvinteDoPool(banco, { esperaInicialMs: 20 });
    // Varredura de segurança de um minuto: se o evento chegar em segundos, foi o NOTIFY.
    const api = criarApi({ banco, leitura: () => config, ouvinte, intervaloEventosMs: 60_000 });
    let sse: LeitorSse | undefined;
    try {
      await ouvinte.iniciar();
      expect(ouvinte.ouvindo).toBe(true);
      sse = await abrirSse(api, '0');

      const inicio = Date.now();
      const primeiro = await novoJob(banco, 'j14:um');
      const chegou = await sse.esperar('enfileirado', 5_000);
      expect(Date.now() - inicio).toBeLessThan(5_000);
      expect(ouvinte.avisos).toBeGreaterThanOrEqual(1);
      const ultimo = (await banco.query<{ id: string }>('SELECT max(id)::text AS id FROM evento_job WHERE job_id=$1', [primeiro])).rows[0];
      expect(chegou.id).toBe(ultimo?.id);

      // O NOTIFY é da transação que grava o evento: rollback não avisa ninguém.
      const avisosAntes = ouvinte.avisos;
      await comTransacao(banco, async (cliente) => {
        await jobsRepo.enfileirar(cliente, { tipo: 'teste_j14', dedup_key: 'j14:desfeito', input_snapshot_hash: 'b'.repeat(64) });
        throw new Error('desfaz');
      }).catch(() => undefined);
      await new Promise((resolver) => setTimeout(resolver, 300));
      expect(ouvinte.avisos).toBe(avisosAntes);

      // Queda da conexão dedicada: o ouvinte reconecta sozinho e o fluxo continua.
      ouvinte.derrubarParaTeste();
      expect(ouvinte.ouvindo).toBe(false);
      await ate(() => ouvinte.conexoes >= 2 && ouvinte.ouvindo, 5_000);
      await novoJob(banco, 'j14:dois');
      await sse.esperar('enfileirado', 5_000);
    } finally {
      await sse?.fechar();
      await ouvinte.encerrar();
    }
  }));

test('SSE sem LISTEN: com a conexão dedicada fora do ar, a varredura de segurança continua entregando', async () =>
  comBanco('j14_fallback', async (banco) => {
    const config = await configurar(banco, { versao: 1, passos: [await passosDe('leitor-ok')] });
    const anotacoes: string[] = [];
    // Porta 1 em loopback recusa na hora: o ouvinte nunca consegue escutar.
    const ouvinte = new OuvinteDeEventos({
      conectar: () => new pg.Client({ host: '127.0.0.1', port: 1, connectionTimeoutMillis: 500 }),
      esperaInicialMs: 20, esperaMaximaMs: 80,
      anotar: (evento) => { anotacoes.push(evento); },
    });
    const api = criarApi({ banco, leitura: () => config, ouvinte, intervaloEventosMs: 150 });
    let sse: LeitorSse | undefined;
    try {
      await ouvinte.iniciar();
      expect(ouvinte.ouvindo).toBe(false);
      sse = await abrirSse(api, '0');
      await novoJob(banco, 'j14:varredura');
      await sse.esperar('enfileirado', 5_000);
      expect(ouvinte.avisos).toBe(0);
      // E continua tentando reconectar, com espera crescente.
      await ate(() => anotacoes.filter((evento) => evento === 'reconectando').length >= 2, 5_000);
    } finally {
      await sse?.fechar();
      await ouvinte.encerrar();
    }
  }));
