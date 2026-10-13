/**
 * Métricas da avaliação (J32, `docs/desenho/10-MODELO-DO-CAPITULO.md` §12). Puras: recebem a referência
 * resolvida e o que uma leitura produziu (marcas e, se houver, as revisões do modelo e os lotes).
 *
 * Um item da referência casa com uma marca ou um elemento quando as âncoras estão no mesmo bloco e se
 * sobrepõem em pelo menos metade da menor. Os vereditos do leitor (`confirmada`/`rejeitada`) medem só
 * precisão; a cobertura dos essenciais, que eles não medem, vem da referência.
 */
import type { AncoraV1, ElementoSemanticoV1, LoteDoModeloV1, MarcaV2, ModeloDoCapituloV1 } from '@margem/contratos';
import type { ItemResolvido, ReferenciaResolvida } from './referencia.js';

export function casam(a: AncoraV1, b: AncoraV1): boolean {
  if (a.bloco_id !== b.bloco_id) return false;
  const sobreposicao = Math.min(a.fim_utf16, b.fim_utf16) - Math.max(a.inicio_utf16, b.inicio_utf16);
  const menor = Math.min(a.fim_utf16 - a.inicio_utf16, b.fim_utf16 - b.inicio_utf16);
  return menor > 0 && sobreposicao * 2 >= menor;
}

function elementoDo(item: ItemResolvido, elementos: readonly ElementoSemanticoV1[]): ElementoSemanticoV1 | undefined {
  return elementos.find((elemento) => elemento.ancoras.some((ancora) => casam(ancora, item.ancora)));
}

export interface Fracao { acertos: number; total: number; valor: number | null; faltando: string[] }
function fracao(acertos: string[], todos: readonly string[]): Fracao {
  return { acertos: acertos.length, total: todos.length, valor: todos.length === 0 ? null : acertos.length / todos.length, faltando: todos.filter((item) => !acertos.includes(item)) };
}

export interface LeituraAvaliada {
  /** Marcas da camada no capítulo. */
  marcas: readonly MarcaV2[];
  /** Revisões do modelo, da r0 à final (vazio numa leitura V2, que não tem modelo). */
  revisoes: readonly ModeloDoCapituloV1[];
  lotes: readonly LoteDoModeloV1[];
}

export interface Metricas {
  cobertura_essenciais_marcas: Fracao;
  cobertura_essenciais_modelo: Fracao | null;
  falsos_positivos: { rotulo: string; marca_id: string }[];
  precisao_vereditos: { confirmadas: number; rejeitadas: number; valor: number | null };
  relacoes: { encontradas: Fracao; mesmo_tipo: Fracao } | null;
  retrospectivas_capturadas: Fracao | null;
  dificuldades_encontradas: Fracao | null;
  mudancas_da_revisao: { uteis: string[]; prejudiciais: string[] } | null;
}

