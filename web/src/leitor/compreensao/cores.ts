/**
 * As cinco cores das relações, na ordem do capítulo (a relação n tem a cor n % 5). As mesmas de
 * `.braquetes .cor-N` em `compreensao.css`: mudar uma lá exige mudar aqui. Usadas fora dos braquetes
 * (Percorrer, página do documento) para a relação ter a mesma cor em todo lugar.
 */
export const CORES_DAS_RELACOES = ['#d4524a', '#e08a26', '#2f9e8f', '#7c63cc', '#3a82c4'] as const;

export function corDaRelacao(indiceNoCapitulo: number): string {
  return CORES_DAS_RELACOES[indiceNoCapitulo % CORES_DAS_RELACOES.length]!;
}
