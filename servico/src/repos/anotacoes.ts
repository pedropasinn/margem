/**
 * Anotações do leitor (`AnotacaoV1`, migração 0004). A âncora é guardada nos campos da
 * `AncoraV1` e conferida contra o bloco real da versão antes de gravar.
 */
import { conferirAncora, validarAnotacao, type AnotacaoV1, type Id } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import { obterVersao } from './documentos.js';

/** Erro de dado do cliente: vira 422 na API, com a mensagem como detalhe. */
export class DadoRecusado extends Error {
  constructor(readonly codigo: string, mensagem: string) { super(mensagem); this.name = 'DadoRecusado'; }
}

export class AnotacaoObsoleta extends Error {
  constructor(readonly atual: AnotacaoV1) { super('A anotação mudou em outro lugar.'); }
}

export const OBJETO_ANCORA = (prefixo = ''): string => `jsonb_build_object(
  'versao_id',${prefixo}versao_id,'bloco_id',${prefixo}bloco_id,'inicio_utf16',${prefixo}inicio_utf16,
  'fim_utf16',${prefixo}fim_utf16,'citacao',${prefixo}citacao,'prefixo',${prefixo}prefixo,'sufixo',${prefixo}sufixo)`;
export const DATA = (coluna: string): string => `to_char(${coluna} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

const OBJETO = `jsonb_build_object('versao',1,'id',a.id,'versao_id',a.versao_id,'ancora',${OBJETO_ANCORA('a.')},
    'revisao_edicao',a.revisao_edicao,'tipo',a.tipo,'texto',a.texto,'criada_em',${DATA('a.criada_em')},'atualizada_em',${DATA('a.atualizada_em')})
  || CASE WHEN a.fonte IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('fonte',a.fonte) END
  || CASE WHEN a.marca_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('marca_id',a.marca_id) END
  || CASE WHEN a.revisao IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('revisao',a.revisao) END`;

export async function obter(cliente: Transacao, id: Id, travar = false): Promise<AnotacaoV1 | null> {
  return (await cliente.query<{ anotacao: AnotacaoV1 }>(`SELECT ${OBJETO} AS anotacao FROM anotacao a WHERE a.id=$1${travar ? ' FOR UPDATE' : ''}`, [id])).rows[0]?.anotacao ?? null;
}

/** Anotações da versão ancoradas nos blocos pedidos, na ordem de criação. */
export async function listarNosBlocos(cliente: Transacao, versaoId: Id, blocos: readonly Id[]): Promise<AnotacaoV1[]> {
  return (await cliente.query<{ anotacao: AnotacaoV1 }>(`SELECT ${OBJETO} AS anotacao FROM anotacao a
    WHERE a.versao_id=$1 AND a.bloco_id = ANY($2::text[]) ORDER BY a.criada_em, a.id`, [versaoId, [...blocos]])).rows
    .map((linha) => linha.anotacao);
}

/** Todas as anotações da versão, na ordem de criação (exportação). */
export async function listarDaVersao(cliente: Transacao, versaoId: Id): Promise<AnotacaoV1[]> {
  return (await cliente.query<{ anotacao: AnotacaoV1 }>(`SELECT ${OBJETO} AS anotacao FROM anotacao a
    WHERE a.versao_id=$1 ORDER BY a.criada_em, a.id`, [versaoId])).rows.map((linha) => linha.anotacao);
}

/** Contrato, âncora no bloco real da versão e marca (quando há) da mesma versão. */
async function conferir(cliente: Transacao, anotacao: AnotacaoV1): Promise<void> {
  if (!validarAnotacao(anotacao)) throw new DadoRecusado('anotacao_invalida', 'A anotação não segue o contrato AnotacaoV1.');
  const versao = await obterVersao(cliente, anotacao.versao_id).catch(() => null);
  if (!versao) throw new DadoRecusado('versao_inexistente', 'A versão da âncora não existe.');
  const bloco = versao.canonico.blocos.find((candidato) => candidato.id === anotacao.ancora.bloco_id);
  if (!bloco || !conferirAncora(bloco, anotacao.ancora)) throw new DadoRecusado('ancora_invalida', 'A âncora não confere no bloco da versão.');
  if (anotacao.marca_id !== undefined) {
    const marca = (await cliente.query('SELECT 1 FROM marca WHERE id=$1 AND versao_id=$2', [anotacao.marca_id, anotacao.versao_id])).rowCount;
    if (!marca) throw new DadoRecusado('marca_inexistente', 'A marca citada não existe nesta versão.');
  }
}

export async function criar(cliente: Transacao, anotacao: AnotacaoV1, chaveCliente?: string): Promise<AnotacaoV1> {
  await conferir(cliente, anotacao);
  const a = anotacao.ancora;
  await cliente.query(`INSERT INTO anotacao (id,versao_id,bloco_id,inicio_utf16,fim_utf16,citacao,prefixo,sufixo,
      tipo,texto,fonte,marca_id,criada_em,atualizada_em,chave_cliente) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT (chave_cliente) WHERE chave_cliente IS NOT NULL DO NOTHING`,
  [anotacao.id, anotacao.versao_id, a.bloco_id, a.inicio_utf16, a.fim_utf16, a.citacao, a.prefixo, a.sufixo,
    anotacao.tipo, anotacao.texto, anotacao.tipo === 'fonte' ? JSON.stringify(anotacao.fonte) : null,
    anotacao.marca_id ?? null, anotacao.criada_em, anotacao.atualizada_em, chaveCliente ?? null]);
  if (chaveCliente !== undefined) {
    return (await cliente.query<{ anotacao: AnotacaoV1 }>(`SELECT ${OBJETO} AS anotacao FROM anotacao a WHERE chave_cliente=$1`, [chaveCliente])).rows[0]!.anotacao;
  }
  return (await obter(cliente, anotacao.id))!;
}

/** Troca tipo, texto, fonte e marca; a âncora e a data de criação não mudam. */
export async function atualizar(cliente: Transacao, anotacao: AnotacaoV1): Promise<AnotacaoV1> {
  const atual = await obter(cliente, anotacao.id, true);
  if (!atual) throw new DadoRecusado('anotacao_inexistente', 'Anotação inexistente.');
  if (atual.revisao_edicao !== anotacao.revisao_edicao) throw new AnotacaoObsoleta(atual);
  await conferir(cliente, anotacao);
  await cliente.query(`UPDATE anotacao SET tipo=$2, texto=$3, fonte=$4, marca_id=$5, atualizada_em=$6, revisao=$7, revisao_edicao=revisao_edicao+1 WHERE id=$1`,
    [anotacao.id, anotacao.tipo, anotacao.texto, anotacao.tipo === 'fonte' ? JSON.stringify(anotacao.fonte) : null,
      anotacao.marca_id ?? null, anotacao.atualizada_em, anotacao.revisao === undefined ? null : JSON.stringify(anotacao.revisao)]);
  return (await obter(cliente, anotacao.id))!;
}

export async function apagar(cliente: Transacao, id: Id, revisao: number): Promise<boolean> {
  const atual = await obter(cliente, id, true);
  if (!atual) return false;
  if (atual.revisao_edicao !== revisao) throw new AnotacaoObsoleta(atual);
  return ((await cliente.query('DELETE FROM anotacao WHERE id=$1', [id])).rowCount ?? 0) > 0;
}

// ------------------------------------------------------------------ J37: o Codex revisa uma nota do leitor

/** Pedido de revisão pendente: um por nota; a instrução do leitor é opcional. */
export interface PedidoDeRevisao { id: Id; instrucao: string | null; pedido_em: string }

export async function pedirRevisao(cliente: Transacao, anotacaoId: Id, pedido: PedidoDeRevisao): Promise<'pedido' | 'pendente' | 'inexistente'> {
  const linha = (await cliente.query<{ pedido: PedidoDeRevisao | null }>('SELECT pedido_de_revisao AS pedido FROM anotacao WHERE id=$1 FOR UPDATE', [anotacaoId])).rows[0];
  if (!linha) return 'inexistente';
  if (linha.pedido !== null) return 'pendente';
  await cliente.query('UPDATE anotacao SET pedido_de_revisao=$2 WHERE id=$1', [anotacaoId, JSON.stringify(pedido)]);
  return 'pedido';
}

export async function pedidoDeRevisao(cliente: Transacao, anotacaoId: Id, travar = false): Promise<PedidoDeRevisao | null> {
  return (await cliente.query<{ pedido: PedidoDeRevisao | null }>(`SELECT pedido_de_revisao AS pedido FROM anotacao WHERE id=$1${travar ? ' FOR UPDATE' : ''}`, [anotacaoId])).rows[0]?.pedido ?? null;
}

/** As notas da versão com revisão do Codex pendente. */
export async function comRevisaoPendente(cliente: Transacao, versaoId: Id): Promise<Id[]> {
  return (await cliente.query<{ id: Id }>('SELECT id FROM anotacao WHERE versao_id=$1 AND pedido_de_revisao IS NOT NULL', [versaoId])).rows.map((linha) => linha.id);
}

/** Aplica a revisão do Codex: o texto novo entra, o anterior e o motivo ficam em `revisao`, o pedido sai. */
export async function aplicarRevisao(cliente: Transacao, anotacaoId: Id, pedidoId: Id, texto: string, motivo: string, agora: string): Promise<AnotacaoV1> {
  const pedido = await pedidoDeRevisao(cliente, anotacaoId, true);
  if (pedido?.id !== pedidoId) throw new Error('O pedido de revisão já foi atendido ou não é este.');
  const atual = await obter(cliente, anotacaoId);
  if (!atual) throw new Error('Anotação inexistente.');
  const em = Date.parse(agora) >= Date.parse(atual.atualizada_em) ? agora : atual.atualizada_em;
  const revisada = { ...atual, texto, revisao: { autor: 'codex' as const, texto_anterior: atual.texto, motivo, em }, atualizada_em: em };
  const gravada = await atualizar(cliente, revisada);
  await cliente.query('UPDATE anotacao SET pedido_de_revisao=NULL WHERE id=$1', [anotacaoId]);
  return gravada;
}

/** Um pedido que falhou de vez sai, para o leitor poder pedir de novo. */
export async function desistirDaRevisao(cliente: Transacao, anotacaoId: Id): Promise<void> {
  await cliente.query('UPDATE anotacao SET pedido_de_revisao=NULL WHERE id=$1', [anotacaoId]);
}
