/** Saneamento do ambiente entregue ao `codex exec` e aos subprocessos do motor. */

/** Únicas variáveis repassadas ao processo do motor (Linux e base dos outros sistemas). */
export const VARIAVEIS_PERMITIDAS = ['PATH', 'HOME', 'LANG', 'TERM', 'CODEX_HOME'] as const;

/**
 * O que cada sistema acrescenta à lista (J114). No Windows, sem `SystemRoot` nem o Winsock nem o
 * TLS sobem, e sem `TEMP`/`TMP` o Python e o Codex não têm onde pôr temporários; `USERPROFILE`,
 * `APPDATA` e `LOCALAPPDATA` são onde os programas procuram a casa. Nenhuma delas carrega segredo.
 * No macOS, `TMPDIR` é a pasta temporária privada do usuário.
 */
export const VARIAVEIS_POR_PLATAFORMA: Readonly<Partial<Record<NodeJS.Platform, readonly string[]>>> = {
  win32: ['SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
    'ProgramData', 'ProgramFiles', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE'],
  darwin: ['TMPDIR'],
};

export function variaveisPermitidas(plataforma: NodeJS.Platform = process.platform): readonly string[] {
  return [...VARIAVEIS_PERMITIDAS, ...(VARIAVEIS_POR_PLATAFORMA[plataforma] ?? [])];
}

/**
 * Devolve apenas as variáveis da lista de permissão, e nunca vazias.
 * Credenciais do Postgres (a URL do banco, as variáveis `PG*`) e a configuração
 * do próprio Margem (`MARGEM_*`) ficam de fora por construção: o resultado é montado
 * a partir da lista de permissão, não filtrado a partir do ambiente recebido.
 * No Windows os nomes não diferenciam maiúsculas (`Path`, `SYSTEMROOT`): a procura também não.
 */
export function ambienteSaneado(origem: NodeJS.ProcessEnv = process.env, plataforma: NodeJS.Platform = process.platform): Record<string, string> {
  const saneado: Record<string, string> = {};
  const chaves = plataforma === 'win32' ? new Map(Object.keys(origem).map((chave) => [chave.toUpperCase(), chave])) : null;
  for (const nome of variaveisPermitidas(plataforma)) {
    const chave = chaves === null ? nome : chaves.get(nome.toUpperCase());
    const valor = chave === undefined ? undefined : origem[chave];
    if (valor !== undefined && valor !== '') saneado[nome] = valor;
  }
  return saneado;
}

/** Nomes que jamais podem aparecer no ambiente do motor; usado pelos testes e pela auditoria. */
export function vazamentos(ambiente: Record<string, string>, plataforma: NodeJS.Platform = process.platform): string[] {
  const permitidas = variaveisPermitidas(plataforma);
  return Object.keys(ambiente).filter((nome) => !permitidas.includes(nome));
}
