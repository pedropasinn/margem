import type { ReactNode } from 'react';
import type { TipoRelacaoSemantica } from '@margem/contratos';

/** Símbolos vetoriais próprios; o tipo não depende da cor nem de glifos da fonte. */
export const CAMINHOS_DA_RELACAO: Record<TipoRelacaoSemantica, string> = {
  suporta: 'M4 18h16M7 18v-5h10v5M12 13V4m-4 4 4-4 4 4',
  desenvolve: 'M12 20V4m-5 5 5-5 5 5M12 15l-7-5m0 4v-4h4m3 5 7-5m-4 0h4v4',
  pressupoe: 'M14 4h6v16h-6M3 12h12m-4-4 4 4-4 4',
  contrasta: 'M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4',
  exemplifica: 'm12 3 9 9-9 9-9-9 9-9M10 12h4m-2-2v4',
  retoma: 'M8 6 3 11l5 5M3 11h12a5 5 0 0 1 0 10M15 21h-3',
  responde: 'M4 4h16v12h-8l-5 4v-4H4V4m3 6h10m-3-3 3 3-3 3',
  tensiona: 'M3 5v14M21 5v14M3 12h4l3-6 4 12 3-6h4',
  ecoa: 'M5 10v4M9 7q5 5 0 10M14 4q8 8 0 16M19 2q10 10 0 20',
};
export function IconeDaRelacao({ tipo }: { tipo: TipoRelacaoSemantica }): ReactNode {
  return <svg className="icone-da-relacao" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={CAMINHOS_DA_RELACAO[tipo]} /></svg>;
}
