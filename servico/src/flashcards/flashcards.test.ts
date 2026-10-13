/**
 * Flashcards na API e no worker: Postgres de teste, o job `gerar_flashcards` com o executor falso
 * (nenhum Codex), cartões manuais, a fila do dia com o SM-2 e a exportação para o Anki.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { ancoraDeSelecao } from '@margem/core';
import { comBanco } from '../../testes/apoio.js';
import { livro } from '../../testes/compreensao.js';
import { comTransacao } from '../db/transacao.js';
import { criarExecutorFalso, type PassoRoteiro } from '../executor/fake.js';
import type { PedidoExecucao } from '../executor/tipos.js';
import { criarApi } from '../http/app.js';
import * as documentos from '../repos/documentos.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { Worker } from '../worker/worker.js';
import { agendar, ESTADO_INICIAL, inicioDoDia } from './agenda.js';
import { manipuladoresDosFlashcards, type SaidaDosFlashcards } from './manipuladores.js';
import { faixaDeCartoes } from './prompts.js';
import { cartoesEmCsv, type Flashcard } from './repo.js';

const temporarios: string[] = [];
let dados = '';
beforeEach(async () => { dados = await mkdtemp(join(tmpdir(), 'margem-flashcards-dados-')); temporarios.push(dados); process.env.MARGEM_DADOS = dados; });
afterEach(async () => { delete process.env.MARGEM_DADOS; for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true }); });

/** A âncora de um trecho literal do bloco. */
function trecho(bloco: Parameters<typeof ancoraDeSelecao>[0], citacao: string) {
  const inicio = bloco.texto.indexOf(citacao);
  return ancoraDeSelecao(bloco, inicio, inicio + citacao.length);
}

const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };
interface Lista { cartoes: Flashcard[]; em_curso: string[] }

async function preparar(banco: pg.Pool) {
  const canonico = livro();
  const versao = await comTransacao(banco, async (c) => {
    const documento = await documentos.criar(c, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
    return documentos.criarVersao(c, documento.id, canonico);
  });
  const blocos = canonico.blocos.map((bloco) => ({ ...bloco, versao_id: versao.id }));
  return { canonico, versao, blocos, capitulo: canonico.secoes[0]!, segundo: canonico.secoes[2]! };
}

function montar(banco: pg.Pool, passos: PassoRoteiro[]) {
  const pedidos: PedidoExecucao[] = [];
  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); }, intervaloEventosMs: 20 });
  const falso = criarExecutorFalso({ versao: 1, passos });
  const artefatos = join(dados, 'artefatos');
  const executor = (pedido: PedidoExecucao) => { pedidos.push(pedido); return falso({ ...pedido, diretorioArtefatos: artefatos }); };
  const rodar = async () => {
    const slots = await mkdtemp(join(tmpdir(), 'margem-flashcards-slots-'));
    temporarios.push(slots);
    await new Worker({ fila: new FilaPostgres(banco), manipuladores: manipuladoresDosFlashcards({ banco, executor, modelo: 'modelo-de-teste', esforco: 'low', prazoMs: 10_000, diretorioArtefatos: artefatos }),
      slots: 1, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: 1, heartbeatMs: 60_000 }).rodar();
  };
  return { api, pedidos, rodar };
}

/** B1 = "Capítulo um", B2…B5 = os blocos seguintes do capítulo um. */
const SAIDA: SaidaDosFlashcards = { cartoes: [
  { frente: 'Que hipótese o autor admite de início?', verso: 'Que os preços são rígidos.', citacao: { bloco: 'B2', texto: 'os preços são rígidos' } },
  { frente: 'Que exemplo ilustra a rigidez?', verso: 'O cardápio impresso, que não muda todo dia.', citacao: { bloco: 'B3', texto: 'o cardápio impresso não muda todo dia' } },
  { frente: 'Pergunta sem trecho', verso: 'Resposta.', citacao: { bloco: 'B5', texto: 'frase que não está lá' } },
  { frente: 'Pergunta de bloco inventado', verso: 'Resposta.', citacao: { bloco: 'B40', texto: 'qualquer' } },
] };

