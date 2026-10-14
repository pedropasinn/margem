/**
 * J142 · "Analisar" num vídeo do YouTube, de ponta a ponta, com o motor Python de verdade, áudio do ffmpeg,
 * YouTube falso e Codex falso (sem rede): a legenda automática é passada a limpo (versão nova, mídia
 * realinhada), e só então a análise segue com grifos e relações (compreensão enfileirada) e as partes e os
 * momentos do vídeo (popups). Num texto, `/analise` é a preparação de sempre.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Hono } from 'hono';
import type pg from 'pg';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { ConceitosDoVideoV1, Id, MidiaV1 } from '@margem/contratos';
import { canonicoDeTeste, comBanco, exigirMotorPython } from '../../testes/apoio.js';
import { configurar } from '../../testes/compreensao.js';
import { comTransacao } from '../db/transacao.js';
import { criarExecutorFalso } from '../executor/fake.js';
import type { Executor, PedidoExecucao } from '../executor/tipos.js';
import { criarApi } from '../http/app.js';
import { CABECALHO_MARGEM } from '../http/ambiente.js';
import { raizDoRepositorio } from '../dados.js';
import * as documentos from '../repos/documentos.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { Worker, type Manipulador } from '../worker/worker.js';
import { seguirAnaliseDoVideo } from './analise-do-video.js';
import { manipuladoresDosConceitos } from './conceitos.js';
import type { FonteDoYoutube } from './fontes-do-youtube.js';
import { manipuladorImportarYoutube, TIPO_IMPORTAR_YOUTUBE } from './importacao-youtube.js';
import { MARCA_DA_LIMPEZA, manipuladoresDaLimpeza } from './limpeza-da-transcricao.js';
import { manipuladorCanonizarRevisao, TIPO_CANONIZAR_REVISAO } from './revisao.js';
import { metadadosDoYtDlp } from './youtube.js';
import { LEGENDA_AUTOMATICA } from './youtube.casos.js';

const executar = promisify(execFile);
beforeAll(exigirMotorPython, 30_000);
const temporarios: string[] = [];
afterEach(async () => { for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true }); });
const ESCRITA = { [CABECALHO_MARGEM]: '1', 'Content-Type': 'application/json' };
const VIDEO = 'dO8EW2LqBfU';

function fonteFalsa(pasta: string): FonteDoYoutube {
  return {
    metadados: (id) => Promise.resolve(metadadosDoYtDlp({
      title: 'A jogada de mestre da China', channel: 'Fernando Ulrich', upload_date: '20260920', duration: 6, language: 'pt',
      description: '', automatic_captions: { 'pt-orig': [] },
    }, id)),
    legenda: () => Promise.resolve(LEGENDA_AUTOMATICA),
    audio: async (id) => {
      const destino = join(pasta, `audio-${id}.m4a`);
      await executar('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:a', 'aac', '-vn', destino]);
      return destino;
    },
  };
}

async function rodar(banco: pg.Pool, manipuladores: Record<string, Manipulador>, ciclos: number): Promise<void> {
  const vagas = await mkdtemp(join(tmpdir(), 'margem-j142-vagas-'));
  temporarios.push(vagas);
  await new Worker({ fila: new FilaPostgres(banco), manipuladores, slots: 1, diretorioSlots: vagas, intervaloMs: 5, maximoCiclos: ciclos, heartbeatMs: 60_000 }).rodar();
}

function executorCom(conteudo: unknown, artefatos: string, pedidos: PedidoExecucao[]): Executor {
  const falso = criarExecutorFalso({ versao: 1, passos: [{ tipo: 'ok', conteudo }] });
  return (p) => { pedidos.push(p); return falso({ ...p, diretorioArtefatos: artefatos }); };
}

interface Situacao {
  estado: string;
  video: { midia_id: Id | null; transcricao: { estado: string }; momentos: { estado: string; quantidade: number; partes: number }; aguardando_transcricao: boolean } | null;
}
async function situacao(api: Hono, id: Id): Promise<Situacao> {
  const resposta = await api.request(`/api/documentos/${id}/analise`);
  expect(resposta.status).toBe(200);
  return await resposta.json() as Situacao;
}

test('Analisar um vídeo: transcrição passada a limpo → grifos e relações + partes e momentos', async () => comBanco('analise_video_j142', async (banco) => {
  const antes = process.env.MARGEM_DADOS;
  const pasta = await mkdtemp(join(tmpdir(), 'margem-j142-'));
  temporarios.push(pasta);
  process.env.MARGEM_DADOS = pasta;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    const { config } = await configurar(banco, temporarios);
    const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); }, compreensao: () => config });
    const importada = await (await api.request('/api/importacoes/youtube', { method: 'POST', headers: ESCRITA, body: JSON.stringify({ url: `https://youtu.be/${VIDEO}` }) })).json() as { documento_id: Id };
    const documentoId = importada.documento_id;
    await rodar(banco, { [TIPO_IMPORTAR_YOUTUBE]: manipuladorImportarYoutube({ banco, fonte: fonteFalsa(pasta), transcritor: null, raiz: raizDoRepositorio(), prazoMs: 120_000 }) }, 2);
    // O tipo escolhido dispensa a identificação: a leitura começa assim que a transcrição estiver limpa.
    expect((await api.request(`/api/documentos/${documentoId}/tipo-de-texto`, { method: 'PUT', headers: ESCRITA, body: JSON.stringify({ tipo_id: 'outro' }) })).status).toBe(200);

    const inicial = await situacao(api, documentoId);
    expect(inicial.video).toMatchObject({ transcricao: { estado: 'original' }, momentos: { estado: 'nao_preparado' }, aguardando_transcricao: false });
    const midiaOriginal = inicial.video!.midia_id!;

    // 1. "Analisar": legenda automática → primeiro a transcrição passa a limpo; a análise espera (202).
    const pedido = await api.request(`/api/documentos/${documentoId}/analise`, { method: 'POST', headers: ESCRITA, body: JSON.stringify({}) });
    expect(pedido.status).toBe(202);
    const corpo = await pedido.json() as { aguardando_transcricao: boolean; situacao: Situacao };
    expect(corpo.aguardando_transcricao).toBe(true);
    expect(corpo.situacao).toMatchObject({ estado: 'preparando', video: { transcricao: { estado: 'passando_a_limpo' }, aguardando_transcricao: true } });
    // O nome antigo é a mesma coisa; clicar de novo não enfileira outra limpeza.
    expect((await api.request(`/api/documentos/${documentoId}/preparacao`, { method: 'POST', headers: ESCRITA })).status).toBe(202);
    const jobs = async () => (await banco.query<{ tipo: string; documento_id: Id | null }>('SELECT tipo, documento_id FROM job WHERE tipo <> ALL($1) ORDER BY criado_em', [[TIPO_IMPORTAR_YOUTUBE, 'identificar_tipo']])).rows;
    expect(await jobs()).toEqual([{ tipo: 'revisar_transcricao', documento_id: documentoId }]);

    // 2. O Codex (falso) devolve o parágrafo limpo; vira versão nova com a mídia realinhada e a análise segue.
    const artefatos = await mkdtemp(join(tmpdir(), 'margem-j142-art-'));
    temporarios.push(artefatos);
    const pedidosDaLimpeza: PedidoExecucao[] = [];
    const seguir = (cliente: Parameters<typeof seguirAnaliseDoVideo>[1], id: Id) => seguirAnaliseDoVideo(config, cliente, id);
    await rodar(banco, {
      ...manipuladoresDaLimpeza({ banco, executor: executorCom({ paragrafos: [{ numero: 1, texto: 'A China fez uma jogada de mestre.' }] }, artefatos, pedidosDaLimpeza),
        modelo: 'modelo-de-teste', esforco: 'medium', diretorioArtefatos: artefatos, aoSeguirSemRevisao: seguir }),
      [TIPO_CANONIZAR_REVISAO]: manipuladorCanonizarRevisao({ banco, raiz: raizDoRepositorio(), prazoMs: 120_000, aoPublicar: seguir }),
    }, 4);
    expect(pedidosDaLimpeza).toHaveLength(1);
    expect(pedidosDaLimpeza[0]!.prompt).toContain('[1] a China fez uma jogada de mestre');
    expect(pedidosDaLimpeza[0]!.esforco).toBe('medium');

    const detalhe = await (await api.request(`/api/documentos/${documentoId}`)).json() as { versao_id: Id };
    const texto = (await banco.query<{ texto: string }>("SELECT string_agg(texto, ' ' ORDER BY ordem) AS texto FROM bloco WHERE versao_id=$1 AND tipo='paragrafo'", [detalhe.versao_id])).rows[0]!.texto;
    expect(texto).toBe('A China fez uma jogada de mestre.');
    const { midias } = await (await api.request(`/api/versoes/${detalhe.versao_id}/midias`)).json() as { midias: MidiaV1[] };
    expect(midias).toHaveLength(1);
    expect(midias[0]!.transcricao.motor).toContain(MARCA_DA_LIMPEZA);
    expect(midias[0]!.id).not.toBe(midiaOriginal);
    // Os tempos vieram da legenda: "jogada" continua em 3,8 s.
    const jogada = midias[0]!.palavras.find((p) => texto.slice(p.inicio_utf16, p.fim_utf16) === 'jogada')!;
    expect(jogada.inicio_s).toBeCloseTo(3.8, 1);

    // Grifos e relações (compreensão) e partes e momentos, na versão limpa.
    const depois = await jobs();
    expect(depois.map((j) => j.tipo)).toEqual(expect.arrayContaining(['revisar_transcricao', 'canonizar_revisao', 'analisar_passagens', 'conceitos_do_video']));
    expect(depois.find((j) => j.tipo === 'conceitos_do_video')!.documento_id).toBe(documentoId);
    const guardada = (await banco.query<{ analise_video: { etapa: string } }>('SELECT analise_video FROM documento WHERE id=$1', [documentoId])).rows[0]!.analise_video;
    expect(guardada.etapa).toBe('leitura');
    expect((await situacao(api, documentoId)).video).toMatchObject({ midia_id: midias[0]!.id, transcricao: { estado: 'limpa' }, momentos: { estado: 'preparando' }, aguardando_transcricao: false });

    // 3. Partes e momentos (Codex falso): prontos para o player.
    const pedidosDosMomentos: PedidoExecucao[] = [];
    await rodar(banco, manipuladoresDosConceitos({ banco, modelo: 'modelo-de-teste', esforco: 'medium', prazoMs: 10_000, diretorioArtefatos: artefatos,
      executor: executorCom({
        partes: [{ paragrafo: 'P1', titulo: 'A jogada da China', resumo: 'O que a China fez.' }],
        momentos: [{ paragrafo: 'P1', citacao: 'jogada de mestre', tipo: 'pergunta', titulo: 'Por que de mestre?', curto: 'Jogada', explicacao: 'O que torna a jogada tão boa?' }],
      }, artefatos, pedidosDosMomentos) }), 1);
    expect(pedidosDosMomentos[0]!.prompt).toContain('[P1 · 0:00] A China fez uma jogada de mestre.');
    const momentos = await (await api.request(`/api/midias/${midias[0]!.id}/conceitos`)).json() as { estado: string; conceitos: ConceitosDoVideoV1 };
    expect(momentos.estado).toBe('pronto');
    expect(momentos.conceitos.conceitos).toMatchObject([{ tipo: 'pergunta', curto: 'Jogada' }]);
    expect(momentos.conceitos.conceitos[0]!.instante_s).toBeCloseTo(3.8, 1);
    expect(momentos.conceitos.partes).toMatchObject([{ titulo: 'A jogada da China', instante_s: midias[0]!.palavras[0]!.inicio_s }]);
    expect((await situacao(api, documentoId)).video?.momentos).toEqual({ estado: 'pronto', quantidade: 1, partes: 1 });

    // 4. Analisar de novo: nada novo (transcrição já limpa, momentos prontos com o prompt atual).
    const total = (await jobs()).length;
    expect((await api.request(`/api/documentos/${documentoId}/analise`, { method: 'POST', headers: ESCRITA })).status).toBeLessThan(300);
    expect((await jobs()).filter((j) => j.tipo === 'conceitos_do_video' || j.tipo === 'revisar_transcricao')).toHaveLength(2);
    expect((await jobs()).length).toBeGreaterThanOrEqual(total);
  } finally {
    process.env.MARGEM_DADOS = antes;
  }
}), 180_000);

test('Analisar um texto: a preparação da leitura de sempre, sem a parte do vídeo', async () => comBanco('analise_texto_j142', async (banco) => {
  const { config } = await configurar(banco, temporarios);
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); }, compreensao: () => config });
  const canonico = canonicoDeTeste({ blocos: [{ tipo: 'capitulo', texto: 'Um' }, { tipo: 'paragrafo', texto: 'Admitamos inicialmente que os preços são rígidos, e vejamos o que acontece com o produto.' }], secoes: [{ nivel: 1, inicio: 0, fim: 1 }] });
  const documento = await comTransacao(banco, async (cliente) => {
    const criado = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'teste.txt' });
    await documentos.criarVersao(cliente, criado.id, canonico);
    return criado;
  });
  await api.request(`/api/documentos/${documento.id}/tipo-de-texto`, { method: 'PUT', headers: ESCRITA, body: JSON.stringify({ tipo_id: 'outro' }) });
  const resposta = await api.request(`/api/documentos/${documento.id}/analise`, { method: 'POST', headers: ESCRITA });
  expect(resposta.status).toBe(201);
  const corpo = await resposta.json() as { aguardando_transcricao: boolean; situacao: Situacao };
  expect(corpo).toMatchObject({ aguardando_transcricao: false, situacao: { estado: 'preparando', video: null } });
  const tipos = (await banco.query<{ tipo: string }>('SELECT DISTINCT tipo FROM job ORDER BY tipo')).rows.map((l) => l.tipo);
  expect(tipos).toEqual(['analisar_passagens']);
}));
