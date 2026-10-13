import { conteudosIguais } from './igualdade';
/**
 * Núcleo puro da compreensão do capítulo (J28, `docs/desenho/10-MODELO-DO-CAPITULO.md` §3–§4).
 *
 * - `TabelaDeAliases`: o que o modelo vê no lugar de ids (`B001`, `L01`, `R01`…). O modelo só repete
 *   aliases que recebeu; o serviço traduz de volta e gera os ULIDs.
 * - `aplicarOperacoes`: de uma revisão imutável do modelo e um lote de operações, a revisão seguinte.
 * - `particionarPorInicios`: unidades e passos chegam só com o bloco de início; daqui saem faixas que
 *   cobrem o capítulo inteiro, em ordem, sem sobreposição.
 */
import type {
  ElementoSemanticoV1, EstagioDoModelo, Id, ModeloDoCapituloV1, OperacaoDoModeloV1, RelacaoSemanticaV1,
} from '@margem/contratos';

export class TabelaDeAliases {
  private readonly porAlias = new Map<string, Id>();
  private readonly porId = new Map<Id, string>();

  constructor(private readonly prefixo: string, private readonly largura: number) {}

  /** Registra o id e devolve o alias; registrar de novo devolve o mesmo alias. */
  registrar(id: Id): string {
    const existente = this.porId.get(id);
    if (existente !== undefined) return existente;
    const alias = `${this.prefixo}${String(this.porAlias.size + 1).padStart(this.largura, '0')}`;
    this.porAlias.set(alias, id);
    this.porId.set(id, alias);
    return alias;
  }

  alias(id: Id): string | undefined { return this.porId.get(id); }
  id(alias: string): Id | undefined { return this.porAlias.get(alias); }
  get tamanho(): number { return this.porAlias.size; }
  /** Para gravar na auditoria (`aliases.json`). */
  entradas(): { alias: string; id: Id }[] { return [...this.porAlias].map(([alias, id]) => ({ alias, id })); }
}

/** Tabelas de um prompt da compreensão. */
export interface AliasesDoPrompt {
  blocos: TabelaDeAliases;
  elementos: TabelaDeAliases;
  relacoes: TabelaDeAliases;
  dificuldades: TabelaDeAliases;
  unidades: TabelaDeAliases;
}

export function novosAliases(): AliasesDoPrompt {
  return {
    blocos: new TabelaDeAliases('B', 3), elementos: new TabelaDeAliases('L', 2), relacoes: new TabelaDeAliases('R', 2),
    dificuldades: new TabelaDeAliases('D', 2), unidades: new TabelaDeAliases('U', 1),
  };
}

export function aliasesParaAuditoria(aliases: AliasesDoPrompt): Record<keyof AliasesDoPrompt, { alias: string; id: Id }[]> {
  return {
    blocos: aliases.blocos.entradas(), elementos: aliases.elementos.entradas(), relacoes: aliases.relacoes.entradas(),
    dificuldades: aliases.dificuldades.entradas(), unidades: aliases.unidades.entradas(),
  };
}

/**
 * Faixas contíguas a partir dos inícios. `ordem` é a lista completa de blocos do capítulo, em ordem.
 * Inícios fora do capítulo são ignorados (e listados); o primeiro bloco sempre abre a primeira faixa.
 */
export function particionarPorInicios<T extends { inicio: Id }>(
  ordem: readonly Id[], itens: readonly T[],
): { faixas: (T & { bloco_inicio: Id; bloco_fim: Id })[]; ignorados: T[]; primeiro_ajustado: boolean } {
  const posicao = new Map(ordem.map((id, indice) => [id, indice]));
  const ignorados: T[] = [];
  const validos: { item: T; indice: number }[] = [];
  const vistos = new Set<number>();
  for (const item of itens) {
    const indice = posicao.get(item.inicio);
    if (indice === undefined || vistos.has(indice)) { ignorados.push(item); continue; }
    vistos.add(indice);
    validos.push({ item, indice });
  }
  validos.sort((a, b) => a.indice - b.indice);
  let primeiroAjustado = false;
  const primeiro = validos[0];
  if (primeiro && primeiro.indice !== 0) { primeiro.indice = 0; primeiroAjustado = true; }
  const faixas = validos.map(({ item, indice }, i) => {
    const proximo = validos[i + 1];
    const fim = proximo === undefined ? ordem.length - 1 : proximo.indice - 1;
    return { ...item, bloco_inicio: ordem[indice] ?? '', bloco_fim: ordem[fim] ?? '' };
  });
  return { faixas, ignorados, primeiro_ajustado: primeiroAjustado };
}