test('gerar: pedido → Codex (falso) → cartões ancorados, grifos e notas no prompt; recusa em curso; de novo sem repetir', async () => comBanco('flashcards_gerar', async (banco) => {
  const { versao, blocos, capitulo } = await preparar(banco);
  const { api, pedidos, rodar } = montar(banco, [
    { quando: { ordem: 1 }, tipo: 'ok', conteudo: SAIDA },
    { quando: { ordem: 2 }, tipo: 'ok', conteudo: { cartoes: [SAIDA.cartoes[0]!, { frente: 'O que acontece com o produto?', verso: 'O choque o reduz.', citacao: { bloco: 'B5', texto: 'o choque reduz o produto' } }] } },
  ]);
  // Uma nota do leitor no capítulo entra no prompt.
  const nota = await api.request('/api/anotacoes', { method: 'POST', headers: ESCRITA, body: JSON.stringify({
    ancora: trecho(blocos[4]!, 'somente com preços rígidos'), tipo: 'duvida', texto: 'Por que só com preços rígidos?' }) });
  expect(nota.status).toBe(201);

  const caminho = `/api/versoes/${versao.id}/capitulos/${capitulo.id}/flashcards`;
  const pedido = await api.request(caminho, { method: 'POST', headers: ESCRITA });
  expect(pedido.status).toBe(202);
  expect((await api.request(caminho, { method: 'POST', headers: ESCRITA })).status).toBe(409);
  const pendente = await (await api.request(`/api/flashcards?documento=${versao.documento_id}`)).json() as Lista;
  expect(pendente).toEqual({ cartoes: [], em_curso: [capitulo.id] });

  await rodar();
  expect(pedidos).toHaveLength(1);
  expect(pedidos[0]).toMatchObject({ esforco: 'low' });
  const prompt = pedidos[0]!.prompt;
  expect(prompt).toContain('"Preços e produto"');
  expect(prompt).toContain('⟦B3⟧ Um exemplo ilustra');
  expect(prompt).toContain('nota: Por que só com preços rígidos?');
  expect(prompt).not.toContain(blocos[2]!.id);
  expect(prompt).not.toContain('Outro capítulo, lido depois.');

  const lista = await (await api.request(`/api/flashcards?documento=${versao.documento_id}`)).json() as Lista;
  expect(lista.em_curso).toEqual([]);
  expect(lista.cartoes.map((c) => c.frente)).toEqual(['Que hipótese o autor admite de início?', 'Que exemplo ilustra a rigidez?']);
  const [primeiro, segundo] = lista.cartoes;
  expect(primeiro).toMatchObject({ origem: 'ia', capitulo: { id: capitulo.id, titulo: 'Capítulo um' }, documento: { titulo: 'Preços e produto' },
    ancora: { bloco_id: blocos[1]!.id, citacao: 'os preços são rígidos' }, agenda: { proxima_revisao: null, revisoes: 0, facilidade: 2.5 },
    link: `/ler/${versao.documento_id}/${capitulo.id}?bloco=${blocos[1]!.id}` });
  expect(blocos[2]!.texto.slice(segundo!.ancora.inicio_utf16, segundo!.ancora.fim_utf16)).toBe('o cardápio impresso não muda todo dia');
  const job = (await banco.query<{ diagnosticos: { codigo: string }[] }>("SELECT diagnosticos FROM job WHERE tipo='gerar_flashcards'")).rows[0]!;
  expect(job.diagnosticos.map((d) => d.codigo).sort()).toEqual(['bloco_inexistente', 'citacao_ausente']);

  // De novo: o prompt lista as perguntas que já existem, e a repetida sai.
  expect((await api.request(caminho, { method: 'POST', headers: ESCRITA })).status).toBe(202);
  await rodar();
  expect(pedidos[1]!.prompt).toContain('- Que exemplo ilustra a rigidez?');
  const depois = await (await api.request(`/api/flashcards?documento=${versao.documento_id}`)).json() as Lista;
  expect(depois.cartoes.map((c) => c.frente)).toEqual(['Que hipótese o autor admite de início?', 'Que exemplo ilustra a rigidez?', 'O que acontece com o produto?']);
}));

