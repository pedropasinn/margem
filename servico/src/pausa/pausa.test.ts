/**
 * V-F1: trabalho do Codex parado há horas fica em pausa na partida do worker e só roda quando a pessoa
 * mandar; o que é pedido depois roda normal.
 */
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { Hono } from 'hono';
import type pg from 'pg';
import { ulid } from 'ulid';
import { afterEach, expect, test } from 'vitest';
import { comBanco } from '../../testes/apoio.js';
import { configurar, livro } from '../../testes/compreensao.js';
import { seguirSemTipo } from '../compreensao/preparacao.js';
import { comTransacao } from '../db/transacao.js';
import { listarExecucoes } from '../execucoes/ativas.js';
import { criarApi } from '../http/app.js';
import { detalhe } from '../http/consultas.js';
import * as documentos from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import { chaveDaIdentificacao, enfileirarIdentificacao } from '../tipo-de-texto/identificar.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { pausarNaPartida } from '../worker/main.js';
import { ESPERA_PARA_PAUSAR_MS, esperaParaPausarMs, pausarParados, retomar, type TrabalhosEmPausa } from './pausa.js';

const temporarios: string[] = [];
afterEach(async () => { for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true }); });

const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };
const pedir = (api: Hono, caminho: string, metodo = 'GET', dado?: unknown) =>
  Promise.resolve(api.request(caminho, { method: metodo, ...(metodo === 'GET' ? {} : { headers: ESCRITA }), ...(dado === undefined ? {} : { body: JSON.stringify(dado) }) }));

const HORA = 60 * 60_000;
const hash = (texto: string) => createHash('sha256').update(texto).digest('hex');

async function documentoDoLivro(banco: pg.Pool, titulo = 'Preços') {
  const canonico = livro();
  return comTransacao(banco, async (cliente) => {
    const criado = await documentos.criar(cliente, { ...canonico.documento, titulo, origem_caminho: `/home/pessoa/textos/${titulo}.md` });
    const versao = await documentos.criarVersao(cliente, criado.id, canonico);
    return { documento: criado, versao };
  });
}

async function enfileirar(banco: pg.Pool, tipo: string, chave: string, versaoId: string, horasParado = 0): Promise<jobsRepo.Job> {
  const job = await comTransacao(banco, (cliente) => jobsRepo.enfileirar(cliente, { tipo, dedup_key: chave, input_snapshot_hash: hash(chave), versao_id: versaoId }));
  if (horasParado > 0) await banco.query(`UPDATE job SET atualizado_em = clock_timestamp() - $2 * interval '1 hour' WHERE id=$1`, [job.id, horasParado]);
  return job;
}

/** A preparação pedida ao importar, guardada à espera do tipo do texto, `horas` atrás. */
async function pedirPreparacao(banco: pg.Pool, documentoId: string, horas: number): Promise<void> {
  const em = new Date(Date.now() - horas * HORA).toISOString();
  await banco.query('UPDATE documento SET preparacao_pedida=$2 WHERE id=$1', [documentoId, JSON.stringify({ todos: false, itens: ['grifos_relacoes'], origem: 'importacao', em })]);
}

test('o limite: 3 h por padrão, MARGEM_PAUSAR_PARADOS_H troca e 0 desliga', () => {
  expect(esperaParaPausarMs({})).toBe(ESPERA_PARA_PAUSAR_MS);
  expect(ESPERA_PARA_PAUSAR_MS).toBe(3 * HORA);
  expect(esperaParaPausarMs({ MARGEM_PAUSAR_PARADOS_H: '0.5' })).toBe(HORA / 2);
  expect(esperaParaPausarMs({ MARGEM_PAUSAR_PARADOS_H: '0' })).toBeNull();
  expect(esperaParaPausarMs({ MARGEM_PAUSAR_PARADOS_H: 'muito' })).toBe(ESPERA_PARA_PAUSAR_MS);
});

