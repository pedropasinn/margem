/**
 * J107: a contagem de marcas da biblioteca vale para todas as funções de todos os modos e bate com o
 * que o leitor mostra — por capítulo, a camada que o leitor abre ali, os grifos do leitor, sem as
 * rejeitadas, as ocultas, as não resolvidas e as da IA sem função. Postgres de teste, sem Codex.
 */
import type { Hono } from 'hono';
import type pg from 'pg';
import { ulid } from 'ulid';
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  validarExecucaoLeituraV2, type AncoraV1, type Bloco, type ExecucaoLeituraV2, type Id, type MarcaV2, type ReferenciaModo,
} from '@margem/contratos';
import { canonicoDeTeste, comBanco } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import * as documentos from '../repos/documentos.js';
import * as execucoes from '../repos/execucoes.js';
import * as marcasRepo from '../repos/marcas.js';
import { criarApi } from './app.js';
import { contagemPorFuncao, type ContagemDeMarcas } from './consultas.js';

const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };
const ECONOMICA: ReferenciaModo = { id: 'economica', revisao: 2 };
const ARGUMENTATIVA: ReferenciaModo = { id: 'argumentativa', revisao: 1 };

function montar(banco: pg.Pool): Hono {
  return criarApi({ banco, leitura: () => { throw new Error('Leitura não usada neste teste.'); }, intervaloEventosMs: 20 });
}

function escrever(api: Hono, metodo: string, caminho: string, dado: unknown): Promise<Response> {
  return Promise.resolve(api.request(caminho, { method: metodo, headers: ESCRITA, body: JSON.stringify(dado) }));
}

function ancora(versaoId: Id, bloco: Bloco, citacao: string): AncoraV1 {
  const inicio = bloco.texto.indexOf(citacao);
  if (inicio < 0) throw new Error(`Citação ausente: ${citacao}`);
  return {
    versao_id: versaoId, bloco_id: bloco.id, inicio_utf16: inicio, fim_utf16: inicio + citacao.length,
    citacao, prefixo: bloco.texto.slice(0, inicio), sufixo: bloco.texto.slice(inicio + citacao.length),
  };
}

function execucao(versaoId: Id, modo: ReferenciaModo, criadaEm: string): ExecucaoLeituraV2 {
  const base: unknown = JSON.parse(readFileSync(new URL('../../../contratos/casos/ExecucaoLeituraV2/valido-minimo.json', import.meta.url), 'utf8'));
  if (!validarExecucaoLeituraV2(base)) throw new Error('Caso de execução V2 inválido.');
  return { ...base, id: ulid(), versao_id: versaoId, plano_partes: [ulid()], criada_em: criadaEm, modo };
}

function marca(a: AncoraV1, funcao: string, exec: ExecucaoLeituraV2, extra: Partial<MarcaV2> = {}): MarcaV2 {
  return {
    id: ulid(), ancora: a, funcao, saliencia: 2, subfaixas: [], comentario: null, origem: 'parte', validade: 'resolvida',
    visivel: true, avaliacao: 'nao_avaliada', camada_id: exec.id, execucao_id: exec.id, modo: exec.modo,
    criada_em: '2026-10-12T12:00:00.000Z', ...extra,
  };
}

interface Montado { documentoId: Id; versaoId: Id; capitulos: Id[]; antiga: Id; economica: Id; bloco: (indice: number) => Bloco }

/**
 * Dois capítulos. A leitura antiga (argumentativa) marca os dois; a recente (econômica) só o primeiro,
 * com uma marca rejeitada, uma oculta, uma ambígua e uma da IA sem função, que o leitor não mostra.
 */
