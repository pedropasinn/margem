/**
 * Conversas da página "Perguntar" (0021). O estado de cada pergunta vem do job que a responde.
 */
import { ulid } from 'ulid';
import type {
  ArtefatoDoAgenteV1, CitacaoDoAgenteV1, ConversaDoAgenteV1, EstadoDaPerguntaV1, Id, JobResultV1, MensagemDoAgenteV1,
} from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';

interface LinhaDaConversa { id: Id; titulo: string; criada_em: Date; atualizada_em: Date }
interface LinhaDaMensagem {
  id: Id; conversa_id: Id; autor: 'leitor' | 'agente'; texto: string; em_resposta_a: Id | null; job_id: Id | null;
  citacoes: CitacaoDoAgenteV1[]; artefatos: ArtefatoDoAgenteV1[]; diagnosticos: MensagemDoAgenteV1['diagnosticos'];
  execucao: MensagemDoAgenteV1['execucao'] | null; criada_em: Date;
  job_estado: string | null; job_diagnosticos: JobResultV1['diagnosticos'] | null; job_erro: string | null; job_not_before: Date | null;
  respondida: boolean;
}

const MOTIVOS: Record<string, string> = {
  timeout: 'O Codex passou do prazo.', cancelado: 'O pedido foi cancelado.', auth: 'A conta do Codex está sem sessão válida.',
  schema: 'A resposta do Codex veio fora do formato.', json_invalido: 'A resposta do Codex veio truncada.', processo: 'O Codex terminou com erro.',
  cli_incompativel: 'A versão local do Codex não oferece o que o agente precisa.',
};

function conversaDaLinha(linha: LinhaDaConversa): ConversaDoAgenteV1 {
  return { id: linha.id, titulo: linha.titulo, criada_em: linha.criada_em.toISOString(), atualizada_em: linha.atualizada_em.toISOString() };
}

function estadoDaPergunta(linha: LinhaDaMensagem): { estado: EstadoDaPerguntaV1; motivo?: string; aviso?: string } {
  if (linha.respondida) return { estado: 'respondida' };
  switch (linha.job_estado) {
    case null: case 'fila': return { estado: 'na_fila' };
    case 'adiado': {
      const quando = linha.job_not_before?.toISOString();
      return { estado: 'na_fila', aviso: quando ? `Cota do Codex esgotada; volta a tentar em ${quando}.` : 'Adiado pela fila.' };
    }
    case 'reservado': return { estado: 'pensando' };
    case 'ok': return { estado: 'falhou', motivo: 'O job terminou sem publicar a resposta.' };
    default: {
      const diagnostico = (linha.job_diagnosticos ?? []).find((item) => item.nivel === 'erro') ?? linha.job_diagnosticos?.[0];
      const motivo = diagnostico?.mensagem ?? (linha.job_erro === null ? undefined : MOTIVOS[linha.job_erro]) ?? 'O agente não conseguiu responder.';
      return { estado: 'falhou', motivo: motivo.slice(0, 1000) };
    }
  }
}

function mensagemDaLinha(linha: LinhaDaMensagem): MensagemDoAgenteV1 {
  const base: MensagemDoAgenteV1 = {
    id: linha.id, autor: linha.autor, texto: linha.texto, citacoes: linha.citacoes, artefatos: linha.artefatos,
    diagnosticos: linha.diagnosticos, ...(linha.execucao ? { execucao: linha.execucao } : {}), criada_em: linha.criada_em.toISOString(),
  };
  return linha.autor === 'leitor' ? { ...base, ...estadoDaPergunta(linha) } : base;
}

export async function listarConversas(cliente: Transacao): Promise<ConversaDoAgenteV1[]> {
  const { rows } = await cliente.query<LinhaDaConversa>(`SELECT id, titulo, criada_em, atualizada_em FROM agente_conversa
    WHERE apagada_em IS NULL ORDER BY atualizada_em DESC, id DESC LIMIT 200`);
  return rows.map(conversaDaLinha);
}

export async function obterConversa(cliente: Transacao, id: Id, opcoes: { travar?: boolean } = {}): Promise<ConversaDoAgenteV1 | null> {
  const { rows } = await cliente.query<LinhaDaConversa>(`SELECT id, titulo, criada_em, atualizada_em FROM agente_conversa
    WHERE id=$1 AND apagada_em IS NULL${opcoes.travar ? ' FOR UPDATE' : ''}`, [id]);
  return rows[0] ? conversaDaLinha(rows[0]) : null;
}