test('nenhum cartão ancorado: falha legível; capítulo inexistente 404', async () => comBanco('flashcards_falha', async (banco) => {
  const { versao, capitulo, canonico } = await preparar(banco);
  const { api, rodar } = montar(banco, [{ quando: { ordem: 1 }, tipo: 'ok', conteudo: { cartoes: [SAIDA.cartoes[2]!] } }]);
  expect((await api.request(`/api/versoes/${versao.id}/capitulos/${canonico.blocos[0]!.id}/flashcards`, { method: 'POST', headers: ESCRITA })).status).toBe(404);
  await api.request(`/api/versoes/${versao.id}/capitulos/${capitulo.id}/flashcards`, { method: 'POST', headers: ESCRITA });
  await rodar();
  const job = (await banco.query<{ estado: string; diagnosticos: { mensagem: string }[] }>("SELECT estado, diagnosticos FROM job WHERE tipo='gerar_flashcards'")).rows[0]!;
  expect(job.estado).toBe('falhou');
  expect(JSON.stringify(job.diagnosticos)).toContain('Nenhum cartão ficou ancorado');
}));

test('manual, editar, apagar, estudar (fila do dia com SM-2) e exportar para o Anki', async () => comBanco('flashcards_estudo', async (banco) => {
  const { versao, blocos, capitulo } = await preparar(banco);
  const { api } = montar(banco, []);
  const criar = (ancora: unknown, frente: string, verso: string) => api.request('/api/flashcards', { method: 'POST', headers: ESCRITA, body: JSON.stringify({ ancora, frente, verso }) });
  // O bloco 4 está dentro da seção de nível 2: o cartão fica no capítulo (nível 1).
  const r1 = await criar(trecho(blocos[4]!, 'o choque reduz o produto'), '  O que o choque faz? ', 'Reduz o produto; "só" com preços rígidos.');
  expect(r1.status).toBe(201);
  const { cartao } = await r1.json() as { cartao: Flashcard };
  expect(cartao).toMatchObject({ origem: 'manual', frente: 'O que o choque faz?', capitulo: { id: capitulo.id } });
  const r2 = await criar(trecho(blocos[6]!, 'Outro capítulo'), 'Qual o outro capítulo?', 'O dois.');
  const outro = (await r2.json() as { cartao: Flashcard }).cartao;
  expect(outro.capitulo.titulo).toBe('Capítulo dois');

  expect((await criar({ ...trecho(blocos[4]!, 'o choque reduz o produto'), citacao: 'inventada' }, 'f', 'v')).status).toBe(422);
  expect((await criar(trecho(blocos[4]!, 'o choque reduz o produto'), '   ', 'v')).status).toBe(422);
  expect((await api.request('/api/flashcards', { method: 'POST', headers: ESCRITA, body: JSON.stringify({ frente: 'f', verso: 'v', ancora: {}, extra: 1 }) })).status).toBe(400);

  const editado = await api.request(`/api/flashcards/${cartao.id}`, { method: 'PATCH', headers: ESCRITA, body: JSON.stringify({ verso: 'Reduz o produto.' }) });
  expect(await editado.json()).toMatchObject({ cartao: { frente: 'O que o choque faz?', verso: 'Reduz o produto.' } });

  const hoje = async () => (await (await api.request('/api/flashcards?fila=hoje')).json() as Lista).cartoes.map((c) => c.id);
  expect(await hoje()).toEqual([cartao.id, outro.id]);
  const responder = (id: string, nota: number) => api.request(`/api/flashcards/${id}/revisoes`, { method: 'POST', headers: ESCRITA, body: JSON.stringify({ nota }) });
  const bom = await responder(cartao.id, 3);
  expect(bom.status).toBe(201);
  const { agenda } = await bom.json() as { agenda: Flashcard['agenda'] };
  expect(agenda).toMatchObject({ intervalo_dias: 1, repeticoes: 1, revisoes: 1 });
  expect(Date.parse(agenda.proxima_revisao!)).toBe(inicioDoDia(new Date(), 1).getTime());
  // Errei: continua na fila de hoje.
  expect((await (await responder(outro.id, 1)).json() as { agenda: Flashcard['agenda'] }).agenda).toMatchObject({ intervalo_dias: 0, facilidade: 2.3 });
  expect(await hoje()).toEqual([outro.id]);
  expect((await responder(outro.id, 5)).status).toBe(400);

  const csv = await api.request(`/api/flashcards/exportacao.csv?documento=${versao.documento_id}`);
  expect(csv.headers.get('content-disposition')) .toContain('margem-flashcards-precos-e-produto-');
  const texto = await csv.text();
  expect(texto.split('\n').slice(0, 3)).toEqual(['#separator:semicolon', '#html:false', '#tags column:3']);
  expect(texto).toContain('O que o choque faz?;Reduz o produto.;margem margem::precos-e-produto margem::precos-e-produto::capitulo-um');

  expect((await api.request(`/api/flashcards/${outro.id}`, { method: 'DELETE', headers: ESCRITA })).status).toBe(204);
  expect((await api.request(`/api/flashcards/${outro.id}`, { method: 'DELETE', headers: ESCRITA })).status).toBe(404);
  expect(await hoje()).toEqual([]);
}));

