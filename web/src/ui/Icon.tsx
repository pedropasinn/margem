import type { ReactNode } from 'react';
import { ICONES_LUCIDE } from './icones-lucide';

/**
 * Ícones de traço da plataforma de estudos (`calculo/plataforma/src/components/Icon.tsx`). Os que faltam
 * vêm do Lucide (`icones-lucide.ts`, licença ISC), desenhados com o mesmo traço.
 */
const CAMINHOS: Record<string, string> = {
  casa: 'M3 11l9-8 9 8M5 10v11h5v-7h4v7h5V10',
  painel: 'M3 4h18v16H3zM9 4v16',
  adicionar: 'M12 4v16M4 12h16',
  buscar: 'M21 21l-6-6M10 17a7 7 0 1 1 0-14 7 7 0 0 1 0 14',
  arquivo: 'M3 4h18v5H3zM5 9v12h14V9M9 13h6',
  library: 'M4 4h4v17H4zM10 4h4v17h-4zM17 4l4 16-3 1-4-16z',
  book: 'M12 5c-3-2-7-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-6-1-9 1v15',
  upload: 'M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5',
  arrow: 'M5 12h14M14 7l5 5-5 5',
  back: 'M19 12H5M10 7l-5 5 5 5',
  chevron: 'm9 5 7 7-7 7',
  check: 'm5 12 4 4L19 6',
  clock: 'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  note: 'M4 3h16v18H4zM8 7h8M8 11h8M8 15h5',
  video: 'M3 6h13v12H3zM16 10l5-3v10l-5-3',
  spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  info: 'M12 11v6m0-10v1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  alerta: 'M12 7v6m0 4v.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  olho: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 14.75a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5',
  'olho-fechado': 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 14.75a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5M4 20 20 4',
  xis: 'M6 6l12 12M18 6 6 18',
  comentario: 'M4 5h16v11H9l-5 4z',
  etiqueta: 'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',
  mais: 'M5 12h.01M12 12h.01M19 12h.01',
  copiar: 'M9 9h11v11H9zM5 15H4V4h11v1',
  /** Dois cartões, um sobre o outro (flashcards). */
  cartoes: 'M8 3h11a2 2 0 0 1 2 2v10M5 7h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z',
  'janela-lateral': 'M3 4h18v16H3zM14 4v16',
  'janela-flutuante': 'M3 4h18v16H3zM11 10h7v7h-7z',
  'tela-cheia': 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  /** Seta para cima (enviar a pergunta). */
  enviar: 'M12 19V5M6 11l6-6 6 6',
  lapis: 'M15 5l4 4M4 20l1-5L16 4l4 4L9 19z',
  lixeira: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
};

export function Icon({ name, size = 20 }: { name: string; size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={CAMINHOS[name] ?? ICONES_LUCIDE[name] ?? CAMINHOS['book']} />
    </svg>
  );
}

export function BarraDeProgresso({ valor, rotulo }: { valor: number; rotulo: string }): ReactNode {
  const limitado = Math.max(0, Math.min(100, valor));
  return (
    <div className="progress-track" role="progressbar" aria-valuenow={Math.round(limitado)}
      aria-valuemin={0} aria-valuemax={100} aria-label={rotulo}>
      <span style={{ width: `${String(limitado)}%` }} />
    </div>
  );
}
