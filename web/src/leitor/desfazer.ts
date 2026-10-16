/**
 * Pilha de desfazer da leitura (J37): cada ação do leitor no texto (grifar, tirar um grifo, remover uma marca,
 * trocar a função, etiquetar, editar uma nota) registra como se desfaz. `Z` desfaz a última, e de novo a
 * anterior, até vinte. O aviso mostra a última ação por alguns segundos, com o botão "Desfazer".
 *
 * A ação só sai da pilha depois que o desfazer dá certo: uma falha (o serviço reiniciando) deixa tentar de
 * novo. Enquanto um desfazer está em curso, outro pedido não começa (dois Z seguidos não desfazem duas vezes
 * a mesma ação). Quem registra uma ação de várias etapas guarda as já feitas, para a nova tentativa não repeti-las.
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
  /** Desfaz a última ação; devolve o rótulo dela, ou `null` com a pilha vazia ou outro desfazer em curso. Falhou: a ação continua na pilha. */
  desfazer: () => Promise<string | null>;
  /** Um desfazer em curso (o botão fica desligado até ele terminar). */
  desfazendo: boolean;
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
  const emCurso = useRef(false);
  const [desfazendo, definirDesfazendo] = useState(false);
  const registrar = useCallback((acao: AcaoDesfazivel) => {
    pilha.current = [...pilha.current, acao].slice(-LIMITE_DA_PILHA);
    definirTamanho(pilha.current.length);
    definirAviso(acao.rotulo);
    definirDesfazivel(true);
  }, []);
  const desfazer = useCallback(async () => {
    const ultima = pilha.current.at(-1);
    if (emCurso.current) return null;
    if (!ultima) { definirAviso('Nada para desfazer.'); definirDesfazivel(false); return null; }
    emCurso.current = true;
    definirDesfazendo(true);
    try {
      await ultima.desfazer();
    } finally {
      emCurso.current = false;
      definirDesfazendo(false);
    }
    // Pela identidade: uma ação registrada enquanto este desfazer esperava continua na pilha.
    pilha.current = pilha.current.filter((acao) => acao !== ultima);
    definirTamanho(pilha.current.length);
    // Ainda havendo o que desfazer, o botão continua: Z de novo desfaz a anterior.
    definirAviso(`Desfeito: ${ultima.rotulo.charAt(0).toLocaleLowerCase('pt-BR')}${ultima.rotulo.slice(1)}`);
    definirDesfazivel(pilha.current.length > 0);
    return ultima.rotulo;
  }, []);
  const avisar = useCallback((texto: string) => { definirAviso(texto); definirDesfazivel(false); }, []);
  const dispensar = useCallback(() => definirAviso(null), []);
  return useMemo(() => ({ registrar, desfazer, desfazendo, aviso, desfazivel, avisar, dispensar, tamanho }), [registrar, desfazer, desfazendo, aviso, desfazivel, avisar, dispensar, tamanho]);
}

const SEM_PILHA: PilhaDeDesfazer = { registrar: () => undefined, desfazer: () => Promise.resolve(null), desfazendo: false, aviso: null, desfazivel: false, avisar: () => undefined, dispensar: () => undefined, tamanho: 0 };
export const ContextoDeDesfazer = createContext<PilhaDeDesfazer>(SEM_PILHA);
export function usarDesfazer(): PilhaDeDesfazer { return useContext(ContextoDeDesfazer); }

/** Ctrl Z (⌘ Z no Mac), sem Shift nem Alt: o desfazer de sempre. Não há refazer na pilha do leitor. */
export function ehDesfazerDoSistema(evento: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): boolean {
  return (evento.ctrlKey || evento.metaKey) && !evento.altKey && !evento.shiftKey && evento.key.toLowerCase() === 'z';
}

/** O evento da janela que o leitor aberto ouve para desfazer pela pilha (o Editar → Desfazer do menu do app). */
export const EVENTO_DESFAZER_DO_MENU = 'margem:desfazer';

/** O foco está num campo editável: o desfazer é o do próprio campo. */
function focoEmCampo(): boolean {
  const ativo = document.activeElement;
  return ativo instanceof HTMLElement && (ativo.isContentEditable || ativo.matches('input, textarea, select'));
}

/**
 * O Editar → Desfazer do app de computador (U-05): o processo principal avisa pela ponte (`janela.aoDesfazer`);
 * num campo, desfaz a digitação como o menu nativo; fora, manda o evento ao leitor. No navegador, nada muda.
 * Devolve a função que para de ouvir.
 */
export function ligarDesfazerDoMenu(janela: Window = window): () => void {
  const ponte = (janela as { margemDesktop?: { janela?: { aoDesfazer?: (ouvir: () => void) => () => void } } }).margemDesktop;
  const aoDesfazer = ponte?.janela?.aoDesfazer;
  if (typeof aoDesfazer !== 'function') return () => undefined;
  return aoDesfazer(() => {
    // `execCommand('undo')` é obsoleto, mas é o desfazer nativo do campo (o mesmo do papel `undo` do menu).
    if (focoEmCampo()) document.execCommand('undo');
    else janela.dispatchEvent(new Event(EVENTO_DESFAZER_DO_MENU));
  });
}
