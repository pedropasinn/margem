import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { obterEstadoDaInstalacao, type EstadoDaInstalacao } from './estado';
import { lembrarConexao } from './ponte-do-chatgpt';

export interface ValorDaInstalacao {
  /** `null` até a primeira resposta, e também quando o serviço não tem a rota (versão anterior ao J103). */
  estado: EstadoDaInstalacao | null;
  /** A primeira consulta terminou (com ou sem resposta). */
  pronto: boolean;
  verificando: boolean;
  /** Consulta de novo; `renovar` ignora a memória curta do serviço (depois de um login, por exemplo). */
  verificar: (renovar?: boolean) => Promise<void>;
  /** Grava localmente que a primeira execução terminou, sem esperar a próxima consulta. */
  marcarConcluida: (concluida_em: string) => void;
  /** O tipo do aviso que a pessoa dispensou nesta aba (a faixa some até o problema mudar). */
  avisoDispensado: string | null;
  dispensarAviso: (tipo: string) => void;
  /** Fora do provedor (testes, páginas `/dev`) nada da instalação aparece. */
  ativo: boolean;
}

const Contexto = createContext<ValorDaInstalacao>({
  estado: null, pronto: true, verificando: false, verificar: async () => {}, marcarConcluida: () => {},
  avisoDispensado: null, dispensarAviso: () => {}, ativo: false,
});

export function usarInstalacao(): ValorDaInstalacao {
  return useContext(Contexto);
}

/** Intervalo da consulta de fundo: a cota e o login mudam sem o Margem saber. */
export const INTERVALO_DA_CONSULTA_MS = 60_000;

export function ProvedorDaInstalacao({ children, obter = obterEstadoDaInstalacao, intervaloMs = INTERVALO_DA_CONSULTA_MS }: {
  children: ReactNode;
  obter?: (renovar?: boolean) => Promise<EstadoDaInstalacao>;
  intervaloMs?: number;
}): ReactNode {
  const [estado, definir] = useState<EstadoDaInstalacao | null>(null);
  const [pronto, aprontar] = useState(false);
  const [verificando, definirVerificando] = useState(false);
  const [avisoDispensado, dispensarAviso] = useState<string | null>(null);
  const vivo = useRef(true);
  const obterRef = useRef(obter); obterRef.current = obter;

  const verificar = useCallback(async (renovar = false) => {
    definirVerificando(true);
    try {
      const novo = await obterRef.current(renovar);
      if (novo.codex.logado === true) lembrarConexao();
      if (vivo.current) definir(novo);
    } catch {
      // Serviço sem a rota ou fora do ar: a interface segue como antes, sem avisos da instalação.
    } finally {
      if (vivo.current) { definirVerificando(false); aprontar(true); }
    }
  }, []);

  useEffect(() => {
    vivo.current = true;
    void verificar();
    const relogio = setInterval(() => { if (document.visibilityState !== 'hidden') void verificar(); }, intervaloMs);
    const voltar = () => { if (document.visibilityState === 'visible') void verificar(); };
    document.addEventListener('visibilitychange', voltar);
    return () => { vivo.current = false; clearInterval(relogio); document.removeEventListener('visibilitychange', voltar); };
  }, [verificar, intervaloMs]);

  const marcarConcluida = useCallback((concluida_em: string) => {
    definir((atual) => atual && { ...atual, primeira_execucao: { ...atual.primeira_execucao, concluida: true, concluida_em } });
  }, []);

  const valor = useMemo(() => ({ estado, pronto, verificando, verificar, marcarConcluida, avisoDispensado, dispensarAviso, ativo: true }),
    [estado, pronto, verificando, verificar, marcarConcluida, avisoDispensado]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
