import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import type pg from 'pg';
import type { Hono } from 'hono';
import type { CanonicoV1, Id, LoteRevisaoV2, MarcaV1, ProgressoV1 } from '@margem/contratos';
import { hashMarcas } from '@margem/contratos';
import {
  caminhoDoRoteiro, caminhoDoSchemaDoLeitor, canonicoDeTeste, comBanco, contadorDeIds,
  idTeste, textosDaRevisao, textosDoPrompt, VERSOES,
} from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import { carregarRoteiro, criarExecutorFalso } from '../executor/fake.js';
import * as documentos from '../repos/documentos.js';
import * as marcasRepo from '../repos/marcas.js';
import { iniciarExecucao, type ConfiguracaoDaLeitura } from '../leitura/manipuladores.js';
import { manipuladorCanonizar, TIPO_CANONIZAR } from '../worker/canonizar.js';
import { manipuladoresDaLeitura } from '../worker/manipuladores-leitura.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { Worker } from '../worker/worker.js';
import { pastaDaVersao, raizDoRepositorio } from '../dados.js';
import { criarApi } from './app.js';
import { LIMITE_UPLOAD_BYTES } from './ambiente.js';

const temporarios: string[] = [];
const dadosOriginais = process.env.MARGEM_DADOS;

afterEach(async () => {
  for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true });
  if (dadosOriginais === undefined) delete process.env.MARGEM_DADOS;
  else process.env.MARGEM_DADOS = dadosOriginais;
});

async function comDadosTemporarios(): Promise<string> {
  const diretorio = await mkdtemp(join(tmpdir(), 'margem-j07-dados-'));
  temporarios.push(diretorio);
  process.env.MARGEM_DADOS = diretorio;
  return diretorio;
}

async function configurar(banco: pg.Pool, roteiro = 'leitor-ok'): Promise<ConfiguracaoDaLeitura> {
  const diretorio = await mkdtemp(join(tmpdir(), 'margem-j07-artefatos-'));
  temporarios.push(diretorio);
  return {
    banco,
    executor: criarExecutorFalso(await carregarRoteiro(caminhoDoRoteiro(roteiro))),
    versoes: VERSOES,
    textos: textosDoPrompt(),
    caminhoSchemaLeitor: caminhoDoSchemaDoLeitor(),
    revisao: textosDaRevisao(),
    modelo: 'modelo-de-teste',
    esforco: 'alto',
    diretorioArtefatos: diretorio,
    prazoMs: 10_000,
    novoId: contadorDeIds('M'),
    agora: () => new Date('2026-09-20T12:00:00.000Z'),
  };
}

function montar(banco: pg.Pool, config: ConfiguracaoDaLeitura): Hono {
  return criarApi({ banco, leitura: () => config, intervaloEventosMs: 20 });
}

/** Roda o worker por alguns ciclos, com vagas próprias e a fila do Postgres. */
async function rodarWorker(banco: pg.Pool, config: ConfiguracaoDaLeitura, ciclos = 3): Promise<void> {
  const vagas = await mkdtemp(join(tmpdir(), 'margem-j07-vagas-'));
  temporarios.push(vagas);
  const worker = new Worker({
    fila: new FilaPostgres(banco),
    manipuladores: {
      [TIPO_CANONIZAR]: manipuladorCanonizar({ banco, raiz: raizDoRepositorio(), prazoMs: 120_000 }),
      ...manipuladoresDaLeitura(config),
    },
    diretorioSlots: vagas,
    slots: 1,
    intervaloMs: 5,
    maximoCiclos: ciclos,
  });
  await worker.rodar();
}

function formularioDeArquivo(nome: string, conteudo: string, tipo: string, formato: string): FormData {
  const formulario = new FormData();
  formulario.set('titulo', 'Leitura e memória');
  formulario.set('autor', 'Machado de Assis');
  formulario.set('formato', formato);
  formulario.set('arquivo', new File([conteudo], nome, { type: tipo }));
  return formulario;
}

const ESCRITA = { 'X-Margem': '1' };

async function corpo<T>(resposta: Response): Promise<T> {
  return await resposta.json() as T;
}

// ---------------------------------------------------------------- caminho completo

