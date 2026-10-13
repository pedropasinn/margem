/**
 * Etiquetas do leitor (`EtiquetaV1`, migração 0009) sobre uma marca ou uma anotação da versão.
 * O alvo é conferido na mesma versão antes de gravar; a mesma etiqueta no mesmo alvo (sem contar
 * maiúsculas) não se repete: criar de novo devolve a que já existe.
 */
import { validarEtiqueta, type EtiquetaV1, type Id } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import { DadoRecusado, DATA } from './anotacoes.js';

const OBJETO = `jsonb_build_object('versao',1,'id',e.id,'versao_id',e.versao_id,
    'alvo',CASE WHEN e.marca_id IS NOT NULL THEN jsonb_build_object('tipo','marca','id',e.marca_id)
      ELSE jsonb_build_object('tipo','anotacao','id',e.anotacao_id) END,
    'nome',e.nome,'criada_em',${DATA('e.criada_em')})`;

export async function obter(cliente: Transacao, id: Id): Promise<EtiquetaV1 | null> {
  return (await cliente.query<{ etiqueta: EtiquetaV1 }>(`SELECT ${OBJETO} AS etiqueta FROM etiqueta e WHERE e.id=$1`, [id])).rows[0]?.etiqueta ?? null;
}

export async function daVersao(cliente: Transacao, versaoId: Id): Promise<EtiquetaV1[]> {
  return (await cliente.query<{ etiqueta: EtiquetaV1 }>(`SELECT ${OBJETO} AS etiqueta FROM etiqueta e
    WHERE e.versao_id=$1 ORDER BY e.criada_em, e.id`, [versaoId])).rows.map((linha) => linha.etiqueta);
}

/** Os nomes já usados em qualquer documento, dos mais usados aos menos: sugestões ao etiquetar. */
export async function nomesUsados(cliente: Transacao, limite = 50): Promise<string[]> {
  return (await cliente.query<{ nome: string }>(`SELECT min(nome) AS nome FROM etiqueta
    GROUP BY lower(nome) ORDER BY count(*) DESC, min(nome) LIMIT $1`, [limite])).rows.map((linha) => linha.nome);
}

export async function criar(cliente: Transacao, etiqueta: EtiquetaV1): Promise<EtiquetaV1> {
  if (!validarEtiqueta(etiqueta)) throw new DadoRecusado('etiqueta_invalida', 'A etiqueta não segue o contrato EtiquetaV1.');
  const tabela = etiqueta.alvo.tipo === 'marca' ? 'marca' : 'anotacao';
  const alvo = await cliente.query(`SELECT 1 FROM ${tabela} WHERE id=$1 AND versao_id=$2`, [etiqueta.alvo.id, etiqueta.versao_id]);
  if (!alvo.rowCount) throw new DadoRecusado('alvo_inexistente', `A ${etiqueta.alvo.tipo === 'marca' ? 'marca' : 'anotação'} não existe nesta versão.`);
  const existente = await cliente.query<{ id: Id }>(`SELECT id FROM etiqueta
    WHERE coalesce(marca_id, anotacao_id)=$1 AND lower(nome)=lower($2)`, [etiqueta.alvo.id, etiqueta.nome]);
  if (existente.rows[0]) return (await obter(cliente, existente.rows[0].id))!;
  await cliente.query('INSERT INTO etiqueta (id,versao_id,marca_id,anotacao_id,nome,criada_em) VALUES ($1,$2,$3,$4,$5,$6)', [
    etiqueta.id, etiqueta.versao_id, etiqueta.alvo.tipo === 'marca' ? etiqueta.alvo.id : null,
    etiqueta.alvo.tipo === 'anotacao' ? etiqueta.alvo.id : null, etiqueta.nome, etiqueta.criada_em]);
  return (await obter(cliente, etiqueta.id))!;
}

export async function apagar(cliente: Transacao, id: Id): Promise<boolean> {
  return ((await cliente.query('DELETE FROM etiqueta WHERE id=$1', [id])).rowCount ?? 0) > 0;
}