export async function mensagens(cliente: Transacao, conversaId: Id): Promise<MensagemDoAgenteV1[]> {
  const { rows } = await cliente.query<LinhaDaMensagem>(`SELECT m.*, j.estado AS job_estado, j.diagnosticos AS job_diagnosticos,
      j.error_code AS job_erro, j.not_before AS job_not_before,
      EXISTS (SELECT 1 FROM agente_mensagem r WHERE r.em_resposta_a = m.id) AS respondida
    FROM agente_mensagem m LEFT JOIN job j ON j.id = m.job_id
    WHERE m.conversa_id=$1 ORDER BY m.criada_em, m.id`, [conversaId]);
  return rows.map(mensagemDaLinha);
}

export async function criarConversa(cliente: Transacao, titulo: string): Promise<Id> {
  const id = ulid();
  await cliente.query('INSERT INTO agente_conversa (id, titulo) VALUES ($1, $2)', [id, titulo]);
  return id;
}

export async function apagarConversa(cliente: Transacao, id: Id): Promise<boolean> {
  const { rowCount } = await cliente.query('UPDATE agente_conversa SET apagada_em=clock_timestamp() WHERE id=$1 AND apagada_em IS NULL', [id]);
  return (rowCount ?? 0) > 0;
}

export async function acrescentarPergunta(cliente: Transacao, conversaId: Id, texto: string): Promise<Id> {
  const id = ulid();
  await cliente.query("INSERT INTO agente_mensagem (id, conversa_id, autor, texto) VALUES ($1, $2, 'leitor', $3)", [id, conversaId, texto]);
  await cliente.query('UPDATE agente_conversa SET atualizada_em=clock_timestamp() WHERE id=$1', [conversaId]);
  return id;
}

export async function ligarJob(cliente: Transacao, mensagemId: Id, jobId: Id): Promise<void> {
  await cliente.query("UPDATE agente_mensagem SET job_id=$2 WHERE id=$1 AND autor='leitor'", [mensagemId, jobId]);
}

export class RespostaJaPublicada extends Error {
  constructor() { super('A pergunta já tem resposta publicada.'); this.name = 'RespostaJaPublicada'; }
}

export async function publicarResposta(cliente: Transacao, dados: {
  conversa_id: Id; em_resposta_a: Id; texto: string; citacoes: CitacaoDoAgenteV1[]; artefatos: ArtefatoDoAgenteV1[];
  diagnosticos: MensagemDoAgenteV1['diagnosticos']; execucao: NonNullable<MensagemDoAgenteV1['execucao']>;
}): Promise<Id> {
  const id = ulid();
  const { rowCount } = await cliente.query(`INSERT INTO agente_mensagem (id, conversa_id, autor, texto, em_resposta_a, citacoes, artefatos, diagnosticos, execucao)
    VALUES ($1, $2, 'agente', $3, $4, $5, $6, $7, $8) ON CONFLICT (em_resposta_a) DO NOTHING`,
  [id, dados.conversa_id, dados.texto, dados.em_resposta_a, JSON.stringify(dados.citacoes), JSON.stringify(dados.artefatos),
    JSON.stringify(dados.diagnosticos), JSON.stringify(dados.execucao)]);
  if ((rowCount ?? 0) !== 1) throw new RespostaJaPublicada();
  await cliente.query('UPDATE agente_conversa SET atualizada_em=clock_timestamp() WHERE id=$1', [dados.conversa_id]);
  return id;
}

/** A mensagem crua (para o salvar e o tentar de novo). */
export async function obterMensagem(cliente: Transacao, id: Id, opcoes: { travar?: boolean } = {}): Promise<(MensagemDoAgenteV1 & { conversa_id: Id; em_resposta_a: Id | null }) | null> {
  if (opcoes.travar) await cliente.query('SELECT id FROM agente_mensagem WHERE id=$1 FOR UPDATE', [id]);
  const { rows } = await cliente.query<LinhaDaMensagem>(`SELECT m.*, j.estado AS job_estado, j.diagnosticos AS job_diagnosticos,
      j.error_code AS job_erro, j.not_before AS job_not_before,
      EXISTS (SELECT 1 FROM agente_mensagem r WHERE r.em_resposta_a = m.id) AS respondida
    FROM agente_mensagem m LEFT JOIN job j ON j.id = m.job_id
    JOIN agente_conversa c ON c.id = m.conversa_id AND c.apagada_em IS NULL WHERE m.id=$1`, [id]);
  const linha = rows[0];
  return linha ? { ...mensagemDaLinha(linha), conversa_id: linha.conversa_id, em_resposta_a: linha.em_resposta_a } : null;
}

export async function gravarArtefatos(cliente: Transacao, id: Id, artefatos: ArtefatoDoAgenteV1[]): Promise<void> {
  await cliente.query("UPDATE agente_mensagem SET artefatos=$2 WHERE id=$1 AND autor='agente'", [id, JSON.stringify(artefatos)]);
}
