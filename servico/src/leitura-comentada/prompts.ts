/**
 * Prompt da leitura comentada (J92): `comentar-leitura@2`, função pura. O modelo recebe as pausas já
 * montadas (onde a leitura para e o que comenta) e devolve uma fala por pausa. Nada de ULID nem offset:
 * as pausas têm alias `P001…` e as fontes são descritas pelo que dizem.
 */
import { corpoDoModelo, lerPrompt, preencher, type SchemaJson } from '../leitura/v2/prompt.js';
import type { EsbocoDaLeitura } from './montagem.js';

export const PROMPT_DA_LEITURA_COMENTADA = 'comentar-leitura@2';

export interface SaidaDaLeituraComentada { falas: { pausa: string; fala: string }[] }

export interface EntradaDoPrompt {
  livro: string;
  capitulo: string;
  numero: number;
  total: number;
  movimento: string | null;
  esboco: EsbocoDaLeitura;
}

const uma = (texto: string, limite = 300): string => {
  const limpo = texto.replace(/\s+/gu, ' ').trim();
  return limpo.length > limite ? `${limpo.slice(0, limite - 1)}…` : limpo;
};

function lerSchema(): SchemaJson {
  const valor: unknown = JSON.parse(lerPrompt(`${PROMPT_DA_LEITURA_COMENTADA}.schema.json`));
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) throw new Error('Schema da leitura comentada não é objeto.');
  return valor as SchemaJson;
}

/** Restringe `pausa` às recebidas (enum) e pede exatamente uma fala por pausa. */
function especializar(schema: SchemaJson, aliases: readonly string[]): SchemaJson {
  const copia = structuredClone(schema);
  const falas = (copia.properties as Record<string, SchemaJson>).falas!;
  falas.minItems = aliases.length;
  falas.maxItems = aliases.length;
  ((falas.items as SchemaJson).properties as Record<string, SchemaJson>).pausa = { type: 'string', enum: [...aliases] };
  return copia;
}

export function montarPromptDaLeitura(entrada: EntradaDoPrompt): { prompt: string; schema: SchemaJson; prompt_versao: string } {
  if (entrada.esboco.pausas.length === 0) throw new Error('Nenhuma pausa: não há o que comentar.');
  const prompt = preencher(corpoDoModelo(lerPrompt(`${PROMPT_DA_LEITURA_COMENTADA}.md`)), {
    livro: uma(entrada.livro),
    capitulo: uma(entrada.capitulo),
    posicao: `capítulo ${String(entrada.numero)} de ${String(entrada.total)}`,
    movimento: entrada.movimento ? uma(entrada.movimento, 1200) : 'Sem resumo do movimento do capítulo.',
    pausas: entrada.esboco.pausas.map((pausa) => pausa.descricao).join('\n\n'),
  });
  return { prompt, schema: especializar(lerSchema(), entrada.esboco.pausas.map((p) => p.alias)), prompt_versao: PROMPT_DA_LEITURA_COMENTADA };
}
