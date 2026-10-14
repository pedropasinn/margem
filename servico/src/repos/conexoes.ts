/**
 * Conexões entre trechos (`ConexaoV2`, migração 0004). A origem é sempre um trecho de
 * uma versão; o destino é outro trecho (deste ou de outro livro), um documento ou uma
 * nota externa. Toda âncora é conferida contra o bloco real antes de gravar.
 *
 * v0.1 (migração 0030): a conexão também guarda o tipo fino da relação (`relacao_semantica`, 9 tipos)
 * e, quando adotada da compreensão, a relação e o modelo de origem. `criar` aceita V2 ou V3; as
 * leituras `…V3` devolvem `ConexaoV3` (as antigas sem o tipo fino), as outras seguem em V2.
 */
import {
  conferirAncora, decidirConexao, validarConexaoV2, validarConexaoV3, type AncoraV1, type ConexaoV2, type ConexaoV3, type Id,
} from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import { DadoRecusado, DATA, OBJETO_ANCORA } from './anotacoes.js';
import { obterVersao } from './documentos.js';

const DESTINO = `CASE c.destino_tipo
    WHEN 'trecho' THEN jsonb_build_object('tipo','trecho','ancora',jsonb_build_object(
      'versao_id',c.destino_versao_id,'bloco_id',c.destino_bloco_id,'inicio_utf16',c.destino_inicio_utf16,
      'fim_utf16',c.destino_fim_utf16,'citacao',c.destino_citacao,'prefixo',c.destino_prefixo,'sufixo',c.destino_sufixo))
    WHEN 'documento' THEN jsonb_build_object('tipo','documento','documento_id',c.destino_documento_id)
    ELSE jsonb_build_object('tipo','nota_externa','caminho',c.destino_caminho,'titulo',c.destino_titulo) END`;
const OBJETO = `jsonb_build_object('versao',2,'id',c.id,'origem',${OBJETO_ANCORA('c.')},'destino',${DESTINO},
    'relacao',c.relacao,'justificativa',c.justificativa,'autor',c.autor,'estado',c.estado,'criada_em',${DATA('c.criada_em')})
  || CASE WHEN c.decidida_em IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('decidida_em',${DATA('c.decidida_em')}) END
  || CASE WHEN c.conversa_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('conversa_id',c.conversa_id) END`;

/** A V3: o objeto da V2 com `versao: 3` e o tipo fino e a origem da compreensão, quando houver. */
const OBJETO_V3 = `(${OBJETO}) || jsonb_build_object('versao',3)
  || CASE WHEN c.relacao_semantica IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('relacao_semantica',c.relacao_semantica) END
  || CASE WHEN c.relacao_origem_id IS NULL THEN '{}'::jsonb
     ELSE jsonb_build_object('origem_compreensao',jsonb_build_object('modelo_id',c.relacao_modelo_id,'relacao_id',c.relacao_origem_id)) END`;

export async function obterV3(cliente: Transacao, id: Id): Promise<ConexaoV3 | null> {
  return (await cliente.query<{ conexao: ConexaoV3 }>(`SELECT ${OBJETO_V3} AS conexao FROM conexao c WHERE c.id=$1`, [id])).rows[0]?.conexao ?? null;
}

/** Como `listarNosBlocos`, em V3. */
export async function listarV3NosBlocos(cliente: Transacao, versaoId: Id, blocos: readonly Id[]): Promise<ConexaoV3[]> {
  return (await cliente.query<{ conexao: ConexaoV3 }>(`SELECT ${OBJETO_V3} AS conexao FROM conexao c
    WHERE (c.versao_id=$1 AND c.bloco_id = ANY($2::text[]))
       OR (c.destino_tipo='trecho' AND c.destino_versao_id=$1 AND c.destino_bloco_id = ANY($2::text[]))
    ORDER BY c.criada_em, c.id`, [versaoId, [...blocos]])).rows.map((linha) => linha.conexao);
}

export async function obter(cliente: Transacao, id: Id): Promise<ConexaoV2 | null> {
  return (await cliente.query<{ conexao: ConexaoV2 }>(`SELECT ${OBJETO} AS conexao FROM conexao c WHERE c.id=$1`, [id])).rows[0]?.conexao ?? null;
}

/** Conexões com origem ou destino (trecho) nos blocos pedidos da versão. */
export async function listarNosBlocos(cliente: Transacao, versaoId: Id, blocos: readonly Id[]): Promise<ConexaoV2[]> {
  return (await cliente.query<{ conexao: ConexaoV2 }>(`SELECT ${OBJETO} AS conexao FROM conexao c
    WHERE (c.versao_id=$1 AND c.bloco_id = ANY($2::text[]))
       OR (c.destino_tipo='trecho' AND c.destino_versao_id=$1 AND c.destino_bloco_id = ANY($2::text[]))
    ORDER BY c.criada_em, c.id`, [versaoId, [...blocos]])).rows.map((linha) => linha.conexao);
}

