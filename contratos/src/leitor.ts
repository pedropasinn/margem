/**
 * J101: o domínio deixa de falar "pedro". Os contratos V2 (`ConversaV2`, `ConexaoV2`, `ResolucaoV2`,
 * `LoteRevisaoV2`) trocam o autor humano `pedro` por `leitor`; o resto é idêntico à V1.
 *
 * As V1 continuam aceitas na leitura: `lerConversa`, `lerConexao`, `lerResolucao` e `lerLoteRevisao`
 * recebem `unknown`, aceitam V1 ou V2 e devolvem sempre a V2 (ou `null` se nenhuma das duas valer).
 * As conversões V1 → V2 são puras e exatas; a volta (V2 → V1) não existe, porque nada novo grava V1.
 */
import type {
  ConexaoV1, ConexaoV2, ConexaoV3, ConversaV1, ConversaV2, LoteRevisaoV1, LoteRevisaoV2, ResolucaoV1, ResolucaoV2,
} from './tipos';
import {
  validarConexao, validarConexaoV2, validarConexaoV3, validarConversa, validarConversaV2, validarLoteRevisao, validarLoteRevisaoV2,
  validarResolucao, validarResolucaoV2,
} from './validadores';

/** O autor humano nos contratos atuais. */
export const AUTOR_LEITOR = 'leitor' as const;
export type AutorLeitor = typeof AUTOR_LEITOR;

const trocarAutor = <T extends { autor: string }>(item: T): T => (item.autor === 'pedro' ? { ...item, autor: AUTOR_LEITOR } : item);

export function conversaV1ParaV2(conversa: ConversaV1): ConversaV2 {
  const copia = structuredClone(conversa);
  return { ...copia, versao: 2, mensagens: copia.mensagens.map(trocarAutor) as ConversaV2['mensagens'] };
}
export function conexaoV1ParaV2(conexao: ConexaoV1): ConexaoV2 {
  return { ...trocarAutor(structuredClone(conexao)), versao: 2 } as ConexaoV2;
}
export function resolucaoV1ParaV2(sessao: ResolucaoV1): ResolucaoV2 {
  const copia = structuredClone(sessao);
  return { ...copia, versao: 2, mensagens: copia.mensagens.map(trocarAutor) as ResolucaoV2['mensagens'] };
}
export function loteRevisaoV1ParaV2(lote: LoteRevisaoV1): LoteRevisaoV2 {
  return trocarAutor(structuredClone(lote)) as LoteRevisaoV2;
}

export function lerConversa(valor: unknown): ConversaV2 | null {
  if (validarConversaV2(valor)) return valor;
  return validarConversa(valor) ? conversaV1ParaV2(valor) : null;
}
export function lerConexao(valor: unknown): ConexaoV2 | null {
  if (validarConexaoV2(valor)) return valor;
  return validarConexao(valor) ? conexaoV1ParaV2(valor) : null;
}
export function lerResolucao(valor: unknown): ResolucaoV2 | null {
  if (validarResolucaoV2(valor)) return valor;
  return validarResolucao(valor) ? resolucaoV1ParaV2(valor) : null;
}
export function lerLoteRevisao(valor: unknown): LoteRevisaoV2 | null {
  if (validarLoteRevisaoV2(valor)) return valor;
  return validarLoteRevisao(valor) ? loteRevisaoV1ParaV2(valor) : null;
}

/** V2 → V3: os mesmos campos, `versao: 3` e, se houver, o tipo fino e a origem da compreensão. */
export function conexaoV2ParaV3(conexao: ConexaoV2, extras: Pick<ConexaoV3, 'relacao_semantica' | 'origem_compreensao'> = {}): ConexaoV3 {
  const copia = { ...structuredClone(conexao), versao: 3 } as unknown as ConexaoV3;
  if (extras.relacao_semantica !== undefined) copia.relacao_semantica = extras.relacao_semantica;
  if (extras.origem_compreensao !== undefined) copia.origem_compreensao = { ...extras.origem_compreensao };
  return copia;
}
/** Qualquer versão de conexão lida como V3 (as antigas sem o tipo fino). */
export function lerConexaoV3(valor: unknown): ConexaoV3 | null {
  if (validarConexaoV3(valor)) return valor;
  const v2 = lerConexao(valor);
  return v2 === null ? null : conexaoV2ParaV3(v2);
}
