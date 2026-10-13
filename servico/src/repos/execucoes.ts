import { validarExecucaoLeitura, validarExecucaoLeituraV2, type ExecucaoLeituraV1, type ExecucaoLeituraV2 } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';

const projecao = `id,versao_id,metodo_versao,prompt_versao,schema_versao,modelo,esforco,
  tamanho_parte_tokens::float8,concorrencia,plano AS plano_partes,
  to_char(criada_em AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS criada_em`;
/**
 * Grava a execução com o modelo e o esforço **pedidos** (também em `*_pedido`, desde a 0003).
 * `modelo`/`esforco` são substituídos pelos que o executor declarar ao publicar a primeira
 * parte (`registrarProveniencia`, em `leitura/manipuladores.ts`).
 */
export async function criar(cliente: Transacao, execucao: ExecucaoLeituraV1): Promise<void> {
  if (!validarExecucaoLeitura(execucao)) throw new Error('Execução de leitura inválida.');
  await cliente.query(`INSERT INTO execucao_leitura
    (id,versao_id,metodo_versao,prompt_versao,schema_versao,modelo,esforco,tamanho_parte_tokens,concorrencia,plano,criada_em,
     modelo_pedido,esforco_pedido)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$6,$7)`,
  [execucao.id, execucao.versao_id, execucao.metodo_versao, execucao.prompt_versao, execucao.schema_versao,
    execucao.modelo, execucao.esforco, execucao.tamanho_parte_tokens, execucao.concorrencia, JSON.stringify(execucao.plano_partes), execucao.criada_em]);
}
/**
 * O esforço que quem enfileirou pediu (`config.esforco` do `POST …/leituras`), ou `null` em
 * execuções anteriores à 0003. O worker roda as partes e a revisão com ele, e não com o próprio padrão.
 */
export async function esforcoPedido(cliente: Transacao, id: string): Promise<string | null> {
  const linha = (await cliente.query<{ esforco_pedido: string | null }>('SELECT esforco_pedido FROM execucao_leitura WHERE id=$1', [id])).rows[0];
  if (!linha) throw new Error('Execução inexistente.');
  return linha.esforco_pedido;
}
/** Projeção de consulta, não um contrato completo de execução V1. */
export interface ExecucaoParaPlanejamento {
  id: string; versao_id: string; schema_versao: 1 | 2 | 3;
  tamanho_parte_tokens: number; plano_partes: string[];
}
const projecaoPlanejamento = 'id,versao_id,schema_versao,tamanho_parte_tokens::float8,plano AS plano_partes';
function conferirProjecao(valor: ExecucaoParaPlanejamento): ExecucaoParaPlanejamento {
  if (![1, 2, 3].includes(valor.schema_versao)) throw new Error('Versão de execução desconhecida.');
  return valor;
}
export async function listar(cliente: Transacao, versaoId: string): Promise<ExecucaoParaPlanejamento[]> {
  return (await cliente.query<ExecucaoParaPlanejamento>(`SELECT ${projecaoPlanejamento} FROM execucao_leitura WHERE versao_id=$1 ORDER BY criada_em,id`, [versaoId])).rows.map(conferirProjecao);
}
export async function obter(cliente: Transacao, id: string): Promise<ExecucaoParaPlanejamento> {
  const execucao = (await cliente.query<ExecucaoParaPlanejamento>(`SELECT ${projecaoPlanejamento} FROM execucao_leitura WHERE id=$1`, [id])).rows[0];
  if (!execucao) throw new Error('Execução inexistente.');
  return conferirProjecao(execucao);
}

/**
 * Execução V2 (J19): modo, nível de atenção e `schema_versao` 2. `executor` nasce com o
 * modelo e o esforço **pedidos** (`proveniencia = configuracao`) e é trocado pelos que o
 * executor declarar, na publicação da primeira parte (`registrarProveniencia`).
 */
export async function criarV2(cliente: Transacao, execucao: ExecucaoLeituraV2): Promise<void> {
  if (!validarExecucaoLeituraV2(execucao)) throw new Error('Execução de leitura V2 inválida.');
  await cliente.query(`INSERT INTO execucao_leitura
    (id,versao_id,metodo_versao,prompt_versao,schema_versao,modelo,esforco,tamanho_parte_tokens,concorrencia,plano,criada_em,
     modelo_pedido,esforco_pedido,modo_id,modo_revisao,nivel_de_atencao_alvo)
    VALUES ($1,$2,$3,$4,2,$5,$6,$7,$8,$9,$10,$5,$6,$11,$12,$13)`,
  [execucao.id, execucao.versao_id, execucao.metodo_versao, execucao.prompt_versao,
    execucao.executor.modelo, execucao.executor.esforco, execucao.tamanho_parte_tokens, execucao.concorrencia,
    JSON.stringify(execucao.plano_partes), execucao.criada_em,
    execucao.modo.id, execucao.modo.revisao, execucao.nivel_de_atencao_alvo]);
}

/** A execução como `ExecucaoLeituraV2`, ou `null` quando ela é de F1 (`schema_versao` 1). */
export async function obterV2(cliente: Transacao, id: string): Promise<ExecucaoLeituraV2 | null> {
  const linha = (await cliente.query<ExecucaoLeituraV1 & { modo_id: string; modo_revisao: number; nivel: number }>(
    `SELECT ${projecao}, modo_id, modo_revisao, nivel_de_atencao_alvo::int AS nivel FROM execucao_leitura WHERE id=$1`, [id])).rows[0];
  if (!linha) throw new Error('Execução inexistente.');
  if (Number(linha.schema_versao) !== 2) return null;
  const nivel = linha.nivel;
  if (nivel !== 1 && nivel !== 2 && nivel !== 3) throw new Error('Nível de atenção gravado fora de 1 a 3.');
  return {
    id: linha.id, versao_id: linha.versao_id, metodo_versao: linha.metodo_versao, prompt_versao: linha.prompt_versao,
    schema_versao: 2, modo: { id: linha.modo_id, revisao: linha.modo_revisao }, nivel_de_atencao_alvo: nivel,
    executor: { modelo: linha.modelo, esforco: linha.esforco },
    tamanho_parte_tokens: Number(linha.tamanho_parte_tokens), concorrencia: linha.concorrencia,
    plano_partes: linha.plano_partes, criada_em: linha.criada_em,
  };
}
