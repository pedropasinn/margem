/**
 * Página "Perguntar" na API e no worker: Postgres de teste, worker de verdade e executor falso
 * determinístico; nenhuma chamada ao Codex.
 */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import type pg from 'pg';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { validarVisual, type CanonicoV1, type ConversaDoAgenteV1, type MensagemDoAgenteV1, type VisualV1 } from '@margem/contratos';
import { canonicoDeTeste, comBanco } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import { criarExecutorFalso, type PassoRoteiro } from '../executor/fake.js';
import type { PedidoExecucao } from '../executor/tipos.js';
import { criarApi } from '../http/app.js';
import { tituloDaPergunta } from '../http/rotas-agente.js';
import * as documentos from '../repos/documentos.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { Worker } from '../worker/worker.js';
import { capituloEmMarkdown } from './biblioteca.js';
import { contextoDaPergunta, numeroNoTitulo, termosDaPergunta } from './contexto.js';
import { manipuladoresDoAgente } from './manipulador.js';
import { historicoEmTexto } from './prompt.js';

const temporarios: string[] = [];
let dados = '';
beforeEach(async () => { dados = await mkdtemp(join(tmpdir(), 'margem-agente-dados-')); temporarios.push(dados); process.env.MARGEM_DADOS = dados; });
afterEach(async () => { delete process.env.MARGEM_DADOS; for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true }); });

test('R3-7: "capítulo N" é o número dos títulos (com o sumário sugerido em uso), não a posição; ambíguo, nenhum', async () => comBanco('agente_ctx_numero', async (banco) => {
  expect([numeroNoTitulo('1. The Challenge'), numeroNoTitulo('Capítulo 3 — A tese'), numeroNoTitulo('Chapter IV'), numeroNoTitulo('II. Partes'),
    numeroNoTitulo('Prefácio'), numeroNoTitulo('1999: o ano'), numeroNoTitulo('1.5 milhão'), numeroNoTitulo('Capital')]).toEqual([1, 3, 4, 2, null, null, null, null]);
  const prefacio = 'Prefácio longo que não é o capítulo pedido. '.repeat(60);
  const canonico = canonicoDeTeste({ titulo: 'Zero a um', blocos: [
    { tipo: 'capitulo' as const, texto: 'Prefácio' }, { tipo: 'paragrafo' as const, texto: prefacio },
    { tipo: 'capitulo' as const, texto: '1' },
    { tipo: 'capitulo' as const, texto: 'O DESAFIO DO FUTURO' }, { tipo: 'paragrafo' as const, texto: 'O desafio é criar o novo.' },
    { tipo: 'capitulo' as const, texto: '2' },
    { tipo: 'capitulo' as const, texto: 'FESTA COMO EM 1999' }, { tipo: 'paragrafo' as const, texto: 'A bolha das empresas de internet.' },
  ], secoes: [{ nivel: 1, inicio: 0, fim: 1 }, { nivel: 1, inicio: 2, fim: 2 }, { nivel: 1, inicio: 3, fim: 4 }, { nivel: 1, inicio: 5, fim: 5 }, { nivel: 1, inicio: 6, fim: 7 }] });
  const { documentoId, versaoId } = await comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'zero.epub' });
    return { documentoId: documento.id, versaoId: (await documentos.criarVersao(cliente, documento.id, canonico)).id };
  });
  const secao = (n: number) => canonico.secoes[n]!;
  const proposta = [
    { bloco_inicio: secao(0).bloco_inicio, titulo: 'Prefácio', nivel: 1 },
    { bloco_inicio: secao(2).bloco_inicio, titulo: '1. O desafio do futuro', nivel: 1 },
    { bloco_inicio: secao(4).bloco_inicio, titulo: '2. Festa como em 1999', nivel: 1 },
  ];
  await banco.query(`INSERT INTO conferencia_sumario (versao_id, documento_id, estado, resposta) VALUES ($1, $2, 'aplicada', $3)`,
    [versaoId, documentoId, JSON.stringify({ ok: false, problemas: ['números soltos'], proposta })]);
  await comTransacao(banco, async (cliente) => {
    const vazio = await contextoDaPergunta(cliente, 'Resuma', [], 0);
    const limite = vazio.texto.length + 400;
    const pedido = await contextoDaPergunta(cliente, 'Resuma o capítulo 1 de Zero a um', [], limite);
    expect(pedido.texto).toContain(`  - 1. O desafio do futuro · secao_id ${secao(2).id}`);
    expect(pedido.texto).not.toContain('- 2. 1. O desafio');
    expect(pedido.texto).toContain('### Zero a um · 1. O desafio do futuro');
    expect(pedido.texto).toContain('O desafio é criar o novo.');
    expect(pedido.texto).not.toContain('Prefácio longo');
  });
  // Duas partes que recomeçam a contagem: "capítulo 1" é ambíguo e nenhum entra pelo número.
  await banco.query(`UPDATE conferencia_sumario SET resposta = jsonb_set(resposta, '{proposta,2,titulo}', '"1. Festa como em 1999"')`);
  await comTransacao(banco, async (cliente) => {
    const ambiguo = await contextoDaPergunta(cliente, 'Resuma o capítulo 1 de Zero a um', [], (await contextoDaPergunta(cliente, 'Resuma', [], 0)).texto.length + 400);
    expect(ambiguo.texto).not.toContain('O desafio é criar o novo.');
    expect(ambiguo.texto).not.toContain('A bolha das empresas');
  });
}));

