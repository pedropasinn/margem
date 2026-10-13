import type pg from 'pg';
import { ulid } from 'ulid';
import type { EdicaoDeNoticiasV1, HubDeNoticiasV1, ItemDoHubDeNoticias } from '@margem/contratos';
import { comTransacao, type Transacao } from '../db/transacao.js';
import { enfileirar, type Job } from '../repos/jobs.js';
import { hash } from './validar.js';

export const TIPO_EDITAR_NOTICIAS = 'editar_noticias';
export const TIPO_NARRAR_NOTICIAS = 'narrar_noticias';
export interface RegistroEdicao { id: string; dia: string; corte_em: Date; criado_em: Date; conteudo: EdicaoDeNoticiasV1 | null; documento_id: string | null; job_id: string }

export function relogioNoticias(agora: Date): { dia: string; hora: number } {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(agora);
  const campo = (tipo: string) => partes.find(p => p.type === tipo)!.value;
  return { dia: `${campo('year')}-${campo('month')}-${campo('day')}`, hora: Number(campo('hour')) };
}

export async function pedirEdicao(banco: pg.Pool, agora = new Date(), automatico = false): Promise<string | null> {
  return comTransacao(banco, async c => {
    await c.query('SELECT pg_advisory_xact_lock(3095)');
    const agenda = (await c.query<{ ativa: boolean; hora: number }>('SELECT ativa,hora FROM noticia_agenda WHERE id=true')).rows[0]!;
    const { dia, hora } = relogioNoticias(agora);
    if (automatico && (!agenda.ativa || hora < agenda.hora)) return null;
    const existente = (await c.query<{ id: string }>('SELECT id FROM noticia_edicao WHERE dia=$1', [dia])).rows[0];
    if (existente) return existente.id;
    const id = ulid();
    const job = await enfileirar(c, { tipo: TIPO_EDITAR_NOTICIAS, dedup_key: `noticias:${id}`, input_snapshot_hash: hash(agora.toISOString()), prioridade: 20 });
    await c.query('INSERT INTO noticia_edicao(id,dia,corte_em,job_id) VALUES($1,$2,$3,$4)', [id, dia, agora, job.id]);
    return id;
  });
}

export async function registro(banco: pg.Pool | Transacao, id: string): Promise<RegistroEdicao> {
  const r = (await banco.query<RegistroEdicao>('SELECT *,dia::text AS dia FROM noticia_edicao WHERE id=$1', [id])).rows[0];
  if (!r) throw new Error('Edição não encontrada.');
  return r;
}

export async function pedirNarracao(c: Transacao, edicao: RegistroEdicao): Promise<Job | null> {
  if (!edicao.conteudo?.roteiro.trim()) return null;
  if ((await c.query('SELECT 1 FROM noticia_audio WHERE edicao_id=$1', [edicao.id])).rowCount) return null;
  const chave = `noticias-audio:${edicao.id}`;
  // Uma nova tentativa só é enfileirada quando a anterior terminou; o roteiro é imutável.
  const ativo = (await c.query<Job>("SELECT * FROM job WHERE tipo=$1 AND starts_with(dedup_key,$2) AND estado IN ('fila','reservado','adiado') LIMIT 1", [TIPO_NARRAR_NOTICIAS, `${chave}:`])).rows[0];
  if (ativo) return ativo;
  return enfileirar(c, { tipo: TIPO_NARRAR_NOTICIAS, dedup_key: `${chave}:${ulid()}`, input_snapshot_hash: hash(edicao.conteudo.roteiro), prioridade: 20 });
}

export async function hubNoticias(banco: pg.Pool): Promise<HubDeNoticiasV1> {
  const agenda = (await banco.query<{ ativa: boolean; hora: number }>('SELECT ativa,hora FROM noticia_agenda WHERE id=true')).rows[0]!;
  const { rows } = await banco.query<ItemDoHubDeNoticias>(`SELECT e.id,e.dia::text,e.conteudo,e.documento_id,j.estado,
    CASE WHEN j.estado IN ('falhou','adiado','cancelado') THEN COALESCE(j.diagnosticos->0->>'mensagem','Geração interrompida.') ELSE NULL END AS diagnostico,
    CASE WHEN a.edicao_id IS NULL THEN NULL ELSE jsonb_build_object('duracao_s',a.duracao_s,'sha256_roteiro',a.sha256_roteiro) END AS audio,
    (SELECT estado FROM job WHERE tipo='narrar_noticias' AND starts_with(dedup_key,'noticias-audio:'||e.id||':') ORDER BY criado_em DESC,id DESC LIMIT 1) AS estado_audio,
    capa.conteudo AS capa,
    (SELECT estado FROM job WHERE tipo='ilustrar_noticias' AND starts_with(dedup_key,'noticias-capa:'||e.id||':') ORDER BY criado_em DESC,id DESC LIMIT 1) AS estado_capa
    FROM noticia_edicao e JOIN job j ON j.id=e.job_id LEFT JOIN noticia_audio a ON a.edicao_id=e.id LEFT JOIN noticia_capa capa ON capa.edicao_id=e.id ORDER BY e.dia DESC LIMIT 30`);
  return { edicoes: rows, agenda: { ...agenda, fuso: 'America/Sao_Paulo', foco: 'ia_aplicada' } };
}
