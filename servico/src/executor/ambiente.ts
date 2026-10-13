/** Saneamento do ambiente entregue ao `codex exec`. */

/** Únicas variáveis repassadas ao processo do motor. */
export const VARIAVEIS_PERMITIDAS = ['PATH', 'HOME', 'LANG', 'TERM', 'CODEX_HOME'] as const;

/**
 * Devolve apenas as variáveis da lista de permissão, e nunca vazias.
 * Credenciais do Postgres (a URL do banco, as variáveis `PG*`) e a configuração
 * do próprio Margem (`MARGEM_*`) ficam de fora por construção: o resultado é montado
 * a partir da lista de permissão, não filtrado a partir do ambiente recebido.
 */
export function ambienteSaneado(origem: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const saneado: Record<string, string> = {};
  for (const nome of VARIAVEIS_PERMITIDAS) {
    const valor = origem[nome];
    if (valor !== undefined && valor !== '') saneado[nome] = valor;
  }
  return saneado;
}

/** Nomes que jamais podem aparecer no ambiente do motor; usado pelos testes e pela auditoria. */
export function vazamentos(ambiente: Record<string, string>): string[] {
  return Object.keys(ambiente).filter(
    (nome) => !(VARIAVEIS_PERMITIDAS as readonly string[]).includes(nome),
  );
}
