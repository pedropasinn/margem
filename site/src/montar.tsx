import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './estilos/tokens.css';
import './estilos/base.css';
import './estilos/site.css';

export function montar(pagina: ReactNode): void {
  const raiz = document.getElementById('raiz');
  if (!raiz) throw new Error('Elemento #raiz ausente no HTML.');
  createRoot(raiz).render(<StrictMode>{pagina}</StrictMode>);
}