export class OperacaoInaplicavel extends Error {
  constructor(public readonly ordem: number, mensagem: string) {
    super(`Operação ${String(ordem)}: ${mensagem}`);
    this.name = 'OperacaoInaplicavel';
  }
}

export interface DadosDaRevisao {
  id: Id;
  estagio: Exclude<EstagioDoModelo, 'analise_local'>;
  lote_id: Id;
  criada_em: string;
}

function semRelacoesDe(relacoes: RelacaoSemanticaV1[], ids: ReadonlySet<Id>): RelacaoSemanticaV1[] {
  return relacoes.filter((relacao) => !ids.has(relacao.origem_id) && !ids.has(relacao.destino_id));
}

/** Redireciona para `alvo` as relações que apontavam para elementos absorvidos, sem laços nem repetição. */
function redirecionar(relacoes: RelacaoSemanticaV1[], absorvidos: ReadonlySet<Id>, alvo: Id): RelacaoSemanticaV1[] {
  const vistas = new Set<string>();
  const saida: RelacaoSemanticaV1[] = [];
  for (const relacao of relacoes) {
    const origem = absorvidos.has(relacao.origem_id) ? alvo : relacao.origem_id;
    const destino = absorvidos.has(relacao.destino_id) ? alvo : relacao.destino_id;
    if (origem === destino) continue;
    const chave = `${relacao.tipo}|${origem}|${destino}`;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    saida.push({ ...relacao, origem_id: origem, destino_id: destino });
  }
  return saida;
}

/**
 * A revisão seguinte. A base não é tocada (revisões são imutáveis). Uma operação que não se aplica
 * (alvo inexistente, `antes` que não confere) lança `OperacaoInaplicavel`: o serviço confere antes de
 * montar o lote, então isto só dispara por erro de programação.
 */