const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };
function escrever(api: Hono, metodo: string, caminho: string, dado?: unknown): Promise<Response> {
  return Promise.resolve(api.request(caminho, { method: metodo, headers: ESCRITA, ...(dado === undefined ? {} : { body: JSON.stringify(dado) }) }));
}

const LIVRO = [
  { tipo: 'capitulo' as const, texto: 'Introdução' },
  { tipo: 'paragrafo' as const, texto: 'A inferência causal pergunta o que teria acontecido sem o tratamento.' },
  { tipo: 'paragrafo' as const, texto: 'Correlação não é causalidade, e a seleção enviesa a comparação ingênua.' },
  { tipo: 'capitulo' as const, texto: 'Grafos acíclicos dirigidos' },
  { tipo: 'paragrafo' as const, texto: 'Um DAG mostra os caminhos pelos quais uma variável afeta outra.' },
  { tipo: 'paragrafo' as const, texto: 'Fechar os caminhos pela porta dos fundos identifica o efeito causal.' },
];

async function preparar(banco: pg.Pool): Promise<{ canonico: CanonicoV1; versaoId: string; documentoId: string }> {
  const canonico = canonicoDeTeste({ titulo: 'Mixtape de teste', blocos: LIVRO, secoes: [{ nivel: 1, inicio: 0, fim: 2 }, { nivel: 1, inicio: 3, fim: 5 }] });
  return comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'mixtape.md' });
    return { canonico, versaoId: (await documentos.criarVersao(cliente, documento.id, canonico)).id, documentoId: documento.id };
  });
}

function montar(banco: pg.Pool, passos: PassoRoteiro[], opcoes: { semFerramentas?: boolean } = {}) {
  const pedidos: PedidoExecucao[] = [];
  const biblioteca = join(dados, 'biblioteca');
  const vistos: string[][] = [];
  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); }, intervaloEventosMs: 20 });
  const falso = criarExecutorFalso({ versao: 1, passos });
  const artefatos = join(dados, 'artefatos');
  const executor = async (pedido: PedidoExecucao) => {
    pedidos.push(pedido);
    // O que o Codex enxergaria na pasta montada, no momento da chamada.
    const anexo = pedido.anexos?.[0];
    vistos.push(anexo ? await readdir(anexo.origem) : []);
    return falso({ ...pedido, diretorioArtefatos: artefatos });
  };
  const rodar = async (ciclos = 1) => {
    const slots = await mkdtemp(join(tmpdir(), 'margem-agente-slots-'));
    temporarios.push(slots);
    await new Worker({ fila: new FilaPostgres(banco), manipuladores: manipuladoresDoAgente({ banco, executor, modelo: 'modelo-de-teste', esforco: 'medium', prazoMs: 10_000, diretorioArtefatos: artefatos, diretorioBiblioteca: biblioteca, semFerramentas: opcoes.semFerramentas ?? false }),
      slots: 1, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: ciclos, heartbeatMs: 60_000 }).rodar();
  };
  return { api, pedidos, rodar, biblioteca, vistos };
}

