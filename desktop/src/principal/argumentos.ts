import { fileURLToPath } from 'node:url';

/** Linha de comando do app (além das opções do Chromium, que o Electron trata sozinho). */
export interface Argumentos {
  /** Sobe o serviço sem janela nenhuma (teste de fumaça, servidores sem tela). */
  semJanela: boolean;
  /** Usa esta pasta como biblioteca, sem a janela de boas-vindas. */
  biblioteca: string | null;
}

export function lerArgumentos(argv: readonly string[]): Argumentos {
  let biblioteca: string | null = null;
  let semJanela = false;
  for (let indice = 0; indice < argv.length; indice += 1) {
    const atual = argv[indice] ?? '';
    if (atual === '--sem-janela') semJanela = true;
    else if (atual.startsWith('--biblioteca=')) biblioteca = atual.slice('--biblioteca='.length) || null;
    else if (atual === '--biblioteca') { biblioteca = argv[indice + 1] ?? null; indice += 1; }
  }
  return { semJanela, biblioteca };
}

/** "Abrir com" (U-08): os formatos que o sistema pode mandar para o Margem. */
export const EXTENSOES_ABERTAS = ['.pdf', '.epub'] as const;

/** `esquema:` de URI (duas letras ou mais: `C:\\…` do Windows é caminho, não esquema). */
const ESQUEMA = /^([a-z][a-z0-9+.-]+):/iu;

/**
 * Os arquivos que o sistema mandou abrir pela linha de comando (Windows e Linux: "Abrir com"; também o
 * `second-instance`): os argumentos posicionais com extensão de PDF ou EPUB, absolutos a partir de `pasta`,
 * sem repetir. Opções (`--…`), o `.` do Electron em desenvolvimento e o valor de `--biblioteca` ficam de fora.
 * R2-7: o lançador do Linux (`%U`) manda URIs `file://` (com escapes): viram caminho por `fileURLToPath`;
 * outros esquemas (http, smb…) e URIs que não são de arquivo local são recusados.
 */
export function arquivosDosArgumentos(
  argv: readonly string[], pasta: string, resolver: (pasta: string, caminho: string) => string,
  deUri: (uri: string) => string = fileURLToPath,
): string[] {
  const achados: string[] = [];
  for (let indice = 0; indice < argv.length; indice += 1) {
    let atual = argv[indice] ?? '';
    if (atual === '--biblioteca') { indice += 1; continue; }
    if (atual.startsWith('-')) continue;
    const esquema = ESQUEMA.exec(atual)?.[1]?.toLowerCase();
    if (esquema !== undefined) {
      if (esquema !== 'file') continue;
      try { atual = deUri(atual); } catch { continue; }
    }
    if (!ehArquivoAberto(atual)) continue;
    const absoluto = resolver(pasta, atual);
    if (!achados.includes(absoluto)) achados.push(absoluto);
  }
  return achados;
}

export function ehArquivoAberto(caminho: string): boolean {
  const minusculo = caminho.toLowerCase();
  return EXTENSOES_ABERTAS.some((extensao) => minusculo.endsWith(extensao));
}

/** Só endereços que podem sair para o navegador do sistema. */
export function linkExterno(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:';
  } catch {
    return false;
  }
}

export function mesmaOrigem(url: string, base: string): boolean {
  try {
    return new URL(url).origin === new URL(base).origin;
  } catch {
    return false;
  }
}
