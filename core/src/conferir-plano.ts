import type { Bloco, ModeloDoCapituloV1, PlanoPedagogicoV1, ResultadoContrato } from '@margem/contratos';

/** Recebe valores locais e os blocos do capítulo carregado pelo serviço.
 * Confere a revisão exata e referências; não escolhe a revisão vigente nem consulta persistência.
 */
export function conferirPlanoNoModelo(plano: PlanoPedagogicoV1, modelo: ModeloDoCapituloV1 | null,
  blocos: readonly Pick<Bloco, 'id'>[]): ResultadoContrato<ModeloDoCapituloV1> {
  const falha = (codigo: string, caminho: (string | number)[]): ResultadoContrato<never> =>
    ({ ok: false, erros: [{ codigo, caminho, mensagem: 'O plano não corresponde ao modelo e ao capítulo carregados.' }] });
  if (!modelo || plano.modelo_id !== modelo.id) return falha('modelo_divergente', ['modelo_id']);
  if (plano.execucao_id !== modelo.execucao_id) return falha('execucao_divergente', ['execucao_id']);
  if (plano.secao_id !== modelo.secao_id) return falha('secao_divergente', ['secao_id']);
  const ordem = new Map(blocos.map((b, i) => [b.id, i]));
  const elementos = new Set(modelo.elementos.map(e => e.id));
  const relacoes = new Set(modelo.relacoes.map(r => r.id));
  const alvos = new Set([...elementos, ...modelo.dificuldades.map(d => d.id)]);
  for (const [i, passo] of plano.passos.entries()) {
    const inicio = ordem.get(passo.bloco_inicio), fim = ordem.get(passo.bloco_fim);
    if (inicio === undefined || fim === undefined || fim < inicio) return falha('faixa_fora_do_capitulo', ['passos', i]);
    for (const [j, id] of passo.foco.entries()) if (!elementos.has(id)) return falha('foco_ausente', ['passos', i, 'foco', j]);
    for (const [j, id] of passo.relacoes.entries()) if (!relacoes.has(id)) return falha('relacao_ausente', ['passos', i, 'relacoes', j]);
  }
  for (const [i, apoio] of plano.apoios.entries()) if (!alvos.has(apoio.alvo_id)) return falha('apoio_ausente', ['apoios', i, 'alvo_id']);
  return { ok: true, valor: modelo };
}
