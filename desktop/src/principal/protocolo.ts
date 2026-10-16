/**
 * R2-6 · Links `margem://` da extensão do navegador e das notas do Obsidian.
 *
 * O serviço do app exige a chave local (S-01), que só a janela do app tem (cookie da sessão). Um link
 * `http://127.0.0.1:<porta>/…` aberto no navegador do sistema chega sem a chave e a página recebe 401.
 * Por isso esses links usam o esquema `margem://`, registrado pelo app, que leva a rota para a janela dele.
 *
 * Duas formas aceitas (só o início e as rotas de documento e de leitura, com ids ULID):
 * - `margem://abrir/documentos/<id>` e `margem://abrir/ler/<id>/<secao>?bloco=<bloco>`: a rota da página,
 *   como o serviço monta nas notas do Obsidian (a base `margem://abrir` no lugar de `http://…`);
 * - `margem://abrir?documento=<id>&secao=<secao>&bloco=<bloco>`.
 * Qualquer outra coisa é ignorada: o link vem de fora e não pode levar a janela a outro lugar.
 */
export const ESQUEMA = 'margem';
/** A base dos links que o serviço do app escreve no lugar de `http://127.0.0.1:<porta>`. */
export const BASE_DOS_LINKS = 'margem://abrir';

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;

function rotaDeLeitura(documento: string, secao: string | null, bloco: string | null): string | null {
  if (!ULID.test(documento) || (secao !== null && !ULID.test(secao)) || (bloco !== null && !ULID.test(bloco))) return null;
  if (secao === null) return `/documentos/${documento}`;
  return `/ler/${documento}/${secao}${bloco === null ? '' : `?bloco=${bloco}`}`;
}

/** A rota da página (caminho e consulta) para um link `margem://abrir…`, ou `null` se o link não serve. */
export function rotaDoLink(link: string): string | null {
  let url: URL;
  try { url = new URL(link); } catch { return null; }
  if (url.protocol !== `${ESQUEMA}:` || url.hostname.toLowerCase() !== 'abrir' || url.username !== '' || url.password !== '' || url.port !== '') return null;
  const partes = url.pathname.split('/').filter((parte) => parte !== '');
  const bloco = url.searchParams.get('bloco');
  if (partes.length === 0) {
    const documento = url.searchParams.get('documento');
    const secao = url.searchParams.get('secao');
    // `margem://abrir/` (o link de volta para a biblioteca) abre o início.
    return documento === null ? '/' : rotaDeLeitura(documento, secao, secao === null ? null : bloco);
  }
  if (partes[0] === 'documentos' && partes.length === 2) return rotaDeLeitura(partes[1]!, null, null);
  if (partes[0] === 'ler' && partes.length === 2) return rotaDeLeitura(partes[1]!, null, null) === null ? null : `/ler/${partes[1]!}`;
  if (partes[0] === 'ler' && partes.length === 3) return rotaDeLeitura(partes[1]!, partes[2]!, bloco);
  return null;
}

/** O primeiro link `margem:` da linha de comando (Windows e Linux: o app aberto pelo link, ou o second-instance). */
export function linkDosArgumentos(argv: readonly string[]): string | null {
  return argv.find((argumento) => argumento.toLowerCase().startsWith(`${ESQUEMA}:`)) ?? null;
}

/** O que o registro precisa do `app` do Electron (para testar sem ele). */
export interface AppDoProtocolo {
  setAsDefaultProtocolClient(protocolo: string, caminho?: string, argumentos?: string[]): boolean;
}

/**
 * Registra o Margem como quem abre `margem://`. Empacotado, basta o nome (o electron-builder declara o
 * esquema no Info.plist do macOS e no .desktop do Linux; no Windows o registro vai para HKCU). Em
 * desenvolvimento (`electron .`) o sistema precisa chamar o Electron com o caminho do app.
 */
export function registrarProtocolo(app: AppDoProtocolo, desenvolvimento: { execPath: string; app: string } | null): boolean {
  try {
    return desenvolvimento === null
      ? app.setAsDefaultProtocolClient(ESQUEMA)
      : app.setAsDefaultProtocolClient(ESQUEMA, desenvolvimento.execPath, [desenvolvimento.app]);
  } catch {
    return false;
  }
}

/**
 * Encaminha a rota de um link para a janela. `abrir` devolve `false` enquanto a biblioteca não está no ar
 * (o app foi aberto pelo próprio link): a rota fica guardada e a janela principal a usa ao abrir.
 */
export function criarEncaminhador(abrir: (rota: string) => boolean): { receber(link: string | null): boolean; pendente(): string | null } {
  let guardada: string | null = null;
  return {
    receber(link) {
      const rota = link === null ? null : rotaDoLink(link);
      if (rota === null) return false;
      if (!abrir(rota)) guardada = rota;
      return true;
    },
    pendente() {
      const rota = guardada;
      guardada = null;
      return rota;
    },
  };
}