test('upload de Markdown vira job de canonização, versão publicada e snapshot de capítulo', async () =>
  comBanco('api_upload', async (banco) => {
    await comDadosTemporarios();
    const config = await configurar(banco);
    const api = montar(banco, config);
    const markdown = await readFile(join(raizDoRepositorio(), 'fixtures/unicode-dificil.md'), 'utf8');

    const envio = await api.request('/api/documentos', {
      method: 'POST', headers: ESCRITA,
      body: formularioDeArquivo('unicode-dificil.md', markdown, 'text/markdown', 'md'),
    });
    expect(envio.status).toBe(202);
    const { documento_id, job_id } = await corpo<{ documento_id: Id; job_id: Id }>(envio);

    // A API não esperou o worker: o texto ainda não existe, mas o documento já está na casa.
    const antes = await corpo<{ documentos: { id: Id; estado: string; texto_disponivel: boolean }[] }>(
      await api.request('/api/documentos'));
    expect(antes.documentos.find((item) => item.id === documento_id))
      .toMatchObject({ estado: 'canonizando', texto_disponivel: false });

    await rodarWorker(banco, config, 2);

    const detalhe = await corpo<{
      texto_disponivel: boolean; versao_id: Id; versoes: { blocos: number; secoes: number }[];
      jobs: { id: Id; tipo: string; estado: string }[];
    }>(await api.request(`/api/documentos/${documento_id}`));
    expect(detalhe.texto_disponivel).toBe(true);
    expect(detalhe.jobs.find((job) => job.id === job_id)).toMatchObject({ tipo: TIPO_CANONIZAR, estado: 'ok' });
    expect(detalhe.versoes[0]?.blocos).toBeGreaterThan(0);

    const arvore = await corpo<{ capitulos: { id: Id; titulo: string }[] }>(
      await api.request(`/api/versoes/${detalhe.versao_id}/secoes`));
    expect(arvore.capitulos.length).toBeGreaterThan(0);
    const capitulo = arvore.capitulos[0]?.id ?? '';

    const snapshot = await corpo<{ palavras_no_livro: { antes: number; total: number }; blocos: { texto: string }[]; marcas: unknown[]; revisao_marcas: string }>(
      await api.request(`/api/versoes/${detalhe.versao_id}/capitulos/${capitulo}`));
    expect(snapshot.blocos.length).toBeGreaterThan(0);
    expect(snapshot.palavras_no_livro.antes).toBe(0);
    expect(snapshot.palavras_no_livro.total).toBeGreaterThanOrEqual(snapshot.blocos.reduce((n, b) => n + (b.texto.match(/\S+/g)?.length ?? 0), 0));
    // O texto chega ao leitor sem normalização: o emoji e a ligatura continuam lá.
    expect(snapshot.blocos.map((bloco) => bloco.texto).join('\n')).toContain('🧭');
    expect(snapshot.revisao_marcas).toMatch(/^[0-9a-f]{64}$/);
  }), 120_000);

test('o texto continua legível com o worker parado e uma marcação que falhou', async () =>
  comBanco('api_worker_parado', async (banco) => {
    await comDadosTemporarios();
    const config = await configurar(banco, 'leitor-problemas');
    const api = montar(banco, config);
    const versao = await comTransacao(banco, async (cliente) => {
      const canonico = livroDeTeste();
      const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
      return documentos.criarVersao(cliente, documento.id, canonico);
    });

    // Nenhum worker roda aqui: a leitura da biblioteca e do capítulo não depende dele.
    const lista = await corpo<{ documentos: { texto_disponivel: boolean; estado: string }[] }>(
      await api.request('/api/documentos'));
    expect(lista.documentos[0]).toMatchObject({ texto_disponivel: true, estado: 'pronto' });

    // Agora uma leitura que falha por citação ambígua; o texto não muda de estado.
    const pedido = await api.request(`/api/documentos/${versao.documento_id}/leituras`, { method: 'POST', headers: ESCRITA });
    expect(pedido.status).toBe(202);
    await rodarWorker(banco, config, 3);

    const depois = await corpo<{ texto_disponivel: boolean; estado: string }>(
      await api.request(`/api/documentos/${versao.documento_id}`));
    expect(depois.texto_disponivel).toBe(true);
    expect(['pronto', 'marcando', 'revisando']).toContain(depois.estado);

    const arvore = await corpo<{ capitulos: { id: Id }[] }>(await api.request(`/api/versoes/${versao.id}/secoes`));
    const snapshot = await api.request(`/api/versoes/${versao.id}/capitulos/${arvore.capitulos[0]?.id ?? ''}`);
    expect(snapshot.status).toBe(200);
    expect((await corpo<{ blocos: unknown[] }>(snapshot)).blocos).toHaveLength(5);
  }));