test('SM-2: intervalos crescem, Errei recomeça, facilidade limitada; faixa de cartões; CSV com aspas', () => {
  const agora = new Date('2026-10-02T15:00:00.000Z');
  let estado = agendar(ESTADO_INICIAL, 3, agora);
  expect(estado).toMatchObject({ intervalo_dias: 1, repeticoes: 1, facilidade: 2.5 });
  expect(estado.proxima_revisao.toISOString()).toBe('2026-10-03T03:00:00.000Z');
  estado = agendar(estado, 3, agora);
  expect(estado.intervalo_dias).toBe(3);
  estado = agendar(estado, 3, agora);
  expect(estado.intervalo_dias).toBe(8);
  expect(agendar(estado, 4, agora)).toMatchObject({ intervalo_dias: 26, facilidade: 2.65 });
  expect(agendar(estado, 2, agora)).toMatchObject({ intervalo_dias: 10, facilidade: 2.35 });
  expect(agendar(estado, 1, agora)).toMatchObject({ intervalo_dias: 0, repeticoes: 0, proxima_revisao: agora });
  expect(agendar({ facilidade: 1.3, intervalo_dias: 0, repeticoes: 0 }, 1, agora).facilidade).toBe(1.3);
  expect(agendar(ESTADO_INICIAL, 4, agora).intervalo_dias).toBe(4);
  // 23h30 em Brasília ainda é o mesmo dia.
  expect(inicioDoDia(new Date('2026-10-03T02:30:00.000Z')).toISOString()).toBe('2026-10-02T03:00:00.000Z');
  expect(faixaDeCartoes(100)).toEqual({ minimo: 2, maximo: 4 });
  expect(faixaDeCartoes(100_000)).toEqual({ minimo: 10, maximo: 20 });
  const base = { documento: { id: 'd', titulo: 'Ética', autor: null }, capitulo: { id: 's', titulo: 'Livro I' } } as unknown as Flashcard;
  expect(cartoesEmCsv([{ ...base, frente: 'A; B', verso: 'Diz "não"\nduas linhas' }]).split('\n').slice(3).join('\n'))
    .toBe('"A; B";"Diz ""não""\nduas linhas";margem margem::etica margem::etica::livro-i\n');
});