export function medir(referencia: ReferenciaResolvida, leitura: LeituraAvaliada): Metricas {
  const visiveis = leitura.marcas.filter((marca) => marca.visivel && marca.validade === 'resolvida');
  const coberto = (item: ItemResolvido) => visiveis.some((marca) => marca.saliencia <= 2 && casam(marca.ancora, item.ancora));
  const essenciais = referencia.essenciais;
  const final = leitura.revisoes.at(-1);
  const r0 = leitura.revisoes.find((revisao) => revisao.revisao === 0);
  const porRotulo = new Map([...referencia.essenciais, ...referencia.dificuldades, ...referencia.nao_marcar].map((item) => [item.rotulo, item]));

  const falsos = referencia.nao_marcar.flatMap((item) => visiveis.filter((marca) => marca.funcao !== 'nenhuma' && casam(marca.ancora, item.ancora))
    .map((marca) => ({ rotulo: item.rotulo, marca_id: marca.id })));
  const confirmadas = leitura.marcas.filter((marca) => marca.avaliacao === 'confirmada').length;
  const rejeitadas = leitura.marcas.filter((marca) => marca.avaliacao === 'rejeitada').length;

  let relacoes: Metricas['relacoes'] = null;
  let retrospectivas: Fracao | null = null;
  let dificuldades: Fracao | null = null;
  let mudancas: Metricas['mudancas_da_revisao'] = null;
  let coberturaModelo: Fracao | null = null;
  if (final) {
    coberturaModelo = fracao(essenciais.filter((item) => (elementoDo(item, final.elementos)?.centralidade ?? 9) <= 2).map((item) => item.rotulo),
      essenciais.map((item) => item.rotulo));
    const achadas: string[] = [];
    const doMesmoTipo: string[] = [];
    for (const esperada of referencia.relacoes) {
      const chave = `${esperada.origem}->${esperada.destino}`;
      const a = porRotulo.get(esperada.origem);
      const b = porRotulo.get(esperada.destino);
      const ea = a && elementoDo(a, final.elementos);
      const eb = b && elementoDo(b, final.elementos);
      if (!ea || !eb) continue;
      const existentes = final.relacoes.filter((relacao) => (relacao.origem_id === ea.id && relacao.destino_id === eb.id) || (relacao.origem_id === eb.id && relacao.destino_id === ea.id));
      if (existentes.length > 0) achadas.push(chave);
      if (esperada.tipo !== null && existentes.some((relacao) => relacao.tipo === esperada.tipo)) doMesmoTipo.push(chave);
    }
    const chaves = referencia.relacoes.map((item) => `${item.origem}->${item.destino}`);
    relacoes = { encontradas: fracao(achadas, chaves), mesmo_tipo: fracao(doMesmoTipo, referencia.relacoes.filter((item) => item.tipo !== null).map((item) => `${item.origem}->${item.destino}`)) };
    retrospectivas = fracao(referencia.retrospectivas.filter((rotulo) => {
      const item = porRotulo.get(rotulo);
      if (!item) return false;
      const agora = elementoDo(item, final.elementos);
      const antes = r0 ? elementoDo(item, r0.elementos) : undefined;
      return agora?.centralidade === 1 && (antes === undefined || antes.centralidade > 1);
    }), referencia.retrospectivas);
    dificuldades = fracao(referencia.dificuldades.filter((item) => final.dificuldades.some((dificuldade) => dificuldade.ancoras.some((ancora) => casam(ancora, item.ancora))))
      .map((item) => item.rotulo), referencia.dificuldades.map((item) => item.rotulo));
    const revisao = leitura.lotes.find((lote) => lote.estagio === 'revisao');
    if (revisao && r0) {
      const uteis: string[] = [];
      const prejudiciais: string[] = [];
      const base = leitura.revisoes.find((item) => item.id === revisao.base_id) ?? r0;
      for (const operacao of revisao.operacoes) {
        if (!('alvo_id' in operacao) || operacao.alvo_id === undefined) continue;
        const elemento = base.elementos.find((item) => item.id === operacao.alvo_id)
          ?? (operacao.op === 'adicionar_elemento' ? operacao.depois : undefined);
        if (!elemento) continue;
        const essencial = essenciais.find((item) => elemento.ancoras.some((ancora) => casam(ancora, item.ancora)));
        const indesejado = referencia.nao_marcar.find((item) => elemento.ancoras.some((ancora) => casam(ancora, item.ancora)));
        const descricao = `${operacao.op} ${essencial?.rotulo ?? indesejado?.rotulo ?? ''}`.trim();
        if (essencial && ['promover', 'adicionar_elemento'].includes(operacao.op)) uteis.push(descricao);
        else if (essencial && ['rebaixar', 'remover_elemento'].includes(operacao.op)) prejudiciais.push(descricao);
        else if (indesejado && ['rebaixar', 'remover_elemento'].includes(operacao.op)) uteis.push(descricao);
        else if (indesejado && ['promover', 'adicionar_elemento'].includes(operacao.op)) prejudiciais.push(descricao);
      }
      mudancas = { uteis, prejudiciais };
    }
  }
  return {
    cobertura_essenciais_marcas: fracao(essenciais.filter(coberto).map((item) => item.rotulo), essenciais.map((item) => item.rotulo)),
    cobertura_essenciais_modelo: coberturaModelo,
    falsos_positivos: falsos,
    precisao_vereditos: { confirmadas, rejeitadas, valor: confirmadas + rejeitadas === 0 ? null : confirmadas / (confirmadas + rejeitadas) },
    relacoes, retrospectivas_capturadas: retrospectivas, dificuldades_encontradas: dificuldades, mudancas_da_revisao: mudancas,
  };
}

