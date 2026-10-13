import type { ReactNode } from 'react';

/** Ícones de traço (desenho no estilo Lucide, refeito à mão para não carregar a biblioteca). */
const CAMINHOS = {
  marca: ['M9 11 4 16v4h4l5-5', 'm14 6 4 4', 'M13 7 17 3l4 4-4 4', 'M3 21h18'],
  margem: ['M4 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4z', 'M8 3v18', 'M11 8h4', 'M11 12h4', 'M20 8h1', 'M20 12h1'],
  pergunta: ['M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z', 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.2', 'M12 16.5h.01'],
  pdf: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M9 13h6', 'M9 17h4'],
  retomar: ['M6 3h12v18l-6-4-6 4z', 'M10 9l3 2-3 2z'],
  ouvir: ['M3 14v-2a9 9 0 0 1 18 0v2', 'M3 14h3v6H4a1 1 0 0 1-1-1z', 'M21 14h-3v6h2a1 1 0 0 0 1-1z'],
  conectar: ['M9 15 15 9', 'M11 6l1-1a4 4 0 0 1 6 6l-1 1', 'M13 18l-1 1a4 4 0 0 1-6-6l1-1'],
  obsidian: ['M12 2 5 8l2 9 5 5 5-5 2-9z', 'M12 2v20', 'M5 8l7 4 7-4'],
  extensao: ['M12 3v12', 'm7 10 5 5 5-5', 'M5 21h14'],
  aparelho: ['M3 5h13a1 1 0 0 1 1 1v9H3z', 'M1 19h17', 'M19 9h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z'],
  cadeado: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4', 'M12 15v2'],
  proibido: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M5.6 5.6l12.8 12.8'],
  seta: ['M5 12h14', 'm13 6 6 6-6 6'],
} as const;

export type NomeDoIcone = keyof typeof CAMINHOS;

export function Icone({ nome, tamanho = 24 }: { nome: NomeDoIcone; tamanho?: number }): ReactNode {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {CAMINHOS[nome].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
