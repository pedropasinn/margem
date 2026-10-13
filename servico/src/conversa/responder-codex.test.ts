/**
 * J19: a porta `Responder` real composta com o executor falso (prompt `responder@2` →
 * executor → `resolverResposta`), a escolha por `MARGEM_RESPONDER` e o caminho inteiro
 * pelo worker. Nenhuma chamada ao Codex.
 */
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { ulid } from 'ulid';
import { afterEach, expect, test } from 'vitest';
import type { AncoraV1, Bloco, ConversaV2, Id, RespostaGeradaV1 } from '@margem/contratos';
import { canonicoDeTeste, comBanco } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import { criarExecutorFalso, type Roteiro } from '../executor/fake.js';
import type { Executor, PedidoExecucao } from '../executor/tipos.js';
import { modoOuNada } from '../modos.js';
import * as conversasRepo from '../repos/conversas.js';
import * as documentos from '../repos/documentos.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { escolherResponder } from '../worker/main.js';
import { Worker } from '../worker/worker.js';
import { FalhaDoResponder, responderCodex } from './responder-codex.js';
import { TIPO_RESPONDER, enfileirarResposta, manipuladorResponder, type EntradaDoResponder } from './responder.js';

const temporarios: string[] = [];
afterEach(async () => {
  for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true });
});
async function temporario(nome: string): Promise<string> {
  const diretorio = await mkdtemp(join(tmpdir(), `margem-j19-${nome}-`));
  temporarios.push(diretorio);
  return diretorio;
}

const canonico = canonicoDeTeste({
  blocos: [
    { tipo: 'capitulo', texto: 'Círculo vicioso' },
    { tipo: 'estrofe', texto: 'Bailando no ar, gemia inquieto vaga-lume:\nQuem me dera que fosse aquela loura estrela' },
    { tipo: 'estrofe', texto: 'Mas a estrela, fitando a lua, com ciúme:\nPudesse eu copiar o transparente lume' },
    { tipo: 'estrofe', texto: 'Mas o sol, inclinando a rútila capela:\nPor que não nasci eu um simples vaga-lume?' },
  ],
  secoes: [{ nivel: 1, inicio: 0, fim: 3 }],
});
const VERSAO: Id = '01K5J19V000000000000000001';

function ancora(bloco: Bloco, citacao: string, versao = VERSAO): AncoraV1 {
  const inicio = bloco.texto.indexOf(citacao);
  return {
    versao_id: versao, bloco_id: bloco.id, inicio_utf16: inicio, fim_utf16: inicio + citacao.length,
    citacao, prefixo: bloco.texto.slice(0, inicio), sufixo: bloco.texto.slice(inicio + citacao.length),
  };
}

function entrada(versao = VERSAO): EntradaDoResponder {
  const modo = modoOuNada({ id: 'literaria', revisao: 1 });
  if (!modo) throw new Error('modo ausente');
  const [titulo, e1, e2, e3] = canonico.blocos;
  if (!titulo || !e1 || !e2 || !e3) throw new Error('canônico incompleto');
  const agora = '2026-09-24T12:00:00.000Z';
  const pergunta = 'Por que o vaga-lume fecha o círculo?';
  return {
    conversa: {
      versao: 2, id: '01K5J19K000000000000000001', versao_id: versao, ancora: ancora(e3, 'Por que não nasci eu um simples vaga-lume?', versao),
      mensagens: [{ id: '01K5J19P000000000000000001', autor: 'leitor', texto: pergunta, criada_em: agora }],
      estado: 'aberta', criada_em: agora,
    },
    pergunta,
    blocos_nucleo: [e2, e3],
    blocos_contexto: [titulo, e1],
    modo,
  };
}

function resposta(): RespostaGeradaV1 {
  const [, e1, , e3] = canonico.blocos;
  return {
    texto: 'O último verso devolve o desejo ao ponto de partida.',
    pontos: [
      { tipo: 'estrutura', texto: 'O primeiro verso nomeia o vaga-lume.', apoios: [{ bloco_id: e1!.id, citacao: 'gemia inquieto vaga-lume' }] },
      { tipo: 'explicacao', texto: 'O sol quer ser o vaga-lume.', apoios: [{ bloco_id: e3!.id, citacao: 'um simples vaga-lume' }] },
      // Aspas e palavra que não estão no bloco: diagnóstico, nunca citação inventada.
      { tipo: 'objecao', texto: 'Apoio falso.', apoios: [{ bloco_id: e1!.id, citacao: 'vaga-lume triste' }] },
    ],
    sugestoes_de_conexao: [{ destino_bloco_id: e1!.id, citacao: 'Bailando no ar', relacao: 'contraste', justificativa: 'Começo e fim do círculo.' }],
  };
}

