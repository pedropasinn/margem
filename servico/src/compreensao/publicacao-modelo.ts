import { conferirOrcamento, ORCAMENTOS } from '../entrada-json.js';
/** Única entrada de escrita do agregado modelo/lote; sempre na transação do chamador. */
import { contratoLoteDoModelo, contratoModeloDoCapitulo, type Local, type LoteDoModeloV1 } from '@margem/contratos';
import { conferirEvolucaoDoModelo, conferirModeloNoCanonico, resolverReferenciasDoModelo, type ModeloConferido } from '@margem/core';
import type { Transacao } from '../db/transacao.js';
import { obterVersao } from '../repos/documentos.js';
import { obterExecucao, obterModelo, revisaoDoCapitulo } from '../repos/compreensao.js';

/** Falhas voltam ao publicador do job e causam rollback de modelo, lote e eventos. */
export async function publicarModeloDoCapitulo(cliente: Transacao, entrada: unknown, entradaLote: unknown = null): Promise<void> {
  conferirOrcamento(entrada, ORCAMENTOS.modelo);
  if (entradaLote !== null) conferirOrcamento(entradaLote, ORCAMENTOS.lote);
  const local = contratoModeloDoCapitulo.validarLocal(entrada);
  if (!local.ok) throw new Error(`Modelo local inválido: ${JSON.stringify(local.erros)}`);
  const loteLocal = entradaLote === null ? null : contratoLoteDoModelo.validarLocal(entradaLote);
  if (loteLocal && !loteLocal.ok) throw new Error(`Lote local inválido: ${JSON.stringify(loteLocal.erros)}`);
  const modelo = local.valor;
  await bloquearCapitulo(cliente, modelo.execucao_id, modelo.secao_id);
  const execucao = await obterExecucao(cliente, modelo.execucao_id);
  if (!execucao) throw new Error('Execução de compreensão inexistente.');
  const versao = await obterVersao(cliente, execucao.versao_id);
  const referencias = resolverReferenciasDoModelo(modelo, execucao, versao.canonico);
  if (!referencias.ok) throw new Error(`Referências do modelo: ${JSON.stringify(referencias.erros)}`);
  const consistente = conferirModeloNoCanonico(referencias.valor);
  if (!consistente.ok) throw new Error(`Modelo diverge do canônico: ${JSON.stringify(consistente.erros)}`);
  const atual = await revisaoDoCapitulo(cliente, modelo.execucao_id, modelo.secao_id);
  if (atual?.id !== (modelo.base_id ?? undefined)) throw new Error('Revisão-base obsoleta ou revisão inicial já publicada.');
  const base = modelo.base_id === null ? null : await obterModelo(cliente, modelo.base_id);
  const lote = loteLocal?.ok ? loteLocal.valor : null;
  const permitido = conferirEvolucaoDoModelo(consistente.valor, base, lote);
  if (!permitido.ok) throw new Error(`Evolução do modelo: ${JSON.stringify(permitido.erros)}`);
  await gravarAgregado(cliente, permitido.valor, lote);
}

// Não exportado: não há gravarModelo/gravarLote público que contorne a conferência contextual.
async function gravarAgregado(cliente: Transacao, conferido: ModeloConferido, lote: Local<LoteDoModeloV1> | null): Promise<void> {
  const m = conferido.modelo;
  await cliente.query(`INSERT INTO modelo_capitulo (id,execucao_id,secao_id,revisao,estagio,conteudo,criada_em)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`, [m.id, m.execucao_id, m.secao_id, m.revisao, m.estagio, JSON.stringify(m), m.criada_em]);
  if (lote) await cliente.query(`INSERT INTO lote_modelo (id,execucao_id,secao_id,estagio,base_id,resultado_id,conteudo,criado_em)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [lote.id, lote.execucao_id, lote.secao_id, lote.estagio,
    lote.base_id, lote.resultado_id, JSON.stringify(lote), lote.criado_em]);
}

/** Ordem comum a preparação, análises, janelas e publicação do agregado. */
export async function bloquearCapitulo(cliente: Transacao, execucaoId: string, secaoId: string): Promise<void> {
  await cliente.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 3052))', [`${execucaoId}:${secaoId}`]);
}
