/**
 * Salas de teste do beta (0018): a sala, os documentos dela, os testadores, as sessões, os
 * comentários nos trechos e as respostas ao formulário. Só o serviço escreve aqui; nada toca as
 * tabelas do leitor (marca, anotacao, progresso).
 */
import type {
  ComentarioDaSalaV1, FormularioDaSalaV1, Id, RespostaDaSalaV1, SalaDeTesteV1, ValorDaRespostaDaSala,
} from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';

interface LinhaDaSala {
  id: Id; slug: string; titulo: string; boas_vindas: string; senha_hash: string; ativa: boolean;
  expira_em: Date | null; formulario: FormularioDaSalaV1; criada_em: Date; atualizada_em: Date; documentos: Id[];
}

export interface SalaGuardada { sala: SalaDeTesteV1; senha_hash: string }

const PROJECAO = `s.id, s.slug, s.titulo, s.boas_vindas, s.senha_hash, s.ativa, s.expira_em, s.formulario, s.criada_em, s.atualizada_em,
  coalesce((SELECT array_agg(d.documento_id::text ORDER BY d.ordem) FROM sala_documento d WHERE d.sala_id = s.id), '{}'::text[]) AS documentos`;

function daLinha(linha: LinhaDaSala): SalaGuardada {
  return {
    senha_hash: linha.senha_hash,
    sala: {
      versao: 1, id: linha.id, slug: linha.slug, titulo: linha.titulo, boas_vindas: linha.boas_vindas,
      documentos: linha.documentos, ativa: linha.ativa, expira_em: linha.expira_em?.toISOString() ?? null,
      formulario: linha.formulario, criada_em: linha.criada_em.toISOString(), atualizada_em: linha.atualizada_em.toISOString(),
    },
  };
}

/** A sala aceita testadores: ligada e dentro da validade. */
export function salaAberta(sala: Pick<SalaDeTesteV1, 'ativa' | 'expira_em'>, agora: Date): boolean {
  return sala.ativa && (sala.expira_em === null || Date.parse(sala.expira_em) > agora.getTime());
}

export async function obter(cliente: Transacao, id: Id): Promise<SalaGuardada | null> {
  const linha = (await cliente.query<LinhaDaSala>(`SELECT ${PROJECAO} FROM sala s WHERE s.id=$1`, [id])).rows[0];
  return linha ? daLinha(linha) : null;
}

export async function porSlug(cliente: Transacao, slug: string): Promise<SalaGuardada | null> {
  const linha = (await cliente.query<LinhaDaSala>(`SELECT ${PROJECAO} FROM sala s WHERE s.slug=$1`, [slug])).rows[0];
  return linha ? daLinha(linha) : null;
}

export interface ResumoDaSala extends SalaDeTesteV1 { testadores: number; enviadas: number; comentarios: number }

export async function listar(cliente: Transacao): Promise<ResumoDaSala[]> {
  const linhas = (await cliente.query<LinhaDaSala & { testadores: number; enviadas: number; comentarios: number }>(`SELECT ${PROJECAO},
      (SELECT count(*)::int FROM sala_testador t WHERE t.sala_id = s.id) AS testadores,
      (SELECT count(*)::int FROM sala_resposta r WHERE r.sala_id = s.id AND r.estado = 'enviada') AS enviadas,
      (SELECT count(*)::int FROM sala_comentario c WHERE c.sala_id = s.id) AS comentarios
    FROM sala s ORDER BY s.criada_em DESC`)).rows;
  return linhas.map((linha) => ({ ...daLinha(linha).sala, testadores: linha.testadores, enviadas: linha.enviadas, comentarios: linha.comentarios }));
}

async function gravarDocumentos(cliente: Transacao, salaId: Id, documentos: readonly Id[]): Promise<void> {
  await cliente.query('DELETE FROM sala_documento WHERE sala_id=$1 AND NOT (documento_id = ANY($2::text[]))', [salaId, documentos]);
  // Ordem em duas passadas: a restrição única (sala, ordem) não aceita troca direta.
  await cliente.query('UPDATE sala_documento SET ordem = ordem + 1000 WHERE sala_id=$1', [salaId]);
  for (const [ordem, documento] of documentos.entries()) {
    await cliente.query(`INSERT INTO sala_documento (sala_id, documento_id, ordem) VALUES ($1,$2,$3)
      ON CONFLICT (sala_id, documento_id) DO UPDATE SET ordem = excluded.ordem`, [salaId, documento, ordem]);
  }
}