/**
 * Estabilidade entre execuções iguais (três, não duas): Jaccard das marcas de saliência ≤ 2, com o
 * mesmo critério de casamento. Devolve a média e o mínimo dos pares.
 */
export function estabilidade(execucoes: readonly (readonly MarcaV2[])[]): { media: number | null; minimo: number | null; pares: number[] } {
  const conjuntos = execucoes.map((marcas) => marcas.filter((marca) => marca.saliencia <= 2 && marca.visivel).map((marca) => marca.ancora));
  const pares: number[] = [];
  for (let i = 0; i < conjuntos.length; i += 1) {
    for (let j = i + 1; j < conjuntos.length; j += 1) {
      const a = conjuntos[i] ?? [];
      const b = conjuntos[j] ?? [];
      const comuns = a.filter((ancora) => b.some((outra) => casam(ancora, outra))).length;
      const uniao = a.length + b.length - comuns;
      pares.push(uniao === 0 ? 1 : comuns / uniao);
    }
  }
  if (pares.length === 0) return { media: null, minimo: null, pares };
  return { media: pares.reduce((soma, valor) => soma + valor, 0) / pares.length, minimo: Math.min(...pares), pares };
}

function pct(valor: number | null): string { return valor === null ? '—' : `${(valor * 100).toFixed(0)}%`; }
function linhaDe(nome: string, item: Fracao | null): string {
  if (item === null) return `${nome}: — (sem modelo)`;
  return `${nome}: ${pct(item.valor)} (${String(item.acertos)}/${String(item.total)})${item.faltando.length > 0 ? ` · faltam ${item.faltando.join(', ')}` : ''}`;
}

/** Relatório em texto, para o terminal. */
export function relatorio(nome: string, metricas: Metricas): string {
  return [
    `== ${nome}`,
    linhaDe('Cobertura dos essenciais (marcas de saliência ≤ 2)', metricas.cobertura_essenciais_marcas),
    linhaDe('Cobertura dos essenciais (elementos de centralidade ≤ 2)', metricas.cobertura_essenciais_modelo),
    `Falsos positivos (marcas sobre “não deveria marcar”): ${String(metricas.falsos_positivos.length)}${metricas.falsos_positivos.length > 0 ? ` · ${metricas.falsos_positivos.map((item) => item.rotulo).join(', ')}` : ''}`,
    `Precisão pelos seus vereditos: ${pct(metricas.precisao_vereditos.valor)} (${String(metricas.precisao_vereditos.confirmadas)} confirmadas, ${String(metricas.precisao_vereditos.rejeitadas)} rejeitadas)`,
    metricas.relacoes === null ? 'Relações: — (sem modelo)' : `${linhaDe('Relações encontradas', metricas.relacoes.encontradas)}\n${linhaDe('Relações do mesmo tipo', metricas.relacoes.mesmo_tipo)}`,
    linhaDe('Retrospectivas capturadas (r0 periférica → final estrutural)', metricas.retrospectivas_capturadas),
    linhaDe('Dificuldades textuais encontradas', metricas.dificuldades_encontradas),
    metricas.mudancas_da_revisao === null ? 'Mudanças da revisão global: —'
      : `Mudanças da revisão global: ${String(metricas.mudancas_da_revisao.uteis.length)} úteis, ${String(metricas.mudancas_da_revisao.prejudiciais.length)} prejudiciais`
        + `${metricas.mudancas_da_revisao.uteis.length + metricas.mudancas_da_revisao.prejudiciais.length > 0 ? ` (${[...metricas.mudancas_da_revisao.uteis, ...metricas.mudancas_da_revisao.prejudiciais.map((item) => `✗ ${item}`)].join('; ')})` : ''}`,
  ].join('\n');
}
