/**
 * As cinco cores das relações. As mesmas de `.braquetes .cor-N` em `compreensao.css`: mudar uma lá exige
 * mudar aqui. A cor de uma relação vem do id dela (J132), não da posição na lista: a mesma relação tem a
 * mesma cor no texto, no Percorrer, no Caderno e na página do documento, com qualquer filtro.
 */
export const CORES_DAS_RELACOES = ['#d4524a', '#e08a26', '#2f9e8f', '#7c63cc', '#3a82c4'] as const;

/** O índice (0 a 4) da cor de uma relação: um hash estável do id (FNV-1a de 32 bits). */
export function indiceDaCorDaRelacao(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { hash ^= id.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash % CORES_DAS_RELACOES.length;
}

export function corDaRelacao(id: string): string {
  return CORES_DAS_RELACOES[indiceDaCorDaRelacao(id)]!;
}