// ---------------------------------------------------------------- limites e segurança

test('arquivo acima do limite é recusado com 413 antes de ler o corpo', async () =>
  comBanco('api_limite', async (banco) => {
    await comDadosTemporarios();
    const api = montar(banco, await configurar(banco));
    const resposta = await api.request('/api/documentos', {
      method: 'POST',
      headers: { ...ESCRITA, 'content-length': String(LIMITE_UPLOAD_BYTES + 1) },
      body: formularioDeArquivo('grande.md', 'x', 'text/markdown', 'md'),
    });
    expect(resposta.status).toBe(413);
    expect(await corpo<{ erro: string }>(resposta)).toMatchObject({ erro: 'corpo_grande_demais' });
  }));

test('origem indevida é recusada com 403 e escrita sem X-Margem também', async () =>
  comBanco('api_origem', async (banco) => {
    await comDadosTemporarios();
    const api = montar(banco, await configurar(banco));
    const alheia = await api.request('/api/documentos', { headers: { origin: 'https://exemplo.invalido' } });
    expect(alheia.status).toBe(403);
    expect(await corpo<{ erro: string }>(alheia)).toMatchObject({ erro: 'origem_recusada' });

    const semCabecalho = await api.request('/api/documentos', { method: 'POST', body: new FormData() });
    expect(semCabecalho.status).toBe(403);
    expect(await corpo<{ erro: string }>(semCabecalho)).toMatchObject({ erro: 'cabecalho_ausente' });

    const propria = await api.request('/api/documentos', { headers: { origin: 'http://localhost:8730' } });
    expect(propria.status).toBe(200);
  }));

test('asset com caminho malicioso ou de outra versão devolve 404', async () =>
  comBanco('api_asset', async (banco) => {
    await comDadosTemporarios();
    const api = montar(banco, await configurar(banco));
    const canonico = livroDeTeste();
    const versao = await comTransacao(banco, async (cliente) => {
      const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
      return documentos.criarVersao(cliente, documento.id, canonico);
    });
    // Asset inexistente: nem sequer há caminho para compor.
    const inexistente = await api.request(`/api/assets/${versao.id}/${'0'.repeat(26)}`);
    expect(inexistente.status).toBe(404);
    // Travessia no caminho da URL: a rota nem casa, e o que responde é a web (404 da API).
    const travessia = await api.request(`/api/assets/${versao.id}/..%2F..%2Fetc%2Fpasswd`);
    expect(travessia.status).toBe(404);
    const invalido = await api.request('/api/assets/nao-e-ulid/tambem-nao');
    expect(invalido.status).toBe(404);
  }));

// ---------------------------------------------------------------- progresso

test('PUT de progresso obsoleto devolve 409 com a revisão atual', async () =>
  comBanco('api_progresso', async (banco) => {
    await comDadosTemporarios();
    const api = montar(banco, await configurar(banco));
    const canonico = livroDeTeste();
    const versao = await comTransacao(banco, async (cliente) => {
      const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
      return documentos.criarVersao(cliente, documento.id, canonico);
    });
    const bloco = canonico.blocos[1];
    if (!bloco) throw new Error('fixture sem bloco');
    const capitulo = canonico.secoes[0];
    const progresso: ProgressoV1 = {
      documento_id: versao.documento_id, versao_id: versao.id,
      ancora: {
        versao_id: versao.id, bloco_id: bloco.id, inicio_utf16: 0, fim_utf16: 4,
        citacao: bloco.texto.slice(0, 4), prefixo: '', sufixo: bloco.texto.slice(4, 12),
      },
      revisao_esperada: 0,
      capitulos_concluidos: capitulo ? [capitulo.id] : [],
      atualizado_em: '2026-09-20T12:00:00.000Z',
    };
    const primeira = await api.request(`/api/documentos/${versao.documento_id}/progresso`, {
      method: 'PUT', headers: { ...ESCRITA, 'content-type': 'application/json' }, body: JSON.stringify(progresso),
    });
    expect(primeira.status).toBe(200);
    expect(await corpo<{ progresso: { revisao: number } }>(primeira)).toMatchObject({ progresso: { revisao: 1 } });

    const repetida = await api.request(`/api/documentos/${versao.documento_id}/progresso`, {
      method: 'PUT', headers: { ...ESCRITA, 'content-type': 'application/json' }, body: JSON.stringify(progresso),
    });
    expect(repetida.status).toBe(409);
    expect(await corpo<{ erro: string; revisao_atual: number }>(repetida))
      .toMatchObject({ erro: 'progresso_obsoleto', revisao_atual: 1 });

    const lida = await corpo<{ progresso: { revisao: number } | null }>(
      await api.request(`/api/documentos/${versao.documento_id}/progresso`));
    expect(lida.progresso?.revisao).toBe(1);
  }));

