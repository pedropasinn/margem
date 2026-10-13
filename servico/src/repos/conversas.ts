/**
 * Conversas ancoradas no trecho (`ConversaV2`, migração 0004). Cada mensagem é uma
 * linha de `mensagem`, na ordem de `ordem`. A resposta da IA a uma pergunta é única
 * (`em_resposta_a` é UNIQUE): é o que garante a publicação única do job `responder`.
 */
import { conferirAncora, validarConversaV2, type ConversaV2, type Id, type MensagemIaV1, type MensagemV2 } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import { DadoRecusado, DATA, OBJETO_ANCORA } from './anotacoes.js';
import { obterVersao } from './documentos.js';

const CABECALHO = `jsonb_build_object('versao',2,'id',c.id,'versao_id',c.versao_id,'ancora',${OBJETO_ANCORA('c.')},
    'estado',c.estado,'criada_em',${DATA('c.criada_em')})
  || CASE WHEN c.marca_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('marca_id',c.marca_id) END
  || CASE WHEN c.anotacao_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('anotacao_id',c.anotacao_id) END`;
const MENSAGEM = `jsonb_build_object('id',m.id,'autor',m.autor,'texto',m.texto,'criada_em',${DATA('m.criada_em')})
  || CASE WHEN m.citacoes IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('citacoes',m.citacoes) END
  || CASE WHEN m.contexto IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('contexto',m.contexto) END
  || CASE WHEN m.execucao IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('execucao',m.execucao) END`;

export async function obter(cliente: Transacao, id: Id, opcoes: { travar?: boolean } = {}): Promise<ConversaV2 | null> {
  const cabecalho = (await cliente.query<{ conversa: Omit<ConversaV2, 'mensagens'> }>(
    `SELECT ${CABECALHO} AS conversa FROM conversa c WHERE c.id=$1${opcoes.travar === true ? ' FOR UPDATE' : ''}`, [id])).rows[0]?.conversa;
  if (!cabecalho) return null;
  const mensagens = (await cliente.query<{ mensagem: MensagemV2 }>(
    `SELECT ${MENSAGEM} AS mensagem FROM mensagem m WHERE m.conversa_id=$1 ORDER BY m.ordem`, [id])).rows.map((linha) => linha.mensagem);
  return { ...cabecalho, mensagens };
}

export interface ResumoDaConversa {
  id: Id;
  ancora: ConversaV2['ancora'];
  estado: ConversaV2['estado'];
  criada_em: string;
  mensagens: number;
  ultima: MensagemV2 | null;
}

/** Resumo das conversas ancoradas nos blocos: id, âncora, número de mensagens e a última. */
export async function resumosNosBlocos(cliente: Transacao, versaoId: Id, blocos: readonly Id[]): Promise<ResumoDaConversa[]> {
  return (await cliente.query<{ resumo: ResumoDaConversa }>(`SELECT jsonb_build_object(
      'id',c.id,'ancora',${OBJETO_ANCORA('c.')},'estado',c.estado,'criada_em',${DATA('c.criada_em')},
      'mensagens',(SELECT count(*)::int FROM mensagem x WHERE x.conversa_id=c.id),
      'ultima',(SELECT ${MENSAGEM} FROM mensagem m WHERE m.conversa_id=c.id ORDER BY m.ordem DESC LIMIT 1)) AS resumo
    FROM conversa c WHERE c.versao_id=$1 AND c.bloco_id = ANY($2::text[]) ORDER BY c.criada_em, c.id`,
  [versaoId, [...blocos]])).rows.map((linha) => linha.resumo);
}

/** Contrato inteiro da conversa, âncora no bloco real e referências da mesma versão. */
export async function conferir(cliente: Transacao, conversa: ConversaV2): Promise<void> {
  if (!validarConversaV2(conversa)) throw new DadoRecusado('conversa_invalida', 'A conversa não segue o contrato ConversaV2.');
  const versao = await obterVersao(cliente, conversa.versao_id).catch(() => null);
  if (!versao) throw new DadoRecusado('versao_inexistente', 'A versão da âncora não existe.');
  const bloco = versao.canonico.blocos.find((candidato) => candidato.id === conversa.ancora.bloco_id);
  if (!bloco || !conferirAncora(bloco, conversa.ancora)) throw new DadoRecusado('ancora_invalida', 'A âncora não confere no bloco da versão.');
  if (conversa.marca_id !== undefined
    && !(await cliente.query('SELECT 1 FROM marca WHERE id=$1 AND versao_id=$2', [conversa.marca_id, conversa.versao_id])).rowCount) {
    throw new DadoRecusado('marca_inexistente', 'A marca citada não existe nesta versão.');
  }
  if (conversa.anotacao_id !== undefined
    && !(await cliente.query('SELECT 1 FROM anotacao WHERE id=$1 AND versao_id=$2', [conversa.anotacao_id, conversa.versao_id])).rowCount) {
    throw new DadoRecusado('anotacao_inexistente', 'A anotação citada não existe nesta versão.');
  }
}

