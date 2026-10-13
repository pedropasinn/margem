import { conteudosIguais } from './igualdade';
/** Conferência contextual pura: recebe a versão carregada; não consulta banco. */
import type { CanonicoV1, ExecucaoCompreensaoV1, Local, LoteDoModeloV1, ModeloDoCapituloV1, ResultadoContrato } from '@margem/contratos';
import { conferirTextoAncora } from '@margem/contratos/texto';
import { aplicarOperacoes } from './compreensao';

const referencias: unique symbol = Symbol('referencias do modelo');
const conferido: unique symbol = Symbol('modelo conferido');
export interface ModeloReferenciado {
  readonly modelo: Local<ModeloDoCapituloV1>;
  readonly blocos: ReadonlyMap<string, CanonicoV1['blocos'][number]>;
  readonly ordem: readonly string[];
  readonly [referencias]: true;
}
export type ModeloConferido = ModeloReferenciado & { readonly [conferido]: true };
const falha = (codigo: string, mensagem: string, caminho: (string | number)[] = []): ResultadoContrato<never> =>
  ({ ok: false, erros: [{ codigo, mensagem, caminho }] });

export function resolverReferenciasDoModelo(modelo: Local<ModeloDoCapituloV1>, execucao: ExecucaoCompreensaoV1,
  canonico: CanonicoV1): ResultadoContrato<ModeloReferenciado> {
  if (modelo.execucao_id !== execucao.id || modelo.versao_id !== execucao.versao_id
    || modelo.modo.id !== execucao.modo.id || modelo.modo.revisao !== execucao.modo.revisao) {
    return falha('execucao_divergente', 'Modelo, versão e modo precisam pertencer à execução.');
  }
  const secao = canonico.secoes.find(s => s.id === modelo.secao_id && s.nivel === 1);
  if (!secao) return falha('secao_ausente', 'Capítulo fora do canônico.', ['secao_id']);
  const inicio = canonico.blocos.findIndex(b => b.id === secao.bloco_inicio);
  const fim = canonico.blocos.findIndex(b => b.id === secao.bloco_fim);
  if (inicio < 0 || fim < inicio) return falha('secao_invalida', 'Faixa do capítulo inválida.');
  const blocos = new Map(canonico.blocos.slice(inicio, fim + 1).map(b => [b.id, b]));
  for (const [grupo, itens] of [['elementos', modelo.elementos], ['dificuldades', modelo.dificuldades]] as const) {
    for (const [i, item] of itens.entries()) for (const [j, ancora] of item.ancoras.entries()) {
      if (!blocos.has(ancora.bloco_id)) return falha('bloco_fora_do_capitulo', 'Âncora fora do capítulo.', [grupo, i, 'ancoras', j, 'bloco_id']);
    }
  }
  return { ok: true, valor: { modelo, blocos, ordem: [...blocos.keys()], [referencias]: true } };
}

export function conferirModeloNoCanonico(referenciado: ModeloReferenciado): ResultadoContrato<ModeloConferido> {
  const { modelo, blocos, ordem } = referenciado;
  for (const [grupo, itens] of [['elementos', modelo.elementos], ['dificuldades', modelo.dificuldades]] as const) {
    for (const [i, item] of itens.entries()) for (const [j, ancora] of item.ancoras.entries()) {
      const bloco = blocos.get(ancora.bloco_id);
      if (!bloco || !conferirTextoAncora(bloco, ancora)) return falha('citacao_divergente', 'Citação ou contexto diverge do canônico.', [grupo, i, 'ancoras', j]);
    }
  }
  let proximo = 0;
  for (const [i, unidade] of modelo.unidades.entries()) {
    const inicio = ordem.indexOf(unidade.bloco_inicio), fim = ordem.indexOf(unidade.bloco_fim);
    if (inicio !== proximo || fim < inicio) return falha('unidades_nao_particionam', 'Unidades precisam particionar o capítulo em ordem.', ['unidades', i]);
    proximo = fim + 1;
  }
  if (modelo.estagio !== 'analise_local' && proximo !== ordem.length) return falha('unidades_incompletas', 'Unidades não cobrem o capítulo.', ['unidades']);
  return { ok: true, valor: { ...referenciado, [conferido]: true } };
}

/** Permissão relativa à base imutável carregada. O serviço confere a revisão vigente sob lock. */
export function conferirEvolucaoDoModelo(atual: ModeloConferido, base: ModeloDoCapituloV1 | null,
  lote: Local<LoteDoModeloV1> | null): ResultadoContrato<ModeloConferido> {
  const m = atual.modelo;
  if (m.revisao === 0) return base === null && lote === null ? { ok: true, valor: atual }
    : falha('base_inesperada', 'Revisão inicial não recebe base ou lote.');
  if (!base || !lote || m.base_id !== base.id || m.lote_id !== lote.id || lote.base_id !== base.id || lote.resultado_id !== m.id
    || base.execucao_id !== m.execucao_id || base.versao_id !== m.versao_id || base.secao_id !== m.secao_id
    || lote.execucao_id !== m.execucao_id || lote.secao_id !== m.secao_id || lote.estagio !== m.estagio
    || m.revisao !== base.revisao + 1) return falha('base_lote_divergentes', 'Base, lote e resultado incompatíveis.');
  if (Date.parse(m.criada_em) < Date.parse(base.criada_em)) return falha('revisao_anterior', 'Revisão anterior à base.');
  for (const [i, op] of lote.operacoes.entries()) for (const [j, evidencia] of op.evidencia.entries()) {
    const bloco = atual.blocos.get(evidencia.bloco_id);
    if (evidencia.versao_id !== m.versao_id || !bloco || !conferirTextoAncora(bloco, evidencia)) {
      return falha('evidencia_divergente', 'Evidência fora do capítulo ou incompatível com o canônico.', ['operacoes', i, 'evidencia', j]);
    }
  }
  try {
    // Clone próprio: aplicarOperacoes só recebe dados locais já conferidos.
    const operacoes = structuredClone(lote.operacoes) as LoteDoModeloV1['operacoes'];
    const resultado = aplicarOperacoes(base, operacoes, { id: m.id, estagio: lote.estagio, lote_id: lote.id, criada_em: m.criada_em });
    return conteudosIguais(resultado, m) ? { ok: true, valor: atual } : falha('resultado_divergente', 'O lote não produz o modelo recebido.');
  } catch (erro) { return falha('operacao_inaplicavel', erro instanceof Error ? erro.message : 'Operação inaplicável.'); }
}