test('na partida, só o trabalho do Codex parado há horas entra em pausa; o worker não o reserva; o novo roda', async () => comBanco('pausa_fila', async (banco) => {
  const { versao } = await documentoDoLivro(banco);
  const antigo = await enfileirar(banco, 'gerar_esquema', 'esquema:antigo', versao.id, 5);
  const local = await enfileirar(banco, 'canonizar', 'canonizar:antigo', versao.id, 5);
  const recente = await enfileirar(banco, 'gerar_flashcards', 'flashcards:recente', versao.id, 1);
  // Rodava quando o app fechou: a concessão venceu e a última batida foi há horas.
  const interrompido = await enfileirar(banco, 'roteirizar_visita', 'visita:interrompida', versao.id);
  await banco.query(`UPDATE job SET estado='reservado', lease_owner='antigo', lease_token=$2, lease_expires_at=clock_timestamp() - interval '4 hours',
    atualizado_em=clock_timestamp() - interval '4 hours' WHERE id=$1`, [interrompido.id, ulid()]);
  const adiado = await enfileirar(banco, 'comentar_leitura', 'comentada:adiada', versao.id);
  await banco.query(`UPDATE job SET estado='adiado', not_before=clock_timestamp() + interval '1 hour', atualizado_em=clock_timestamp() - interval '6 hours' WHERE id=$1`, [adiado.id]);

  const partida = new Date();
  const pausa = await comTransacao(banco, (cliente) => pausarParados(cliente, { partida, esperaMs: 3 * HORA }));
  expect(pausa.jobs.sort()).toEqual([antigo.id, interrompido.id, adiado.id].sort());
  expect(pausa.preparacoes).toEqual([]);
  // Idempotente: partir de novo não muda nada.
  expect((await comTransacao(banco, (cliente) => pausarParados(cliente, { partida, esperaMs: 3 * HORA }))).jobs).toEqual([]);
  expect((await banco.query('SELECT count(*)::int AS n FROM evento_job WHERE tipo=$1', ['retido'])).rows[0]).toEqual({ n: 3 });

  // O worker reserva o recente e o local; o que está em pausa, não (nem depois que a concessão vencida volta à fila).
  const fila = new FilaPostgres(banco);
  await fila.expirarConcessoes();
  const tipos = ['gerar_esquema', 'canonizar', 'gerar_flashcards', 'roteirizar_visita', 'comentar_leitura'];
  const reservados = (await fila.reservar('teste', tipos, 10)).map((concessao) => concessao.job.id);
  expect(reservados.sort()).toEqual([local.id, recente.id].sort());

  // Um pedido feito depois da partida não entra em pausa e roda normal.
  const novo = await enfileirar(banco, 'gerar_esquema', 'esquema:novo', versao.id);
  expect(novo.retido_em).toBeNull();
  expect((await fila.reservar('teste', tipos, 10)).map((concessao) => concessao.job.id)).toEqual([novo.id]);

  // Os avisos do canto não listam o que está em pausa (ele tem o aviso próprio).
  const ativas = await comTransacao(banco, (cliente) => listarExecucoes(cliente));
  expect(ativas.execucoes.map((execucao) => execucao.id)).not.toContain(antigo.id);
  // A tela do documento mostra "em pausa".
  const doc = await comTransacao(banco, (cliente) => detalhe(cliente, versao.documento_id));
  expect(doc?.jobs.find((job) => job.id === antigo.id)?.em_pausa).toBe(true);
  expect(doc?.jobs.find((job) => job.id === novo.id)?.em_pausa).toBe(false);

  // O encadeamento automático (prioridade baixa) não tira da pausa; um pedido da pessoa tira.
  await comTransacao(banco, (cliente) => jobsRepo.enfileirar(cliente, { tipo: 'gerar_esquema', dedup_key: 'esquema:antigo', input_snapshot_hash: hash('x'), versao_id: versao.id, prioridade: jobsRepo.PRIORIDADE.proximo_provavel }));
  expect((await banco.query<{ retido_em: Date | null }>('SELECT retido_em FROM job WHERE id=$1', [antigo.id])).rows[0]?.retido_em).not.toBeNull();
  const liberado = await comTransacao(banco, (cliente) => jobsRepo.enfileirar(cliente, { tipo: 'gerar_esquema', dedup_key: 'esquema:antigo', input_snapshot_hash: hash('x'), versao_id: versao.id, prioridade: jobsRepo.PRIORIDADE.artefato_pedido }));
  expect(liberado.retido_em).toBeNull();
  expect((await fila.reservar('teste', tipos, 10)).map((concessao) => concessao.job.id)).toEqual([antigo.id]);

  // Retomar (a pessoa, na janela): a marca sai e o evento acorda o worker.
  expect(await comTransacao(banco, (cliente) => retomar(cliente, { ids: [interrompido.id] }))).toEqual({ retomados: 1 });
  expect((await banco.query('SELECT retido_em FROM job WHERE id=$1', [interrompido.id])).rows[0]).toEqual({ retido_em: null });
  expect((await banco.query(`SELECT detalhe->>'motivo' AS motivo FROM evento_job WHERE job_id=$1 AND tipo='retomado'`, [interrompido.id])).rows).toEqual([{ motivo: 'pessoa' }]);
  expect(await comTransacao(banco, (cliente) => retomar(cliente, { todos: true }))).toEqual({ retomados: 1 });
  expect((await banco.query('SELECT count(*)::int AS n FROM job WHERE retido_em IS NOT NULL')).rows[0]).toEqual({ n: 0 });
}));