/** Documentos que não existem na biblioteca (ou não têm texto): a sala os recusa. */
export async function documentosSemTexto(cliente: Transacao, documentos: readonly Id[]): Promise<Id[]> {
  const comTexto = new Set((await cliente.query<{ id: Id }>(
    'SELECT DISTINCT documento_id AS id FROM versao_texto WHERE documento_id = ANY($1::text[])', [documentos])).rows.map((linha) => linha.id));
  return documentos.filter((documento) => !comTexto.has(documento));
}

export interface NovaSala {
  id: Id; slug: string; titulo: string; boas_vindas: string; documentos: Id[]; ativa: boolean;
  expira_em: string | null; formulario: FormularioDaSalaV1; senha_hash: string;
}

export async function criar(cliente: Transacao, nova: NovaSala): Promise<SalaDeTesteV1> {
  await cliente.query(`INSERT INTO sala (id, slug, titulo, boas_vindas, senha_hash, ativa, expira_em, formulario)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
  [nova.id, nova.slug, nova.titulo, nova.boas_vindas, nova.senha_hash, nova.ativa, nova.expira_em, JSON.stringify(nova.formulario)]);
  await gravarDocumentos(cliente, nova.id, nova.documentos);
  const gravada = await obter(cliente, nova.id);
  if (!gravada) throw new Error('Sala sumiu depois de criada.');
  return gravada.sala;
}

export type MudancaDaSala = Partial<Pick<NovaSala, 'titulo' | 'boas_vindas' | 'documentos' | 'ativa' | 'expira_em' | 'formulario'>>;

export async function atualizar(cliente: Transacao, id: Id, mudanca: MudancaDaSala): Promise<SalaDeTesteV1 | null> {
  const atual = await obter(cliente, id);
  if (!atual) return null;
  await cliente.query(`UPDATE sala SET titulo=$2, boas_vindas=$3, ativa=$4, expira_em=$5, formulario=$6, atualizada_em=clock_timestamp()
    WHERE id=$1`, [id, mudanca.titulo ?? atual.sala.titulo, mudanca.boas_vindas ?? atual.sala.boas_vindas,
    mudanca.ativa ?? atual.sala.ativa, mudanca.expira_em === undefined ? atual.sala.expira_em : mudanca.expira_em,
    JSON.stringify(mudanca.formulario ?? atual.sala.formulario)]);
  if (mudanca.documentos) await gravarDocumentos(cliente, id, mudanca.documentos);
  // Desligar a sala derruba quem está dentro.
  if (mudanca.ativa === false) await encerrarSessoesDaSala(cliente, id);
  return (await obter(cliente, id))?.sala ?? null;
}

export async function trocarSenha(cliente: Transacao, id: Id, senhaHash: string): Promise<boolean> {
  const resultado = await cliente.query('UPDATE sala SET senha_hash=$2, atualizada_em=clock_timestamp() WHERE id=$1', [id, senhaHash]);
  if (resultado.rowCount !== 1) return false;
  await encerrarSessoesDaSala(cliente, id);
  return true;
}

export async function apagar(cliente: Transacao, id: Id): Promise<boolean> {
  return (await cliente.query('DELETE FROM sala WHERE id=$1', [id])).rowCount === 1;
}

// ------------------------------------------------------------------ testadores e sessões

export interface Testador { id: Id; sala_id: Id; nome: string; email: string | null; criado_em: string; ultimo_acesso_em: string }

/** Mesmo nome (e e-mail, se houver) na mesma sala é o mesmo testador. */
export function chaveDoTestador(nome: string, email: string | null): string {
  return `${nome.normalize('NFC').trim().replaceAll(/\s+/g, ' ').toLowerCase()}|${(email ?? '').trim().toLowerCase()}`;
}

export async function entrarTestador(cliente: Transacao, salaId: Id, novoId: Id, nome: string, email: string | null): Promise<Testador> {
  const linha = (await cliente.query<{ id: Id; sala_id: Id; nome: string; email: string | null; criado_em: Date; ultimo_acesso_em: Date }>(
    `INSERT INTO sala_testador (id, sala_id, nome, email, chave) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (sala_id, chave) DO UPDATE SET ultimo_acesso_em = clock_timestamp(), nome = excluded.nome
     RETURNING id, sala_id, nome, email, criado_em, ultimo_acesso_em`,
    [novoId, salaId, nome, email, chaveDoTestador(nome, email)])).rows[0];
  if (!linha) throw new Error('Testador não gravado.');
  return { ...linha, criado_em: linha.criado_em.toISOString(), ultimo_acesso_em: linha.ultimo_acesso_em.toISOString() };
}

export async function criarSessao(cliente: Transacao, sessao: { id: Id; sala_id: Id; testador_id: Id; segredo_sha256: string; expira_em: Date }): Promise<void> {
  await cliente.query(`INSERT INTO sala_sessao (id, sala_id, testador_id, segredo_sha256, expira_em) VALUES ($1,$2,$3,$4,$5)`,
    [sessao.id, sessao.sala_id, sessao.testador_id, sessao.segredo_sha256, sessao.expira_em]);
}

export interface SessaoValida { sessao_id: Id; sala: SalaDeTesteV1; testador: Testador; expira_em: Date }

/** A sessão vale se o segredo confere, não venceu, não foi encerrada e a sala segue aberta. */
export async function lerSessao(cliente: Transacao, sessaoId: Id, segredoSha256: string, agora: Date): Promise<SessaoValida | null> {
  const linha = (await cliente.query<{ sala_id: Id; segredo_sha256: string; expira_em: Date; encerrada_em: Date | null;
    testador_id: Id; nome: string; email: string | null; criado_em: Date; ultimo_acesso_em: Date }>(
    `SELECT s.sala_id, s.segredo_sha256, s.expira_em, s.encerrada_em, t.id AS testador_id, t.nome, t.email, t.criado_em, t.ultimo_acesso_em
       FROM sala_sessao s JOIN sala_testador t ON t.id = s.testador_id AND t.sala_id = s.sala_id WHERE s.id=$1`, [sessaoId])).rows[0];
  if (!linha || linha.segredo_sha256 !== segredoSha256 || linha.encerrada_em !== null || linha.expira_em.getTime() <= agora.getTime()) return null;
  const sala = await obter(cliente, linha.sala_id);
  if (!sala || !salaAberta(sala.sala, agora)) return null;
  return {
    sessao_id: sessaoId, sala: sala.sala, expira_em: linha.expira_em,
    testador: { id: linha.testador_id, sala_id: linha.sala_id, nome: linha.nome, email: linha.email,
      criado_em: linha.criado_em.toISOString(), ultimo_acesso_em: linha.ultimo_acesso_em.toISOString() },
  };
}

export async function encerrarSessao(cliente: Transacao, sessaoId: Id): Promise<void> {
  await cliente.query('UPDATE sala_sessao SET encerrada_em = clock_timestamp() WHERE id=$1 AND encerrada_em IS NULL', [sessaoId]);
}

export async function encerrarSessoesDaSala(cliente: Transacao, salaId: Id): Promise<void> {
  await cliente.query('UPDATE sala_sessao SET encerrada_em = clock_timestamp() WHERE sala_id=$1 AND encerrada_em IS NULL', [salaId]);
}

// ------------------------------------------------------------------ comentários

interface LinhaDoComentario {
  id: Id; sala_id: Id; testador_id: Id; documento_id: Id; versao_id: Id; bloco_id: Id;
  inicio_utf16: number; fim_utf16: number; citacao: string; texto: string; criado_em: Date;
}
const CAMPOS_DO_COMENTARIO = 'id, sala_id, testador_id, documento_id, versao_id, bloco_id, inicio_utf16, fim_utf16, citacao, texto, criado_em';
const comentarioDaLinha = (linha: LinhaDoComentario): ComentarioDaSalaV1 => ({ ...linha, criado_em: linha.criado_em.toISOString() });

export async function criarComentario(cliente: Transacao, comentario: Omit<ComentarioDaSalaV1, 'criado_em'>): Promise<ComentarioDaSalaV1> {
  const linha = (await cliente.query<LinhaDoComentario>(`INSERT INTO sala_comentario (${CAMPOS_DO_COMENTARIO.replace(', criado_em', '')})
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${CAMPOS_DO_COMENTARIO}`, [comentario.id, comentario.sala_id, comentario.testador_id,
    comentario.documento_id, comentario.versao_id, comentario.bloco_id, comentario.inicio_utf16, comentario.fim_utf16, comentario.citacao, comentario.texto])).rows[0];
  if (!linha) throw new Error('Comentário não gravado.');
  return comentarioDaLinha(linha);
}

export async function listarComentarios(cliente: Transacao, salaId: Id, filtro: { testador_id?: Id; documento_id?: Id } = {}): Promise<ComentarioDaSalaV1[]> {
  const linhas = (await cliente.query<LinhaDoComentario>(`SELECT ${CAMPOS_DO_COMENTARIO} FROM sala_comentario
    WHERE sala_id=$1 AND ($2::text IS NULL OR testador_id=$2) AND ($3::text IS NULL OR documento_id=$3) ORDER BY criado_em, id`,
  [salaId, filtro.testador_id ?? null, filtro.documento_id ?? null])).rows;
  return linhas.map(comentarioDaLinha);
}

export async function apagarComentario(cliente: Transacao, salaId: Id, testadorId: Id, id: Id): Promise<boolean> {
  return (await cliente.query('DELETE FROM sala_comentario WHERE id=$1 AND sala_id=$2 AND testador_id=$3', [id, salaId, testadorId])).rowCount === 1;
}

// ------------------------------------------------------------------ respostas

interface LinhaDaResposta {
  testador_id: Id; geral: Record<string, ValorDaRespostaDaSala>; por_documento: Record<Id, Record<string, ValorDaRespostaDaSala>>;
  estado: 'rascunho' | 'enviada'; atualizada_em: Date; enviada_em: Date | null;
}
const respostaDaLinha = (linha: LinhaDaResposta): RespostaDaSalaV1 => ({
  versao: 1, estado: linha.estado, geral: linha.geral, por_documento: linha.por_documento,
  atualizada_em: linha.atualizada_em.toISOString(), enviada_em: linha.enviada_em?.toISOString() ?? null,
});

export async function lerResposta(cliente: Transacao, salaId: Id, testadorId: Id): Promise<RespostaDaSalaV1 | null> {
  const linha = (await cliente.query<LinhaDaResposta>(`SELECT testador_id, geral, por_documento, estado, atualizada_em, enviada_em
    FROM sala_resposta WHERE sala_id=$1 AND testador_id=$2`, [salaId, testadorId])).rows[0];
  return linha ? respostaDaLinha(linha) : null;
}

/** Grava o rascunho ou o envio. Enviar de novo (editar depois do envio) atualiza `enviada_em`. */
export async function gravarResposta(cliente: Transacao, salaId: Id, testadorId: Id, resposta: Pick<RespostaDaSalaV1, 'geral' | 'por_documento'>, enviar: boolean): Promise<RespostaDaSalaV1> {
  // `statement_timestamp()` é o mesmo nas duas colunas: o envio fica no instante da última edição.
  const linha = (await cliente.query<LinhaDaResposta>(`INSERT INTO sala_resposta (sala_id, testador_id, geral, por_documento, estado, atualizada_em, enviada_em)
    VALUES ($1,$2,$3,$4,$5, statement_timestamp(), CASE WHEN $5 = 'enviada' THEN statement_timestamp() END)
    ON CONFLICT (sala_id, testador_id) DO UPDATE SET geral=excluded.geral, por_documento=excluded.por_documento, estado=excluded.estado,
      atualizada_em=excluded.atualizada_em, enviada_em=excluded.enviada_em
    RETURNING testador_id, geral, por_documento, estado, atualizada_em, enviada_em`,
  [salaId, testadorId, JSON.stringify(resposta.geral), JSON.stringify(resposta.por_documento), enviar ? 'enviada' : 'rascunho'])).rows[0];
  if (!linha) throw new Error('Resposta não gravada.');
  return respostaDaLinha(linha);
}

export interface TestadorComResposta extends Testador { resposta: RespostaDaSalaV1 | null; comentarios: number }

export async function testadoresDaSala(cliente: Transacao, salaId: Id): Promise<TestadorComResposta[]> {
  const linhas = (await cliente.query<{ id: Id; sala_id: Id; nome: string; email: string | null; criado_em: Date; ultimo_acesso_em: Date;
    comentarios: number; r_geral: LinhaDaResposta['geral'] | null; r_por_documento: LinhaDaResposta['por_documento'] | null;
    r_estado: LinhaDaResposta['estado'] | null; r_atualizada_em: Date | null; r_enviada_em: Date | null }>(
    `SELECT t.id, t.sala_id, t.nome, t.email, t.criado_em, t.ultimo_acesso_em,
        (SELECT count(*)::int FROM sala_comentario c WHERE c.sala_id = t.sala_id AND c.testador_id = t.id) AS comentarios,
        r.geral AS r_geral, r.por_documento AS r_por_documento, r.estado AS r_estado, r.atualizada_em AS r_atualizada_em, r.enviada_em AS r_enviada_em
       FROM sala_testador t LEFT JOIN sala_resposta r ON r.sala_id = t.sala_id AND r.testador_id = t.id
      WHERE t.sala_id=$1 ORDER BY t.criado_em, t.id`, [salaId])).rows;
  return linhas.map((linha) => ({
    id: linha.id, sala_id: linha.sala_id, nome: linha.nome, email: linha.email,
    criado_em: linha.criado_em.toISOString(), ultimo_acesso_em: linha.ultimo_acesso_em.toISOString(), comentarios: linha.comentarios,
    resposta: linha.r_estado === null || linha.r_atualizada_em === null ? null : respostaDaLinha({
      testador_id: linha.id, geral: linha.r_geral ?? {}, por_documento: linha.r_por_documento ?? {}, estado: linha.r_estado,
      atualizada_em: linha.r_atualizada_em, enviada_em: linha.r_enviada_em }),
  }));
}