// ---------------------------------------------------------------- marcas e eventos

test('PATCH de marca pelo leitor sobrevive a um lote posterior do codex', async () =>
  comBanco('api_marca', async (banco) => {
    await comDadosTemporarios();
    const config = await configurar(banco);
    const api = montar(banco, config);
    const canonico = livroDeTeste();
    const versao = await comTransacao(banco, async (cliente) => {
      const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
      return documentos.criarVersao(cliente, documento.id, canonico);
    });
    const execucao = await iniciarExecucao(config, versao.id);
    await rodarWorker(banco, config, 2);

    const marcas = await comTransacao(banco, (cliente) => marcasRepo.listarPorVersao(cliente, versao.id));
    const alvo = marcas.find((marca) => marca.funcao === 'tese');
    if (!alvo) throw new Error('a leitura não produziu marca de tese');

    const patch = await api.request(`/api/marcas/${alvo.id}`, {
      method: 'PATCH', headers: { ...ESCRITA, 'content-type': 'application/json' },
      body: JSON.stringify({ avaliacao: 'confirmada', motivo: 'Confirmo a tese.' }),
    });
    expect(patch.status).toBe(200);
    const aplicado = await corpo<{ estado: string; marca: MarcaV1 }>(patch);
    expect(aplicado.estado).toBe('aplicado');
    expect(aplicado.marca.avaliacao).toBe('confirmada');

    // Agora o codex tenta mexer na mesma marca: o lote inteiro é recusado.
    const atuais = await comTransacao(banco, (cliente) => marcasRepo.listarPorVersao(cliente, versao.id));
    const lote: LoteRevisaoV2 = {
      id: idTeste('C', 1), execucao_id: execucao.execucao.id,
      snapshot_base: hashMarcas(atuais), autor: 'codex', motivo_do_lote: 'Uniformizar funções.',
      operacoes: [{
        ordem: 0, marca_id: alvo.id, motivo: 'A cor não combina com o resto.',
        op: 'mudar_funcao', antes: { funcao: 'tese' }, depois: { funcao: 'conceito' },
      }],
    };
    const recusa = await comTransacao(banco, (cliente) => marcasRepo.aplicarLote(cliente, lote));
    expect(recusa.estado).toBe('recusado');

    const depois = await comTransacao(banco, (cliente) => marcasRepo.listarPorVersao(cliente, versao.id));
    const conferida = depois.find((marca) => marca.id === alvo.id);
    expect(conferida?.avaliacao).toBe('confirmada');
    expect(conferida?.funcao).toBe('tese');

    const campoDuplo = await api.request(`/api/marcas/${alvo.id}`, {
      method: 'PATCH', headers: { ...ESCRITA, 'content-type': 'application/json' },
      body: JSON.stringify({ avaliacao: 'rejeitada', visivel: false }),
    });
    expect(campoDuplo.status).toBe(400);
  }));

test('o snapshot do capítulo devolve as perguntas de recuperação das partes lidas', async () =>
  comBanco('api_recuperacao', async (banco) => {
    await comDadosTemporarios();
    const config = await configurar(banco);
    const api = montar(banco, config);
    const canonico = livroDeTeste();
    const versao = await comTransacao(banco, async (cliente) => {
      const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
      return documentos.criarVersao(cliente, documento.id, canonico);
    });
    const capitulo = idTeste('S', 0);

    const antes = await corpo<{ recuperacao: unknown[] }>(
      await api.request(`/api/versoes/${versao.id}/capitulos/${capitulo}`));
    expect(antes.recuperacao).toEqual([]);

    await iniciarExecucao(config, versao.id);
    await rodarWorker(banco, config, 3);

    const depois = await corpo<{ recuperacao: { secao_id: Id; perguntas: string[] }[] }>(
      await api.request(`/api/versoes/${versao.id}/capitulos/${capitulo}`));
    expect(depois.recuperacao).toHaveLength(1);
    expect(depois.recuperacao[0]?.secao_id).toBe(capitulo);
    expect(depois.recuperacao[0]?.perguntas[0]).toContain('Qual afirmação');

    // A recuperação é do capítulo pedido: a segunda seção não herda as perguntas da primeira.
    const irma = await corpo<{ recuperacao: unknown[] }>(
      await api.request(`/api/versoes/${versao.id}/capitulos/${idTeste('S', 1)}`));
    expect(irma.recuperacao).toEqual([]);
  }));

