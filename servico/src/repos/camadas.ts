/**
 * Camadas de marcas (migração 0004). Cada execução de leitura é uma camada com o mesmo
 * id (criada pelo gatilho `execucao_cria_camada`), e cada lote de importação também.
 * Os grifos do leitor (J37, migração 0010; `pedro` até a 0025) ficam numa camada `leitor` por versão e modo, que não é
 * camada de leitura: não se escolhe, não é padrão, e as marcas dela aparecem em qualquer camada.
 */
import { ulid } from 'ulid';
import type { Id, ReferenciaModo } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';

export interface Camada {
  id: Id;
  versao_id: Id;
  tipo: 'execucao' | 'importacao' | 'leitor';
  execucao_id: Id | null;
  modo: ReferenciaModo;
  criada_em: string;
  /** Camada de uma execução de compreensão do capítulo (J29: `schema_versao = 3`). */
  compreensao: boolean;
  /** Rótulo que substitui o nome da camada no leitor (comparação cega, J32). */
  rotulo: string | null;
}

const projecao = `c.id, c.versao_id, c.tipo, c.execucao_id, c.rotulo,
  COALESCE((SELECT e.schema_versao = 3 FROM execucao_leitura e WHERE e.id = c.execucao_id), false) AS compreensao,
  jsonb_build_object('id', c.modo_id, 'revisao', c.modo_revisao) AS modo,
  to_char(c.criada_em AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS criada_em`;

/** Camadas da versão, da mais antiga para a mais recente. */
export async function listar(cliente: Transacao, versaoId: Id): Promise<Camada[]> {
  return (await cliente.query<Camada>(
    `SELECT ${projecao} FROM camada c WHERE c.versao_id=$1 ORDER BY c.criada_em, c.id`, [versaoId])).rows;
}

/** As camadas que o leitor escolhe (sem a dos grifos dele), da mais antiga para a mais recente. */
export async function listarDeLeitura(cliente: Transacao, versaoId: Id): Promise<Camada[]> {
  return (await listar(cliente, versaoId)).filter((camada) => camada.tipo !== 'leitor');
}

/** A camada dos grifos do leitor nesta versão e neste modo; criada no primeiro grifo. */
export async function camadaDoLeitor(cliente: Transacao, versaoId: Id, modo: ReferenciaModo): Promise<Camada> {
  await cliente.query(`INSERT INTO camada (id, versao_id, tipo, execucao_id, modo_id, modo_revisao, criada_em)
    VALUES ($1,$2,'leitor',NULL,$3,$4,$5)
    ON CONFLICT (versao_id, modo_id, modo_revisao) WHERE tipo = 'leitor' DO NOTHING`,
  [ulid(), versaoId, modo.id, modo.revisao, new Date().toISOString()]);
  const camada = (await cliente.query<Camada>(`SELECT ${projecao} FROM camada c
    WHERE c.versao_id=$1 AND c.tipo='leitor' AND c.modo_id=$2 AND c.modo_revisao=$3`, [versaoId, modo.id, modo.revisao])).rows[0];
  if (!camada) throw new Error('A camada do leitor não foi gravada.');
  return camada;
}

export async function obter(cliente: Transacao, id: Id): Promise<Camada | null> {
  return (await cliente.query<Camada>(`SELECT ${projecao} FROM camada c WHERE c.id=$1`, [id])).rows[0] ?? null;
}

/** Lote de importação sem execução: uma camada nova, com id atribuído pelo serviço. */
export async function criarLoteDeImportacao(
  cliente: Transacao, versaoId: Id, modo: ReferenciaModo, criadaEm = new Date().toISOString(),
): Promise<Camada> {
  const id = ulid();
  await cliente.query(`INSERT INTO camada (id, versao_id, tipo, execucao_id, modo_id, modo_revisao, criada_em)
    VALUES ($1,$2,'importacao',NULL,$3,$4,$5)`, [id, versaoId, modo.id, modo.revisao, criadaEm]);
  const camada = await obter(cliente, id);
  if (!camada) throw new Error('Lote de importação não foi gravado.');
  return camada;
}

/** Quantas marcas cada camada tem; com `blocos`, só as ancoradas nesses blocos. */
export async function contarMarcas(cliente: Transacao, versaoId: Id, blocos?: readonly Id[]): Promise<Map<Id, number>> {
  const linhas = (await cliente.query<{ camada_id: Id; total: number }>(
    `SELECT camada_id, count(*)::int AS total FROM marca
      WHERE versao_id=$1 AND ($2::text[] IS NULL OR bloco_id = ANY($2::text[])) GROUP BY camada_id`,
    [versaoId, blocos === undefined ? null : [...blocos]])).rows;
  return new Map(linhas.map((linha) => [linha.camada_id, linha.total]));
}

/**
 * Camada padrão de uma versão: a preferida do documento, quando é desta versão; senão a
 * camada mais recente que tem marcas — no recorte `blocos`, quando dado (um capítulo);
 * senão a mais recente. `null` sem camada nenhuma.
 *
 * O recorte importa: a importação legada cria um lote por capítulo, e a camada mais recente
 * da versão costuma não ter nenhuma marca no capítulo aberto.
 */
export async function camadaPadrao(cliente: Transacao, versaoId: Id, blocos?: readonly Id[]): Promise<Id | null> {
  const preferida = (await cliente.query<{ camada_padrao: Id | null }>(
    `SELECT p.camada_padrao FROM preferencia_documento p
       JOIN versao_texto v ON v.documento_id = p.documento_id
       JOIN camada c ON c.id = p.camada_padrao AND c.versao_id = v.id AND c.tipo <> 'leitor'
      WHERE v.id = $1`, [versaoId])).rows[0]?.camada_padrao ?? null;
  if (preferida !== null) return preferida;
  const recente = (await cliente.query<{ id: Id }>(
    `SELECT c.id FROM camada c WHERE c.versao_id=$1 AND c.tipo <> 'leitor'
      ORDER BY EXISTS (SELECT 1 FROM marca m WHERE m.camada_id=c.id
                         AND ($2::text[] IS NULL OR m.bloco_id = ANY($2::text[]))) DESC,
               c.criada_em DESC, c.id DESC LIMIT 1`,
    [versaoId, blocos === undefined ? null : [...blocos]])).rows[0];
  return recente?.id ?? null;
}
