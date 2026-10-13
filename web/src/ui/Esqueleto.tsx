import type { ReactNode } from 'react';
export function Esqueleto(): ReactNode {
  return <div className="esqueleto" role="status" aria-label="Carregando texto"><span /><span /><span /><span /><span /></div>;
}