interface Capturado { pedido: PedidoExecucao; schema: string; entrada: string[] }
function capturando(roteiro: Roteiro): { executor: Executor; pedidos: Capturado[] } {
  const base = criarExecutorFalso(roteiro);
  const pedidos: Capturado[] = [];
  return {
    pedidos,
    executor: async (pedido) => {
      pedidos.push({ pedido, schema: await readFile(pedido.schema, 'utf8'), entrada: await readdir(pedido.diretorioEntrada) });
      return base(pedido);
    },
  };
}

test('responder real com executor falso: prompt @1 com o schema dos blocos, citações resolvidas, modelo de quem executou', async () => {
  const artefatos = await temporario('artefatos');
  const { executor, pedidos } = capturando({ versao: 1, passos: [{ tipo: 'ok', conteudo: resposta(), modelo: 'gpt-6-astra', esforco: 'high' }] });
  const responder = responderCodex({ executor, esforco: 'high', diretorioArtefatos: artefatos });
  const saida = await responder(entrada());

  expect(pedidos).toHaveLength(1);
  const { pedido, schema, entrada: arquivos } = pedidos[0]!;
  // Sem modelo nas opções, o pedido não leva modelo: a CLI usa o padrão da conta.
  expect(pedido.modelo).toBeUndefined();
  expect(pedido.esforco).toBe('high');
  expect(pedido.diretorioArtefatos).toBe(artefatos);
  expect(pedido.prompt).toContain('Por que o vaga-lume fecha o círculo?');
  expect(pedido.prompt).toContain('[núcleo · estrofe]');
  expect(pedido.prompt).toContain('[capítulo · capitulo]');
  expect(arquivos).toEqual([]);
  const ids = canonico.blocos.map((bloco) => bloco.id);
  const montado = JSON.parse(schema) as { properties: { pontos: { items: { anyOf: { properties: { apoios: { items: { properties: { bloco_id: { enum: string[] } } } } } }[] } } } };
  expect([...montado.properties.pontos.items.anyOf[0]!.properties.apoios.items.properties.bloco_id.enum].sort()).toEqual([...ids].sort());

  expect(saida.modelo).toBe('gpt-6-astra');
  expect(saida.esforco).toBe('high');
  expect(saida.texto).toBe('O último verso devolve o desejo ao ponto de partida.');
  expect(saida.citacoes.map((item) => item.citacao)).toEqual(['gemia inquieto vaga-lume', 'um simples vaga-lume']);
  expect(saida.citacoes[1]).toMatchObject({ bloco_id: canonico.blocos[3]!.id, versao_id: VERSAO });
  expect(saida.diagnosticos.map((item) => item.codigo)).toEqual(['citacao_ausente', 'ponto_sem_apoio']);
  expect(saida.sugestoes).toHaveLength(1);
  expect(saida.sugestoes[0]).toMatchObject({ relacao: 'contraste', autor: 'ia', estado: 'sugerida', conversa_id: entrada().conversa.id });
});

test('responder real: cota vira FalhaDoResponder adiada; resposta fora do contrato vira falha de schema', async () => {
  const cota = responderCodex({ executor: criarExecutorFalso({ versao: 1, passos: [{ tipo: 'cota', not_before: '2026-09-25T10:00:00Z' }] }) });
  const erro = await cota(entrada()).catch((falha: unknown) => falha);
  expect(erro).toBeInstanceOf(FalhaDoResponder);
  expect((erro as FalhaDoResponder).resultado).toMatchObject({ estado: 'adiado', codigo: 'cota' });

  // O schema do prompt só aceita blocos recebidos; um id alheio nem passa pelo executor.
  const alheio = { ...resposta(), sugestoes_de_conexao: [{ destino_bloco_id: '01K5J19B999999999999999999', citacao: 'x', relacao: 'contraste', justificativa: 'y' }] };
  const fora = responderCodex({ executor: criarExecutorFalso({ versao: 1, passos: [{ tipo: 'ok', conteudo: alheio }] }), diretorioArtefatos: await temporario('a') });
  const falha = await fora(entrada()).catch((motivo: unknown) => motivo);
  expect(falha).toBeInstanceOf(FalhaDoResponder);
  expect((falha as FalhaDoResponder).resultado).toMatchObject({ estado: 'falhou', codigo: 'schema' });
});

