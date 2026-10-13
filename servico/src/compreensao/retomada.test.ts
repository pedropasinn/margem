import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { comBanco } from '../../testes/apoio.js';
import { configurar, livro, rodarUm } from '../../testes/compreensao.js';
import { comTransacao } from '../db/transacao.js';
import * as documentos from '../repos/documentos.js';
import * as jobs from '../repos/jobs.js';
import * as repo from '../repos/compreensao.js';
import { exigirModo } from '../modos.js';
import { estadoDoCapitulo, iniciarCompreensao, prepararCapitulo } from './pipeline.js';
import { falhou, type ResultadoExecutor } from '../executor/tipos.js';
import { criarExecutorFalso } from '../executor/fake.js';
import { Worker } from '../worker/worker.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { manipuladoresDaCompreensao } from './manipuladores.js';
const temporarios: string[] = [];
afterEach(async () => { for (const p of temporarios.splice(0)) await rm(p, { recursive: true, force: true }); });

test('falha na síntese e cancelamento na revisão retomam sem refazer análise nem duplicar modelo', async () => comBanco('retomada_j55', async banco => {
  const canonico = livro();
  const v = await comTransacao(banco, async c => {
    const d = await documentos.criar(c, { ...canonico.documento, origem_caminho: 'teste.txt' });
    return documentos.criarVersao(c, d.id, canonico);
  });
  const { config, auditoria } = await configurar(banco, temporarios);
  const exec = await iniciarCompreensao(config, v.id, exigirModo({ id: 'argumentativa', revisao: 1 }));
  const secao = canonico.secoes[0]!.id;
  const slots = await mkdtemp(join(tmpdir(), 'margem-retomada-')); temporarios.push(slots);
  await Promise.all([prepararCapitulo(config, exec.id, secao), prepararCapitulo(config, exec.id, secao)]);
  await rodarUm(banco, config, auditoria, slots);
  const base = await comTransacao(banco, c => repo.revisaoDoCapitulo(c, exec.id, secao));
  expect(base?.revisao).toBe(0);
  const normal = config.executor;
  config.executor = () => Promise.resolve(falhou('processo', 'Falha simulada na síntese.', 0));
  await rodarUm(banco, config, auditoria, slots);
  const falha = (await banco.query<jobs.Job>("SELECT * FROM job WHERE estado='falhou'")).rows[0]!;
  expect(falha.tipo).toBe('sintetizar_capitulo');
  await prepararCapitulo(config, exec.id, secao);
  expect((await comTransacao(banco, c => jobs.obter(c, falha.id)))?.estado).toBe('falhou');
  expect(await comTransacao(banco, c => repo.revisaoDoCapitulo(c, exec.id, secao))).toEqual(base);
  await jobs.reenfileirar(banco, falha.id); config.executor = normal;
  await rodarUm(banco, config, auditoria, slots);
  expect((await comTransacao(banco, c => repo.revisaoDoCapitulo(c, exec.id, secao)))?.revisao).toBe(1);
  let pronta: ResultadoExecutor | undefined;
  let cancelado = '';
  config.executor = async pedido => {
    pronta = await normal(pedido);
    cancelado = (await banco.query<{ id: string }>("SELECT id FROM job WHERE estado='reservado'")).rows[0]!.id;
    await jobs.cancelar(banco, cancelado);
    return pronta;
  };
  await rodarUm(banco, config, auditoria, slots);
  expect((await comTransacao(banco, c => jobs.obter(c, cancelado)))?.estado).toBe('cancelado');
  expect((await comTransacao(banco, c => repo.revisaoDoCapitulo(c, exec.id, secao)))?.revisao).toBe(1);
  await jobs.reenfileirar(banco, cancelado);
  config.executor = () => { if (!pronta) throw new Error('Faltou artefato.'); return Promise.resolve(pronta); };
  await rodarUm(banco, config, auditoria, slots);
  config.executor = normal;
  await rodarUm(banco, config, auditoria, slots);
  expect((await comTransacao(banco, c => estadoDoCapitulo(c, exec.id, secao))).estado).toBe('pronto');
  expect((await banco.query('SELECT * FROM analise_local')).rowCount).toBe(1);
  expect((await banco.query('SELECT * FROM modelo_capitulo')).rowCount).toBe(3);
  expect((await banco.query('SELECT * FROM lote_modelo')).rowCount).toBe(2);
  expect(await jobs.reenfileirar(banco, cancelado)).toBeNull();
  expect((await prepararCapitulo(config, exec.id, secao)).enfileirados).toEqual([]);
}));

test('análises concorrentes do mesmo capítulo publicam uma única r0 e uma síntese', async () => comBanco('concorrencia_j55', async banco => {
  const canonico = livro();
  const v = await comTransacao(banco, async c => {
    const d = await documentos.criar(c, { ...canonico.documento, origem_caminho: 'teste.txt' });
    return documentos.criarVersao(c, d.id, canonico);
  });
  const { config, artefatos } = await configurar(banco, temporarios);
  config.tamanho_parte_tokens = 20;
  const falso = criarExecutorFalso({ versao: 1, passos: [{ tipo: 'ok', conteudo: {
    elementos: [], relacoes: [], dificuldades: [], resumo_da_parte: 'Resumo.', limites: [], leitura_integral: true,
  } }] });
  config.executor = pedido => falso({ ...pedido, diretorioArtefatos: artefatos });
  const exec = await iniciarCompreensao(config, v.id, exigirModo({ id: 'argumentativa', revisao: 1 }));
  const secao = canonico.secoes[0]!.id;
  const pedido = await prepararCapitulo(config, exec.id, secao);
  expect(pedido.enfileirados.length).toBeGreaterThan(1);
  const slots = await mkdtemp(join(tmpdir(), 'margem-paralelo-')); temporarios.push(slots);
  const manipuladores = manipuladoresDaCompreensao(config);
  const worker = new Worker({ fila: new FilaPostgres(banco), manipuladores: { analisar_passagens: manipuladores.analisar_passagens! },
    slots: 4, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: pedido.enfileirados.length });
  await worker.rodar();
  expect((await banco.query('SELECT * FROM analise_local')).rowCount).toBe(pedido.enfileirados.length);
  expect((await banco.query('SELECT * FROM modelo_capitulo WHERE revisao=0')).rowCount).toBe(1);
  expect((await banco.query("SELECT * FROM job WHERE tipo='sintetizar_capitulo'")).rowCount).toBe(1);
}));
