import type { AfirmacaoDaObra, FonteDaObra, ModeloDaObraV1, TemaDaObra, TipoDeAfirmacaoDaObra } from '@margem/contratos';

export const ROTULO_DO_TIPO: Record<TipoDeAfirmacaoDaObra, string> = {
  observacao: 'Observação', fato: 'Fato documentado', interpretacao_documentada: 'Interpretação documentada',
  inferencia_ia: 'Inferência da IA', intencao_desconhecida: 'Intenção não documentada',
};
export const ROTULO_DA_CONFIANCA: Record<AfirmacaoDaObra['confianca'], string> = {
  alta: 'confiança alta', media: 'confiança média', baixa: 'confiança baixa', nao_aplicavel: 'sem grau de certeza',
};
export const ROTULO_DO_TEMA: Record<TemaDaObra, string> = {
  composicao: 'Composição', iconografia: 'Iconografia', tecnica: 'Técnica', historia: 'História', artista: 'Artista',
  contexto: 'Contexto', interpretacoes: 'Interpretações', obras_relacionadas: 'Obras relacionadas',
};
export const ROTULO_DA_CATEGORIA: Record<FonteDaObra['categoria'], string> = {
  instituicao_proprietaria: 'Instituição proprietária', museu: 'Museu', catalogo: 'Catálogo', academica: 'Acadêmica', arquivo: 'Arquivo',
  leilao: 'Leilão', google_arts: 'Google Arts & Culture', secundaria: 'Secundária', popular: 'Popular',
};
const ORDEM_DOS_TEMAS = Object.keys(ROTULO_DO_TEMA) as TemaDaObra[];

export interface GrupoDeAfirmacoes { chave: string; titulo: string; afirmacoes: AfirmacaoDaObra[] }

/** As afirmações por dimensão de estudo (na ordem dos temas); as que não estão em nenhum grupo vão para "Identificação e outras". */
export function agruparAfirmacoes(modelo: ModeloDaObraV1): GrupoDeAfirmacoes[] {
  const porId = new Map(modelo.afirmacoes.map((a) => [a.id, a]));
  const usadas = new Set<string>();
  const grupos: GrupoDeAfirmacoes[] = [];
  for (const tema of ORDEM_DOS_TEMAS) {
    const ids = modelo.estudo.filter((e) => e.tema === tema).flatMap((e) => e.afirmacoes);
    const afirmacoes = [...new Set(ids)].map((id) => porId.get(id)).filter((a): a is AfirmacaoDaObra => a !== undefined);
    if (!afirmacoes.length) continue;
    afirmacoes.forEach((a) => usadas.add(a.id));
    grupos.push({ chave: tema, titulo: ROTULO_DO_TEMA[tema], afirmacoes });
  }
  const resto = modelo.afirmacoes.filter((a) => !usadas.has(a.id));
  if (resto.length) grupos.push({ chave: 'outras', titulo: grupos.length ? 'Identificação e outras' : 'Afirmações', afirmacoes: resto });
  return grupos;
}

/** A ordem do Percorrer: a da aba Análise, sem repetir. */
export function afirmacoesEmOrdem(modelo: ModeloDaObraV1): AfirmacaoDaObra[] {
  const vistas = new Set<string>();
  return agruparAfirmacoes(modelo).flatMap((g) => g.afirmacoes).filter((a) => (vistas.has(a.id) ? false : (vistas.add(a.id), true)));
}
