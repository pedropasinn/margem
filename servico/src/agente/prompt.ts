/**
 * Prompts do agente da biblioteca: `agente@2` (a pergunta, com o histórico do fio) e `agente-mapa@1`
 * (a correção curta de um mapa recusado pela régua do Mermaid). Funções puras.
 *
 * O J70 não usa `resume`: a conversa segue pelo histórico mandado no prompt, recortado no fim
 * (as mensagens mais recentes primeiro na escolha, na ordem do fio no texto).
 */
import type { MensagemDoAgenteV1 } from '@margem/contratos';
import { cercar, corpoDoModelo, ehObjeto, lerPrompt, preencher, type SchemaJson } from '../leitura/v2/prompt.js';

export const VERSAO_PROMPT_AGENTE = 'agente@2';
/** R2-4: o mesmo agente sem ferramentas (Windows), com os trechos da biblioteca no próprio prompt. */
export const VERSAO_PROMPT_AGENTE_SEM_FERRAMENTAS = 'agente-sem-ferramentas@1';
export const VERSAO_PROMPT_MAPA = 'agente-mapa@1';
/** Quantas mensagens anteriores e quantos caracteres cada uma leva ao prompt. */
export const HISTORICO_MAXIMO = 16;
export const CARACTERES_POR_MENSAGEM = 4000;

function lerSchema(nome: string): SchemaJson {
  const valor: unknown = JSON.parse(lerPrompt(nome));
  if (!ehObjeto(valor)) throw new Error(`Schema ${nome} não é um objeto.`);
  return valor;
}

export function historicoEmTexto(anteriores: readonly Pick<MensagemDoAgenteV1, 'autor' | 'texto' | 'artefatos'>[]): string {
  const recentes = anteriores.slice(-HISTORICO_MAXIMO);
  if (recentes.length === 0) return '(é a primeira pergunta da conversa)';
  const partes = recentes.map((mensagem) => {
    const texto = mensagem.texto.length > CARACTERES_POR_MENSAGEM ? `${mensagem.texto.slice(0, CARACTERES_POR_MENSAGEM)}\n[…cortado]` : mensagem.texto;
    const artefatos = mensagem.artefatos.length === 0 ? '' : `\n(artefatos entregues: ${mensagem.artefatos.map((artefato) => `${artefato.tipo} “${artefato.titulo}”`).join('; ')})`;
    return `${mensagem.autor === 'leitor' ? 'Leitor' : 'Agente'}:\n${cercar(texto)}${artefatos}`;
  });
  const cortadas = anteriores.length - recentes.length;
  return `${cortadas > 0 ? `(${String(cortadas)} mensagens mais antigas omitidas)\n\n` : ''}${partes.join('\n\n')}`;
}

/**
 * Com `contexto` (o modelo sem ferramentas, R2-4), o prompt traz os trechos da biblioteca escolhidos pelo
 * serviço no lugar das instruções de ler a pasta `biblioteca/`. A saída é a mesma.
 */
export function montarPromptDoAgente(
  pergunta: string, anteriores: readonly Pick<MensagemDoAgenteV1, 'autor' | 'texto' | 'artefatos'>[], contexto?: string,
): { prompt: string; schema: SchemaJson } {
  if (!/\S/u.test(pergunta)) throw new Error('Pergunta vazia.');
  const valores = { historico: historicoEmTexto(anteriores), pergunta: cercar(pergunta.trim()) };
  return {
    prompt: contexto === undefined
      ? preencher(corpoDoModelo(lerPrompt(`${VERSAO_PROMPT_AGENTE}.md`)), valores)
      : preencher(corpoDoModelo(lerPrompt(`${VERSAO_PROMPT_AGENTE_SEM_FERRAMENTAS}.md`)), { ...valores, contexto: cercar(contexto) }),
    schema: lerSchema(`${VERSAO_PROMPT_AGENTE}.schema.json`),
  };
}

export function montarPromptDoMapa(codigo: string, nos: unknown, erro: string): { prompt: string; schema: SchemaJson } {
  return {
    prompt: preencher(corpoDoModelo(lerPrompt(`${VERSAO_PROMPT_MAPA}.md`)), { erro, codigo: cercar(codigo), nos: cercar(JSON.stringify(nos, null, 2)) }),
    schema: lerSchema(`${VERSAO_PROMPT_MAPA}.schema.json`),
  };
}