async function preparar(banco: pg.Pool): Promise<Montado> {
  const canonico = canonicoDeTeste({
    blocos: [
      { tipo: 'capitulo', texto: 'Capítulo um' },
      { tipo: 'paragrafo', texto: 'Supomos mercados perfeitos e sem impostos.' },
      { tipo: 'paragrafo', texto: 'O custo de capital independe da estrutura, pela arbitragem.' },
      { tipo: 'paragrafo', texto: 'A estimativa cai dois pontos; o efeito vale só no curto prazo.' },
      { tipo: 'capitulo', texto: 'Capítulo dois' },
      { tipo: 'paragrafo', texto: 'A tese do capítulo dois depende do conceito de valor.' },
    ],
    secoes: [{ nivel: 1, inicio: 0, fim: 3 }, { nivel: 1, inicio: 4, fim: 5 }],
  });
  return comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'teste.md' });
    const versao = await documentos.criarVersao(cliente, documento.id, canonico);
    const bloco = (indice: number): Bloco => canonico.blocos[indice]!;
    const antiga = execucao(versao.id, ARGUMENTATIVA, '2026-10-10T10:00:00.000Z');
    const economica = execucao(versao.id, ECONOMICA, '2026-10-11T10:00:00.000Z');
    await execucoes.criarV2(cliente, antiga);
    await execucoes.criarV2(cliente, economica);
    const a = (indice: number, citacao: string) => ancora(versao.id, bloco(indice), citacao);
    await marcasRepo.publicarMarcasV2(cliente, versao.id, [
      marca(a(1, 'Supomos mercados perfeitos'), 'tese', antiga),
      marca(a(5, 'A tese do capítulo dois'), 'tese', antiga),
      marca(a(5, 'conceito de valor'), 'conceito', antiga),
      marca(a(1, 'Supomos mercados perfeitos'), 'hipotese', economica, { saliencia: 1 }),
      marca(a(2, 'independe da estrutura'), 'resultado', economica),
      marca(a(2, 'pela arbitragem'), 'mecanismo', economica, { saliencia: 3 }),
      marca(a(3, 'A estimativa cai dois pontos'), 'resultado', economica),
      marca(a(3, 'só no curto prazo'), 'limitacao', economica, { avaliacao: 'rejeitada' }),
      marca(a(1, 'sem impostos'), 'limitacao', economica, { visivel: false }),
      marca(a(2, 'O custo de capital'), 'nenhuma', economica, { comentario: null }),
      marca(a(3, 'o efeito vale'), 'mecanismo', economica, { validade: 'ambigua' }),
    ]);
    return {
      documentoId: documento.id, versaoId: versao.id, capitulos: canonico.secoes.map((secao) => secao.id),
      antiga: antiga.id, economica: economica.id, bloco,
    };
  });
}

async function contagemDaBiblioteca(api: Hono, documentoId: Id): Promise<ContagemDeMarcas> {
  const lista = await (await api.request('/api/documentos')).json() as { documentos: { id: Id; marcas: ContagemDeMarcas }[] };
  const naLista = lista.documentos.find((item) => item.id === documentoId)!.marcas;
  const detalhe = await (await api.request(`/api/documentos/${documentoId}`)).json() as { marcas: ContagemDeMarcas };
  expect(detalhe.marcas).toEqual(naLista);
  return naLista;
}

/** O que o leitor desenha, capítulo a capítulo, com o filtro da web (`ReaderController`/`CamadaDeMarcas`). */
async function contagemDoLeitor(api: Hono, m: Montado): Promise<Record<string, number>> {
  const total: Record<string, number> = {};
  for (const secao of m.capitulos) {
    const snapshot = await (await api.request(`/api/versoes/${m.versaoId}/capitulos/${secao}`)).json() as { marcas: MarcaV2[] };
    for (const item of snapshot.marcas) {
      if (!item.visivel || item.validade !== 'resolvida' || item.avaliacao === 'rejeitada' || (item.funcao === 'nenhuma' && item.origem !== 'manual')) continue;
      total[item.funcao] = (total[item.funcao] ?? 0) + 1;
    }
  }
  return total;
}

const comoMapa = (contagem: ContagemDeMarcas): Record<string, number> =>
  Object.fromEntries(contagem.por_funcao.map((item) => [item.funcao, item.quantidade]));

