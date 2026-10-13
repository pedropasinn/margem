import { useState, type ReactNode } from 'react';

/** Bloco de comando de terminal com botão de copiar. Uma linha por comando. */
export function Comando({ children, rotulo = 'Terminal' }: { children: string; rotulo?: string }): ReactNode {
  const [copiado, definirCopiado] = useState(false);
  const copiar = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(children);
      definirCopiado(true);
      window.setTimeout(() => definirCopiado(false), 1800);
    } catch { /* sem permissão de área de transferência: a pessoa seleciona à mão */ }
  };
  return (
    <div className="comando">
      <div className="comando-topo">
        <span>{rotulo}</span>
        <button type="button" className="comando-copiar" onClick={() => void copiar()} aria-live="polite">
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <pre><code>{children}</code></pre>
    </div>
  );
}
