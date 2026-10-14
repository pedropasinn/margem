/**
 * Exportar para o Obsidian (formato 2: uma pasta por documento, uma nota por grifo, anotação,
 * pergunta e relação). O serviço gera as notas; aqui só se decide como entregá-las:
 *
 * - no navegador, o ZIP com a árvore de pastas (`GET /api/obsidian/v2/exportacao.zip`), do documento
 *   ou da biblioteca inteira;
 * - no app de computador, a gravação direta no cofre (`window.margemDesktop.exportarParaObsidian`, a
 *   ponte do Electron), com a mesma mescla do plugin: o que a pessoa escreveu fora do bloco do Margem
 *   fica;
 * - para manter o cofre em dia, o plugin do Obsidian.
 *
 * A escolha das marcas fica neste navegador.
 */
export interface PreferenciasDoObsidian {
  marcas: 'minhas' | 'todas';
}

export const PREFERENCIAS_DO_OBSIDIAN_PADRAO: PreferenciasDoObsidian = { marcas: 'minhas' };
const CHAVE = 'margem:obsidian';

export function validarPreferenciasDoObsidian(valor: unknown): PreferenciasDoObsidian {
  if (typeof valor !== 'object' || valor === null) return { ...PREFERENCIAS_DO_OBSIDIAN_PADRAO };
  return { marcas: (valor as Record<string, unknown>)['marcas'] === 'todas' ? 'todas' : 'minhas' };
}

export function lerPreferenciasDoObsidian(): PreferenciasDoObsidian {
  try { return validarPreferenciasDoObsidian(JSON.parse(localStorage.getItem(CHAVE) ?? 'null')); }
  catch { return { ...PREFERENCIAS_DO_OBSIDIAN_PADRAO }; }
}

export function gravarPreferenciasDoObsidian(preferencias: PreferenciasDoObsidian): void {
  try { localStorage.setItem(CHAVE, JSON.stringify(validarPreferenciasDoObsidian(preferencias))); } catch { /* sem storage: vale só nesta visita */ }
}

/** Consulta da API: as marcas escolhidas e a origem desta página nos links de volta. */
export function consultaDaExportacao(marcas: PreferenciasDoObsidian['marcas'], origem: string): string {
  return `marcas=${marcas}&base=${encodeURIComponent(origem)}`;
}

/** O ZIP do formato 2: de um documento, ou da biblioteca inteira. */
export function urlDoZip(marcas: PreferenciasDoObsidian['marcas'], origem: string, documentoId?: string): string {
  const documento = documentoId === undefined ? '' : `&documento=${encodeURIComponent(documentoId)}`;
  return `/api/obsidian/v2/exportacao.zip?${consultaDaExportacao(marcas, origem)}${documento}`;
}

/** O que o app de computador expõe à página (ausente no navegador). Espelho de `desktop/src/principal/ponte.ts`. */
export interface PonteDoDesktop {
  exportarParaObsidian: (documentoId?: string) => Promise<{ estado: 'ok' | 'cancelada' | 'falhou'; mensagem: string; pasta?: string }>;
}

export function ponteDoDesktop(): PonteDoDesktop | null {
  const ponte = (window as { margemDesktop?: Partial<PonteDoDesktop> }).margemDesktop;
  return typeof ponte?.exportarParaObsidian === 'function' ? ponte as PonteDoDesktop : null;
}
