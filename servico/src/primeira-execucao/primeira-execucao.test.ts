/**
 * Primeira execução (J103), contra o Postgres de teste: a rota do estado, o exemplo semeado e a
 * conclusão. O `codex` e o motor entram por verificadores falsos; nenhum Codex roda.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type pg from 'pg';
import { comBanco } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import { criarApi } from '../http/app.js';
import * as documentos from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import type { EstadoDoCodex } from './codex.js';
import type { EstadoDaInstalacao, Verificadores } from './estado.js';
import { MARCAS_DO_EXEMPLO, METODO_DO_EXEMPLO, canonicoDoExemplo } from './exemplo.js';

const ESCRITA = { 'X-Margem': '1' };
const LOGADO: EstadoDoCodex = { encontrado: true, versao: 'codex-cli 0.160.0', compativel: true, logado: true, conta: 'chatgpt' };

let dados = '';
const dadosAntes = process.env.MARGEM_DADOS;
beforeEach(async () => { dados = await mkdtemp(join(tmpdir(), 'margem-j103-')); process.env.MARGEM_DADOS = dados; });
afterEach(async () => {
  if (dadosAntes === undefined) delete process.env.MARGEM_DADOS; else process.env.MARGEM_DADOS = dadosAntes;
  await rm(dados, { recursive: true, force: true });
});

function montar(banco: pg.Pool, verificadores: Partial<Verificadores> = {}) {
  const chamadas = { codex: 0, motor: 0 };
  const api = criarApi({
    banco, leitura: () => { throw new Error('a primeira execução não lê nada'); },
    primeiraExecucao: {
      codex: () => { chamadas.codex += 1; return Promise.resolve(LOGADO); },
      motor: () => { chamadas.motor += 1; return Promise.resolve({ ok: true }); },
      executor: () => 'codex',
      ...verificadores,
    },
  });
  return { api, chamadas };
}

async function estado(api: ReturnType<typeof criarApi>, consulta = ''): Promise<EstadoDaInstalacao> {
  const resposta = await api.request(`/api/estado-instalacao${consulta}`);
  expect(resposta.status).toBe(200);
  expect(resposta.headers.get('cache-control')).toBe('no-store');
  return await resposta.json() as EstadoDaInstalacao;
}

test('instalação nova: tudo pronto, primeira execução pendente; concluir é idempotente', async () => comBanco('j103_estado', async (banco) => {
  const { api, chamadas } = montar(banco);
  const { instancia, ...inicial } = await estado(api);
  // V-W9: a identificação deste Margem (a mesma da saúde, que a extensão do navegador lê) e a porta.
  expect(instancia.id).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}$/);
  expect(Number.isInteger(instancia.porta)).toBe(true);
  expect(inicial).toEqual({
    versao: 1, banco: { ok: true }, motor: { ok: true },
    codex: { ...LOGADO, executor: 'codex' },
    cota: { esgotada: false, volta_em: null },
    primeira_execucao: { concluida: false, concluida_em: null, exemplo_documento_id: null },
    pronto: true,
  });

  // A memória curta poupa os subprocessos; `?renovar=1` (o "Verificar de novo") pede de novo.
  await estado(api);
  expect(chamadas).toEqual({ codex: 1, motor: 1 });
  await estado(api, '?renovar=1');
  expect(chamadas).toEqual({ codex: 2, motor: 2 });

  const primeira = await api.request('/api/estado-instalacao/concluir', { method: 'POST', headers: ESCRITA });
  expect(primeira.status).toBe(200);
  const { concluida_em } = await primeira.json() as { concluida_em: string };
  expect(Date.parse(concluida_em)).not.toBeNaN();
  const segunda = await api.request('/api/estado-instalacao/concluir', { method: 'POST', headers: ESCRITA });
  expect(await segunda.json()).toEqual({ concluida: true, concluida_em });
  expect((await estado(api)).primeira_execucao).toEqual({ concluida: true, concluida_em, exemplo_documento_id: null });
}));

test('V-D5: dentro do app de computador o estado diz a origem, para a interface não refazer a checagem', async () => comBanco('j133_origem', async (banco) => {
  const { api } = montar(banco);
  expect((await estado(api)).origem).toBeUndefined();
  const antes = process.env.MARGEM_APP_DESKTOP;
  process.env.MARGEM_APP_DESKTOP = '1';
  try { expect((await estado(api)).origem).toBe('desktop'); }
  finally { if (antes === undefined) delete process.env.MARGEM_APP_DESKTOP; else process.env.MARGEM_APP_DESKTOP = antes; }
}));

test('escrita vinda de outra origem é recusada', async () => comBanco('j103_seguranca', async (banco) => {
  const { api } = montar(banco);
  expect((await api.request('/api/estado-instalacao/concluir', { method: 'POST', headers: { Origin: 'https://exemplo.invalid' } })).status).toBe(403);
  expect((await estado(api)).primeira_execucao.concluida).toBe(false);
}));

test('Codex ausente, deslogado ou antigo não deixa a instalação pronta; o executor falso dispensa o Codex', async () => comBanco('j103_codex', async (banco) => {
  const ausente: EstadoDoCodex = { encontrado: false, versao: null, compativel: false, logado: null, conta: null };
  expect(await estado(montar(banco, { codex: () => Promise.resolve(ausente) }).api)).toMatchObject({ codex: { ...ausente, executor: 'codex' }, pronto: false });
  expect((await estado(montar(banco, { codex: () => Promise.resolve({ ...LOGADO, logado: false, conta: null }) }).api)).pronto).toBe(false);
  expect((await estado(montar(banco, { codex: () => Promise.resolve({ ...LOGADO, compativel: false }) }).api)).pronto).toBe(false);
  expect((await estado(montar(banco, { motor: () => Promise.resolve({ ok: false }) }).api)).pronto).toBe(false);
  expect(await estado(montar(banco, { codex: () => Promise.resolve(ausente), executor: () => 'falso' }).api))
    .toMatchObject({ codex: { executor: 'falso' }, pronto: true });
}));

test('a cota esgotada aparece enquanto houver leitura adiada por ela', async () => comBanco('j103_cota', async (banco) => {
  const { api } = montar(banco);
  const volta = new Date(Date.now() + 3_600_000);
  await comTransacao(banco, async (cliente) => {
    const job = await jobsRepo.enfileirar(cliente, { tipo: 'ler_parte', dedup_key: 'j103:cota', input_snapshot_hash: 'a'.repeat(64) });
    await cliente.query("UPDATE job SET estado='adiado', error_code='cota', not_before=$2 WHERE id=$1", [job.id, volta]);
  });
  const { cota } = await estado(api, '?renovar=1');
  expect(cota.esgotada).toBe(true);
  expect(Date.parse(cota.volta_em ?? '')).toBe(volta.getTime());
}));

test('banco que já tinha documentos nasce com a primeira execução concluída (migração 0026)', async () => comBanco('j103_migracao', async (banco) => {
  // O banco do teste já está migrado; refaz a linha como a migração faria num banco com documentos.
  const canonico = await canonicoDoExemplo();
  await comTransacao(banco, (cliente) => documentos.criar(cliente, { ...canonico.documento, origem_caminho: '/dev/null' }));
  const sql = await readFile(new URL('../db/migrations/0026_primeira_execucao.sql', import.meta.url), 'utf8');
  await banco.query('DROP TABLE instalacao');
  await banco.query(sql);
  const { api } = montar(banco);
  expect((await estado(api)).primeira_execucao.concluida).toBe(true);
}));

test('o exemplo chega marcado, sem Codex nem motor, e não se duplica', async () => comBanco('j103_exemplo', async (banco) => {
  const { api } = montar(banco);
  const criado = await api.request('/api/estado-instalacao/exemplo', { method: 'POST', headers: ESCRITA });
  expect(criado.status).toBe(201);
  const exemplo = await criado.json() as { documento_id: string; versao_id: string; marcas: number; criado: boolean };
  expect(exemplo).toMatchObject({ marcas: MARCAS_DO_EXEMPLO.length, criado: true });

  // De novo: o mesmo documento, 200.
  const repetido = await api.request('/api/estado-instalacao/exemplo', { method: 'POST', headers: ESCRITA });
  expect(repetido.status).toBe(200);
  expect(await repetido.json()).toEqual({ ...exemplo, criado: false });
  expect((await banco.query('SELECT count(*)::int AS n FROM documento')).rows[0]).toEqual({ n: 1 });
  expect((await estado(api)).primeira_execucao.exemplo_documento_id).toBe(exemplo.documento_id);

  // Nada foi para a fila: nem canonização (motor) nem leitura (Codex).
  expect((await banco.query('SELECT count(*)::int AS n FROM job')).rows[0]).toEqual({ n: 0 });
  const execucao = (await banco.query<{ metodo_versao: string; modelo: string }>(
    'SELECT metodo_versao, modelo FROM execucao_leitura WHERE versao_id=$1', [exemplo.versao_id])).rows;
  expect(execucao).toEqual([{ metodo_versao: METODO_DO_EXEMPLO, modelo: 'importacao' }]);

  // Abre como qualquer documento: na biblioteca, com texto, e o capítulo com as marcas na âncora certa.
  const detalhe = await (await api.request(`/api/documentos/${exemplo.documento_id}`)).json() as { titulo: string; autor: string; texto_disponivel: boolean };
  expect(detalhe).toMatchObject({ titulo: 'Um apólogo', autor: 'Machado de Assis', texto_disponivel: true });
  const canonico = await canonicoDoExemplo();
  const secao = canonico.secoes[0]!;
  const capitulo = await (await api.request(`/api/versoes/${exemplo.versao_id}/capitulos/${secao.id}`)).json() as {
    marcas: { funcao: string; ancora: { bloco_id: string; inicio_utf16: number; fim_utf16: number; citacao: string }; comentario: { rotulo: string } | null }[];
  };
  expect(capitulo.marcas).toHaveLength(MARCAS_DO_EXEMPLO.length);
  for (const marca of capitulo.marcas) {
    const bloco = canonico.blocos.find((b) => b.id === marca.ancora.bloco_id)!;
    expect(bloco.texto.slice(marca.ancora.inicio_utf16, marca.ancora.fim_utf16)).toBe(marca.ancora.citacao);
    expect(MARCAS_DO_EXEMPLO.map((m) => m.citacao)).toContain(marca.ancora.citacao);
  }
  // O original fica na pasta de dados, como o de um envio (exportações e reprocessamento o leem dali).
  const { origem_caminho } = (await banco.query<{ origem_caminho: string }>('SELECT origem_caminho FROM documento WHERE id=$1', [exemplo.documento_id])).rows[0]!;
  expect(origem_caminho.startsWith(dados)).toBe(true);
  expect(await readFile(origem_caminho, 'utf8')).toContain('Era uma vez uma agulha');
}));