type Fio = { conversa: ConversaDoAgenteV1; mensagens: MensagemDoAgenteV1[] };
async function lerFio(api: Hono, id: string): Promise<Fio> {
  const resposta = await api.request(`/api/agente/conversas/${id}`);
  expect(resposta.status).toBe(200);
  return resposta.json() as Promise<Fio>;
}

const MAPA = ['flowchart TD', '  A["Pergunta causal"] --> B["Correlação não basta"]', '  B --> C["Seleção enviesa"]'].join('\n');

test('pergunta → export da biblioteca → Codex (falso) → resposta com citação conferida, mapa salvo no capítulo', async () => comBanco('agente_fluxo', async (banco) => {
  const { canonico, versaoId, documentoId } = await preparar(banco);
  const [b1, b2] = [canonico.blocos[1]!, canonico.blocos[2]!];
  const secao = canonico.secoes[0]!;
  const { api, pedidos, rodar, biblioteca, vistos } = montar(banco, [{ quando: { ordem: 1 }, tipo: 'ok', conteudo: {
    resposta: 'O capítulo abre com a pergunta contrafactual [c1]; a comparação ingênua falha [c2] [c3].',
    citacoes: [
      { ref: 'c1', versao_id: versaoId, bloco_id: b1.id, texto: 'o que teria acontecido sem o tratamento' },
      { ref: 'c2', versao_id: versaoId, bloco_id: b2.id, texto: 'a seleção enviesa a comparação ingênua' },
      { ref: 'c3', versao_id: versaoId, bloco_id: b2.id, texto: 'uma frase que não está no livro' },
    ],
    artefatos: [
      { tipo: 'mapa', titulo: 'Mapa da introdução', versao_id: versaoId, secao_id: secao.id, markdown: '', mermaid: MAPA,
        nos: [{ id: 'A', rotulo: 'Pergunta causal', ref: 'c1' }, { id: 'B', rotulo: 'Correlação não basta', ref: null }, { id: 'C', rotulo: 'Seleção enviesa', ref: 'c2' }] },
      { tipo: 'conceitos', titulo: 'Conceitos', versao_id: null, secao_id: null, markdown: '- **Contrafactual**: o que teria acontecido [c1]', mermaid: '', nos: [] },
    ],
  } }]);

  const criada = await escrever(api, 'POST', '/api/agente/conversas', { pergunta: '  Faça um mapa da introdução do Mixtape  ' });
  expect(criada.status).toBe(201);
  const { conversa, mensagens } = await criada.json() as Fio;
  expect(conversa.titulo).toBe('Faça um mapa da introdução do Mixtape');
  expect(mensagens).toMatchObject([{ autor: 'leitor', texto: 'Faça um mapa da introdução do Mixtape', estado: 'na_fila' }]);
  expect((await (await api.request('/api/agente/conversas')).json() as { conversas: ConversaDoAgenteV1[] }).conversas.map((c) => c.id)).toEqual([conversa.id]);

  await rodar();
  expect(pedidos).toHaveLength(1);
  expect(pedidos[0]).toMatchObject({ esforco: 'medium', modelo: 'modelo-de-teste', anexos: [{ nome: 'biblioteca', origem: biblioteca }] });
  expect(pedidos[0]!.prompt).toContain('Faça um mapa da introdução do Mixtape');
  expect(pedidos[0]!.prompt).toContain('é a primeira pergunta da conversa');
  expect(vistos[0]).toEqual(expect.arrayContaining(['INDICE.md', 'textos']));
  const indice = await readFile(join(biblioteca, 'INDICE.md'), 'utf8');
  expect(indice).toContain('## Mixtape de teste');
  expect(indice).toContain(`versao_id: ${versaoId}`);
  expect(indice).toContain(`textos/${versaoId}/02-grafos-aciclicos-dirigidos.md`);
  const capitulo = await readFile(join(biblioteca, 'textos', versaoId, '01-introducao.md'), 'utf8');
  expect(capitulo).toContain(`⟦b:${b1.id}⟧ [paragrafo] A inferência causal`);
  expect(capitulo).toContain(`secao_id: ${secao.id}`);

  const fio = await lerFio(api, conversa.id);
  expect(fio.mensagens.map((m) => [m.autor, m.estado])).toEqual([['leitor', 'respondida'], ['agente', undefined]]);
  const resposta = fio.mensagens[1]!;
  expect(resposta.texto).toContain('[c1]');
  expect(resposta.citacoes.map((c) => c.ref)).toEqual(['c1', 'c2']);
  expect(resposta.citacoes[0]).toMatchObject({ documento_id: documentoId, documento: 'Mixtape de teste', capitulo: 'Introdução', secao_id: secao.id,
    ancora: { versao_id: versaoId, bloco_id: b1.id, citacao: 'o que teria acontecido sem o tratamento' } });
  expect(resposta.diagnosticos.map((d) => d.codigo)).toEqual(['citacao_ausente']);
  expect(resposta.execucao).toMatchObject({ modelo: 'modelo-de-teste', esforco: 'medium' });
  expect(resposta.artefatos).toHaveLength(2);
  const mapa = resposta.artefatos[0]!;
  if (mapa.tipo !== 'mapa') throw new Error('esperava mapa');
  expect(mapa.capitulo).toMatchObject({ documento_id: documentoId, versao_id: versaoId, secao_id: secao.id, titulo: 'Introdução' });
  expect(mapa.nos.map((no) => no.ancora?.bloco_id ?? null)).toEqual([b1.id, null, b2.id]);

  // Salvar: o mapa vira um visual pronto do capítulo; salvar de novo é recusado; os conceitos não têm onde.
  const salvo = await escrever(api, 'POST', `/api/agente/mensagens/${resposta.id}/artefatos/0/salvar`);
  expect(salvo.status).toBe(201);
  const { visual_id, caminho } = await salvo.json() as { visual_id: string; caminho: string };
  expect(caminho).toBe(`/ler/${documentoId}/${secao.id}`);
  const visuais = (await (await api.request(`/api/versoes/${versaoId}/capitulos/${secao.id}/visuais`)).json() as { visuais: VisualV1[] }).visuais;
  expect(visuais).toHaveLength(1);
  expect(validarVisual(visuais[0])).toBe(true);
  expect(visuais[0]).toMatchObject({ id: visual_id, estado: 'pronto', tipo: 'diagrama', alvo: { tipo: 'capitulo' }, artefato: { tipo: 'mermaid', titulo: 'Mapa da introdução', codigo: MAPA } });
  expect((await escrever(api, 'POST', `/api/agente/mensagens/${resposta.id}/artefatos/0/salvar`)).status).toBe(409);
  expect((await escrever(api, 'POST', `/api/agente/mensagens/${resposta.id}/artefatos/1/salvar`)).status).toBe(422);
  expect((await lerFio(api, conversa.id)).mensagens[1]!.artefatos[0]).toMatchObject({ visual_id });
}));

