/** Plataformas para as quais o app é empacotado e o nome dos executáveis em cada uma. */

export const PLATAFORMAS = ['win32-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64'] as const;
export type Plataforma = (typeof PLATAFORMAS)[number];

export function plataformaAtual(sistema: NodeJS.Platform = process.platform, arquitetura: string = process.arch): Plataforma {
  const nome = `${sistema}-${arquitetura}`;
  if ((PLATAFORMAS as readonly string[]).includes(nome)) return nome as Plataforma;
  throw new Error(`Plataforma sem suporte: ${nome}. O Margem roda em Windows x64, macOS (Apple e Intel) e Linux x64.`);
}

/** `codex` vira `codex.exe` no Windows. */
export function executavel(nome: string, sistema: NodeJS.Platform = process.platform): string {
  return sistema === 'win32' ? `${nome}.exe` : nome;
}