async function inserirMensagem(cliente: Transacao, conversaId: Id, ordem: number, mensagem: MensagemV2,
  extra: { em_resposta_a?: Id; job_id?: Id } = {}): Promise<void> {
  const ia = mensagem.autor === 'ia' ? mensagem : null;
  await cliente.query(`INSERT INTO mensagem (id,conversa_id,ordem,autor,texto,citacoes,contexto,execucao,em_resposta_a,job_id,criada_em)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
  [mensagem.id, conversaId, ordem, mensagem.autor, mensagem.texto,
    ia ? JSON.stringify(ia.citacoes) : null,
    ia?.contexto ? JSON.stringify(ia.contexto) : null,
    ia?.execucao ? JSON.stringify(ia.execucao) : null,
    extra.em_resposta_a ?? null, extra.job_id ?? null, mensagem.criada_em]);
}

/** Cria a conversa com a primeira pergunta do leitor. */
export async function criar(cliente: Transacao, conversa: ConversaV2): Promise<ConversaV2> {
  await conferir(cliente, conversa);
  const a = conversa.ancora;
  await cliente.query(`INSERT INTO conversa (id,versao_id,bloco_id,inicio_utf16,fim_utf16,citacao,prefixo,sufixo,
      marca_id,anotacao_id,estado,criada_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
  [conversa.id, conversa.versao_id, a.bloco_id, a.inicio_utf16, a.fim_utf16, a.citacao, a.prefixo, a.sufixo,
    conversa.marca_id ?? null, conversa.anotacao_id ?? null, conversa.estado, conversa.criada_em]);
  for (const [ordem, mensagem] of conversa.mensagens.entries()) await inserirMensagem(cliente, conversa.id, ordem, mensagem);
  return (await obter(cliente, conversa.id))!;
}

/**
 * Acrescenta uma mensagem no fim do fio. A conversa precisa estar travada pelo chamador
 * (`obter(..., { travar: true })`); o fio resultante inteiro é conferido pelo contrato.
 */
export async function acrescentar(cliente: Transacao, atual: ConversaV2, mensagem: MensagemV2,
  extra: { em_resposta_a?: Id; job_id?: Id } = {}): Promise<ConversaV2> {
  await conferir(cliente, { ...atual, mensagens: [...atual.mensagens, mensagem] });
  await inserirMensagem(cliente, atual.id, atual.mensagens.length, mensagem, extra);
  return (await obter(cliente, atual.id))!;
}

/** A resposta já publicada para a pergunta, se houver. */
export async function respostaA(cliente: Transacao, perguntaId: Id): Promise<MensagemIaV1 | null> {
  return (await cliente.query<{ mensagem: MensagemIaV1 }>(
    `SELECT ${MENSAGEM} AS mensagem FROM mensagem m WHERE m.em_resposta_a=$1`, [perguntaId])).rows[0]?.mensagem ?? null;
}

/** Perguntas do leitor ainda sem resposta, com o job que vai respondê-las. */
export async function pendentes(cliente: Transacao, conversaId: Id): Promise<{ mensagem_id: Id; job_id: Id | null; estado: string | null }[]> {
  return (await cliente.query<{ mensagem_id: Id; job_id: Id | null; estado: string | null }>(
    `SELECT p.id AS mensagem_id, j.id AS job_id, j.estado FROM mensagem p
       LEFT JOIN job j ON j.dedup_key = 'responder:' || p.conversa_id || ':' || p.id
      WHERE p.conversa_id=$1 AND p.autor='leitor' AND NOT EXISTS (SELECT 1 FROM mensagem r WHERE r.em_resposta_a=p.id)
      ORDER BY p.ordem`, [conversaId])).rows;
}