test('J107: modo econômico e modos misturados por capítulo, grifo do leitor, sem rejeitada, oculta, ambígua nem IA sem função', async () =>
  comBanco('j107_por_funcao', async (banco) => {
    const m = await preparar(banco);
    const api = montar(banco);

    // Capítulo um: a econômica (mais recente com marca ali). Capítulo dois: a argumentativa.
    const antes = await contagemDaBiblioteca(api, m.documentoId);
    expect(antes.por_funcao).toEqual([
      { funcao: 'hipotese', rotulo: 'Hipótese', quantidade: 1 },
      { funcao: 'resultado', rotulo: 'Resultado', quantidade: 2 },
      { funcao: 'mecanismo', rotulo: 'Mecanismo', quantidade: 1 },
      { funcao: 'tese', rotulo: 'Tese', quantidade: 1 },
      { funcao: 'conceito', rotulo: 'Conceito', quantidade: 1 },
    ]);
    expect(antes).toMatchObject({ tese: 1, conceito: 1, justificativa: 0, nenhuma: 0, total: 6 });
    expect(comoMapa(antes)).toEqual(await contagemDoLeitor(api, m));

    // Grifo do leitor sem função: o leitor desenha, a biblioteca conta como "Sem função", por último.
    const grifo = await escrever(api, 'POST', '/api/grifos', { ancora: ancora(m.versaoId, m.bloco(5), 'depende'), funcao: 'nenhuma' });
    expect(grifo.status).toBe(201);
    const comGrifo = await contagemDaBiblioteca(api, m.documentoId);
    expect(comGrifo.por_funcao.at(-1)).toEqual({ funcao: 'nenhuma', rotulo: 'Sem função', quantidade: 1 });
    expect(comGrifo).toMatchObject({ nenhuma: 1, total: 7 });
    expect(comoMapa(comGrifo)).toEqual(await contagemDoLeitor(api, m));

    // Rejeitar uma marca no leitor a tira da contagem.
    const resultado = antes.por_funcao.find((item) => item.funcao === 'resultado')!;
    const umResultado = (await comTransacao(banco, (cliente) => marcasRepo.listarV2PorVersao(cliente, m.versaoId, { camada_id: m.economica })))
      .find((item) => item.funcao === 'resultado')!;
    expect((await escrever(api, 'PATCH', `/api/marcas/${umResultado.id}`, { avaliacao: 'rejeitada' })).status).toBe(200);
    const semRejeitada = await contagemDaBiblioteca(api, m.documentoId);
    expect(semRejeitada.por_funcao.find((item) => item.funcao === 'resultado')?.quantidade).toBe(resultado.quantidade - 1);
    expect(comoMapa(semRejeitada)).toEqual(await contagemDoLeitor(api, m));

    // Camada padrão escolhida (a antiga em todos os capítulos): só argumentativa, mais o grifo.
    expect((await escrever(api, 'PUT', `/api/documentos/${m.documentoId}/preferencias`, { camada_padrao: m.antiga })).status).toBe(200);
    const preferida = await contagemDaBiblioteca(api, m.documentoId);
    expect(preferida.por_funcao.map((item) => `${String(item.quantidade)} ${item.rotulo}`)).toEqual(['2 Tese', '1 Conceito', '1 Sem função']);
    expect(comoMapa(preferida)).toEqual(await contagemDoLeitor(api, m));

    // "Primeiro eu": no capítulo sem grifo nem nota do leitor, as marcas da IA não aparecem no leitor nem
    // na contagem; no capítulo do grifo (J132: o grifo libera como a nota), aparecem.
    expect((await escrever(api, 'PUT', `/api/documentos/${m.documentoId}/preferencias`, { primeiro_eu: true })).status).toBe(200);
    const primeiroEu = await contagemDaBiblioteca(api, m.documentoId);
    expect(primeiroEu.por_funcao).toEqual([
      { funcao: 'tese', rotulo: 'Tese', quantidade: 1 },
      { funcao: 'conceito', rotulo: 'Conceito', quantidade: 1 },
      { funcao: 'nenhuma', rotulo: 'Sem função', quantidade: 1 },
    ]);
    expect(comoMapa(primeiroEu)).toEqual(await contagemDoLeitor(api, m));
  }));

test('J107: rótulos e ordem vêm do modo; a mesma chave em modos diferentes soma; desconhecida não some', () => {
  const contagem = contagemPorFuncao([
    { funcao: 'nenhuma', modo_id: 'argumentativa', modo_revisao: 1, quantidade: 2 },
    { funcao: 'tese', modo_id: 'argumentativa', modo_revisao: 1, quantidade: 1 },
    { funcao: 'limitacao', modo_id: 'economica', modo_revisao: 2, quantidade: 4 },
    { funcao: 'conceito', modo_id: 'economica', modo_revisao: 2, quantidade: 3 },
    { funcao: 'conceito', modo_id: 'argumentativa', modo_revisao: 1, quantidade: 1 },
    { funcao: 'funcao_aposentada', modo_id: 'modo_inexistente', modo_revisao: 9, quantidade: 1 },
  ]);
  expect(contagem.por_funcao).toEqual([
    { funcao: 'conceito', rotulo: 'Conceito', quantidade: 4 },
    { funcao: 'limitacao', rotulo: 'Limitação', quantidade: 4 },
    { funcao: 'tese', rotulo: 'Tese', quantidade: 1 },
    { funcao: 'funcao_aposentada', rotulo: 'funcao aposentada', quantidade: 1 },
    { funcao: 'nenhuma', rotulo: 'Sem função', quantidade: 2 },
  ]);
  expect(contagem).toMatchObject({ tese: 1, conceito: 4, justificativa: 0, nenhuma: 2, total: 12 });
  expect(contagemPorFuncao([])).toEqual({ por_funcao: [], tese: 0, conceito: 0, justificativa: 0, nenhuma: 0, total: 0 });
});
