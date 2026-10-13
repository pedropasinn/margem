/**
 * O pacote do acervo de quadros publicado para quem instala o app (J110). Ponto único a trocar a cada
 * release do acervo: a URL (um asset do release em github.com/pedropasinn/margem), `publicado` (falso
 * enquanto o release não existe: o pacote conta como "em preparação"), a versão, o
 * número de obras e o tamanho do arquivo. `MARGEM_ARTE_PACOTE_URL` sobrepõe a URL sem rebuild.
 *
 * Os números vêm do relatório de `npm run arte:empacotar` (docs/jobs/J110-RESULTADO.md).
 */
export const PACOTE_PUBLICADO = {
  versao: '2026.10.12',
  url: 'https://github.com/pedropasinn/margem/releases/download/acervo-2026.10.12/acervo-de-quadros-2026.10.12.tar.gz',
  /** Trocar para `true` quando o asset estiver no release. */
  publicado: false as boolean,
  obras: 137,
  bytes: 488_466_000,
} as const;

export interface PacoteParaBaixar {
  versao: string;
  /** `null` enquanto o pacote não foi publicado (`publicado: false`) e não há `MARGEM_ARTE_PACOTE_URL`. */
  url: string | null;
  obras: number;
  bytes: number;
}

export function pacoteParaBaixar(ambiente: NodeJS.ProcessEnv = process.env): PacoteParaBaixar {
  const bruto = ambiente.MARGEM_ARTE_PACOTE_URL?.trim() || (PACOTE_PUBLICADO.publicado ? PACOTE_PUBLICADO.url : '');
  const url = /^https?:\/\/[^<>\s]+$/u.test(bruto) ? bruto : null;
  return { versao: PACOTE_PUBLICADO.versao, url, obras: PACOTE_PUBLICADO.obras, bytes: PACOTE_PUBLICADO.bytes };
}
