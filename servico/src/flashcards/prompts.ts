/**
 * Prompt dos flashcards do capítulo (`flashcards-capitulo@2`), função pura. Os blocos do capítulo
 * ganham apelidos curtos (`B1`, `B2`… na ordem do texto); o modelo nunca vê nem cria ids, responde
 * com o apelido e o serviço o traduz.
 */
import type { Bloco, Id } from '@margem/contratos';
import { cercar, corpoDoModelo, ehObjeto, lerPrompt, preencher, type SchemaJson } from '../leitura/v2/prompt.js';

export const VERSAO_PROMPT_FLASHCARDS = 'flashcards-capitulo@2';
/** Teto do texto enviado: capítulos maiores vão até aqui (o resto fica de fora, com aviso no prompt). */
export const TEXTO_MAXIMO = 120_000;

export interface MarcaDoLeitor { bloco_id: Id; citacao: string; nota: string | null }
export interface ContextoDosFlashcards {
  documento: string;
  capitulo: string;
  blocos: readonly Pick<Bloco, 'id' | 'texto'>[];
  marcas: readonly MarcaDoLeitor[];
  existentes: readonly string[];
}

export interface PromptDosFlashcards { prompt: string; schema: SchemaJson; prompt_versao: string; blocos: Map<string, Id> }

const curto = (texto: string, maximo: number): string => {
  const limpo = texto.replace(/\s+/gu, ' ').trim();
  return limpo.length <= maximo ? limpo : `${limpo.slice(0, maximo - 1).trimEnd()}…`;
};

function lerSchema(nome: string): SchemaJson {
  const valor: unknown = JSON.parse(lerPrompt(nome));
  if (!ehObjeto(valor)) throw new Error(`Schema ${nome} não é um objeto.`);
  return valor;
}

/** Quantos cartões pedir: um a cada ~350 palavras, entre 4 e 20. */
export function faixaDeCartoes(palavras: number): { minimo: number; maximo: number } {
  const maximo = Math.max(4, Math.min(20, Math.round(palavras / 350)));
  return { minimo: Math.max(2, Math.round(maximo / 2)), maximo };
}

export function montarPromptDosFlashcards(contexto: ContextoDosFlashcards): PromptDosFlashcards {
  const comTexto = contexto.blocos.filter((bloco) => bloco.texto.trim() !== '');
  if (comTexto.length === 0) throw new Error('O capítulo não tem texto.');
  const apelidos = new Map<Id, string>();
  const blocos = new Map<string, Id>();
  const linhas: string[] = [];
  let tamanho = 0;
  let cortado = false;
  for (const bloco of comTexto) {
    if (tamanho + bloco.texto.length > TEXTO_MAXIMO && linhas.length > 0) { cortado = true; break; }
    const apelido = `B${String(blocos.size + 1)}`;
    apelidos.set(bloco.id, apelido);
    blocos.set(apelido, bloco.id);
    linhas.push(`⟦${apelido}⟧ ${bloco.texto}`);
    tamanho += bloco.texto.length;
  }
  if (cortado) linhas.push('', '(O capítulo continua, mas o resto ficou de fora por tamanho: faça cartões só do que está acima.)');
  const marcas = contexto.marcas.flatMap((marca) => {
    const apelido = apelidos.get(marca.bloco_id);
    if (!apelido) return [];
    return [`- ⟦${apelido}⟧ “${curto(marca.citacao, 400)}”${marca.nota ? ` — nota: ${curto(marca.nota, 400)}` : ''}`];
  });
  const palavras = linhas.join(' ').split(/\s+/u).length;
  const { minimo, maximo } = faixaDeCartoes(palavras);
  return {
    prompt: preencher(corpoDoModelo(lerPrompt(`${VERSAO_PROMPT_FLASHCARDS}.md`)), {
      documento: contexto.documento,
      capitulo: contexto.capitulo,
      texto: cercar(linhas.join('\n\n')),
      marcas: marcas.length === 0 ? '(Nenhum grifo nem nota neste capítulo: escolha você o essencial.)' : cercar(marcas.join('\n')),
      existentes: contexto.existentes.length === 0 ? '(Nenhum ainda.)' : cercar(contexto.existentes.map((frente) => `- ${curto(frente, 300)}`).join('\n')),
      minimo: String(minimo),
      maximo: String(maximo),
    }),
    schema: lerSchema(`${VERSAO_PROMPT_FLASHCARDS}.schema.json`),
    prompt_versao: VERSAO_PROMPT_FLASHCARDS,
    blocos,
  };
}
