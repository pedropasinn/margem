import type { AncoraV1, Bloco, CanonicoV1, Id } from '@margem/contratos';
import { conferirTextoAncora } from '@margem/contratos/texto';
import { resolverCitacao } from './ancoras';
export interface CanonicoDaVersao { id: Id; canonico: CanonicoV1 }
export interface ComparacaoDeVersoes {
  mesmo_original: boolean;
  blocos_iguais: number;
  sem_par_antes: Bloco[];
  sem_par_depois: Bloco[];
}
/** Comparação literal por multiconjunto; sem par não significa conteúdo perdido.
 * Mudanças de segmentação aparecem dos dois lados para revisão, sem casamento aproximado.
 */
export function compararCanonicos(antes: CanonicoV1, depois: CanonicoV1): ComparacaoDeVersoes {
  const chave = (b: Bloco): string => `${b.tipo}\0${b.texto}`;
  const disponiveis = new Map<string, number>();
  for (const b of depois.blocos) disponiveis.set(chave(b), (disponiveis.get(chave(b)) ?? 0) + 1);
  const consumidos = new Map<string, number>();
  const semPar: Bloco[] = [];
  let iguais = 0;
  for (const b of antes.blocos) {
    const k = chave(b), n = disponiveis.get(k) ?? 0;
    if (n > 0) { disponiveis.set(k, n - 1); consumidos.set(k, (consumidos.get(k) ?? 0) + 1); iguais++; }
    else semPar.push(b);
  }
  const novos = depois.blocos.filter(b => {
    const k = chave(b), n = consumidos.get(k) ?? 0;
    if (n > 0) { consumidos.set(k, n - 1); return false; }
    return true;
  });
  return { mesmo_original: antes.documento.sha256_original === depois.documento.sha256_original,
    blocos_iguais: iguais, sem_par_antes: semPar, sem_par_depois: novos };
}
export type PropostaDeAncora =
  | { tipo: 'proposta'; ancora: AncoraV1; criterio: 'citacao_e_contexto' | 'citacao_literal'; exige_confirmacao: true }
  | { tipo: 'ambigua'; ocorrencias: number; blocos: Id[] }
  | { tipo: 'recusada'; motivo: 'fonte_diferente' | 'origem_invalida' | 'citacao_ausente' };
/** Não muda anotações. Só propõe migração entre canonizações do mesmo original. */
export function proporAncoraEntreVersoes(ancora: AncoraV1, antes: CanonicoDaVersao, depois: CanonicoDaVersao): PropostaDeAncora {
  if (antes.canonico.documento.sha256_original !== depois.canonico.documento.sha256_original) return { tipo: 'recusada', motivo: 'fonte_diferente' };
  const original = antes.canonico.blocos.find(b => b.id === ancora.bloco_id);
  if (ancora.versao_id !== antes.id || !original || !conferirTextoAncora(original, ancora)) return { tipo: 'recusada', motivo: 'origem_invalida' };
  for (const criterio of ['citacao_e_contexto', 'citacao_literal'] as const) {
    let ocorrencias = 0;
    const blocos: Id[] = [];
    let proposta: AncoraV1 | undefined;
    for (const bloco of depois.canonico.blocos) {
      const r = resolverCitacao({ ...bloco, versao_id: depois.id }, { citacao: ancora.citacao,
        prefixo: criterio === 'citacao_e_contexto' ? ancora.prefixo : '', sufixo: criterio === 'citacao_e_contexto' ? ancora.sufixo : '' });
      if (r.ok) { ocorrencias++; blocos.push(bloco.id); proposta = r.ancora; }
      else if (r.motivo === 'ambigua') { ocorrencias += r.ocorrencias; blocos.push(bloco.id); }
    }
    if (ocorrencias > 1) return { tipo: 'ambigua', ocorrencias, blocos };
    if (proposta) return { tipo: 'proposta', ancora: proposta, criterio, exige_confirmacao: true };
  }
  return { tipo: 'recusada', motivo: 'citacao_ausente' };
}
