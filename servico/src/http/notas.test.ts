/**
 * J37 na API: o Codex revisa uma nota do leitor (job `revisar_anotacao`). Postgres de teste, worker e
 * executor falso; nenhuma chamada ao Codex.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { afterEach, expect, test } from 'vitest';
import { validarAnotacao, type AncoraV1, type AnotacaoV1, type Bloco, type MarcaV2 } from '@margem/contratos';
import { canonicoDeTeste, comBanco } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import { criarExecutorFalso } from '../executor/fake.js';
import type { PedidoExecucao } from '../executor/tipos.js';
import { manipuladoresDaRevisao } from '../notas/revisar.js';
import * as documentos from '../repos/documentos.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { Worker } from '../worker/worker.js';
import { criarApi } from './app.js';

const temporarios: string[] = [];
afterEach(async () => { for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true }); });
const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };
function escrever(api: Hono, metodo: string, caminho: string, dado?: unknown): Promise<Response> {
  return Promise.resolve(api.request(caminho, { method: metodo, headers: ESCRITA, ...(dado === undefined ? {} : { body: JSON.stringify(dado) }) }));
}
function ancora(versaoId: string, bloco: Bloco, citacao: string): AncoraV1 {
  const inicio = bloco.texto.indexOf(citacao);
  return { versao_id: versaoId, bloco_id: bloco.id, inicio_utf16: inicio, fim_utf16: inicio + citacao.length,
    citacao, prefixo: bloco.texto.slice(0, inicio), sufixo: bloco.texto.slice(inicio + citacao.length) };
}

test('o Codex revisa a nota do leitor sobre o grifo dele: um pedido por vez, o texto anterior e o motivo ficam', async () => comBanco('j37_revisar_nota', async (banco) => {
  const canonico = canonicoDeTeste({ titulo: 'Ensaio', blocos: [
    { tipo: 'capitulo', texto: 'Um' },
    { tipo: 'paragrafo', texto: 'A razão comum basta para ver que a ordem do mundo pede explicação.' },
  ], secoes: [{ nivel: 1, inicio: 0, fim: 1 }] });
  const versaoId = await comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'ensaio.md' });
    return (await documentos.criarVersao(cliente, documento.id, canonico)).id;
  });
  const bloco = canonico.blocos[1]!;
  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); }, intervaloEventosMs: 20 });
  const artefatos = await mkdtemp(join(tmpdir(), 'margem-j37-art-'));
  const slots = await mkdtemp(join(tmpdir(), 'margem-j37-slots-'));
  temporarios.push(artefatos, slots);
  const pedidos: PedidoExecucao[] = [];
  const falso = criarExecutorFalso({ versao: 1, passos: [
    { quando: { ordem: 1 }, tipo: 'ok', conteudo: { texto: 'Dúvida: a "razão comum" basta mesmo, ou o autor supõe o que quer provar?', motivo: 'Formulei como pergunta, como ele pediu.' } },
  ] });
  const executor = (pedido: PedidoExecucao) => { pedidos.push(pedido); return falso({ ...pedido, diretorioArtefatos: artefatos }); };
  const rodar = () => new Worker({ fila: new FilaPostgres(banco), manipuladores: manipuladoresDaRevisao({ banco, executor, modelo: 'modelo-de-teste', esforco: 'medio', prazoMs: 10_000 }),
    slots: 1, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: 1, heartbeatMs: 60_000 }).rodar();

  // O leitor grifa, anota sobre o grifo e pede a revisão, com uma instrução.
  const trecho = ancora(versaoId, bloco, 'A razão comum basta');
  const { marca } = await (await escrever(api, 'POST', '/api/grifos', { ancora: trecho, funcao: 'tese' })).json() as { marca: MarcaV2 };
  const { anotacao } = await (await escrever(api, 'POST', '/api/anotacoes', { ancora: trecho, tipo: 'duvida', texto: 'razão comum basta?', marca_id: marca.id })).json() as { anotacao: AnotacaoV1 };
  const pedido = await escrever(api, 'POST', `/api/anotacoes/${anotacao.id}/revisar`, { instrucao: 'Formule como pergunta.' });
  expect(pedido.status).toBe(202);
  // Um pedido por vez.
  expect((await escrever(api, 'POST', `/api/anotacoes/${anotacao.id}/revisar`, {})).status).toBe(409);
  expect((await escrever(api, 'POST', `/api/anotacoes/${anotacao.id}/revisar`, { instrucao: 'x'.repeat(1001) })).status).toBe(400);
  const secao = canonico.secoes[0]!.id;
  const antes = await (await api.request(`/api/versoes/${versaoId}/capitulos/${secao}`)).json() as { revisoes_pendentes: string[] };
  expect(antes.revisoes_pendentes).toEqual([anotacao.id]);

  await rodar();
  expect(pedidos).toHaveLength(1);
  expect(pedidos[0]?.prompt).toContain('razão comum basta?');
  expect(pedidos[0]?.prompt).toContain('Formule como pergunta.');
  expect(pedidos[0]?.prompt).toContain('Função: tese');
  expect(pedidos[0]?.prompt).toContain('A razão comum basta para ver que a ordem do mundo pede explicação.');
  const depois = await (await api.request(`/api/versoes/${versaoId}/capitulos/${secao}`)).json() as { anotacoes: AnotacaoV1[]; revisoes_pendentes: string[] };
  expect(depois.revisoes_pendentes).toEqual([]);
  const revisada = depois.anotacoes.find((item) => item.id === anotacao.id)!;
  expect(validarAnotacao(revisada)).toBe(true);
  expect(revisada).toMatchObject({ texto: 'Dúvida: a "razão comum" basta mesmo, ou o autor supõe o que quer provar?', marca_id: marca.id,
    revisao: { autor: 'codex', texto_anterior: 'razão comum basta?', motivo: 'Formulei como pergunta, como ele pediu.' } });

  expect(revisada.revisao_edicao).toBe(2);
  expect((await escrever(api, 'PATCH', `/api/anotacoes/${anotacao.id}`, { texto: 'Texto antigo', revisao: 1 })).status).toBe(409);
  // O leitor volta ao texto dele editando a nota: a revisão continua registrada.
  const voltou = await (await escrever(api, 'PATCH', `/api/anotacoes/${anotacao.id}`, { texto: 'razão comum basta?', revisao: 2 })).json() as { anotacao: AnotacaoV1 };
  expect(voltou.anotacao).toMatchObject({ texto: 'razão comum basta?', revisao: { autor: 'codex' } });
  // Revisada, pode pedir de novo; nota inexistente, 404.
  expect((await escrever(api, 'POST', `/api/anotacoes/${anotacao.id}/revisar`, {})).status).toBe(202);
  expect((await escrever(api, 'POST', `/api/anotacoes/${'0'.repeat(26)}/revisar`, {})).status).toBe(404);
}));
