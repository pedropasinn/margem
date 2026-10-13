/**
 * Conceitos programados do vídeo (noite2/video-popups): pedido pela API → job com executor falso →
 * citações conferidas, instante da primeira palavra citada, cortes com diagnóstico, idempotência e
 * nova tentativa depois de falha. Postgres de teste; nenhuma chamada ao Codex.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import type { ConceitosDoVideoV1 } from '@margem/contratos';
import { canonicoDeTeste, comBanco } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import { criarExecutorFalso } from '../executor/fake.js';
import type { PedidoExecucao } from '../executor/tipos.js';
import { criarApi } from '../http/app.js';
import * as documentos from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { Worker } from '../worker/worker.js';
import { faixaDeQuantidade, lerChaveDosConceitos, listaDosGrifos, manipuladoresDosConceitos, paragrafosFalados } from './conceitos.js';
import { montarMidia } from './publicacao.js';

const temporarios: string[] = [];
afterEach(async () => { for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true }); });
const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };

const PARAGRAFOS = [
  'Hoje vamos falar de stablecoin, que é uma moeda digital atrelada ao dólar.',
  'O Tesouro americano compra e vende títulos, e os títulos pagam juros.',
  'O Banco Central e o Banco Central europeu discordam sobre isso.',
  'A Selic subiu de novo e o crédito ficou mais caro para todo mundo.',
  'Voltando à stablecoin: o lastro precisa ser auditado todo mês.',
  'Por fim, o arcabouço fiscal limita o crescimento da despesa pública.',
];

/** Uma palavra a cada 2,5 s; cada parágrafo começa 150 s depois do anterior (vídeo de 15 min). */
function transcricao(): { texto: string; inicio_s: number; fim_s: number }[] {
  return PARAGRAFOS.flatMap((p, i) => p.split(' ').map((texto, j) => ({ texto, inicio_s: i * 150 + j * 2.5, fim_s: i * 150 + j * 2.5 + 2 })));
}

const SAIDA = { conceitos: [
  { paragrafo: 'P1', citacao: 'stablecoin, que é uma moeda', titulo: 'O que é uma stablecoin?', curto: 'Stablecoin', explicacao: 'Uma moeda digital com valor atrelado a outra. Serve para guardar dólar na rede.' },
  // Perto demais da anterior (o mesmo parágrafo, 10 s depois).
  { paragrafo: 'P1', citacao: 'atrelada ao dólar', titulo: 'Paridade', curto: 'Paridade', explicacao: 'Valor fixo em relação a outra moeda.' },
  { paragrafo: 'P2', citacao: 'compra e vende ações', titulo: 'Títulos do Tesouro', curto: 'Títulos', explicacao: 'Dívida do governo.' },
  { paragrafo: 'P3', citacao: 'Banco Central', titulo: 'Banco Central', curto: 'Banco Central', explicacao: 'Quem cuida da moeda.' },
  { paragrafo: 'P4', citacao: 'A Selic subiu', titulo: 'Selic', curto: 'Taxa de juros do BC', explicacao: 'A taxa básica de juros do Brasil. Ela orienta o custo do crédito.' },
  { paragrafo: 'P5', citacao: 'o lastro precisa', titulo: 'O que é uma stablecoin', curto: 'Stablecoin', explicacao: 'Repetida.' },
  { paragrafo: 'P9', citacao: 'nada', titulo: 'Fora', curto: 'Fora', explicacao: 'Parágrafo inexistente.' },
  { paragrafo: 'P6', citacao: 'o arcabouço fiscal limita', titulo: 'Arcabouço fiscal', curto: 'Arcabouço fiscal', explicacao: 'A regra que limita o gasto federal. Substituiu o teto de gastos.' },
] };