test('uma parte que falhou aparece com o motivo, mesmo com a revisão adiada', async () =>
  comBanco('api_falha_visivel', async (banco) => {
    await comDadosTemporarios();
    const config = await configurar(banco);
    const api = montar(banco, config);
    const canonico = livroDeTeste();
    const versao = await comTransacao(banco, async (cliente) => {
      const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
      return documentos.criarVersao(cliente, documento.id, canonico);
    });
    await iniciarExecucao(config, versao.id);

    // O estado real depois de uma parte falhada: `ler_parte` em `falhou` e a revisão
    // de consistência adiada, esperando uma parte que nunca vai ficar pronta.
    await comTransacao(banco, async (cliente) => {
      await cliente.query(
        `UPDATE job SET estado='falhou', error_code='processo' WHERE tipo='ler_parte' AND versao_id=$1`, [versao.id]);
      await cliente.query(
        `UPDATE job SET estado='adiado', not_before=now() + interval '5 minutes'
         WHERE tipo='revisar_consistencia' AND versao_id=$1`, [versao.id]);
    });

    const corpoDetalhe = await corpo<{ estado: string; detalhe: string | null; texto_disponivel: boolean }>(
      await api.request(`/api/documentos/${versao.documento_id}`));
    expect(corpoDetalhe.texto_disponivel).toBe(true);
    expect(corpoDetalhe.detalhe).toBe('processo');
    expect(corpoDetalhe.estado).not.toBe('revisando');
  }));

test('/api/saude responde 503 sem banco, sem tocar na biblioteca', async () => {
  const semBanco = { query: () => Promise.reject(new Error('conexão recusada')) } as unknown as pg.Pool;
  const api = criarApi({ banco: semBanco, leitura: () => { throw new Error('não usado'); } });
  const resposta = await api.request('/api/saude');
  expect(resposta.status).toBe(503);
  expect(await corpo<{ ok: boolean }>(resposta)).toEqual({ ok: false });
});

test('HEAD nos fluxos de eventos responde sem abrir fluxo nem gastar a vaga do teto (auditoria 02/10)', async () => {
  const semBanco = { query: () => Promise.reject(new Error('não usado')) } as unknown as pg.Pool;
  const api = criarApi({ banco: semBanco, leitura: () => { throw new Error('não usado'); } });
  // O teto é de 20 conexões abertas por IP: 30 HEAD não podem esgotá-lo.
  for (let i = 0; i < 30; i += 1) {
    const resposta = await api.request('/api/eventos', { method: 'HEAD' });
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get('content-type')).toBe('text/event-stream');
  }
  expect((await api.request('/api/execucoes/eventos', { method: 'HEAD' })).status).toBe(200);
});

test('SSE com Last-Event-ID entrega os eventos perdidos e /api/estado resume o mesmo', async () =>
  comBanco('api_eventos', async (banco) => {
    await comDadosTemporarios();
    const config = await configurar(banco);
    const api = montar(banco, config);
    const canonico = livroDeTeste();
    const versao = await comTransacao(banco, async (cliente) => {
      const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
      return documentos.criarVersao(cliente, documento.id, canonico);
    });
    await iniciarExecucao(config, versao.id);

    expect(await corpo<{ ok: boolean }>(await api.request('/api/saude'))).toEqual({ ok: true });
    const estado = await corpo<{ ultimo_evento: string; jobs_abertos: { tipo: string; total: number }[] }>(
      await api.request('/api/estado'));
    expect(Number(estado.ultimo_evento)).toBeGreaterThan(0);
    expect(estado.jobs_abertos.map((linha) => linha.tipo)).toContain('ler_parte');

    // O cliente esteve desconectado; volta pedindo tudo o que veio depois do primeiro evento.
    await rodarWorker(banco, config, 2);
    const perdidos = await lerSse(api, '1');
    expect(perdidos.length).toBeGreaterThan(1);
    expect(perdidos.map((evento) => evento.tipo)).toContain('publicado');
    expect(Number(perdidos[0]?.id)).toBeGreaterThan(1);

    // Do último evento em diante não há nada represado.
    const ultimo = perdidos.at(-1)?.id ?? '0';
    const novos = await lerSse(api, ultimo);
    expect(novos).toEqual([]);
  }));