test('fio: a segunda pergunta leva o histórico; 409 com pergunta em curso; mapa fora da régua ganha uma correção', async () => comBanco('agente_fio', async (banco) => {
  const { canonico, versaoId } = await preparar(banco);
  const bloco = canonico.blocos[4]!;
  const citacao = { ref: 'c1', versao_id: versaoId, bloco_id: bloco.id, texto: 'os caminhos pelos quais uma variável afeta outra' };
  const { api, pedidos, rodar, vistos } = montar(banco, [
    { quando: { ordem: 1 }, tipo: 'ok', conteudo: { resposta: 'Um DAG desenha caminhos causais [c1].', citacoes: [citacao], artefatos: [] } },
    { quando: { ordem: 2 }, tipo: 'ok', conteudo: { resposta: 'Segue o mapa [c1].', citacoes: [citacao], artefatos: [
      { tipo: 'mapa', titulo: 'DAGs', versao_id: versaoId, secao_id: canonico.secoes[1]!.id, markdown: '', mermaid: 'flowchart LR\n  A["DAG"] --> B["Porta dos fundos"]',
        nos: [{ id: 'A', rotulo: 'DAG', ref: 'c1' }, { id: 'B', rotulo: 'Porta dos fundos', ref: null }] },
    ] } },
    { quando: { ordem: 3 }, tipo: 'ok', conteudo: { mermaid: 'flowchart TD\n  A["DAG"] --> B["Porta dos fundos"]', nos: [{ id: 'A', rotulo: 'DAG', ref: 'c1' }, { id: 'B', rotulo: 'Porta dos fundos', ref: null }] } },
  ]);
  const { conversa } = await (await escrever(api, 'POST', '/api/agente/conversas', { pergunta: 'O que é um DAG?' })).json() as Fio;
  expect((await escrever(api, 'POST', `/api/agente/conversas/${conversa.id}/mensagens`, { pergunta: 'Outra' })).status).toBe(409);
  expect((await escrever(api, 'POST', '/api/agente/conversas', { pergunta: '   ' })).status).toBe(400);
  expect((await escrever(api, 'POST', '/api/agente/conversas', { pergunta: 'x', extra: 1 })).status).toBe(400);
  await rodar();
  expect((await escrever(api, 'POST', `/api/agente/conversas/${conversa.id}/mensagens`, { pergunta: 'Agora faça o mapa do capítulo de DAGs' })).status).toBe(201);
  await rodar();
  expect(pedidos).toHaveLength(3);
  expect(pedidos[1]!.prompt).toContain('O que é um DAG?');
  expect(pedidos[1]!.prompt).toContain('Um DAG desenha caminhos causais [c1].');
  expect(pedidos[1]!.prompt).toContain('Agora faça o mapa do capítulo de DAGs');
  // A correção do mapa é curta: sem a biblioteca, com o erro e o código recusado.
  expect(pedidos[2]!.anexos).toBeUndefined();
  expect(pedidos[2]!.prompt).toContain('flowchart LR');
  expect(vistos[2]).toEqual([]);
  const fio = await lerFio(api, conversa.id);
  expect(fio.mensagens.map((m) => m.autor)).toEqual(['leitor', 'agente', 'leitor', 'agente']);
  const ultima = fio.mensagens[3]!;
  expect(ultima.diagnosticos.map((d) => d.codigo)).toEqual(['mermaid_corrigido']);
  expect(ultima.artefatos[0]).toMatchObject({ tipo: 'mapa', codigo: 'flowchart TD\n  A["DAG"] --> B["Porta dos fundos"]', capitulo: { titulo: 'Grafos acíclicos dirigidos' } });
}));