test('conceitos do vídeo: API → Codex (falso) → cartões conferidos, com instante e diagnósticos', async () => comBanco('conceitos_video', async (banco) => {
  const canonico = canonicoDeTeste({ titulo: 'Vídeo de teste', blocos: [{ tipo: 'capitulo', texto: 'Vídeo de teste' }, ...PARAGRAFOS.map((texto) => ({ tipo: 'paragrafo' as const, texto }))],
    secoes: [{ nivel: 1, inicio: 0, fim: PARAGRAFOS.length }] });
  const versao = await comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'teste.txt' });
    return documentos.criarVersao(cliente, documento.id, canonico);
  });
  const { midia } = montarMidia({ documento_id: versao.documento_id, versao_id: versao.id, sha256: 'b'.repeat(64), titulo: 'Stablecoins e juros',
    fonte: { url: 'https://www.youtube.com/watch?v=x', canal: 'Fernando Ulrich' }, capitulos: [], transcricao: { motor: 'teste', idioma: 'pt', palavras: transcricao() } },
  canonico, { tipo: 'video', mime: 'video/mp4', duracao_s: 900, bytes: 1, largura: 160, altura: 90 });
  await banco.query('INSERT INTO midia (id, documento_id, versao_id, sha256, tipo, conteudo) VALUES ($1,$2,$3,$4,$5,$6)',
    [midia.id, midia.documento_id, midia.versao_id, midia.sha256, midia.tipo, JSON.stringify(midia)]);

  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); }, intervaloEventosMs: 20 });
  const url = `/api/midias/${midia.id}/conceitos`;
  expect(await (await api.request(url)).json()).toEqual({ estado: 'nao_preparado', conceitos: null });
  expect((await api.request('/api/midias/01K00000000000000000000000/conceitos')).status).toBe(404);
  const pedido = await api.request(url, { method: 'POST', headers: ESCRITA });
  expect(pedido.status).toBe(202);
  expect((await pedido.json() as { estado: string }).estado).toBe('preparando');
  await api.request(url, { method: 'POST', headers: ESCRITA });
  const jobs = (await banco.query<{ dedup_key: string }>("SELECT dedup_key FROM job WHERE tipo='conceitos_do_video'")).rows;
  expect(jobs).toHaveLength(1);
  expect(lerChaveDosConceitos(jobs[0]!.dedup_key)).toBe(midia.id);

  const pedidos: PedidoExecucao[] = [];
  const artefatos = await mkdtemp(join(tmpdir(), 'margem-conceitos-art-'));
  const slots = await mkdtemp(join(tmpdir(), 'margem-conceitos-slots-'));
  temporarios.push(artefatos, slots);
  const falso = criarExecutorFalso({ versao: 1, passos: [{ quando: { ordem: 1 }, tipo: 'ok', conteudo: SAIDA }] });
  const executor = (p: PedidoExecucao) => { pedidos.push(p); return falso({ ...p, diretorioArtefatos: artefatos }); };
  const rodar = () => new Worker({ fila: new FilaPostgres(banco), manipuladores: manipuladoresDosConceitos({ banco, executor, modelo: 'modelo-de-teste', esforco: 'medium', prazoMs: 10_000, diretorioArtefatos: artefatos }),
    slots: 1, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: 1, heartbeatMs: 60_000 }).rodar();
  await rodar();

  expect(pedidos).toHaveLength(1);
  expect(pedidos[0]!.esforco).toBe('medium');
  const prompt = pedidos[0]!.prompt;
  expect(prompt).toContain('[P1 · 0:00] Hoje vamos falar de stablecoin');
  expect(prompt).toContain('[P4 · 7:30] A Selic subiu');
  expect(prompt).toContain('Canal: Fernando Ulrich');
  expect(prompt).toContain(`de ${String(faixaDeQuantidade(900).minimo)} a ${String(faixaDeQuantidade(900).maximo)} momentos`);
  expect(prompt).toContain('(nenhum grifo neste vídeo)');
  expect(prompt).not.toMatch(/[0-7][0-9A-HJKMNP-TV-Z]{25}/u);

  const resposta = await (await api.request(url)).json() as { estado: string; conceitos: ConceitosDoVideoV1 };
  expect(resposta.estado).toBe('pronto');
  const { conceitos, diagnosticos } = resposta.conceitos;
  expect(conceitos.map((c) => [c.titulo, c.instante_s])).toEqual([
    // "stablecoin," é a 5ª palavra do P1; "A" (de "A Selic") é a 1ª do P4; "o" de "o arcabouço" é a 3ª do P6.
    ['O que é uma stablecoin?', 10], ['Selic', 450], ['Arcabouço fiscal', 755],
  ]);
  // O rótulo da pílula: guardado quando cabe na regra; fora dela, some (a web deriva do título).
  expect(conceitos.map((c) => c.curto)).toEqual(['Stablecoin', undefined, 'Arcabouço fiscal']);
  expect(conceitos[0]!.ancora).toMatchObject({ bloco_id: canonico.blocos[1]!.id, citacao: 'stablecoin, que é uma moeda', inicio_utf16: 20 });
  expect(diagnosticos.map((d) => d.codigo).sort()).toEqual(['citacao_ambigua', 'citacao_ausente', 'curto_invalido', 'paragrafo_inexistente', 'perto_demais', 'repetido']);
  expect(resposta.conceitos.execucao).toMatchObject({ esforco: 'medium', prompt: 'conceitos-do-video@2' });

  // Pronto: pedir de novo não gera outro job. Imutável.
  await api.request(url, { method: 'POST', headers: ESCRITA });
  expect((await banco.query("SELECT count(*)::int AS n FROM job WHERE tipo='conceitos_do_video'")).rows[0]).toEqual({ n: 1 });
  await expect(banco.query('DELETE FROM conceitos_video')).rejects.toThrow(/imutável/u);

  // Conceitos prontos de um prompt anterior (@1, sem `curto`): "Preparar" pede de novo com o atual.
  const antigo = await comTransacao(banco, (cliente) => jobsRepo.enfileirar(cliente, { tipo: 'conceitos_do_video', dedup_key: `conceitos:${midia.id}:conceitos-do-video@1:0`, input_snapshot_hash: 'd'.repeat(64), versao_id: midia.versao_id }));
  const conteudoAntigo = { ...resposta.conceitos, id: '01K0000000000000000000ANTG', job_id: antigo.id, execucao: { ...resposta.conceitos.execucao, prompt: 'conceitos-do-video@1' } };
  await banco.query('INSERT INTO conceitos_video(id,midia_id,versao_id,job_id,conteudo) VALUES ($1,$2,$3,$4,$5)', [conteudoAntigo.id, midia.id, midia.versao_id, antigo.id, JSON.stringify(conteudoAntigo)]);
  expect((await (await api.request(url, { method: 'POST', headers: ESCRITA })).json() as { estado: string }).estado).toBe('preparando');
  expect((await banco.query("SELECT dedup_key FROM job WHERE tipo='conceitos_do_video' ORDER BY criado_em DESC LIMIT 1")).rows[0]).toEqual({ dedup_key: `conceitos:${midia.id}:conceitos-do-video@2:1` });
}));

