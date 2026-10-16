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
 * Rede da empresa (W-04, mudança do J157): proxy explícito e certificados corporativos. Sem elas o login
 * (que recebe o ambiente do app) passava e a leitura falhava na conexão. Vão com o nome como a pessoa
 * escreveu (`https_proxy` ou `HTTPS_PROXY`; o Codex e o Python aceitam as duas caixas). Nunca vão para
 * registro: a URL do proxy pode ter usuário e senha. TLS continua verificado: só se acrescentam autoridades.
 */
export const VARIAVEIS_DE_REDE = [
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'CODEX_CA_CERTIFICATE', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE',
] as const;

const LOOPBACK = ['127.0.0.1', 'localhost', '::1'];

function ehDeRede(nome: string): boolean {
  return (VARIAVEIS_DE_REDE as readonly string[]).includes(nome.toUpperCase());
}

/**
 * As variáveis de rede presentes em `origem`, em qualquer caixa. Com proxy, o loopback entra no
 * `NO_PROXY`/`no_proxy`: o que fala com a API local nunca passa pelo proxy.
 */
export function variaveisDeRede(origem: NodeJS.ProcessEnv | Record<string, string>): Record<string, string> {
  const rede: Record<string, string> = {};
  for (const [nome, valor] of Object.entries(origem)) {
    if (valor !== undefined && valor !== '' && ehDeRede(nome)) rede[nome] = valor;
  }
  const comProxy = Object.keys(rede).some((nome) => /^(?:HTTP|HTTPS|ALL)_PROXY$/u.test(nome.toUpperCase()));
  if (comProxy) {
    const atuais = Object.keys(rede).filter((nome) => nome.toUpperCase() === 'NO_PROXY');
    const itens = atuais.flatMap((nome) => (rede[nome] ?? '').split(',').map((item) => item.trim()).filter((item) => item !== ''));
    const juntos = [...new Set([...itens, ...LOOPBACK])].join(',');
    for (const nome of new Set([...atuais, 'NO_PROXY', 'no_proxy'])) rede[nome] = juntos;
  }
  return rede;
}

/**
 * Devolve apenas as variáveis da lista de permissão (mais as de rede, `variaveisDeRede`), e nunca vazias.
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
  return { ...saneado, ...variaveisDeRede(origem) };
}

/** Nomes que jamais podem aparecer no ambiente do motor; usado pelos testes e pela auditoria. */
export function vazamentos(ambiente: Record<string, string>, plataforma: NodeJS.Platform = process.platform): string[] {
  const permitidas = variaveisPermitidas(plataforma);
  return Object.keys(ambiente).filter((nome) => !permitidas.includes(nome) && !ehDeRede(nome));
}
