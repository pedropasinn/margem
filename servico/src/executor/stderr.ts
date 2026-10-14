/**
 * O stderr do Codex que vale guardar (V-W2, auditoria B-03).
 *
 * Antes ele ficava só na memória e sumia: uma falha no Windows chegava à pessoa como "O Codex
 * parou antes de terminar" e à auditoria como "código 1", sem causa. Agora o executor devolve um
 * resumo **redigido** (sem token, cookie, e-mail nem o caminho da casa) com no máximo 4 KB, que a
 * auditoria grava em `stderr.txt`, e uma frase legível, quando a causa é conhecida, que vai para o
 * diagnóstico do job e para a interface.
 */
import { homedir } from 'node:os';

/** Teto do resumo, em caracteres. */
export const TETO_DO_RESUMO = 4 * 1024;
const LINHAS_FINAIS = 20;

/**
 * Linha de erro fatal da CLI: `ERROR: …` (ou `Error:`) no começo da linha, sem o carimbo de hora
 * dos registros internos. Os registros com hora (`2026-…Z ERROR codex_models_manager: … 401 …`)
 * são avisos que a CLI sobrevive; "Reconnecting… n/5" é tentativa, não desfecho.
 */
const LINHA_FATAL = /^(?:ERROR|Error|error):\s+(?!Reconnecting\b)(\S.*)$/u;
/** Linhas que vale manter no resumo mesmo fora da cauda. */
const LINHA_RELEVANTE = /(?:^|\s)(?:ERROR|Error|error|warning|WARN)\b:?/u;

/** As linhas de erro fatal, na ordem em que apareceram, sem o prefixo. */
export function linhasFatais(stderr: string): string[] {
  const linhas: string[] = [];
  for (const linha of stderr.split(/\r?\n/u)) {
    const casou = LINHA_FATAL.exec(linha.trim());
    if (casou?.[1]) linhas.push(casou[1].trim());
  }
  return linhas;
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** Tira do texto o que pode ser credencial ou dado pessoal. */
export function redigir(texto: string, casa: string = homedir()): string {
  let saida = texto
    .replace(/\b(set-cookie|cookie)\s*:[^\n]*/giu, '$1: [redigido]')
    .replace(/\bBearer\s+\S+/gu, 'Bearer [redigido]')
    .replace(/\bsk-[A-Za-z0-9_-]{10,}/gu, 'sk-[redigido]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/gu, '[jwt redigido]')
    .replace(/("?(?:access|refresh|id)_token"?\s*[:=]\s*)"?[^"\s,}]+"?/giu, '$1"[redigido]"')
    .replace(/([?&](?:token|key|code|access_token)=)[^&\s"]+/giu, '$1[redigido]')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu, '[e-mail]');
  // A casa do usuário revela o nome da pessoa; vira `~` (nas duas grafias de barra no Windows).
  for (const variante of new Set([casa, casa.replaceAll('\\', '/'), casa.replaceAll('/', '\\')])) {
    if (variante.length > 1) saida = saida.replace(new RegExp(escaparRegex(variante), 'giu'), '~');
  }
  return saida;
}

/**
 * Resumo para a auditoria: as linhas de erro e aviso, depois as últimas vinte, sem repetir, já
 * redigidas e cortadas em 4 KB (o fim é o que importa: corta o começo).
 */
export function resumirStderr(stderr: string, casa: string = homedir()): string {
  const linhas = stderr.split(/\r?\n/u).map((linha) => linha.trimEnd()).filter((linha) => linha.trim() !== '');
  const cauda = linhas.slice(-LINHAS_FINAIS);
  const inicioDaCauda = linhas.length - cauda.length;
  // Repetições ("Reconnecting… 2/5", o mesmo aviso duas vezes) não ajudam a diagnosticar.
  const relevantes = [...new Set(linhas.slice(0, inicioDaCauda).filter((linha) => LINHA_RELEVANTE.test(linha)))];
  const escolhidas = [...relevantes, ...(relevantes.length > 0 ? ['…'] : []), ...cauda];
  const texto = redigir(escolhidas.join('\n'), casa);
  return texto.length <= TETO_DO_RESUMO ? texto : `…${texto.slice(-(TETO_DO_RESUMO - 1))}`;
}

/** Frase do modelo recusado pela conta; a escolha por categoria (V-T10) a troca por uma que nomeia o modelo. */
export const CAUSA_MODELO_INDISPONIVEL = 'Sua conta do ChatGPT não oferece o modelo pedido.';

/** Causas conhecidas: padrão nas linhas fatais → frase para a pessoa. A ordem importa. */
const CAUSAS: readonly (readonly [RegExp, string])[] = [
  [/invalid_json_schema|invalid schema for response_format|response_format.*schema/iu,
    'O Codex recusou o formato de resposta pedido pelo Margem. É um defeito do Margem; avise o suporte.'],
  [/context_length_exceeded|maximum context length|input is too long|too many tokens/iu,
    'O texto enviado ao Codex passou do tamanho que o modelo aceita.'],
  [/model_not_found|model\b.*\b(?:not supported|does not exist|not found|not available|unsupported)/iu, CAUSA_MODELO_INDISPONIVEL],
  [/sandbox|AppContainer|CreateRestrictedToken|restricted token|landlock|seatbelt/iu,
    'O isolamento do Codex não iniciou neste computador.'],
  [/error sending request|dns error|connection (?:refused|reset)|network is unreachable|timed out|stream disconnected|failed to connect/iu,
    'O Codex não conseguiu falar com o servidor do ChatGPT. Confira a conexão com a internet.'],
];

/** Frase legível da falha, quando a causa está na tabela; `null` quando não se sabe. */
export function causaDoStderr(stderr: string): string | null {
  const fatais = linhasFatais(stderr).join('\n');
  if (fatais === '') return null;
  for (const [padrao, frase] of CAUSAS) if (padrao.test(fatais)) return frase;
  return null;
}
