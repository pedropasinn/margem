/**
 * Pilha de desfazer da leitura (J37): cada ação do leitor no texto (grifar, tirar um grifo, remover uma marca,
 * trocar a função, etiquetar, editar uma nota) registra como se desfaz. `Z` desfaz a última, e de novo a
 * anterior, até vinte. O aviso mostra a última ação por alguns segundos, com o botão "Desfazer".
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export interface AcaoDesfazivel {
  /** O que foi feito, para o aviso: "Grifo criado", "Marca removida"… */
  rotulo: string;
  desfazer: () => void | Promise<void>;
}

export const LIMITE_DA_PILHA = 20;

export interface PilhaDeDesfazer {
  registrar: (acao: AcaoDesfazivel) => void;
  /** Desfaz a última ação; devolve o rótulo dela, ou `null` com a pilha vazia. */
  desfazer: () => Promise<string | null>;
  /** A última ação feita (para o aviso), até alguém dispensá-lo. */
  aviso: string | null;
  /** O aviso é de uma ação que se desfaz (mostra o botão), ou só um recado. */
  desfazivel: boolean;
  /** Um recado no mesmo lugar do aviso, sem entrar na pilha (uma falha, uma dica). */
  avisar: (texto: string) => void;
  dispensar: () => void;
  tamanho: number;
}

export function usePilhaDeDesfazer(): PilhaDeDesfazer {
  const pilha = useRef<AcaoDesfazivel[]>([]);
  const [aviso, definirAviso] = useState<string | null>(null);
  const [desfazivel, definirDesfazivel] = useState(false);
  const [tamanho, definirTamanho] = useState(0);
  const registrar = useCallback((acao: AcaoDesfazivel) => {
    pilha.current = [...pilha.current, acao].slice(-LIMITE_DA_PILHA);
    definirTamanho(pilha.current.length);
    definirAviso(acao.rotulo);
    definirDesfazivel(true);
  }, []);
  const desfazer = useCallback(async () => {
    const ultima = pilha.current.at(-1);
    if (!ultima) { definirAviso('Nada para desfazer.'); definirDesfazivel(false); return null; }
    pilha.current = pilha.current.slice(0, -1);
    definirTamanho(pilha.current.length);
    await ultima.desfazer();
    // Ainda havendo o que desfazer, o botão continua: Z de novo desfaz a anterior.
    definirAviso(`Desfeito: ${ultima.rotulo.charAt(0).toLocaleLowerCase('pt-BR')}${ultima.rotulo.slice(1)}`);
    definirDesfazivel(pilha.current.length > 0);
    return ultima.rotulo;
  }, []);
  const avisar = useCallback((texto: string) => { definirAviso(texto); definirDesfazivel(false); }, []);
  const dispensar = useCallback(() => definirAviso(null), []);
  return useMemo(() => ({ registrar, desfazer, aviso, desfazivel, avisar, dispensar, tamanho }), [registrar, desfazer, aviso, desfazivel, avisar, dispensar, tamanho]);
}

const SEM_PILHA: PilhaDeDesfazer = { registrar: () => undefined, desfazer: () => Promise.resolve(null), aviso: null, desfazivel: false, avisar: () => undefined, dispensar: () => undefined, tamanho: 0 };
export const ContextoDeDesfazer = createContext<PilhaDeDesfazer>(SEM_PILHA);
export function usarDesfazer(): PilhaDeDesfazer { return useContext(ContextoDeDesfazer); }