// ---------------------------------------------------------------- apoio

function livroDeTeste(): CanonicoV1 {
  return canonicoDeTeste({
    titulo: 'Livro de teste',
    blocos: [
      { tipo: 'capitulo', texto: 'Capítulo um' },
      { tipo: 'paragrafo', texto: 'Uma tese central organiza o argumento do capítulo.' },
      { tipo: 'paragrafo', texto: 'Um conceito vale somente sob certas condições declaradas.' },
      { tipo: 'secao', texto: 'Segunda seção' },
      { tipo: 'paragrafo', texto: 'A justificativa aparece com uma evidência decisiva.' },
    ],
    secoes: [{ nivel: 1, inicio: 0, fim: 4 }, { nivel: 2, inicio: 3, fim: 4 }],
  });
}

interface EventoSse {
  id: string;
  tipo: string;
}

/** Lê o fluxo até a primeira pausa e devolve os eventos; depois cancela a conexão. */
async function lerSse(api: Hono, desde: string): Promise<EventoSse[]> {
  const resposta = await api.request('/api/eventos', { headers: { 'last-event-id': desde } });
  expect(resposta.headers.get('content-type')).toContain('text/event-stream');
  const leitor = resposta.body?.getReader();
  if (!leitor) throw new Error('SSE sem corpo');
  const decodificador = new TextDecoder();
  let bruto = '';
  // Lê o lote represado e desiste na primeira pausa do servidor: o fluxo é infinito.
  const pausa = new Promise<'pausa'>((resolver) => { setTimeout(() => { resolver('pausa'); }, 300); });
  try {
    for (;;) {
      const cru: unknown = await Promise.race([leitor.read(), pausa]);
      if (cru === 'pausa') break;
      const passo = cru as { done: boolean; value?: Uint8Array };
      if (passo.done || passo.value === undefined) break;
      bruto += decodificador.decode(passo.value, { stream: true });
    }
  } finally {
    await leitor.cancel();
  }
  return bruto.split('\n\n').filter((bloco) => bloco.trim() !== '').map((bloco) => {
    const id = /^id:\s*(\d+)$/m.exec(bloco)?.[1] ?? '';
    const tipo = /^event:\s*(\S+)$/m.exec(bloco)?.[1] ?? '';
    return { id, tipo };
  });
}


test('EPUB publica metadados do OPF e duplicado ativo retorna 409 sem novo job', async () =>
  comBanco('api_epub', async (banco) => {
    await comDadosTemporarios();
    const config = await configurar(banco);
    const api = montar(banco, config);
    const raiz = raizDoRepositorio();
    const bytes = execFileSync(join(raiz, 'motor/.venv/bin/python'), ['-c',
      "import sys; sys.path[:0] = ['motor', 'motor/tests']; from test_epub import epub; sys.stdout.buffer.write(epub())"], { cwd: raiz });
    const formulario = () => {
      const dados = new FormData();
      dados.set('formato', 'epub');
      dados.set('arquivo', new File([new Uint8Array(bytes)], 'livro.epub', { type: 'application/epub+zip' }));
      return dados;
    };
    const enviar = () => api.request('/api/documentos', { method: 'POST', headers: ESCRITA, body: formulario() });
    const primeira = await enviar();
    expect(primeira.status).toBe(202);
    const { documento_id } = await corpo<{ documento_id: string }>(primeira);
    const repetida = await enviar();
    expect(repetida.status).toBe(409);
    expect(await repetida.json()).toMatchObject({ erro: 'documento_duplicado', documento_id });
    expect((await banco.query('SELECT id FROM documento')).rows).toHaveLength(1);
    expect((await banco.query('SELECT id FROM job')).rows).toHaveLength(1);
    await rodarWorker(banco, config, 2);
    const detalhe = await corpo<{ titulo: string; autor: string; texto_disponivel: boolean }>(
      await api.request(`/api/documentos/${documento_id}`));
    expect(detalhe).toMatchObject({ titulo: 'Livro 🧭', autor: 'Autora', texto_disponivel: true });
    const versao = (await banco.query<{ canonico: CanonicoV1 }>('SELECT canonico FROM versao_texto')).rows[0];
    expect(versao?.canonico.documento.idioma).toBe('pt');
    expect(versao?.canonico.blocos.at(-1)?.texto).toBe('Fim.');
    await comTransacao(banco, cliente => documentos.arquivar(cliente, documento_id));
    expect((await enviar()).status).toBe(202);
  }), 120_000);