test('sem citação válida vira aviso; cota deixa na fila com aviso; falha se repete com um job novo', async () => comBanco('agente_falhas', async (banco) => {
  const { versaoId } = await preparar(banco);
  const { api, rodar } = montar(banco, [
    { quando: { ordem: 1 }, tipo: 'cota', not_before: '2099-01-01T00:00:00.000Z' },
  ]);
  const { conversa } = await (await escrever(api, 'POST', '/api/agente/conversas', { pergunta: 'Qual a tese?' })).json() as Fio;
  await rodar();
  const adiada = (await lerFio(api, conversa.id)).mensagens[0]!;
  expect(adiada).toMatchObject({ estado: 'na_fila' });
  expect(adiada.aviso).toContain('Cota do Codex esgotada');

  // Outra conversa: o processo falha, a pergunta mostra o motivo, "tentar de novo" põe um job novo.
  const segundo = montar(banco, [
    { quando: { ordem: 1 }, tipo: 'processo' },
    { quando: { ordem: 2 }, tipo: 'ok', conteudo: { resposta: 'Não achei nada sobre isso na biblioteca.', citacoes: [
      { ref: 'c1', versao_id: versaoId, bloco_id: '0ZZZZZZZZZZZZZZZZZZZZZZZZZ', texto: 'nada' },
    ], artefatos: [] } },
  ]);
  const outra = (await (await escrever(segundo.api, 'POST', '/api/agente/conversas', { pergunta: 'E sobre Kant?' })).json() as Fio).conversa;
  // A primeira fica parada sem segurar a fila: em pausa e com a cota já de volta (a cota esgotada seguraria
  // todos os trabalhos do Codex, D-09).
  await banco.query("UPDATE job SET retido_em = now(), not_before = now() - interval '1 second' WHERE tipo = 'responder_agente' AND estado = 'adiado'");
  await segundo.rodar();
  const falhou = (await lerFio(segundo.api, outra.id)).mensagens[0]!;
  expect(falhou.estado).toBe('falhou');
  expect(falhou.motivo).toBeTruthy();
  expect((await escrever(segundo.api, 'POST', `/api/agente/mensagens/${adiada.id}/repetir`)).status).toBe(409);
  expect((await escrever(segundo.api, 'POST', `/api/agente/mensagens/${falhou.id}/repetir`)).status).toBe(200);
  await segundo.rodar();
  const fio = await lerFio(segundo.api, outra.id);
  expect(fio.mensagens.map((m) => m.estado ?? m.autor)).toEqual(['respondida', 'agente']);
  expect(fio.mensagens[1]!.citacoes).toEqual([]);
  expect(fio.mensagens[1]!.diagnosticos.map((d) => d.codigo)).toEqual(['citacao_fora_do_texto', 'sem_citacao']);
  // Renomear: só o título muda, numa linha; vazio, longo ou com outro campo é recusado.
  const renomeada = await escrever(segundo.api, 'PATCH', `/api/agente/conversas/${outra.id}`, { titulo: '  Kant e a\n biblioteca ' });
  expect(renomeada.status).toBe(200);
  expect((await renomeada.json() as { conversa: ConversaDoAgenteV1 }).conversa.titulo).toBe('Kant e a biblioteca');
  expect((await lerFio(segundo.api, outra.id)).conversa.titulo).toBe('Kant e a biblioteca');
  expect((await escrever(segundo.api, 'PATCH', `/api/agente/conversas/${outra.id}`, { titulo: '  ' })).status).toBe(400);
  expect((await escrever(segundo.api, 'PATCH', `/api/agente/conversas/${outra.id}`, { titulo: 'x'.repeat(201) })).status).toBe(400);
  expect((await escrever(segundo.api, 'PATCH', `/api/agente/conversas/${outra.id}`, { titulo: 'x', fixada: true })).status).toBe(400);
  expect((await escrever(segundo.api, 'DELETE', `/api/agente/conversas/${outra.id}`)).status).toBe(200);
  expect((await escrever(segundo.api, 'PATCH', `/api/agente/conversas/${outra.id}`, { titulo: 'x' })).status).toBe(404);
  expect((await segundo.api.request(`/api/agente/conversas/${outra.id}`)).status).toBe(404);
}));

