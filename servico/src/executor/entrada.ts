/**
 * Entrada de um prompt montado inteiro em memória (leitor V2 e responder, J19).
 *
 * O prompt vai por argumento da CLI. No Linux um argumento isolado não passa de
 * 128 KiB (`MAX_ARG_STRLEN`), e uma parte de 45 mil tokens estimados passa disso. Acima
 * do teto o texto vai para `prompt.md` no diretório da execução e o argumento só aponta
 * para ele. O schema montado vai para um arquivo fora do diretório de entrada: o executor
 * o copia (saneado) e confere a resposta contra ele.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Folga abaixo dos 128 KiB do kernel, em bytes UTF-8. */
export const TETO_PROMPT_POR_ARGUMENTO = 100_000;
export const ARQUIVO_PROMPT = 'prompt.md';

export const PONTEIRO_DO_PROMPT = [
  `As instruções completas desta tarefa, com o texto a ler, estão no arquivo ${ARQUIVO_PROMPT} deste diretório.`,
  'Leia o arquivo inteiro e siga-o à risca. A resposta final é só o JSON pedido pelo schema.',
].join(' ');

export interface EntradaPreparada {
  /** Diretório (só com a entrada) que vai para `diretorioEntrada`. */
  diretorioEntrada: string;
  /** Caminho do schema montado. */
  schema: string;
  /** O que vai por argumento: o próprio prompt ou o ponteiro para `prompt.md`. */
  prompt: string;
  /** Se o prompt foi para arquivo. */
  emArquivo: boolean;
}

/**
 * Linha de comando inteira no Windows (`CreateProcess`): 32 767 caracteres UTF-16, contando o
 * executável, todos os argumentos, os espaços e as aspas (V-W4, auditoria B-06). O teto de 100 KB
 * acima vale por argumento no Linux; no Windows um prompt de 40 mil caracteres não sai do `spawn`.
 */
export const TETO_DA_LINHA_DO_WINDOWS = 32_767;
/** Folga para o que muda a linha depois de montada (política do modo nativo, caminho do motor). */
export const FOLGA_DA_LINHA_DO_WINDOWS = 2_048;

/**
 * Comprimento da linha que o Node monta no Windows: cada argumento com espaço, tab ou aspas vai
 * entre aspas, com as aspas internas e as barras antes delas escapadas (estimativa por cima).
 */
export function tamanhoNaLinhaDoWindows(argumentos: readonly string[]): number {
  let total = 0;
  for (const argumento of argumentos) {
    const precisaDeAspas = argumento === '' || /[\s"]/u.test(argumento);
    const escapes = precisaDeAspas ? (argumento.match(/["\\]/gu)?.length ?? 0) : 0;
    total += argumento.length + (precisaDeAspas ? 2 : 0) + escapes + 1;
  }
  return total;
}

/**
 * O prompt pode ir por argumento nesta linha de comando? `linha` é a linha inteira (executável,
 * argumentos e o próprio prompt). No Windows conta a linha toda; nos outros, o argumento isolado.
 */
export function promptCabeNaLinha(prompt: string, linha: readonly string[], plataforma: NodeJS.Platform = process.platform): boolean {
  if (plataforma === 'win32') return tamanhoNaLinhaDoWindows(linha) <= TETO_DA_LINHA_DO_WINDOWS - FOLGA_DA_LINHA_DO_WINDOWS;
  return Buffer.byteLength(prompt, 'utf8') <= TETO_PROMPT_POR_ARGUMENTO;
}

/** Escreve a entrada dentro de `raiz` (um temporário de quem chama, que também o remove). */
export async function prepararEntrada(raiz: string, prompt: string, schema: unknown): Promise<EntradaPreparada> {
  const diretorioEntrada = join(raiz, 'entrada');
  await mkdir(diretorioEntrada, { recursive: true, mode: 0o700 });
  const caminhoSchema = join(raiz, 'schema-montado.json');
  await writeFile(caminhoSchema, `${JSON.stringify(schema, null, 2)}\n`, { mode: 0o600 });
  const emArquivo = Buffer.byteLength(prompt, 'utf8') > TETO_PROMPT_POR_ARGUMENTO;
  if (emArquivo) await writeFile(join(diretorioEntrada, ARQUIVO_PROMPT), prompt, { mode: 0o600 });
  return { diretorioEntrada, schema: caminhoSchema, prompt: emArquivo ? PONTEIRO_DO_PROMPT : prompt, emArquivo };
}