test('a preparação que esperava o tipo fica em pausa: o seguirSemTipo não a começa até a pessoa retomar', async () => comBanco('pausa_preparacao', async (banco) => {
  const { documento } = await documentoDoLivro(banco);
  const { config } = await configurar(banco, temporarios);
  await pedirPreparacao(banco, documento.id, 6);
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); }, compreensao: () => config });

  await pausarNaPartida(new Date(), banco, {});
  expect(await comTransacao(banco, (cliente) => seguirSemTipo(config, cliente))).toEqual([]);
  // Nem a consulta da página do documento a começa.
  expect((await (await pedir(api, `/api/documentos/${documento.id}/preparacao`)).json() as { estado: string }).estado).toBe('identificando');

  const lista = await (await pedir(api, '/api/trabalhos-em-pausa')).json() as TrabalhosEmPausa;
  expect(lista.total).toBe(1);
  expect(lista.grupos).toEqual([{ documento_id: documento.id, titulo: 'Preços', itens: [expect.objectContaining({ ids: [`preparacao:${documento.id}`], rotulo: 'Análise pedida antes', quantidade: 1 })] }]);
  expect((await comTransacao(banco, (cliente) => detalhe(cliente, documento.id)))?.preparacao_em_pausa).toBe(true);

  const retomada = await (await pedir(api, '/api/trabalhos-em-pausa/retomar', 'POST', { ids: [`preparacao:${documento.id}`] })).json() as TrabalhosEmPausa & { retomados: number };
  expect(retomada).toMatchObject({ retomados: 1, total: 0, grupos: [] });
  // Retomada, a próxima volta do worker começa a análise com o tipo padrão.
  expect(await comTransacao(banco, (cliente) => seguirSemTipo(config, cliente))).toEqual([documento.id]);
  expect((await banco.query<{ n: number }>("SELECT count(*)::int AS n FROM job WHERE tipo <> 'identificar_tipo' AND retido_em IS NULL AND estado='fila'")).rows[0]?.n).toBeGreaterThan(0);
}));

