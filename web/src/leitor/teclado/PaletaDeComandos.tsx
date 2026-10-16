/**
 * Paleta de comandos (Ctrl/Cmd + K): uma busca sobre tudo o que o leitor faz, com as setas para
 * escolher e Enter para executar. Fecha com Esc, com um clique fora ou ao executar.
 */
import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { filtrarComandos, type Comando } from './comandos';
import { atalhoNoSistema } from '../../ui/teclas';

export function PaletaDeComandos({ comandos, aoFechar }: { comandos: readonly Comando[]; aoFechar: () => void }): ReactNode {
  const [busca, buscar] = useState('');
  const [escolhido, escolher] = useState(0);
  const entrada = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const idDaLista = useId();
  const achados = useMemo(() => filtrarComandos(comandos, busca), [comandos, busca]);
  useEffect(() => { escolher(0); }, [busca]);
  useEffect(() => {
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    entrada.current?.focus();
    return () => anterior?.focus({ preventScroll: true });
  }, []);
  useEffect(() => { lista.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' }); }, [escolhido]);

  const executar = (comando: Comando | undefined) => {
    if (!comando) return;
    aoFechar();
    // Depois de a paleta sair: o foco volta ao leitor e só então o comando age (abre um painel, rola…).
    setTimeout(comando.executar, 0);
  };
  const teclar = (evento: KeyboardEvent<HTMLInputElement>) => {
    if (evento.key === 'ArrowDown') { evento.preventDefault(); escolher((atual) => Math.min(achados.length - 1, atual + 1)); }
    else if (evento.key === 'ArrowUp') { evento.preventDefault(); escolher((atual) => Math.max(0, atual - 1)); }
    else if (evento.key === 'Enter') { evento.preventDefault(); executar(achados[escolhido]); }
    else if (evento.key === 'Escape') { evento.preventDefault(); evento.stopPropagation(); aoFechar(); }
  };

  let grupoAnterior = '';
  return <div className="fundo-da-paleta" onPointerDown={(evento) => { if (evento.target === evento.currentTarget) aoFechar(); }}>
    <div className="paleta-de-comandos" role="dialog" aria-modal="true" aria-label="Paleta de comandos">
      <input ref={entrada} className="paleta-busca" type="text" role="combobox" aria-expanded="true" aria-controls={idDaLista} aria-autocomplete="list"
        aria-activedescendant={achados[escolhido] ? `${idDaLista}-${achados[escolhido].id}` : undefined}
        placeholder="O que fazer?" value={busca} onChange={(evento) => buscar(evento.target.value)} onKeyDown={teclar} />
      <ul ref={lista} id={idDaLista} className="paleta-lista" role="listbox" aria-label="Comandos">
        {achados.map((comando, indice) => {
          const cabeca = comando.grupo !== grupoAnterior ? comando.grupo : null;
          grupoAnterior = comando.grupo;
          return <Fragment key={comando.id}>
            {cabeca && <li className="paleta-grupo" role="presentation">{cabeca}</li>}
            <li id={`${idDaLista}-${comando.id}`} role="option" aria-selected={indice === escolhido}
              onPointerMove={() => escolher(indice)} onClick={() => executar(comando)}>
              <span>{comando.rotulo}</span>{comando.atalho && <kbd>{atalhoNoSistema(comando.atalho)}</kbd>}
            </li>
          </Fragment>;
        })}
        {achados.length === 0 && <li className="paleta-vazia" role="presentation">Nenhum comando com “{busca}”.</li>}
      </ul>
    </div>
  </div>;
}
