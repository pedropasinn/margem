/**
 * Sessões de resolução de exercícios (`ResolucaoV2`, migração 0008). A sessão inteira vive em `dados`;
 * toda escrita passa pelo validador do contrato, e quem publica trava a linha antes (publicação única).
 */
import { resolucaoV1ParaV2, validarResolucaoV2, type Id, type ResolucaoV1, type ResolucaoV2 } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import { DadoRecusado } from './anotacoes.js';

/** J101: a migração 0025 converte as sessões V1; uma V1 que ainda apareça é lida como V2. */
function lida(dados: ResolucaoV1 | ResolucaoV2): ResolucaoV2 {
  return dados.versao === 1 ? resolucaoV1ParaV2(dados) : dados;
}

function conferir(sessao: ResolucaoV2): void {
  if (!validarResolucaoV2(sessao)) throw new DadoRecusado('resolucao_invalida', `ResolucaoV2 recusada: ${JSON.stringify(validarResolucaoV2.errors)}`);
}

export async function criar(cliente: Transacao, sessao: ResolucaoV2): Promise<ResolucaoV2> {
  conferir(sessao);
  await cliente.query('INSERT INTO resolucao (id, documento_id, versao_id, dados, criada_em) VALUES ($1,$2,$3,$4,$5)',
    [sessao.id, sessao.documento_id, sessao.versao_id, JSON.stringify(sessao), sessao.criada_em]);
  return sessao;
}

export async function obter(cliente: Transacao, id: Id, opcoes: { travar?: boolean } = {}): Promise<ResolucaoV2 | null> {
  const linha = (await cliente.query<{ dados: ResolucaoV1 | ResolucaoV2 }>(`SELECT dados FROM resolucao WHERE id=$1${opcoes.travar === true ? ' FOR UPDATE' : ''}`, [id])).rows[0];
  return linha ? lida(linha.dados) : null;
}

export async function gravar(cliente: Transacao, sessao: ResolucaoV2): Promise<ResolucaoV2> {
  conferir(sessao);
  const alteradas = await cliente.query('UPDATE resolucao SET dados=$2, atualizada_em=clock_timestamp() WHERE id=$1', [sessao.id, JSON.stringify(sessao)]);
  if (alteradas.rowCount !== 1) throw new Error('Sessão de resolução inexistente.');
  return sessao;
}

/** Remove a sessão (a imagem do recorte fica: é endereçada por hash e pode servir a outra sessão). */
export async function remover(cliente: Transacao, id: Id): Promise<boolean> {
  return (await cliente.query('DELETE FROM resolucao WHERE id=$1', [id])).rowCount === 1;
}

export async function doDocumento(cliente: Transacao, documentoId: Id): Promise<ResolucaoV2[]> {
  return (await cliente.query<{ dados: ResolucaoV1 | ResolucaoV2 }>('SELECT dados FROM resolucao WHERE documento_id=$1 ORDER BY criada_em DESC, id DESC LIMIT 1000', [documentoId]))
    .rows.map((linha) => lida(linha.dados));
}

/** Todas as sessões do documento, sem o teto da lista do leitor (um livro tem centenas de exercícios). */
export async function todasDoDocumento(cliente: Transacao, documentoId: Id): Promise<ResolucaoV2[]> {
  return (await cliente.query<{ dados: ResolucaoV1 | ResolucaoV2 }>('SELECT dados FROM resolucao WHERE documento_id=$1 ORDER BY criada_em, id', [documentoId]))
    .rows.map((linha) => lida(linha.dados));
}
