/** A lista de atalhos (`?`): o que cada tecla faz na leitura. Fecha com Esc, `?` ou um clique fora. */
import { useEffect, useRef, type ReactNode } from 'react';
import { IconButton } from '../../ui/Primitives';
import { ehMac, teclaNoSistema, textoNoSistema } from '../../ui/teclas';
import { ATALHOS } from './comandos';

export function ListaDeAtalhos({ aoFechar }: { aoFechar: () => void }): ReactNode {
  const fechar = useRef<HTMLButtonElement>(null);
  const mac = ehMac();
  useEffect(() => {
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    fechar.current?.focus();
    const teclar = (evento: KeyboardEvent) => { if (evento.key === 'Escape' || evento.key === '?') { evento.preventDefault(); evento.stopPropagation(); aoFechar(); } };
    window.addEventListener('keydown', teclar, true);
    return () => { window.removeEventListener('keydown', teclar, true); anterior?.focus({ preventScroll: true }); };
  }, [aoFechar]);
  return <div className="fundo-da-paleta" onPointerDown={(evento) => { if (evento.target === evento.currentTarget) aoFechar(); }}>
    <section className="lista-de-atalhos" role="dialog" aria-modal="true" aria-label="Atalhos de teclado">
      <header><h2>Atalhos de teclado</h2><IconButton ref={fechar} type="button" aria-label="Fechar atalhos" onClick={aoFechar} icone="xis" /></header>
      {ATALHOS.map((grupo) => <div key={grupo.titulo} className="grupo-de-atalhos">
        <h3>{grupo.titulo}</h3>
        <dl>{grupo.atalhos.map((atalho) => <div key={atalho.descricao}>
          <dt>{textoNoSistema(atalho.descricao, mac)}</dt><dd>{atalho.teclas.map((tecla) => <kbd key={tecla}>{teclaNoSistema(tecla, mac)}</kbd>)}</dd>
        </div>)}</dl>
      </div>)}
    </section>
  </div>;
}
