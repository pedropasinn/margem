import type { ReactNode } from 'react';

/**
 * Ícones dos formatos que entram na biblioteca e da pasta da biblioteca, no mesmo desenho de
 * `Icone.tsx` (traço de 1,8 em 24 × 24, pontas redondas, estilo Lucide refeito à mão). Ficam à
 * parte para a lista de formatos crescer sem mexer nos ícones gerais.
 */
const CAMINHOS = {
  pdf: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M8.5 13h7', 'M8.5 17h4.5'],
  epub: ['M2.5 5h6a3.5 3.5 0 0 1 3.5 3.5V20a2.5 2.5 0 0 0-2.5-2.5h-7z', 'M21.5 5h-6A3.5 3.5 0 0 0 12 8.5V20a2.5 2.5 0 0 1 2.5-2.5h7z'],
  markdown: ['M3.5 6h17A1.5 1.5 0 0 1 22 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 16.5v-9A1.5 1.5 0 0 1 3.5 6z', 'M5.5 15V9l2.5 3 2.5-3v6', 'M16.5 9v6', 'm14 12.5 2.5 2.5 2.5-2.5'],
  texto: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M8.5 12h7', 'M12 12v6'],
  colado: ['M9 3.5h6v3H9z', 'M15 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2', 'M9 12h6', 'M9 16h4'],
  web: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18', 'M12 3a14 14 0 0 1 0 18', 'M12 3a14 14 0 0 0 0 18'],
  youtube: ['M4.5 5.5h15a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 16V8a2.5 2.5 0 0 1 2.5-2.5z', 'm10 9 5 3-5 3z'],
  video: ['M3 4h18v16H3z', 'M7.5 4v16', 'M16.5 4v16', 'M3 9h4.5', 'M3 15h4.5', 'M16.5 9H21', 'M16.5 15H21'],
  audio: ['M3 11v2', 'M7 8v8', 'M11 4v16', 'M15 7v10', 'M19 10v4'],
  imagem: ['M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'm3 17 5-5 4 4 3-3 6 6', 'M14 9a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0'],
  quadro: ['M3 3h18v18H3z', 'M7 7h10v10H7z', 'm7 15 3-3 2 2 2-2.5 3 3.5'],
  transcricao: ['M8 4H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1', 'M16 4h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1'],
  pasta: ['M10 20H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v3', 'M14 16h7v5h-7z', 'M15.5 16v-1.5a2 2 0 0 1 4 0V16'],
} as const;

export type NomeDoFormato = keyof typeof CAMINHOS;

export function IconeDeFormato({ nome, tamanho = 28 }: { nome: NomeDoFormato; tamanho?: number }): ReactNode {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {CAMINHOS[nome].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
