/**
 * Instalar o Margem como app (PWA, manifesto do PR #47).
 *
 * Chrome, Edge e Android disparam `beforeinstallprompt` quando o app é instalável; guardamos o
 * evento assim que o módulo carrega (ele chega cedo, antes de qualquer tela pedir). No iPhone e no
 * iPad não há esse evento: o caminho é o "Adicionar à Tela de Início" do Safari. Já instalado
 * (`display-mode: standalone`), o passo diz isso e não oferece nada.
 */
import { useEffect, useState } from 'react';

/** O evento ainda não tem tipo no `lib.dom`. */
export interface PedidoDeInstalacao extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type ComoInstalar = 'instalado' | 'pedido' | 'ios' | 'manual';

let pedidoGuardado: PedidoDeInstalacao | null = null;
let instaladoNestaSessao = false;
const ouvintes = new Set<() => void>();
const avisar = () => { for (const ouvinte of ouvintes) ouvinte(); };

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (evento) => {
    evento.preventDefault();
    pedidoGuardado = evento as PedidoDeInstalacao;
    avisar();
  });
  window.addEventListener('appinstalled', () => { pedidoGuardado = null; instaladoNestaSessao = true; avisar(); });
}

export interface AmbienteDeInstalacao {
  standalone: boolean;
  userAgent: string;
  plataforma: string;
  toques: number;
  pedido: boolean;
}

/** iPhone, iPad (que se apresenta como Mac com toque) e iPod. */
export function ehIos(userAgent: string, plataforma: string, toques: number): boolean {
  return /iPhone|iPad|iPod/i.test(userAgent) || (plataforma === 'MacIntel' && toques > 1);
}

/** Decide o caminho a mostrar, a partir de um retrato do ambiente (puro, para testar). */
export function comoInstalar(ambiente: AmbienteDeInstalacao): ComoInstalar {
  if (ambiente.standalone) return 'instalado';
  if (ambiente.pedido) return 'pedido';
  if (ehIos(ambiente.userAgent, ambiente.plataforma, ambiente.toques)) return 'ios';
  return 'manual';
}

function retrato(): AmbienteDeInstalacao {
  const navegador = window.navigator as Navigator & { standalone?: boolean };
  const standalone = instaladoNestaSessao || navegador.standalone === true
    || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  return { standalone, userAgent: navegador.userAgent, plataforma: navegador.platform, toques: navegador.maxTouchPoints ?? 0, pedido: pedidoGuardado !== null };
}

/** O caminho atual e, quando há o pedido do navegador, a função que abre a instalação. */
export function usarInstalacao(): { como: ComoInstalar; instalar: (() => Promise<'aceito' | 'recusado'>) | null } {
  const [como, definir] = useState<ComoInstalar>(() => comoInstalar(retrato()));
  useEffect(() => {
    const atualizar = () => definir(comoInstalar(retrato()));
    ouvintes.add(atualizar); atualizar();
    return () => { ouvintes.delete(atualizar); };
  }, []);
  const instalar = como === 'pedido' ? async () => {
    const pedido = pedidoGuardado;
    if (!pedido) return 'recusado' as const;
    await pedido.prompt();
    const escolha = await pedido.userChoice;
    // O evento só serve uma vez; o navegador manda outro se ainda fizer sentido.
    pedidoGuardado = null; avisar();
    return escolha.outcome === 'accepted' ? 'aceito' as const : 'recusado' as const;
  } : null;
  return { como, instalar };
}