test('deduplicação também compara os bytes de Markdown e texto colado', async () =>
  comBanco('api_duplicado', async (banco) => {
    await comDadosTemporarios();
    const api = montar(banco, await configurar(banco));
    const primeira = await api.request('/api/documentos', {
      method: 'POST', headers: ESCRITA, body: formularioDeArquivo('livro.md', '# Livro', 'text/markdown', 'md'),
    });
    expect(primeira.status).toBe(202);
    const { documento_id } = await corpo<{ documento_id: string }>(primeira);
    const colado = new FormData();
    colado.set('titulo', 'Outro título'); colado.set('formato', 'colado'); colado.set('texto', '# Livro');
    const resposta = await api.request('/api/documentos', { method: 'POST', headers: ESCRITA, body: colado });
    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toMatchObject({ documento_id });
  }));

test('PDF: upload sem título publica metadados e capa; campos explícitos prevalecem', async () => comBanco('noite_metadados', async (banco) => {
  const pasta = await comDadosTemporarios();
  const config = await configurar(banco);
  const api = montar(banco, config);
  const caminho = join(pasta, 'teste.pdf');
  execFileSync(join(raizDoRepositorio(), 'motor/.venv/bin/python'), ['-c',
    'import pymupdf, sys; d=pymupdf.open(); p=d.new_page(); p.insert_text((50,100), "Texto do documento."); d.set_metadata({"title":"Livro embutido", "author":"Autora embutida"}); d.save(sys.argv[1])', caminho]);
  for (const explicitos of [false, true]) {
    const formulario = new FormData();
    formulario.set('formato', 'pdf');
    formulario.set('arquivo', new File([await readFile(caminho)], 'nome_arquivo.pdf', { type: 'application/pdf' }));
    if (explicitos) { formulario.set('titulo', 'Meu título'); formulario.set('autor', 'Minha autora'); }
    const resposta = await api.request('/api/documentos', { method: 'POST', headers: ESCRITA, body: formulario });
    expect(resposta.status).toBe(202);
    const { documento_id } = await resposta.json() as { documento_id: string };
    await rodarWorker(banco, config);
    const documento = await (await api.request(`/api/documentos/${documento_id}`)).json() as {
      titulo: string; autor: string; versao_id: string; texto_disponivel: boolean;
    };
    expect(documento).toMatchObject({ titulo: explicitos ? 'Meu título' : 'Livro embutido',
      autor: explicitos ? 'Minha autora' : 'Autora embutida', texto_disponivel: true });
    const capa = await api.request(`/api/versoes/${documento.versao_id}/capa`);
    expect(capa.status).toBe(200);
    expect(capa.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await capa.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([255, 216]));
    const etag = capa.headers.get('etag') ?? '';
    expect((await api.request(`/api/versoes/${documento.versao_id}/capa`, { headers: { 'If-None-Match': etag } })).status).toBe(304);
    // Documento antigo, sem o artefato: a rota responde 404 e o resto segue igual.
    await rm(join(pastaDaVersao(documento_id, documento.versao_id), 'capa.jpg'));
    expect((await api.request(`/api/versoes/${documento.versao_id}/capa`)).status).toBe(404);
    expect((await api.request(`/api/documentos/${documento_id}`)).status).toBe(200);
    // Integração com o 409 de duplicado (#63): o mesmo PDF só entra de novo depois de arquivado.
    await comTransacao(banco, cliente => documentos.arquivar(cliente, documento_id));
  }
  expect((await api.request('/api/versoes/..%2F..%2Fetc/capa')).status).toBe(400);
}));

