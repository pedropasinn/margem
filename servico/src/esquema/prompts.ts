/**
 * Prompt do esquema do capítulo (`esquema-capitulo@2`), função pura: o modelo da compreensão vira
 * um texto compacto com apelidos curtos (`U1` para as unidades, `E1` para os elementos, na ordem do
 * texto). O modelo nunca vê nem cria ids: responde com os apelidos, e o serviço os traduz.
 */
import type { Bloco, ElementoSemanticoV1, Id, ModeloDoCapituloV1 } from '@margem/contratos';
import { cercar, corpoDoModelo, ehObjeto, lerPrompt, preencher, type SchemaJson } from '../leitura/v2/prompt.js';

export const VERSAO_PROMPT_ESQUEMA = 'esquema-capitulo@2';

export interface ContextoDoEsquema { documento: string; capitulo: string; modo: string }
export interface Correcao { erro: string }

/** Apelido → id real (elementos). */
export interface ApelidosDoModelo { elementos: Map<string, ElementoSemanticoV1>; unidades: Map<Id, string> }

/** Os elementos na ordem do texto (bloco da âncora principal, depois o início dela). */
export function elementosEmOrdem(modelo: ModeloDoCapituloV1, blocos: readonly Pick<Bloco, 'id'>[]): ElementoSemanticoV1[] {
  const posicao = new Map(blocos.map((bloco, indice) => [bloco.id, indice]));
  const onde = (elemento: ElementoSemanticoV1) => posicao.get(elemento.ancoras[0]?.bloco_id ?? '') ?? Number.MAX_SAFE_INTEGER;
  return [...modelo.elementos].sort((a, b) => onde(a) - onde(b) || (a.ancoras[0]?.inicio_utf16 ?? 0) - (b.ancoras[0]?.inicio_utf16 ?? 0));
}

const CENTRALIDADE = { 1: 'estrutural', 2: 'importante', 3: 'periférico' } as const;
const curto = (texto: string, maximo: number): string => texto.length <= maximo ? texto : `${texto.slice(0, maximo - 1).trimEnd()}…`;

/** O modelo em texto: movimento, unidades, elementos (com o trecho literal principal) e relações. */
export function serializarModelo(modelo: ModeloDoCapituloV1, blocos: readonly Pick<Bloco, 'id'>[]): { texto: string; apelidos: ApelidosDoModelo } {
  const posicao = new Map(blocos.map((bloco, indice) => [bloco.id, indice]));
  const unidades = new Map(modelo.unidades.map((unidade, i) => [unidade.id, `U${String(i + 1)}`]));
  const unidadeDo = (elemento: ElementoSemanticoV1): string => {
    const onde = posicao.get(elemento.ancoras[0]?.bloco_id ?? '');
    if (onde === undefined) return '—';
    const unidade = modelo.unidades.find((item) => onde >= (posicao.get(item.bloco_inicio) ?? Infinity) && onde <= (posicao.get(item.bloco_fim) ?? -Infinity));
    return unidade ? unidades.get(unidade.id) ?? '—' : '—';
  };
  const ordenados = elementosEmOrdem(modelo, blocos);
  const elementos = new Map(ordenados.map((elemento, i) => [`E${String(i + 1)}`, elemento]));
  const apelidoDo = new Map([...elementos].map(([apelido, elemento]) => [elemento.id, apelido]));
  const linhas: string[] = [];
  if (modelo.movimento) {
    linhas.push('### Movimento do capítulo', '', modelo.movimento.texto, '');
    modelo.movimento.etapas.forEach((etapa, i) => {
      linhas.push(`${String(i + 1)}. ${etapa.descricao} (${etapa.unidade_ids.map((id) => unidades.get(id) ?? '?').join(', ')})`);
    });
    linhas.push('');
  }
  linhas.push('### Unidades de leitura, em ordem', '');
  for (const unidade of modelo.unidades) linhas.push(`${unidades.get(unidade.id) ?? '?'} · ${unidade.titulo} — ${unidade.funcao_no_capitulo}`);
  linhas.push('', '### Elementos, na ordem do texto', '');
  for (const [apelido, elemento] of elementos) {
    const papel = elemento.papel === null ? '' : ` · papel ${elemento.papel}`;
    linhas.push(`${apelido} [${unidadeDo(elemento)}] ${elemento.nucleo}${papel} · ${CENTRALIDADE[elemento.centralidade]} — ${elemento.enunciado}`);
    const ancora = elemento.ancoras[0];
    if (ancora) linhas.push(`   ⟦b:${ancora.bloco_id}⟧ “${curto(ancora.citacao, 400)}”`);
  }
  if (modelo.relacoes.length > 0) {
    linhas.push('', '### Relações', '');
    for (const relacao of modelo.relacoes) {
      const de = apelidoDo.get(relacao.origem_id);
      const para = apelidoDo.get(relacao.destino_id);
      if (!de || !para) continue;
      linhas.push(`${de} —${relacao.tipo}→ ${para}${relacao.retrospectiva ? ' (retrospectiva)' : ''}: ${curto(relacao.explicacao, 180)}`);
    }
  }
  return { texto: linhas.join('\n'), apelidos: { elementos, unidades } };
}

function lerSchema(nome: string): SchemaJson {
  const valor: unknown = JSON.parse(lerPrompt(nome));
  if (!ehObjeto(valor)) throw new Error(`Schema ${nome} não é um objeto.`);
  return valor;
}

export interface PromptDoEsquema { prompt: string; schema: SchemaJson; prompt_versao: string; apelidos: ApelidosDoModelo }

export function montarPromptDoEsquema(
  contexto: ContextoDoEsquema, modelo: ModeloDoCapituloV1, blocos: readonly Pick<Bloco, 'id'>[], correcao: Correcao | null,
): PromptDoEsquema {
  if (modelo.elementos.length === 0) throw new Error('O modelo do capítulo não tem elementos.');
  const { texto, apelidos } = serializarModelo(modelo, blocos);
  return {
    prompt: preencher(corpoDoModelo(lerPrompt(`${VERSAO_PROMPT_ESQUEMA}.md`)), {
      documento: contexto.documento,
      capitulo: contexto.capitulo,
      modo: contexto.modo,
      modelo: cercar(texto),
      correcao: correcao === null ? ''
        : `\n## Correção pedida\n\nA resposta anterior foi recusada pela conferência do serviço: ${correcao.erro}\n\nRefaça o esquema inteiro respeitando as regras acima.\n`,
    }),
    schema: lerSchema(`${VERSAO_PROMPT_ESQUEMA}.schema.json`),
    prompt_versao: VERSAO_PROMPT_ESQUEMA,
    apelidos,
  };
}
