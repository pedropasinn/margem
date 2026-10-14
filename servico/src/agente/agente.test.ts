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
import { manipuladoresDoAgente } from './manipulador.js';
import { historicoEmTexto } from './prompt.js';

const temporarios: string[] = [];
let dados = '';
beforeEach(async () => { dados = await mkdtemp(join(tmpdir(), 'margem-agente-dados-')); temporarios.push(dados); process.env.MARGEM_DADOS = dados; });
afterEach(async () => { delete process.env.MARGEM_DADOS; for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true }); });

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

function montar(banco: pg.Pool, passos: PassoRoteiro[]) {
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
    await new Worker({ fila: new FilaPostgres(banco), manipuladores: manipuladoresDoAgente({ banco, executor, modelo: 'modelo-de-teste', esforco: 'medium', prazoMs: 10_000, diretorioArtefatos: artefatos, diretorioBiblioteca: biblioteca }),
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
  await banco.query("UPDATE job SET not_before = now() + interval '1 day' WHERE tipo = 'responder_agente' AND estado = 'adiado'");
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