test('título da conversa, histórico recortado e capítulo em Markdown com subtítulos', () => {
  expect(tituloDaPergunta('a\n b')).toBe('a b');
  expect(tituloDaPergunta(`${'palavra '.repeat(20)}fim`).length).toBeLessThanOrEqual(81);
  const historico = historicoEmTexto(Array.from({ length: 20 }, (_, i) => ({ autor: i % 2 === 0 ? 'leitor' as const : 'agente' as const, texto: `m${String(i)}`, artefatos: [] })));
  expect(historico).toContain('4 mensagens mais antigas omitidas');
  expect(historico).not.toContain('m3\n');
  expect(historico).toContain('m19');
  const canonico = canonicoDeTeste({ titulo: 'Livro', blocos: [{ tipo: 'capitulo', texto: 'Cap' }, { tipo: 'secao', texto: 'Seção 1.1' }, { tipo: 'paragrafo', texto: 'Texto.' }],
    secoes: [{ nivel: 1, inicio: 0, fim: 2 }, { nivel: 2, inicio: 1, fim: 2 }] });
  const md = capituloEmMarkdown(canonico, { documento_id: 'D', versao_id: 'V' }, { secao: canonico.secoes[0]!, titulo: 'Cap', blocos: canonico.blocos }, 1);
  expect(md).toContain('### Seção 1.1');
  expect(md).toContain(`⟦b:${canonico.blocos[2]!.id}⟧ [paragrafo] Texto.`);
});

async function outroLivro(banco: pg.Pool): Promise<{ versaoId: string; canonico: CanonicoV1 }> {
  const canonico = canonicoDeTeste({ titulo: 'Crítica da razão pura', blocos: [
    { tipo: 'capitulo' as const, texto: 'Estética transcendental' },
    { tipo: 'paragrafo' as const, texto: 'Espaço e tempo são formas puras da intuição sensível.' },
  ], secoes: [{ nivel: 1, inicio: 0, fim: 1 }] });
  return comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, autor: 'Kant', origem_caminho: 'kant.md' });
    return { canonico, versaoId: (await documentos.criarVersao(cliente, documento.id, canonico)).id };
  });
}