async function conferirTrecho(cliente: Transacao, ancora: AncoraV1, papel: string): Promise<void> {
  const versao = await obterVersao(cliente, ancora.versao_id).catch(() => null);
  const bloco = versao?.canonico.blocos.find((candidato) => candidato.id === ancora.bloco_id);
  if (!bloco || !conferirAncora(bloco, ancora)) throw new DadoRecusado('ancora_invalida', `A âncora ${papel} não confere no bloco da versão.`);
}

export async function conferir(cliente: Transacao, conexao: ConexaoV2 | ConexaoV3): Promise<void> {
  if (conexao.versao === 3 ? !validarConexaoV3(conexao) : !validarConexaoV2(conexao)) {
    throw new DadoRecusado('conexao_invalida', `A conexão não segue o contrato ConexaoV${String(conexao.versao)}.`);
  }
  await conferirTrecho(cliente, conexao.origem, 'de origem');
  if (conexao.destino.tipo === 'trecho') await conferirTrecho(cliente, conexao.destino.ancora, 'de destino');
  if (conexao.destino.tipo === 'documento') {
    const existe = (await cliente.query('SELECT 1 FROM documento WHERE id=$1', [conexao.destino.documento_id])).rowCount;
    if (!existe) throw new DadoRecusado('documento_inexistente', 'O documento de destino não existe.');
  }
}

/** Grava a conexão (V2, ou V3 com o tipo fino) e a devolve em V2, como as outras leituras deste módulo. */
export async function criar(cliente: Transacao, conexao: ConexaoV2 | ConexaoV3): Promise<ConexaoV2> {
  await conferir(cliente, conexao);
  const o = conexao.origem;
  const d = conexao.destino;
  const trecho = d.tipo === 'trecho' ? d.ancora : null;
  const v3 = conexao.versao === 3 ? conexao : null;
  await cliente.query(`INSERT INTO conexao (id,versao_id,bloco_id,inicio_utf16,fim_utf16,citacao,prefixo,sufixo,
      destino_tipo,destino_versao_id,destino_bloco_id,destino_inicio_utf16,destino_fim_utf16,destino_citacao,destino_prefixo,destino_sufixo,
      destino_documento_id,destino_caminho,destino_titulo,relacao,justificativa,autor,estado,conversa_id,criada_em,decidida_em,
      relacao_semantica,relacao_origem_id,relacao_modelo_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
  [conexao.id, o.versao_id, o.bloco_id, o.inicio_utf16, o.fim_utf16, o.citacao, o.prefixo, o.sufixo,
    d.tipo, trecho?.versao_id ?? null, trecho?.bloco_id ?? null, trecho?.inicio_utf16 ?? null, trecho?.fim_utf16 ?? null,
    trecho?.citacao ?? null, trecho?.prefixo ?? null, trecho?.sufixo ?? null,
    d.tipo === 'documento' ? d.documento_id : null,
    d.tipo === 'nota_externa' ? d.caminho : null, d.tipo === 'nota_externa' ? d.titulo : null,
    conexao.relacao, conexao.justificativa, conexao.autor, conexao.estado, conexao.conversa_id ?? null,
    conexao.criada_em, conexao.decidida_em ?? null,
    v3?.relacao_semantica ?? null, v3?.origem_compreensao?.relacao_id ?? null, v3?.origem_compreensao?.modelo_id ?? null]);
  return (await obter(cliente, conexao.id))!;
}

export class DecisaoRecusada extends Error {
  constructor(readonly estado_atual: ConexaoV2['estado'], readonly autor: ConexaoV2['autor']) {
    super('Só uma sugestão da IA pode ser decidida.'); this.name = 'DecisaoRecusada';
  }
}

/** Única transição: sugestão da IA → aceita/rejeitada (`decidirConexao`). `null` se não existe. */
export async function decidir(cliente: Transacao, id: Id, estado: 'aceita' | 'rejeitada', decididaEm: string): Promise<ConexaoV2 | null> {
  await cliente.query('SELECT id FROM conexao WHERE id=$1 FOR UPDATE', [id]);
  const atual = await obter(cliente, id);
  if (!atual) return null;
  if (atual.autor !== 'ia' || atual.estado !== 'sugerida') throw new DecisaoRecusada(atual.estado, atual.autor);
  // A decisão não pode vir antes da criação; o relógio do serviço decide, nunca o cliente.
  const quando = Date.parse(decididaEm) < Date.parse(atual.criada_em) ? atual.criada_em : decididaEm;
  const decidida = decidirConexao(atual, estado, quando);
  await cliente.query('UPDATE conexao SET estado=$2, decidida_em=$3 WHERE id=$1', [id, decidida.estado, decidida.decidida_em ?? null]);
  return obter(cliente, id);
}