test('descartar todos cancela os jobs em pausa e esquece a preparação; o pedido torto é recusado', async () => comBanco('pausa_descartar', async (banco) => {
  const { documento, versao } = await documentoDoLivro(banco);
  const outro = await documentoDoLivro(banco, 'Outro');
  const { config } = await configurar(banco, temporarios);
  await pedirPreparacao(banco, documento.id, 8);
  const identificacao = await comTransacao(banco, (cliente) => enfileirarIdentificacao(cliente, versao.id));
  await banco.query(`UPDATE job SET atualizado_em = clock_timestamp() - interval '8 hours' WHERE id=$1`, [identificacao.id]);
  const mapa = await enfileirar(banco, 'gerar_esquema', 'esquema:outro', outro.versao.id, 4);
  const flashcards = await enfileirar(banco, 'gerar_flashcards', 'flashcards:outro', outro.versao.id, 4);
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); }, compreensao: () => config });
  await pausarNaPartida(new Date(), banco, {});
  // Na biblioteca, o documento com tudo em pausa não aparece "em andamento".
  expect((await comTransacao(banco, (cliente) => detalhe(cliente, outro.documento.id)))?.jobs_em_curso).toBe(0);

  const lista = await (await pedir(api, '/api/trabalhos-em-pausa')).json() as TrabalhosEmPausa;
  expect(lista.total).toBe(4);
  expect(lista.grupos.map((grupo) => [grupo.titulo, grupo.itens.map((item) => item.rotulo).sort()])).toEqual([
    ['Preços', ['Análise pedida antes', 'Reconhecer o tipo do texto']],
    ['Outro', ['Flashcards', 'Mapa do capítulo']],
  ]);

  expect((await pedir(api, '/api/trabalhos-em-pausa/descartar', 'POST', {})).status).toBe(400);
  expect((await pedir(api, '/api/trabalhos-em-pausa/descartar', 'POST', { ids: ['nada'] })).status).toBe(400);

  // Um item só: o mapa sai, os flashcards continuam em pausa.
  const umSo = await (await pedir(api, '/api/trabalhos-em-pausa/descartar', 'POST', { ids: [mapa.id] })).json() as TrabalhosEmPausa & { descartados: number };
  expect(umSo).toMatchObject({ descartados: 1, total: 3 });
  // O mapa e os flashcards cancelados somem, como no Cancelar de sempre (a operação volta a "nenhum pedido").
  expect((await banco.query('SELECT 1 FROM job WHERE id=$1', [mapa.id])).rowCount).toBe(0);

  const todos = await (await pedir(api, '/api/trabalhos-em-pausa/descartar', 'POST', { todos: true })).json() as TrabalhosEmPausa & { descartados: number };
  expect(todos).toMatchObject({ descartados: 3, total: 0 });
  expect((await banco.query('SELECT 1 FROM job WHERE id=$1', [flashcards.id])).rowCount).toBe(0);
  // A identificação cancelada some (como no Cancelar de sempre) e o pedido guardado no documento também.
  expect((await banco.query('SELECT 1 FROM job WHERE dedup_key=$1', [chaveDaIdentificacao(versao.id)])).rowCount).toBe(0);
  expect((await banco.query('SELECT preparacao_pedida, preparacao_retida_em FROM documento WHERE id=$1', [documento.id])).rows[0])
    .toEqual({ preparacao_pedida: null, preparacao_retida_em: null });
  expect(await comTransacao(banco, (cliente) => seguirSemTipo(config, cliente))).toEqual([]);
}));

test('com MARGEM_PAUSAR_PARADOS_H=0 nada entra em pausa', async () => comBanco('pausa_desligada', async (banco) => {
  const { versao } = await documentoDoLivro(banco);
  await enfileirar(banco, 'gerar_esquema', 'esquema:antigo', versao.id, 30);
  await pausarNaPartida(new Date(), banco, { MARGEM_PAUSAR_PARADOS_H: '0' });
  expect((await banco.query('SELECT count(*)::int AS n FROM job WHERE retido_em IS NOT NULL')).rows[0]).toEqual({ n: 0 });
}));
