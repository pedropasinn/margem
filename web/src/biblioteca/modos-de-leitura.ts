import type { ModoDeLeituraV1 } from '@margem/contratos';
const familias: Record<string, string> = {
  argumentativa: 'Geral',
  literaria: 'Literatura', ficcao_narrativa: 'Literatura', dramaturgia: 'Literatura', ensaio_cronica: 'Literatura', critica_literaria: 'Literatura',
  economica: 'Ciência e economia', economia_formal: 'Ciência e economia',
  filosofica: 'Filosofia e matemática', filosofica_comentada: 'Filosofia e matemática', filosofica_dialogica: 'Filosofia e matemática', matematica: 'Filosofia e matemática',
  comunicacao_monetaria: 'Jornalismo e instituições', relatorio_institucional: 'Jornalismo e instituições', jornalistica_factual: 'Jornalismo e instituições', opinativa: 'Jornalismo e instituições', jornalistica_analitica: 'Jornalismo e instituições',
  decisao_judicial: 'Direito', normativa_juridica: 'Direito',
  engenharia_dados: 'Tecnologia', engenharia_software: 'Tecnologia',
};
export function familiaDoModo(id: string): string { return familias[id] ?? 'Outros'; }
/** Só a escolha de uma nova leitura prefere revisões atuais; o catálogo preserva as antigas. */
export function modosParaNovaLeitura(modos: readonly ModoDeLeituraV1[]): ModoDeLeituraV1[] {
  const atuais = new Map<string, ModoDeLeituraV1>();
  for (const modo of modos) if (modo.revisao > (atuais.get(modo.id)?.revisao ?? 0)) atuais.set(modo.id, modo);
  return [...atuais.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

// A consolidação passou pelos contratos; a bancada comparativa com leitores ainda está pendente.
const revisoesEmAvaliacao: Record<string, number> = {
  literaria: 2, ficcao_narrativa: 1, dramaturgia: 1, ensaio_cronica: 1, critica_literaria: 1,
  economica: 2, economia_formal: 1, filosofica: 2, filosofica_comentada: 2, filosofica_dialogica: 1, matematica: 2,
  comunicacao_monetaria: 1, relatorio_institucional: 1, jornalistica_factual: 1, opinativa: 1, jornalistica_analitica: 1,
  decisao_judicial: 1, normativa_juridica: 1,
};
export function modoEmAvaliacao(modo: ModoDeLeituraV1): boolean { return revisoesEmAvaliacao[modo.id] === modo.revisao; }
