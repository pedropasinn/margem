import { validarParte, validarPartes, type ParteV1 } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import { obter as obterExecucao } from './execucoes.js';
import { obterVersao } from './documentos.js';

export async function listar(cliente: Transacao, execucaoId: string): Promise<ParteV1[]> {
  const linhas = (await cliente.query<Omit<ParteV1, 'continuidade_anterior'> & { continuidade_anterior: string | null }>(`SELECT id,execucao_id,ordem::float8,
    blocos_responsaveis,blocos_contexto,continuidade_anterior,hash_entrada FROM parte WHERE execucao_id=$1 ORDER BY ordem`, [execucaoId])).rows;
  return linhas.map(linha => {
    const { continuidade_anterior, ...parte } = linha;
    return continuidade_anterior === null ? parte : { ...parte, continuidade_anterior };
  });
}
// O plano completo é publicado junto: não existe execução visível com metade das partes criadas.
export async function criar(cliente: Transacao, execucaoId: string, partes: ParteV1[]): Promise<void> {
  await cliente.query('SELECT id FROM execucao_leitura WHERE id=$1 FOR UPDATE', [execucaoId]);
  const execucao = await obterExecucao(cliente, execucaoId);
  if (execucao.schema_versao === 3) throw new Error('Compreensão tem uma entrada própria de publicação de partes.');
  const versao = await obterVersao(cliente, execucao.versao_id);
  const ids = [...partes].sort((a, b) => a.ordem - b.ordem).map(parte => parte.id);
  if (!partes.every(parte => validarParte(parte) && parte.execucao_id === execucao.id)
    || !validarPartes(partes, undefined, versao.canonico)
    || JSON.stringify(ids) !== JSON.stringify(execucao.plano_partes)) {
    throw new Error('Plano de partes inválido para a execução e seus blocos.');
  }
  for (const parte of partes) {
    await cliente.query(`INSERT INTO parte (id,execucao_id,ordem,blocos_responsaveis,blocos_contexto,continuidade_anterior,hash_entrada)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [parte.id, parte.execucao_id, parte.ordem, JSON.stringify(parte.blocos_responsaveis),
      JSON.stringify(parte.blocos_contexto), parte.continuidade_anterior ?? null, parte.hash_entrada]);
  }
}
