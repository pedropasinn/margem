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
