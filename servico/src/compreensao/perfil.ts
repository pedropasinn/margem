import { createHash } from 'node:crypto';
import type { PerfilDoLeitorV1 } from '@margem/contratos';
const sha = (texto: string): string => createHash('sha256').update(texto, 'utf8').digest('hex');
export const RECEITA_PERFIL = 'perfil-plano@2';
/** Projeção do conteúdo que chega ao prompt; ordem das listas e Unicode são preservados. */
export function conteudoDoPerfil(perfil: PerfilDoLeitorV1 | null) {
  return { areas: perfil?.areas.map(({ nome, nivel }) => ({ nivel, nome })) ?? [],
    observacoes: perfil?.observacoes.trim() ?? '', preferencias: perfil?.preferencias ?? [] };
}
export function hashDoPerfil(perfil: PerfilDoLeitorV1 | null): string {
  return sha(`${RECEITA_PERFIL}\n${JSON.stringify(conteudoDoPerfil(perfil))}`);
}
/** Receita histórica exata; necessária para jobs e planos imutáveis já gravados. */
export function hashLegadoDoPerfil(perfil: PerfilDoLeitorV1 | null): string {
  const base = perfil === null ? { areas: [], preferencias: [], observacoes: '' }
    : { areas: perfil.areas.map(area => ({ nivel: area.nivel, nome: area.nome })), observacoes: perfil.observacoes, preferencias: perfil.preferencias };
  return sha(JSON.stringify(base));
}
const vazio: PerfilDoLeitorV1 = { versao: 1, revisao: 0, areas: [], preferencias: [], observacoes: '', atualizado_em: '2026-01-01T00:00:00Z' };
export function hashesDoPerfil(perfil: PerfilDoLeitorV1 | null): string[] {
  const atual = hashDoPerfil(perfil);
  return [...new Set([atual, hashLegadoDoPerfil(perfil), ...(atual === hashDoPerfil(null) ? [hashLegadoDoPerfil(null), hashLegadoDoPerfil(vazio)] : [])])];
}
