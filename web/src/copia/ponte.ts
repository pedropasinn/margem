/**
 * Cópia de segurança (U-03, W-01), vista da página: onde moram a biblioteca e o banco, a última cópia e o
 * "Fazer cópia de segurança…". Só existe no app de computador; no navegador `ponteDaCopia()` é null.
 *
 * Espelho de `desktop/src/principal/ponte.ts` (`CopiaDeSegurancaDoDesktop`, `LocaisDaBibliotecaNaJanela`).
 */
export interface LocaisDaBiblioteca {
  biblioteca: string;
  banco: string;
  bancoSeparado: boolean;
  sincronizada: string | null;
  copiaAntesDeMigrar: string | null;
  ultimaCopia: { pasta: string; criada_em: string } | null;
}

export interface PonteDaCopia {
  locais: () => Promise<LocaisDaBiblioteca>;
  fazer: () => void;
  mostrar: (qual: 'biblioteca' | 'banco' | 'ultima') => void;
}

export function ponteDaCopia(): PonteDaCopia | null {
  const ponte = (window as { margemDesktop?: { copia?: Partial<PonteDaCopia> } }).margemDesktop?.copia;
  return typeof ponte?.locais === 'function' && typeof ponte.fazer === 'function' && typeof ponte.mostrar === 'function'
    ? ponte as PonteDaCopia : null;
}

export const LINK_DA_RESTAURACAO = 'https://margem.dev/docs/backup/#restaurar';

/** "16/10/2026 às 14:05". */
export function quando(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  return `${data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })} às ${data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}