export function aplicarOperacoes(
  base: ModeloDoCapituloV1, operacoes: readonly OperacaoDoModeloV1[], dados: DadosDaRevisao,
): ModeloDoCapituloV1 {
  const modelo: ModeloDoCapituloV1 = structuredClone(base);
  const elemento = (ordem: number, id: Id): ElementoSemanticoV1 => {
    const achado = modelo.elementos.find((item) => item.id === id);
    if (!achado) throw new OperacaoInaplicavel(ordem, `elemento ${id} inexistente`);
    return achado;
  };
  for (const operacao of operacoes) {
    const { ordem } = operacao;
    const exigirAntes = (atual: unknown, antes: unknown): void => {
      if (!conteudosIguais(atual, antes)) throw new OperacaoInaplicavel(ordem, 'estado anterior não confere');
    };
    switch (operacao.op) {
      case 'corrigir_papel': {
        const alvo = elemento(ordem, operacao.alvo_id);
        exigirAntes({ nucleo: alvo.nucleo, papel: alvo.papel }, operacao.antes); break;
      }
      case 'reescrever_enunciado': exigirAntes({ enunciado: elemento(ordem, operacao.alvo_id).enunciado }, operacao.antes); break;
      case 'remover_elemento': exigirAntes(elemento(ordem, operacao.alvo_id), operacao.antes); break;
      case 'remover_relacao': exigirAntes(modelo.relacoes.find(r => r.id === operacao.alvo_id), operacao.antes); break;
      case 'remover_dificuldade': exigirAntes(modelo.dificuldades.find(d => d.id === operacao.alvo_id), operacao.antes); break;
      case 'fundir': operacao.antes.absorvidos.forEach(e => exigirAntes(elemento(ordem, e.id), e)); break;
      case 'definir_unidades': exigirAntes(modelo.unidades, operacao.antes); break;
      case 'definir_movimento': exigirAntes(modelo.movimento, operacao.antes); break;
    }
    switch (operacao.op) {
      case 'promover':
      case 'rebaixar': {
        const alvo = elemento(ordem, operacao.alvo_id);
        if (alvo.centralidade !== operacao.antes.centralidade) throw new OperacaoInaplicavel(ordem, 'centralidade anterior não confere');
        alvo.centralidade = operacao.depois.centralidade;
        break;
      }
      case 'corrigir_papel': {
        const alvo = elemento(ordem, operacao.alvo_id);
        alvo.nucleo = operacao.depois.nucleo;
        alvo.papel = operacao.depois.papel;
        break;
      }
      case 'reescrever_enunciado':
        elemento(ordem, operacao.alvo_id).enunciado = operacao.depois.enunciado;
        break;
      case 'acrescentar_nota':
        elemento(ordem, operacao.alvo_id).notas.push(structuredClone(operacao.depois));
        break;
      case 'fundir': {
        const alvo = elemento(ordem, operacao.alvo_id);
        const absorvidos = new Set(operacao.antes.absorvidos.map((item) => item.id));
        for (const id of absorvidos) elemento(ordem, id);
        alvo.ancoras = structuredClone(operacao.depois.ancoras);
        modelo.elementos = modelo.elementos.filter((item) => !absorvidos.has(item.id));
        modelo.relacoes = redirecionar(modelo.relacoes, absorvidos, alvo.id);
        break;
      }
      case 'adicionar_elemento':
        if (modelo.elementos.some((item) => item.id === operacao.alvo_id)) throw new OperacaoInaplicavel(ordem, 'elemento já existe');
        modelo.elementos.push(structuredClone(operacao.depois));
        break;
      case 'remover_elemento':
        elemento(ordem, operacao.alvo_id);
        modelo.elementos = modelo.elementos.filter((item) => item.id !== operacao.alvo_id);
        modelo.relacoes = semRelacoesDe(modelo.relacoes, new Set([operacao.alvo_id]));
        break;
      case 'criar_relacao':
        elemento(ordem, operacao.depois.origem_id);
        elemento(ordem, operacao.depois.destino_id);
        modelo.relacoes.push(structuredClone(operacao.depois));
        break;
      case 'remover_relacao':
        if (!modelo.relacoes.some((item) => item.id === operacao.alvo_id)) throw new OperacaoInaplicavel(ordem, 'relação inexistente');
        modelo.relacoes = modelo.relacoes.filter((item) => item.id !== operacao.alvo_id);
        break;
      case 'adicionar_dificuldade':
        modelo.dificuldades.push(structuredClone(operacao.depois));
        break;
      case 'remover_dificuldade':
        if (!modelo.dificuldades.some((item) => item.id === operacao.alvo_id)) throw new OperacaoInaplicavel(ordem, 'dificuldade inexistente');
        modelo.dificuldades = modelo.dificuldades.filter((item) => item.id !== operacao.alvo_id);
        break;
      case 'definir_unidades':
        modelo.unidades = structuredClone(operacao.depois);
        if (modelo.movimento) {
          const unidades = new Set(modelo.unidades.map((unidade) => unidade.id));
          modelo.movimento.etapas = modelo.movimento.etapas
            .map((etapa) => ({ ...etapa, unidade_ids: etapa.unidade_ids.filter((id) => unidades.has(id)) }))
            .filter((etapa) => etapa.unidade_ids.length > 0);
        }
        break;
      case 'definir_movimento':
        modelo.movimento = structuredClone(operacao.depois);
        break;
    }
  }
  return {
    ...modelo, id: dados.id, revisao: base.revisao + 1, estagio: dados.estagio,
    base_id: base.id, lote_id: dados.lote_id, criada_em: dados.criada_em,
  };
}

/** Elementos cujas âncoras tocam algum dos blocos. */
export function elementosNosBlocos(modelo: Pick<ModeloDoCapituloV1, 'elementos'>, blocos: ReadonlySet<Id>): ElementoSemanticoV1[] {
  return modelo.elementos.filter((item) => item.ancoras.some((ancora) => blocos.has(ancora.bloco_id)));
}

/** Reconstrói as tabelas de um prompt a partir do que foi gravado (`aliasesParaAuditoria`). */
export function aliasesDeEntradas(entradas: Record<keyof AliasesDoPrompt, readonly { alias: string; id: Id }[]>): AliasesDoPrompt {
  const aliases = novosAliases();
  for (const chave of Object.keys(aliases) as (keyof AliasesDoPrompt)[]) {
    for (const { alias, id } of entradas[chave]) {
      const obtido = aliases[chave].registrar(id);
      if (obtido !== alias) throw new Error(`Tabela de aliases gravada fora de ordem: ${alias} ≠ ${obtido}.`);
    }
  }
  return aliases;
}