test('R2-4: sem ferramentas, os trechos relevantes vão no prompt (sem anexo nem export) e a citação confere', async () => comBanco('agente_sem_ferr', async (banco) => {
  const { canonico, versaoId } = await preparar(banco);
  const kant = await outroLivro(banco);
  const bloco = canonico.blocos[5]!;
  const { api, pedidos, rodar, biblioteca } = montar(banco, [
    { quando: { ordem: 1 }, tipo: 'ok', conteudo: { resposta: 'Fechar a porta dos fundos identifica o efeito [c1].', citacoes: [
      { ref: 'c1', versao_id: versaoId, bloco_id: bloco.id, texto: 'identifica o efeito causal' },
    ], artefatos: [] } },
    { quando: { ordem: 2 }, tipo: 'ok', conteudo: { resposta: 'Resumo.', citacoes: [], artefatos: [] } },
  ], { semFerramentas: true });
  const { conversa } = await (await escrever(api, 'POST', '/api/agente/conversas', { pergunta: 'O que é a porta dos fundos?' })).json() as Fio;
  await rodar();
  expect(pedidos).toHaveLength(1);
  const prompt = pedidos[0]!.prompt;
  // O executor recebe o texto: nada de pasta anexada nem instrução de abrir arquivos.
  expect(pedidos[0]!.anexos).toBeUndefined();
  await expect(readdir(biblioteca)).rejects.toThrow();
  expect(prompt).not.toMatch(/grep|sed -n|biblioteca\/INDICE/u);
  expect(prompt).toContain('não tem terminal nem ferramentas');
  expect(prompt).toContain('O que é a porta dos fundos?');
  // Índice com os dois livros; trecho achado pela busca, com o vizinho e a citação possível.
  expect(prompt).toContain(`Mixtape de teste · documento_id`);
  expect(prompt).toContain(`Crítica da razão pura — Kant · documento_id`);
  expect(prompt).toContain(`2. Grafos acíclicos dirigidos · secao_id ${canonico.secoes[1]!.id}`);
  expect(prompt).toContain(`### Mixtape de teste · capítulo 2: Grafos acíclicos dirigidos\nversao_id: ${versaoId} · secao_id: ${canonico.secoes[1]!.id}`);
  expect(prompt).toContain(`⟦b:${bloco.id}⟧ [paragrafo] Fechar os caminhos pela porta dos fundos identifica o efeito causal.`);
  expect(prompt).toContain(`⟦b:${canonico.blocos[4]!.id}⟧ [paragrafo] Um DAG`);
  // O que não casou fica de fora: o outro livro e o capítulo 1.
  expect(prompt).not.toContain('Espaço e tempo');
  expect(prompt).not.toContain('Correlação não é causalidade');
  const fio = await lerFio(api, conversa.id);
  expect(fio.mensagens[1]!.citacoes).toMatchObject([{ ref: 'c1', capitulo: 'Grafos acíclicos dirigidos' }]);

  // Pedir um capítulo pelo número de um livro citado traz o capítulo inteiro (aqui, pelo título "Kant").
  expect((await escrever(api, 'POST', `/api/agente/conversas/${conversa.id}/mensagens`, { pergunta: 'Resuma o capítulo 1 da Crítica da razão pura' })).status).toBe(201);
  await rodar();
  const segundo = pedidos[1]!.prompt;
  expect(segundo).toContain(`### Crítica da razão pura — Kant · capítulo 1: Estética transcendental\nversao_id: ${kant.versaoId}`);
  expect(segundo).toContain('Espaço e tempo são formas puras da intuição sensível.');
}));

test('R2-4: contexto com limite claro e termos da pergunta', async () => comBanco('agente_ctx_limite', async (banco) => {
  await preparar(banco);
  expect(termosDaPergunta('O que é um DAG? DAG, causalidade e or')).toEqual(['que', 'dag', 'causalidade']);
  await comTransacao(banco, async (cliente) => {
    const inteiro = await contextoDaPergunta(cliente, 'Resuma o livro', []);
    // Biblioteca de um livro só: o começo dele entra mesmo sem palavra que case.
    expect(inteiro.cortado).toBe(false);
    expect(inteiro.blocos).toBe(6);
    const curto = await contextoDaPergunta(cliente, 'Resuma o livro', [], 700);
    expect(curto.cortado).toBe(true);
    expect(curto.blocos).toBeLessThan(6);
    expect(curto.texto.length).toBeLessThan(1_000);
    expect(curto.texto).toContain('Há mais texto relevante do que coube aqui');
  });
}));
