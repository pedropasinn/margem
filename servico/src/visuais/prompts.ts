/**
 * Prompts dos visuais ancorados (J70): `visual-imagem@2` e `visual-diagrama@3` (J132: nós curtos e ramificados), funções puras.
 * O trecho literal, o contexto (livro, capítulo, modo) e o pedido do leitor vão cercados.
 */
import type { Bloco, Id } from '@margem/contratos';
import {
  MAXIMO_IDS_NO_ENUM, cercar, corpoDoModelo, ehObjeto, lerPrompt, ordenar, preencher, serializarBlocos, type SchemaJson,
} from '../leitura/v2/prompt.js';

export const VERSAO_PROMPT_IMAGEM = 'visual-imagem@2';
export const VERSAO_PROMPT_DIAGRAMA = 'visual-diagrama@3';

export type AlvoDoPrompt = 'trecho' | 'bloco' | 'capitulo';

export interface ContextoDoVisual {
  documento: string;
  capitulo: string;
  /** Nome do modo de leitura da camada padrão (ex.: "Literária"). */
  modo: string;
  alvo: AlvoDoPrompt;
  /** Estrofe? Muda só a frase do alvo ("a estrofe inteira", "o poema inteiro"). */
  poesia: boolean;
  pedido: string | null;
}

export interface PromptDoVisual { prompt: string; schema: SchemaJson; prompt_versao: string }

function lerSchema(nome: string): SchemaJson {
  const valor: unknown = JSON.parse(lerPrompt(nome));
  if (!ehObjeto(valor)) throw new Error(`Schema ${nome} não é um objeto.`);
  return valor;
}

export function fraseDoAlvo(alvo: AlvoDoPrompt, poesia: boolean): string {
  if (alvo === 'trecho') return 'o trecho abaixo, que ele selecionou';
  if (alvo === 'bloco') return poesia ? 'a estrofe inteira abaixo' : 'o parágrafo inteiro abaixo';
  return poesia ? 'o poema inteiro (o capítulo todo), como um quadro que o represente' : 'o capítulo inteiro';
}

function pedidoCercado(pedido: string | null): string {
  return pedido === null || pedido.trim() === '' ? '(nenhum pedido específico)' : cercar(pedido.trim());
}

/** Imagem: o texto do alvo e, para um trecho, o bloco em volta. */
export function montarPromptDaImagem(contexto: ContextoDoVisual, texto: string, emVolta: string | null): PromptDoVisual {
  if (!/\S/u.test(texto)) throw new Error('Texto do visual vazio.');
  return {
    prompt: preencher(corpoDoModelo(lerPrompt(`${VERSAO_PROMPT_IMAGEM}.md`)), {
      documento: contexto.documento,
      capitulo: contexto.capitulo,
      modo: contexto.modo,
      alvo: fraseDoAlvo(contexto.alvo, contexto.poesia),
      texto: cercar(texto),
      contexto: emVolta === null || emVolta === texto ? '(o texto acima já é tudo)' : cercar(emVolta),
      pedido: pedidoCercado(contexto.pedido),
    }),
    schema: lerSchema(`${VERSAO_PROMPT_IMAGEM}.schema.json`),
    prompt_versao: VERSAO_PROMPT_IMAGEM,
  };
}

/** Schema do diagrama com o `bloco_id` das citações restrito aos blocos enviados (se couber no enum). */
export function schemaDoDiagrama(ids: readonly Id[]): SchemaJson {
  const schema = structuredClone(lerSchema(`${VERSAO_PROMPT_DIAGRAMA}.schema.json`));
  if (ids.length === 0 || ids.length > MAXIMO_IDS_NO_ENUM) return schema;
  const citacao = (((schema.properties as SchemaJson).nos as SchemaJson).items as SchemaJson).properties as SchemaJson;
  const ramo = ((citacao.citacao as SchemaJson).anyOf as SchemaJson[])[0]!;
  (ramo.properties as SchemaJson).bloco_id = { type: 'string', enum: [...ids] };
  return schema;
}

export interface Correcao { codigo: string; erro: string }

/** Diagrama: os blocos com id (para as citações); na segunda tentativa, o código recusado e o erro. */
export function montarPromptDoDiagrama(contexto: ContextoDoVisual, blocos: readonly Bloco[], correcao: Correcao | null): PromptDoVisual {
  if (blocos.length === 0) throw new Error('Diagrama sem texto.');
  const ordenados = ordenar(blocos);
  return {
    prompt: preencher(corpoDoModelo(lerPrompt(`${VERSAO_PROMPT_DIAGRAMA}.md`)), {
      documento: contexto.documento,
      capitulo: contexto.capitulo,
      modo: contexto.modo,
      alvo: fraseDoAlvo(contexto.alvo, contexto.poesia),
      texto: serializarBlocos(ordenados, (bloco) => bloco.tipo),
      pedido: pedidoCercado(contexto.pedido),
      correcao: correcao === null ? ''
        : `\n## Correção pedida\n\nA resposta anterior foi recusada pela conferência do Mermaid: ${correcao.erro}\n\nO código recusado foi:\n\n${cercar(correcao.codigo)}\n\nRefaça respeitando o subconjunto abaixo.\n`,
    }),
    schema: schemaDoDiagrama(ordenados.map((bloco) => bloco.id)),
    prompt_versao: VERSAO_PROMPT_DIAGRAMA,
  };
}