test('conceitos do vídeo: depois de uma falha, "Preparar" enfileira outra tentativa', async () => comBanco('conceitos_falha', async (banco) => {
  const canonico = canonicoDeTeste({ blocos: [{ tipo: 'paragrafo', texto: 'Uma fala curta sobre stablecoin.' }] });
  const versao = await comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'teste.txt' });
    return documentos.criarVersao(cliente, documento.id, canonico);
  });
  const palavras = 'Uma fala curta sobre stablecoin.'.split(' ').map((texto, i) => ({ texto, inicio_s: i, fim_s: i + 0.8 }));
  const { midia } = montarMidia({ documento_id: versao.documento_id, versao_id: versao.id, sha256: 'c'.repeat(64), titulo: 'Curto', fonte: null, capitulos: [],
    transcricao: { motor: 'teste', idioma: 'pt', palavras } }, canonico, { tipo: 'video', mime: 'video/mp4', duracao_s: 6, bytes: 1 });
  await banco.query('INSERT INTO midia (id, documento_id, versao_id, sha256, tipo, conteudo) VALUES ($1,$2,$3,$4,$5,$6)',
    [midia.id, midia.documento_id, midia.versao_id, midia.sha256, midia.tipo, JSON.stringify(midia)]);
  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); }, intervaloEventosMs: 20 });
  const url = `/api/midias/${midia.id}/conceitos`;
  await api.request(url, { method: 'POST', headers: ESCRITA });
  await banco.query("UPDATE job SET estado='falhou' WHERE tipo='conceitos_do_video'");
  expect((await (await api.request(url)).json() as { estado: string }).estado).toBe('falhou');
  expect((await (await api.request(url, { method: 'POST', headers: ESCRITA })).json() as { estado: string }).estado).toBe('preparando');
  const chaves = (await banco.query<{ dedup_key: string }>("SELECT dedup_key FROM job WHERE tipo='conceitos_do_video' ORDER BY criado_em")).rows.map((r) => r.dedup_key);
  expect(chaves).toEqual([`conceitos:${midia.id}:conceitos-do-video@2:0`, `conceitos:${midia.id}:conceitos-do-video@2:1`]);
}));

test('conceitos do vídeo: o prompt lista os grifos dos parágrafos falados, na ordem do texto', () => {
  const blocos = [{ id: 'B1', texto: 'Primeiro parágrafo com stablecoin.' }, { id: 'B2', texto: 'Segundo, com a Selic.' }, { id: 'B3', texto: 'Não falado.' }];
  const palavras = [{ bloco_id: 'B1', inicio_utf16: 0, fim_utf16: 8, inicio_s: 0, fim_s: 1 }, { bloco_id: 'B2', inicio_utf16: 0, fim_utf16: 7, inicio_s: 5, fim_s: 6 }];
  const paragrafos = paragrafosFalados(blocos, { palavras });
  expect(listaDosGrifos([
    { funcao: 'tese', ancora: { bloco_id: 'B2', citacao: 'com a  Selic' } },
    { funcao: 'conceito', ancora: { bloco_id: 'B1', citacao: 'stablecoin' } },
    { funcao: 'tese', ancora: { bloco_id: 'B3', citacao: 'Não falado' } },
  ], paragrafos)).toBe('- P1 · conceito · "stablecoin"\n- P2 · tese · "com a Selic"');
  expect(listaDosGrifos([], paragrafos)).toBe('(nenhum grifo neste vídeo)');
});
