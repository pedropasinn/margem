import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { Id } from '@margem/contratos';
import {
  INTERACAO_VAZIA, marcaAtiva, reduzirInteracao,
  type EstadoDaInteracao,
} from './interacao';

/** Atraso do corredor entre o trecho e a nota: sair e entrar de novo não fecha nada. */
export const ATRASO_DO_CORREDOR_MS = 150;

export interface ControladorDoLeitor {
  estado: EstadoDaInteracao;
  ativa: Id | null;
  entrar: (id: Id) => void;
  sair: (id: Id) => void;
  fixar: (id: Id, acionador?: HTMLElement | null) => void;
  focar: (id: Id, acionador?: HTMLElement | null) => void;
  desfocar: (id: Id) => void;
  fechar: (devolverFoco?: boolean) => void;
}

/**
 * Trecho e nota chamam estas mesmas ações. O atraso de saída é cancelado por qualquer
 * `entrar`, inclusive o da nota correspondente — é o que permite atravessar o corredor.
 */
export function useControlador(atrasoMs: number = ATRASO_DO_CORREDOR_MS): ControladorDoLeitor {
  const [estado, despachar] = useReducer(reduzirInteracao, INTERACAO_VAZIA);
  const tempo = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acionador = useRef<HTMLElement | null>(null);
  // Escape devolve o foco ao trecho; esse foco de volta não pode reabrir a nota que acabou de fechar.
  const ignorarFoco = useRef(false);

  const limpar = useCallback(() => {
    if (tempo.current !== null) {
      clearTimeout(tempo.current);
      tempo.current = null;
    }
  }, []);

  useEffect(() => limpar, [limpar]);

  const entrar = useCallback((id: Id) => {
    limpar();
    despachar({ tipo: 'entrar', id });
  }, [limpar]);

  const sair = useCallback((id: Id) => {
    limpar();
    tempo.current = setTimeout(() => {
      tempo.current = null;
      despachar({ tipo: 'sair', id });
    }, atrasoMs);
  }, [atrasoMs, limpar]);

  const lembrar = useCallback((elemento?: HTMLElement | null) => {
    if (elemento !== undefined && elemento !== null) acionador.current = elemento;
  }, []);

  const fixar = useCallback((id: Id, elemento?: HTMLElement | null) => {
    limpar();
    lembrar(elemento);
    despachar({ tipo: 'fixar', id });
  }, [lembrar, limpar]);

  const focar = useCallback((id: Id, elemento?: HTMLElement | null) => {
    if (ignorarFoco.current) {
      ignorarFoco.current = false;
      return;
    }
    limpar();
    lembrar(elemento);
    despachar({ tipo: 'focar', id });
  }, [lembrar, limpar]);

  const desfocar = useCallback((id: Id) => { despachar({ tipo: 'desfocar', id }); }, []);

  /** Escape fecha tudo e devolve o foco ao trecho que abriu a nota. */
  const fechar = useCallback((devolverFoco = true) => {
    limpar();
    despachar({ tipo: 'fechar' });
    const alvo = acionador.current;
    if (devolverFoco && alvo !== null && alvo.isConnected) {
      ignorarFoco.current = true;
      alvo.focus({ preventScroll: true });
      queueMicrotask(() => { ignorarFoco.current = false; });
    }
  }, [limpar]);

  return useMemo(
    () => ({ estado, ativa: marcaAtiva(estado), entrar, sair, fixar, focar, desfocar, fechar }),
    [desfocar, entrar, estado, fechar, fixar, focar, sair],
  );
}
