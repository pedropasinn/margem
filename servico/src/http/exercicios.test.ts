/**
 * Exercícios na API: descobrir os exercícios de um livro (texto canônico e PDF, este com o script
 * trocado), criar os pedidos sem disparar, disparar em lote, refazer e exportar em LaTeX. Worker e
 * executor falsos: nenhuma chamada ao Codex. O PDF compilado pelo tectonic só com MARGEM_TESTE_LATEX=1.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { ResolucaoGeradaV1, ResolucaoV2 } from '@margem/contratos';
import { canonicoDeTeste, comBanco } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import { criarExecutorFalso } from '../executor/fake.js';
import { binarioDoTectonic } from '../exercicios/compilar.js';
import type { ExercicioDescoberto } from '../exercicios/descoberta.js';
import * as documentos from '../repos/documentos.js';
import { manipuladoresDaResolucao } from '../resolucao/pipeline.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { Worker } from '../worker/worker.js';
import { criarApi } from './app.js';

const temporarios: string[] = [];
let dadosAntes: string | undefined;
let dados = '';
beforeEach(async () => {
  dadosAntes = process.env.MARGEM_DADOS;
  dados = await mkdtemp(join(tmpdir(), 'margem-exercicios-dados-'));
  temporarios.push(dados);
  process.env.MARGEM_DADOS = dados;
});
afterEach(async () => {
  if (dadosAntes === undefined) delete process.env.MARGEM_DADOS; else process.env.MARGEM_DADOS = dadosAntes;
  for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true });
});

const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };
function escrever(api: Hono, metodo: string, caminho: string, dado?: unknown): Promise<Response> {
  return Promise.resolve(api.request(caminho, { method: metodo, headers: ESCRITA, ...(dado === undefined ? {} : { body: JSON.stringify(dado) }) }));
}
async function ler<T>(api: Hono, caminho: string): Promise<T> {
  const resposta = await api.request(caminho);
  expect(resposta.status, caminho).toBe(200);
  return await resposta.json() as T;
}
interface Lista { exercicios: { resolucao: ResolucaoV2; estado: string; capitulo: string; secao: string | null; numero: string | null; secao_id: string | null }[] }

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const RESOLUCAO: ResolucaoGeradaV1 = {
  enunciado: 'Prove que $1 + 2 + \\cdots + n = \\frac{n(n+1)}{2}$ para todo $n \\in \\mathbb{N}$.', legibilidade: 'boa',
  itens: [{ rotulo: '', enunciado: 'A soma dos $n$ primeiros naturais.', estrategia: 'Indução em $n$: 50% do trabalho é a base & o resto, o passo.',
    passos: [{ texto: 'Base: para $n = 1$ os dois lados valem $1$.', calculo: '$$1 = \\frac{1 \\cdot 2}{2}$$' },
      { texto: 'Passo: some $k+1$ aos dois lados.', calculo: '$$\\sum_{i=1}^{k+1} i = \\frac{k(k+1)}{2} + (k+1) = \\frac{(k+1)(k+2)}{2}$$' }],
    resposta: 'Vale para todo $n \\ge 1$.', verificacao: 'Para $n = 3$: $1+2+3 = 6 = \\frac{3 \\cdot 4}{2}$.' }],
  conceitos: ['indução'], observacao: null,
};

function rodarWorker(banco: import('pg').Pool, slots: string, artefatos: string, respostas: number) {
  const falso = criarExecutorFalso({ versao: 1, passos: Array.from({ length: respostas }, (_, i) => ({ quando: { ordem: i + 1 }, tipo: 'ok' as const, conteudo: RESOLUCAO })) });
  const config = { banco, executor: (pedido: Parameters<typeof falso>[0]) => falso({ ...pedido, diretorioArtefatos: artefatos }), modelo: 'modelo-de-teste', esforco: 'medium', prazoMs: 10_000 };
  return () => new Worker({ fila: new FilaPostgres(banco), manipuladores: manipuladoresDaResolucao(config), slots: 1, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: 1, heartbeatMs: 60_000 }).rodar();
}

test('livro em texto: descobrir, criar os pedidos sem disparar, disparar um lote, refazer e exportar', async () => comBanco('exercicios_texto', async (banco) => {
  const canonico = canonicoDeTeste({ titulo: 'Análise', blocos: [
    { tipo: 'capitulo', texto: 'Conjuntos finitos' },
    { tipo: 'paragrafo', texto: 'Teorema 1. Todo conjunto finito tem um elemento máximo.' },
    { tipo: 'secao', texto: '5. Exercícios' },
    { tipo: 'secao', texto: 'Seção 1: Números naturais' },
    { tipo: 'paragrafo', texto: '1. Prove por indução que 1 + 2 + … + n = n(n+1)/2.' },
    { tipo: 'paragrafo', texto: '(a) Comece por n = 1.' },
    { tipo: 'paragrafo', texto: '2. Prove o princípio da boa ordenação.' },
    { tipo: 'capitulo', texto: 'Números reais' },
    { tipo: 'paragrafo', texto: '1. Isto não é exercício: está fora da seção de exercícios.' },
  ], secoes: [{ nivel: 1, inicio: 0, fim: 6 }, { nivel: 2, inicio: 2, fim: 6 }, { nivel: 3, inicio: 3, fim: 6 }, { nivel: 1, inicio: 7, fim: 8 }] });
  const documento = await comTransacao(banco, async (cliente) => {
    const criado = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/analise.txt' });
    await documentos.criarVersao(cliente, criado.id, canonico);
    return criado;
  });
  const slots = await mkdtemp(join(tmpdir(), 'margem-ex-slots-'));
  const artefatos = await mkdtemp(join(tmpdir(), 'margem-ex-art-'));
  temporarios.push(slots, artefatos);
  const rodar = rodarWorker(banco, slots, artefatos, 3);
  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); }, intervaloEventosMs: 20 });
  const base = `/api/documentos/${documento.id}/exercicios`;

  // Só olhar: nada é criado.
  const olhar = await escrever(api, 'POST', `${base}/descobrir`, {});
  expect(olhar.status).toBe(200);
  expect(await olhar.json()).toEqual({ fonte: 'canonico', total: 2, capitulos: [{ capitulo: 'Conjuntos finitos', exercicios: 2, secoes: [{ secao: 'Seção 1: Números naturais', exercicios: 2 }] }] });
  expect((await ler<Lista>(api, base)).exercicios).toEqual([]);
  expect((await escrever(api, 'POST', `${base}/descobrir`, { criar: 'sim' })).status).toBe(400);

  // Criar: um pedido por exercício, pendente (sem job); de novo, nada se repete.
  const criar = await escrever(api, 'POST', `${base}/descobrir`, { criar: true });
  expect(criar.status).toBe(201);
  expect((await criar.json() as { lote: unknown }).lote).toEqual({ criados: 2, reconhecidos: 0, ja_existiam: 0 });
  expect((await (await escrever(api, 'POST', `${base}/descobrir`, { criar: true })).json() as { lote: unknown }).lote).toEqual({ criados: 0, reconhecidos: 0, ja_existiam: 2 });
  const lista = await ler<Lista>(api, base);
  expect(lista.exercicios.map((ex) => [ex.numero, ex.estado, ex.capitulo, ex.secao])).toEqual([
    ['1', 'pendente', 'Conjuntos finitos', 'Seção 1: Números naturais'], ['2', 'pendente', 'Conjuntos finitos', 'Seção 1: Números naturais']]);
  expect(lista.exercicios[0]?.resolucao.texto_extraido).toBe('1. Prove por indução que 1 + 2 + … + n = n(n+1)/2.\n(a) Comece por n = 1.');
  expect(lista.exercicios[0]?.secao_id).toBe(canonico.secoes[0]?.id);
  expect((await banco.query("SELECT count(*)::int AS n FROM job WHERE tipo='resolver_exercicio'")).rows[0]).toEqual({ n: 0 });

  // Disparar um lote de 1: só o primeiro vai para a fila.
  expect((await escrever(api, 'POST', `${base}/disparar`, { limite: 0 })).status).toBe(400);
  const disparo = await escrever(api, 'POST', `${base}/disparar`, { limite: 1 });
  expect(disparo.status).toBe(202);
  expect(await disparo.json()).toEqual({ disparados: [lista.exercicios[0]?.resolucao.id], restantes: 1 });
  expect((await banco.query("SELECT prioridade FROM job WHERE tipo='resolver_exercicio'")).rows).toEqual([{ prioridade: 50 }]);
  await rodar();
  const depois = await ler<Lista>(api, base);
  expect(depois.exercicios.map((ex) => ex.estado)).toEqual(['pronta', 'pendente']);

  // Resolver o pendente pela página; refazer o pronto (sessão nova no lugar, mesmo exercício).
  const pendente = depois.exercicios[1]!.resolucao.id;
  expect((await escrever(api, 'POST', `/api/resolucoes/${pendente}/resolver`)).status).toBe(202);
  expect((await escrever(api, 'POST', `/api/resolucoes/${pendente}/resolver`)).status).toBe(409);
  await rodar();
  const pronta = depois.exercicios[0]!.resolucao.id;
  const refazer = await escrever(api, 'POST', `/api/resolucoes/${pronta}/resolver`);
  expect(refazer.status).toBe(202);
  const refeita = (await refazer.json() as { resolucao: ResolucaoV2 }).resolucao;
  expect(refeita.id).not.toBe(pronta);
  expect(refeita.exercicio).toEqual({ capitulo: 'Conjuntos finitos', secao: 'Seção 1: Números naturais', numero: '1', ordem: 0 });
  expect((await api.request(`/api/resolucoes/${pronta}`)).status).toBe(404);
  await rodar();
  expect((await ler<Lista>(api, base)).exercicios.map((ex) => [ex.numero, ex.estado])).toEqual([['1', 'pronta'], ['2', 'pronta']]);

  // O .tex: capítulo, seção, enunciado e solução; prosa escapada, fórmulas como LaTeX.
  const tex = await api.request(`${base}.tex`);
  expect(tex.status).toBe(200);
  expect(tex.headers.get('content-disposition')).toContain('exercicios.tex');
  const fonte = await tex.text();
  expect(fonte).toContain('\\documentclass[11pt,a4paper,oneside]{book}');
  expect(fonte).toContain('\\usepackage{amsmath,amssymb,amsthm}');
  expect(fonte).toContain('\\tableofcontents');
  expect(fonte).toContain('\\chapter*{Conjuntos finitos}');
  expect(fonte).toContain('\\section*{Seção 1: Números naturais}');
  expect(fonte).toContain('\\begin{exercicio}{2}');
  expect(fonte).toContain('= \\frac{n(n+1)}{2}$');
  expect(fonte).toContain('50\\% do trabalho é a base \\& o resto');
  expect(fonte).toContain('\\[ \\sum_{i=1}^{k+1} i');
  expect(fonte.match(/\\begin\{proof\}\[Solução\]/g)).toHaveLength(2);

  if (process.env.MARGEM_TESTE_LATEX === '1' && binarioDoTectonic()) {
    const pdf = await api.request(`${base}.pdf`);
    expect(pdf.status).toBe(200);
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.headers.get('x-margem-modo-seguro')).toBe('0');
  }
}), 120_000);

test('livro em PDF: recortes do script, o recorte feito à mão é reconhecido e não duplica', async () => comBanco('exercicios_pdf', async (banco) => {
  const doTeste = canonicoDeTeste({ titulo: 'Análise escaneada', blocos: [{ tipo: 'capitulo', texto: 'Análise escaneada' }, { tipo: 'paragrafo', texto: 'Página sem texto.' }], secoes: [{ nivel: 1, inicio: 0, fim: 1 }] });
  const canonico = { ...doTeste, documento: { ...doTeste.documento, formato: 'pdf' as const } };
  await mkdir(join(dados, 'livro'), { recursive: true });
  await writeFile(join(dados, 'livro', 'original.pdf'), '%PDF-1.4 falso');
  const documento = await comTransacao(banco, async (cliente) => {
    const criado = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: join(dados, 'livro', 'original.pdf') });
    await documentos.criarVersao(cliente, criado.id, canonico);
    return criado;
  });
  const descobertos: ExercicioDescoberto[] = [
    { capitulo: 'Capítulo 1 · Conjuntos', secao: 'Seção 1: Naturais', numero: '1', ordem: 0, texto: '1. Usando indução, prove…',
      origem: { tipo: 'recorte', partes: [{ pagina: 17, x: 0.1, y: 0.10, largura: 0.8, altura: 0.08 }] } },
    { capitulo: 'Capítulo 1 · Conjuntos', secao: 'Seção 1: Naturais', numero: '2', ordem: 1, texto: '2. Dados m, n…',
      origem: { tipo: 'recorte', partes: [{ pagina: 17, x: 0.1, y: 0.90, largura: 0.8, altura: 0.06 }, { pagina: 18, x: 0.1, y: 0.05, largura: 0.8, altura: 0.04 }] } },
  ];
  const chamadas: string[] = [];
  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); }, intervaloEventosMs: 20, exercicios: {
    descobrirPdf: (id, original) => { chamadas.push(`descobrir ${id} ${original.endsWith('original.pdf') ? 'original.pdf' : original}`); return Promise.resolve({ fonte: 'ocr', exercicios: descobertos }); },
    recortarPdf: (_original, exercicios) => { chamadas.push(`recortar ${String(exercicios.length)}`); return Promise.resolve(new Map(exercicios.map((ex) => [ex.ordem, PNG]))); },
  } });
  // O leitor já tinha recortado o exercício 1 à mão (retângulo quase igual).
  const manual = await escrever(api, 'POST', `/api/documentos/${documento.id}/resolucoes`, {
    origem: { tipo: 'recorte', pagina: 17, retangulo: { x: 0.09, y: 0.105, largura: 0.82, altura: 0.07 }, imagem_png: PNG.toString('base64') } });
  expect(manual.status).toBe(201);
  const base = `/api/documentos/${documento.id}/exercicios`;
  const criar = await escrever(api, 'POST', `${base}/descobrir`, { criar: true });
  expect(criar.status).toBe(201);
  expect(await criar.json()).toMatchObject({ fonte: 'ocr', total: 2, lote: { criados: 1, reconhecidos: 1, ja_existiam: 0 } });
  expect(chamadas).toEqual([`descobrir ${documento.id} original.pdf`, 'recortar 2']);
  const lista = await ler<Lista>(api, base);
  expect(lista.exercicios.map((ex) => [ex.numero, ex.estado, ex.resolucao.origem.tipo === 'recorte' ? ex.resolucao.origem.pagina : null])).toEqual([
    ['1', 'resolvendo', 17], ['2', 'pendente', 17]]);
  const segundo = lista.exercicios[1]!.resolucao;
  expect(segundo.origem).toMatchObject({ retangulo: { x: 0.1, y: 0.9, largura: 0.8, altura: 0.06 } });
  expect((await api.request(`/api/resolucoes/${segundo.id}/imagem`)).headers.get('content-type')).toBe('image/png');
  expect(lista.exercicios[1]?.secao_id).toBe(canonico.secoes[0]?.id);
}), 60_000);