test('MARGEM_RESPONDER: falso escolhe o determinístico; ausente ou codex, o real; outro valor é erro', async () => {
  const executor = criarExecutorFalso({ versao: 1, passos: [{ tipo: 'ok', conteudo: resposta(), modelo: 'modelo-do-executor' }] });
  const falso = await escolherResponder(executor, { MARGEM_RESPONDER: 'falso' })(entrada());
  expect(falso.modelo).toBe('responder-falso');
  expect(executor.chamadas).toBe(0);
  const real = await escolherResponder(executor, { MARGEM_ESFORCO: 'medium' })(entrada());
  expect(real.modelo).toBe('modelo-do-executor');
  expect(real.esforco).toBe('medium');
  expect(executor.chamadas).toBe(1);
  const codex = await escolherResponder(executor, { MARGEM_RESPONDER: 'codex' })(entrada());
  expect(codex.modelo).toBe('modelo-do-executor');
  expect(() => escolherResponder(executor, { MARGEM_RESPONDER: 'talvez' })).toThrow('MARGEM_RESPONDER');
});

async function conversaNoBanco(banco: pg.Pool): Promise<{ conversa: ConversaV2; job: Id }> {
  return comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'poema.md' });
    const versao = await documentos.criarVersao(cliente, documento.id, canonico);
    const base = entrada(versao.id);
    const conversa = await conversasRepo.criar(cliente, { ...base.conversa, id: ulid(), mensagens: [{ ...base.conversa.mensagens[0]!, id: ulid() }] });
    const job = await enfileirarResposta(cliente, conversa, conversa.mensagens[0]!.id);
    return { conversa, job: job.id };
  });
}

test('worker com o responder real e o executor falso: resposta citada publicada; cota adia o job', async () =>
  comBanco('j19_responder', async (banco) => {
    const { conversa, job } = await conversaNoBanco(banco);
    const artefatos = await temporario('artefatos');
    const executor = criarExecutorFalso({ versao: 1, passos: [
      { quando: { ordem: 1 }, tipo: 'cota', not_before: '2000-01-01T00:00:00Z' },
      { quando: { ordem: 2 }, tipo: 'ok', conteudo: resposta(), modelo: 'gpt-6-astra', esforco: 'high' },
    ] });
    const responder = responderCodex({ executor, diretorioArtefatos: artefatos });
    const rodar = async () => new Worker({
      fila: new FilaPostgres(banco),
      manipuladores: { [TIPO_RESPONDER]: manipuladorResponder({ banco, responder, diretorioArtefatos: artefatos }) },
      diretorioSlots: await temporario('vagas'), slots: 1, intervaloMs: 5, maximoCiclos: 1,
    }).rodar();

    await rodar();
    const adiado = (await banco.query<{ estado: string; error_code: string }>('SELECT estado, error_code FROM job WHERE id=$1', [job])).rows[0];
    expect(adiado).toEqual({ estado: 'adiado', error_code: 'cota' });

    await rodar();
    const fio = await comTransacao(banco, (cliente) => conversasRepo.obter(cliente, conversa.id));
    const ia = fio?.mensagens.at(-1);
    expect(ia).toMatchObject({ autor: 'ia', execucao: { modelo: 'gpt-6-astra', esforco: 'high' } });
    expect(ia?.autor === 'ia' ? ia.citacoes.map((item) => item.citacao) : []).toEqual(['gemia inquieto vaga-lume', 'um simples vaga-lume']);
    const final = (await banco.query<{ estado: string; diagnosticos: { codigo: string }[] }>('SELECT estado, diagnosticos FROM job WHERE id=$1', [job])).rows[0];
    expect(final?.estado).toBe('ok');
    expect(final?.diagnosticos.map((item) => item.codigo)).toEqual(['citacao_ausente', 'ponto_sem_apoio']);
    expect((await banco.query("SELECT count(*)::int AS n FROM conexao WHERE estado='sugerida'")).rows[0]).toEqual({ n: 1 });
  }));
