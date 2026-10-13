/**
 * Publicação única do `responder` com o worker morto no meio: a primeira tentativa
 * executa (a porta responde e o artefato fica em disco), mas o processo morre antes de
 * publicar. A concessão vence, outro worker executa de novo e publica uma vez só; a
 * tentativa morta, se voltar, é recusada pela concessão. Execução repetida é tolerada;
 * publicação duplicada, não.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { ulid } from 'ulid';
import { afterEach, expect, expectTypeOf, test } from 'vitest';
import type { AncoraV1, Bloco, ConversaV2, Id } from '@margem/contratos';
import { canonicoDeTeste, comBanco } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import * as conversasRepo from '../repos/conversas.js';
import * as documentos from '../repos/documentos.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { ConcessaoPerdida } from '../worker/fila.js';
import { Worker } from '../worker/worker.js';
import type { RespostaResolvida } from '../leitura/v2/resolver.js';
import {
  TIPO_RESPONDER, blocosDoCapitulo, enfileirarResposta, lerChaveDoResponder, manipuladorResponder, publicarResposta,
  recortarContexto, responderFalso, type EntradaDoResponder, type Responder, type SaidaDoResponder,
} from './responder.js';

const temporarios: string[] = [];
afterEach(async () => {
  for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true });
});
async function temporario(nome: string): Promise<string> {
  const diretorio = await mkdtemp(join(tmpdir(), `margem-j16-${nome}-`));
  temporarios.push(diretorio);
  return diretorio;
}

function ancoraDoBloco(versaoId: Id, bloco: Bloco, citacao: string): AncoraV1 {
  const inicio = bloco.texto.indexOf(citacao);
  return {
    versao_id: versaoId, bloco_id: bloco.id, inicio_utf16: inicio, fim_utf16: inicio + citacao.length,
    citacao, prefixo: bloco.texto.slice(0, inicio), sufixo: bloco.texto.slice(inicio + citacao.length),
  };
}

async function conversaComPergunta(banco: pg.Pool): Promise<{ conversa: ConversaV2; job: Id }> {
  const canonico = canonicoDeTeste({
    blocos: [
      { tipo: 'capitulo', texto: 'Um' },
      { tipo: 'paragrafo', texto: 'Primeiro parágrafo do capítulo.' },
      { tipo: 'estrofe', texto: 'Verso um,\nverso dois.' },
      { tipo: 'paragrafo', texto: 'Terceiro parágrafo.' },
    ],
    secoes: [{ nivel: 1, inicio: 0, fim: 3 }],
  });
  return comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'poema.md' });
    const versao = await documentos.criarVersao(cliente, documento.id, canonico);
    const agora = new Date().toISOString();
    const conversa = await conversasRepo.criar(cliente, {
      versao: 2, id: ulid(), versao_id: versao.id, ancora: ancoraDoBloco(versao.id, canonico.blocos[2]!, 'verso dois'),
      mensagens: [{ id: ulid(), autor: 'leitor', texto: 'Por que a quebra aqui?', criada_em: agora }],
      estado: 'aberta', criada_em: agora,
    });
    const job = await enfileirarResposta(cliente, conversa, conversa.mensagens[0]!.id);
    return { conversa, job: job.id };
  });
}

async function contar(banco: pg.Pool, sql: string, parametros: unknown[] = []): Promise<number> {
  return (await banco.query<{ n: number }>(sql, parametros)).rows[0]!.n;
}

test('worker morto entre executar e publicar: outro worker publica uma vez só, e a tentativa morta é recusada', async () =>
  comBanco('j16_responder', async (banco) => {
    const { conversa, job } = await conversaComPergunta(banco);
    const artefatos = await temporario('respostas');
    const chamadas: EntradaDoResponder[] = [];
    const base = responderFalso();
    const responder: Responder = (entrada) => { chamadas.push(entrada); return base(entrada); };
    const manipulador = manipuladorResponder({ banco, responder, diretorioArtefatos: artefatos });
    const fila = new FilaPostgres(banco);

    // Tentativa 1: reserva e executa; o processo morre antes de publicar.
    const [concessao] = await fila.reservar('worker-morto', [TIPO_RESPONDER], 1);
    if (!concessao) throw new Error('Nada reservado.');
    const tarefa = { job: concessao.job, lease_token: concessao.lease_token, sinal: new AbortController().signal };
    const execucao = await manipulador.executar(tarefa);
    expect(execucao.estado).toBe('ok');
    if (execucao.estado !== 'ok') return;
    await banco.query("UPDATE job SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id=$1", [job]);
    // A concessão vencida volta à fila com 1 minuto de espera; o teste pula a espera.
    expect(await fila.expirarConcessoes()).toBe(1);
    await banco.query('UPDATE job SET not_before = NULL WHERE id=$1', [job]);

    // Outro worker: a concessão vencida volta à fila, a tentativa 2 executa de novo e publica.
    const worker = new Worker({
      fila, manipuladores: { [TIPO_RESPONDER]: manipulador },
      diretorioSlots: await temporario('vagas'), slots: 1, intervaloMs: 5, maximoCiclos: 3,
    });
    await worker.rodar();
    expect(chamadas).toHaveLength(2);
    expect((await banco.query('SELECT estado, attempt FROM job WHERE id=$1', [job])).rows[0]).toEqual({ estado: 'ok', attempt: 2 });

    // A tentativa morta volta e tenta publicar o artefato dela: a concessão recusa, nada é escrito.
    await expect(fila.publicar(job, concessao.lease_token, (contexto) => manipulador.publicar(tarefa, execucao, contexto)))
      .rejects.toBeInstanceOf(ConcessaoPerdida);
    // Mesmo sem a concessão, a pergunta já respondida recusa uma segunda resposta.
    await expect(comTransacao(banco, (cliente) => publicarResposta({ banco, responder }, cliente, job, execucao)))
      .rejects.toThrow('já tem resposta');

    expect(await contar(banco, "SELECT count(*)::int AS n FROM mensagem WHERE autor='ia'")).toBe(1);
    expect(await contar(banco, "SELECT count(*)::int AS n FROM conexao WHERE estado='sugerida'")).toBe(1);
    expect(await contar(banco, "SELECT count(*)::int AS n FROM evento_job WHERE job_id=$1 AND tipo='publicado'", [job])).toBe(1);
    expect(await contar(banco, "SELECT count(*)::int AS n FROM evento_job WHERE job_id=$1 AND tipo='resposta_publicada'", [job])).toBe(1);
    expect(await contar(banco, "SELECT count(*)::int AS n FROM evento_job WHERE job_id=$1 AND tipo='concessao_expirada'", [job])).toBe(1);
    const fio = await comTransacao(banco, (cliente) => conversasRepo.obter(cliente, conversa.id));
    expect(fio?.mensagens.map((mensagem) => mensagem.autor)).toEqual(['leitor', 'ia']);
  }));

test('contexto: núcleo é a âncora ± 1 no capítulo; o resto entra por proximidade até o orçamento', () => {
  const canonico = canonicoDeTeste({
    blocos: [
      { tipo: 'capitulo', texto: 'Um' }, ...Array.from({ length: 8 }, (_, i) => ({ tipo: 'paragrafo' as const, texto: `Parágrafo ${String(i)} ${'x'.repeat(40)}` })),
      { tipo: 'capitulo', texto: 'Dois' }, { tipo: 'paragrafo', texto: 'Fora.' },
    ],
    secoes: [{ nivel: 1, inicio: 0, fim: 8 }, { nivel: 1, inicio: 9, fim: 10 }],
  });
  const capitulo = blocosDoCapitulo(canonico, canonico.blocos[4]!.id);
  expect(capitulo.map((bloco) => bloco.ordem)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const inteiro = recortarContexto(capitulo, canonico.blocos[4]!.id);
  expect(inteiro.blocos_nucleo.map((bloco) => bloco.ordem)).toEqual([3, 4, 5]);
  expect(inteiro.blocos_contexto.map((bloco) => bloco.ordem)).toEqual([0, 1, 2, 6, 7, 8]);
  // Com orçamento curto, só os mais próximos entram (cada parágrafo tem 15 tokens estimados; o núcleo, 44).
  const curto = recortarContexto(capitulo, canonico.blocos[4]!.id, 80);
  // O título do capítulo (1 token) ainda cabe depois dos dois vizinhos.
  expect(curto.blocos_contexto.map((bloco) => bloco.ordem)).toEqual([0, 2, 6]);
  expect(lerChaveDoResponder(`responder:${canonico.blocos[1]!.id}:${canonico.blocos[2]!.id}`))
    .toEqual({ conversa_id: canonico.blocos[1]!.id, mensagem_id: canonico.blocos[2]!.id });
  expect(() => lerChaveDoResponder('revisao:x')).toThrow('inválida');
});

test('a saída do J17 (`resolverResposta` + modelo e esforço) é a saída da porta, sem adaptador', () => {
  expectTypeOf<RespostaResolvida & { modelo: string; esforco: string }>().toMatchTypeOf<SaidaDoResponder>();
});
