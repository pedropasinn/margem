import { criarApi } from '../http/app.js';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import type { LoteDoModeloV1, ModeloDoCapituloV1, PlanoPedagogicoV1 } from '@margem/contratos';
import { comBanco, idTeste } from '../../testes/apoio.js';
import { configurar, livro, rodarUm } from '../../testes/compreensao.js';
import { comTransacao } from '../db/transacao.js';
import * as documentos from '../repos/documentos.js';
import * as repo from '../repos/compreensao.js';
import { exigirModo } from '../modos.js';
import { iniciarCompreensao, prepararCapitulo } from './pipeline.js';
import { publicarModeloDoCapitulo } from './publicacao-modelo.js';
import { hashDoPerfil, hashLegadoDoPerfil } from './perfil.js';
const temporarios: string[] = [];
afterEach(async () => { for (const p of temporarios.splice(0)) await rm(p, { recursive: true, force: true }); });

test('fronteira recusa contexto errado, reverte publicação e serializa revisões concorrentes; perfil legado é reutilizado', async () => comBanco('publicacao_j52', async banco => {
  const canonico = livro();
  const versao = await comTransacao(banco, async c => {
    const d = await documentos.criar(c, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
    return documentos.criarVersao(c, d.id, canonico);
  });
  const { config, auditoria } = await configurar(banco, temporarios);
  const execucao = await iniciarCompreensao(config, versao.id, exigirModo({ id: 'argumentativa', revisao: 1 }));
  const secao = canonico.secoes[0]!;
  await prepararCapitulo(config, execucao.id, secao.id);
  const slots = await mkdtemp(join(tmpdir(), 'margem-j52-')); temporarios.push(slots);
  for (let i = 0; i < 3; i++) await rodarUm(banco, config, auditoria, slots);
  const base = await comTransacao(banco, c => repo.revisaoDoCapitulo(c, execucao.id, secao.id));
  if (!base || base.revisao !== 2) throw new Error('Pipeline não publicou r2.');
  const novo = (n: number): [ModeloDoCapituloV1, LoteDoModeloV1] => {
    const lote: LoteDoModeloV1 = { versao: 1, id: idTeste('T', n), execucao_id: execucao.id, secao_id: secao.id, estagio: 'revisao',
      base_id: base.id, resultado_id: idTeste('M', n), job_ids: [base.elementos[0]!.origem.job_id], operacoes: [], criado_em: base.criada_em };
    return [{ ...structuredClone(base), id: lote.resultado_id, revisao: 3, base_id: base.id, lote_id: lote.id }, lote];
  };
  for (const tipo of ['bloco', 'citacao', 'base', 'resultado'] as const) {
    const [m, l] = novo(90);
    if (tipo === 'bloco') m.elementos[0]!.ancoras[0]!.bloco_id = canonico.blocos.at(-1)!.id;
    if (tipo === 'citacao') m.elementos[0]!.ancoras[0]!.prefixo = 'contexto inventado';
    if (tipo === 'base') m.base_id = idTeste('M', 888);
    if (tipo === 'resultado') m.elementos[0]!.enunciado += ' sem operação';
    await expect(comTransacao(banco, c => publicarModeloDoCapitulo(c, m, l))).rejects.toThrow();
  }
  const [m, l] = novo(91);
  await expect(comTransacao(banco, async c => { await publicarModeloDoCapitulo(c, m, l); throw new Error('Falha após gravar.'); })).rejects.toThrow('Falha após gravar');
  expect((await banco.query('SELECT id FROM modelo_capitulo WHERE id=$1', [m.id])).rowCount).toBe(0);
  expect((await banco.query('SELECT id FROM lote_modelo WHERE id=$1', [l.id])).rowCount).toBe(0);

  // Publica uma representação histórica antes do job do plano, sem UPDATE em artefatos imutáveis.
  const plano = JSON.parse(readFileSync(new URL('../../../contratos/casos/PlanoPedagogico/valido-um-passo.json', import.meta.url), 'utf8')) as PlanoPedagogicoV1;
  Object.assign(plano, { id: idTeste('P', 99), execucao_id: execucao.id, secao_id: secao.id, modelo_id: base.id,
    perfil_hash: hashLegadoDoPerfil(null), job_id: base.elementos[0]!.origem.job_id });
  plano.passos[0]!.bloco_inicio = secao.bloco_inicio; plano.passos[0]!.bloco_fim = secao.bloco_fim;
  plano.passos[0]!.foco = []; plano.passos[0]!.relacoes = []; plano.apoios = [];
  await comTransacao(banco, c => repo.gravarPlano(c, plano));
  await rodarUm(banco, config, auditoria, slots);
  const encontrado = await comTransacao(banco, c => repo.planoDoCapitulo(c, execucao.id, secao.id, hashDoPerfil(null)));
  expect(encontrado).toEqual(plano);
  const concorrentes = await Promise.all([1, 2].map(n => comTransacao(banco, c => repo.gravarPlano(c,
    { ...plano, id: idTeste('P', 100 + n), perfil_hash: hashDoPerfil(null) }))));
  expect(concorrentes.map(p => p.id)).toEqual([plano.id, plano.id]);
  expect((await banco.query('SELECT id FROM plano_pedagogico WHERE modelo_id=$1', [base.id])).rowCount).toBe(1);
  expect(await comTransacao(banco, c => repo.perfilPeloHash(c, hashLegadoDoPerfil(null)))).toBeNull();

  const resultados = await Promise.allSettled([92, 93].map(n => { const [modelo, lote] = novo(n); return comTransacao(banco, c => publicarModeloDoCapitulo(c, modelo, lote)); }));
  expect(resultados.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(resultados.filter(r => r.status === 'rejected')).toHaveLength(1);
  expect((await banco.query('SELECT id FROM modelo_capitulo WHERE execucao_id=$1 AND revisao=3', [execucao.id])).rowCount).toBe(1);

  // O plano r2 continua íntegro enquanto uma revisão r3 já está publicada.
  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura V2 não usada.'); }, compreensao: () => config, recursos: new Set(['eink'] as const) });
  const caminho = `/api/compreensoes/${execucao.id}/capitulos/${secao.id}`;
  const resposta = await api.request(caminho);
  expect(resposta.status).toBe(200);
  expect(await resposta.json()).toMatchObject({ modelo: { id: base.id, revisao: 2 }, plano: { modelo_id: base.id } });
  for (const sufixo of ['apresentacao?dispositivo=desktop', 'apresentacao?dispositivo=eink', 'eink.epub']) {
    expect((await api.request(`/api/planos/${plano.id}/${sufixo}`)).status).toBe(200);
  }
  const relacoes = await api.request(`${caminho}/relacoes?filtro=todas&modelo_id=${base.id}`);
  expect(relacoes.status).toBe(200);
  expect(await relacoes.json()).toMatchObject({ modelo_id: base.id });
  expect((await api.request(`${caminho}/relacoes?modelo_id=${idTeste('M', 999)}`)).status).toBe(409);
  // Simula plano histórico com referência inexistente somente no banco temporário.
  const ultima = await comTransacao(banco, c => repo.revisaoDoCapitulo(c, execucao.id, secao.id));
  const incoerente = { ...structuredClone(plano), id: idTeste('P', 888), modelo_id: ultima!.id, criado_em: '2026-09-29T12:00:00Z' };
  incoerente.passos[0]!.foco = [idTeste('E', 999)];
  await expect(comTransacao(banco, c => repo.gravarPlano(c, incoerente))).rejects.toThrow('Plano contextual inválido');
  expect((await banco.query('SELECT id FROM plano_pedagogico WHERE id=$1', [incoerente.id])).rowCount).toBe(0);
  // Simula dado histórico gravado antes desta fronteira, sem desativar imutabilidade.
  await banco.query('INSERT INTO plano_pedagogico (id,execucao_id,secao_id,modelo_id,perfil_hash,conteudo,criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [incoerente.id, incoerente.execucao_id, incoerente.secao_id, incoerente.modelo_id, incoerente.perfil_hash, JSON.stringify(incoerente), incoerente.criado_em]);
  for (const url of [caminho, `/api/planos/${incoerente.id}/apresentacao`, `/api/planos/${incoerente.id}/eink.epub`]) {
    expect((await api.request(url)).status).toBe(409);
  }
}));
