import type {
  AncoraV1, ApresentacaoDoPlanoV1, ElementoSemanticoV1, LoteDoModeloV1, ModeloDoCapituloV1, OperacaoDoModeloV1, PerfilDoLeitorV1,
  PlanoPedagogicoV1,
} from './tipos';

/**
 * Invariantes da compreensão (J28, `docs/desenho/10-MODELO-DO-CAPITULO.md` §3) que o JSON Schema não
 * expressa. O que depende do canônico (unidades particionando o capítulo, âncoras que conferem no
 * bloco) fica no serviço.
 */

function unicos(valores: readonly string[]): boolean { return new Set(valores).size === valores.length; }
function ancorasDaVersao(ancoras: readonly AncoraV1[], versaoId: string): boolean {
  return ancoras.every((ancora) => ancora.versao_id === versaoId);
}

export function regrasModeloDoCapitulo(modelo: ModeloDoCapituloV1): boolean {
  const ids = [
    ...modelo.unidades.map((item) => item.id), ...modelo.elementos.map((item) => item.id),
    ...modelo.relacoes.map((item) => item.id), ...modelo.dificuldades.map((item) => item.id),
  ];
  if (!unicos(ids) || ids.includes(modelo.id)) return false;
  const inicial = modelo.revisao === 0;
  if (inicial !== (modelo.estagio === 'analise_local') || inicial !== (modelo.base_id === null) || inicial !== (modelo.lote_id === null)) return false;
  if (modelo.base_id === modelo.id) return false;
  if (!modelo.elementos.every((elemento) => ancorasDaVersao(elemento.ancoras, modelo.versao_id))) return false;
  if (!modelo.dificuldades.every((dificuldade) => ancorasDaVersao(dificuldade.ancoras, modelo.versao_id))) return false;
  const elementos = new Set(modelo.elementos.map((elemento) => elemento.id));
  if (!modelo.relacoes.every((relacao) => relacao.origem_id !== relacao.destino_id
    && elementos.has(relacao.origem_id) && elementos.has(relacao.destino_id))) return false;
  if (!unicos(modelo.unidades.map((unidade) => unidade.bloco_inicio))) return false;
  const unidades = new Set(modelo.unidades.map((unidade) => unidade.id));
  return modelo.movimento === null || modelo.movimento.etapas.every((etapa) => etapa.unidade_ids.every((id) => unidades.has(id)));
}

type Qualquer = Record<string, unknown>;
function objeto(valor: unknown): valor is Qualquer { return typeof valor === 'object' && valor !== null && !Array.isArray(valor); }
function comChaves(valor: unknown, chaves: readonly string[]): valor is Qualquer {
  return objeto(valor) && Object.keys(valor).length === chaves.length && chaves.every((chave) => chave in valor);
}
function ehElemento(valor: unknown): valor is ElementoSemanticoV1 { return objeto(valor) && 'nucleo' in valor && 'ancoras' in valor && 'id' in valor; }
function ehRelacao(valor: unknown): boolean { return objeto(valor) && 'origem_id' in valor && 'destino_id' in valor; }
function ehDificuldade(valor: unknown): boolean { return objeto(valor) && 'descricao' in valor && 'ancoras' in valor && !('nucleo' in valor); }
function mesmoId(valor: unknown, id: string | undefined): boolean { return objeto(valor) && valor.id === id; }

/** Forma de `antes`/`depois` de cada operação; o schema só garante que cada um é uma das formas possíveis. */
export function operacaoCoerente(operacao: OperacaoDoModeloV1): boolean {
  const antes: unknown = operacao.antes;
  const depois: unknown = operacao.depois;
  const alvo = 'alvo_id' in operacao ? operacao.alvo_id : undefined;
  const definir = operacao.op === 'definir_unidades' || operacao.op === 'definir_movimento';
  if (definir !== (alvo === undefined)) return false;
  switch (operacao.op) {
    case 'promover':
    case 'rebaixar': {
      if (!comChaves(antes, ['centralidade']) || !comChaves(depois, ['centralidade'])) return false;
      const de = Number(antes.centralidade);
      const para = Number(depois.centralidade);
      return operacao.op === 'promover' ? para < de : para > de;
    }
    case 'corrigir_papel':
      return comChaves(antes, ['nucleo', 'papel']) && comChaves(depois, ['nucleo', 'papel'])
        && (antes.nucleo !== depois.nucleo || antes.papel !== depois.papel);
    case 'reescrever_enunciado':
      return comChaves(antes, ['enunciado']) && comChaves(depois, ['enunciado']) && antes.enunciado !== depois.enunciado;
    case 'acrescentar_nota':
      return antes === null && comChaves(depois, ['tipo', 'texto']);
    case 'fundir':
      return comChaves(antes, ['absorvidos']) && Array.isArray(antes.absorvidos) && antes.absorvidos.every(ehElemento)
        && !antes.absorvidos.some((elemento) => mesmoId(elemento, alvo)) && comChaves(depois, ['ancoras']);
    case 'adicionar_elemento':
      return antes === null && ehElemento(depois) && mesmoId(depois, alvo);
    case 'remover_elemento':
      return depois === null && ehElemento(antes) && mesmoId(antes, alvo);
    case 'criar_relacao':
      return antes === null && ehRelacao(depois) && mesmoId(depois, alvo);
    case 'remover_relacao':
      return depois === null && ehRelacao(antes) && mesmoId(antes, alvo);
    case 'adicionar_dificuldade':
      return antes === null && ehDificuldade(depois) && mesmoId(depois, alvo);
    case 'remover_dificuldade':
      return depois === null && ehDificuldade(antes) && mesmoId(antes, alvo);
    case 'definir_unidades':
      return Array.isArray(antes) && Array.isArray(depois);
    case 'definir_movimento':
      return (antes === null || comChaves(antes, ['texto', 'etapas'])) && comChaves(depois, ['texto', 'etapas']);
  }
}

export function regrasLoteDoModelo(lote: LoteDoModeloV1): boolean {
  return lote.base_id !== lote.resultado_id
    && lote.operacoes.every((operacao, indice) => operacao.ordem === indice && operacaoCoerente(operacao)
      );
}

export function regrasPlanoPedagogico(plano: PlanoPedagogicoV1): boolean {
  return plano.passos.every((passo, indice) => passo.ordem === indice)
    && unicos(plano.passos.map((passo) => passo.bloco_inicio));
}

export function regrasApresentacao(apresentacao: ApresentacaoDoPlanoV1): boolean {
  return apresentacao.telas.every((tela, indice) => {
    const anterior = apresentacao.telas[indice - 1];
    return anterior === undefined || anterior.passo <= tela.passo;
  });
}

export function regrasPerfil(perfil: PerfilDoLeitorV1): boolean {
  return unicos(perfil.areas.map((area) => area.nome.toLocaleLowerCase('pt-BR')));
}
