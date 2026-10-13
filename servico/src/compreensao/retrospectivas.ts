/**
 * Retrospectivas derivadas pela ordem dos blocos (J76). O modelo marcava `retrospectiva` em 19% das relações
 * que a bancada-50 esperava; a ordem do texto já diz quando o fim volta ao começo. O serviço marca como
 * retrospectiva a relação cuja origem vem bem depois do destino; nunca desmarca o que o modelo marcou.
 */
import type { Id, ModeloDoCapituloV1, RelacaoSemanticaV1 } from '@margem/contratos';

/**
 * Quantos blocos a origem precisa estar depois do destino. Tipos que costumam apontar para trás sem ser
 * retomada (quem suporta, desenvolve ou exemplifica uma tese anterior) precisam de distância maior.
 * Calibrado nos 35 textos de ajuste da bancada-50 (J76): retrospectivas esperadas achadas 17% → 51%,
 * relações não retrospectivas marcadas como tais 0% → 6%.
 */
export const DISTANCIA_RETROSPECTIVA = { volta: 3, outras: 5 } as const;
const TIPOS_QUE_VOLTAM = new Set<RelacaoSemanticaV1['tipo']>(['pressupoe', 'retoma', 'ecoa', 'tensiona', 'contrasta', 'responde']);

/** `blocoDaOrigem`/`blocoDoDestino`: posição do bloco da âncora principal de cada ponta na ordem do capítulo. */
export function retrospectivaPelaOrdem(tipo: RelacaoSemanticaV1['tipo'], blocoDaOrigem: number | undefined, blocoDoDestino: number | undefined): boolean {
  if (blocoDaOrigem === undefined || blocoDoDestino === undefined) return false;
  const minimo = TIPOS_QUE_VOLTAM.has(tipo) ? DISTANCIA_RETROSPECTIVA.volta : DISTANCIA_RETROSPECTIVA.outras;
  return blocoDaOrigem - blocoDoDestino >= minimo;
}

/** O modelo com as retrospectivas derivadas (para a reprojeção offline e para modelos anteriores ao J76). */
export function derivarRetrospectivas(modelo: ModeloDoCapituloV1, ordemDosBlocos: readonly Id[]): ModeloDoCapituloV1 {
  const posicao = new Map(ordemDosBlocos.map((id, indice) => [id, indice]));
  const blocoDe = new Map(modelo.elementos.map((elemento) => [elemento.id, posicao.get(elemento.ancoras[0]?.bloco_id ?? '')]));
  let mudou = false;
  const relacoes = modelo.relacoes.map((relacao) => {
    if (relacao.retrospectiva || !retrospectivaPelaOrdem(relacao.tipo, blocoDe.get(relacao.origem_id), blocoDe.get(relacao.destino_id))) return relacao;
    mudou = true;
    return { ...relacao, retrospectiva: true };
  });
  return mudou ? { ...modelo, relacoes } : modelo;
}
