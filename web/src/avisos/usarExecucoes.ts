/**
 * Acompanha as execuções do Codex: SSE em `/api/execucoes/eventos` e, enquanto o fluxo não estiver
 * aberto (sem `EventSource`, proxy que corta, reconexão), consulta `/api/execucoes/ativas` a cada
 * `INTERVALO_DA_CONSULTA_MS`. Com a aba escondida, a consulta espera a volta.
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import type { ExecucoesDoCodexV1 } from '@margem/contratos';
import { anuncioDaMudanca, ESTADO_INICIAL, pareceLista, reduzirAvisos, type AcaoDosAvisos, type EstadoDosAvisos } from './execucoes';

export const INTERVALO_DA_CONSULTA_MS = 4_000;

export function usarExecucoes(): { estado: EstadoDosAvisos; despachar: (acao: AcaoDosAvisos) => void; anuncio: string } {
  const [estado, despachar] = useReducer(reduzirAvisos, ESTADO_INICIAL);
  const [anuncio, anunciar] = useState('');
  const anterior = useRef(estado);
  useEffect(() => {
    const frase = anuncioDaMudanca(anterior.current, estado);
    anterior.current = estado;
    if (frase) anunciar(frase);
  }, [estado]);

  useEffect(() => {
    let vivo = true;
    let consulta: ReturnType<typeof setInterval> | null = null;
    const receber = (lista: ExecucoesDoCodexV1) => { if (vivo) despachar({ tipo: 'lista', lista, recebidaEm: Date.now() }); };
    const consultar = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const resposta = await fetch('/api/execucoes/ativas', { headers: { Accept: 'application/json' } });
        if (!resposta.ok) return;
        const corpo: unknown = await resposta.json();
        if (pareceLista(corpo)) receber(corpo);
      } catch { /* sem rede: a próxima volta tenta de novo */ }
    };
    const consultarSempre = () => {
      if (consulta !== null) return;
      void consultar();
      consulta = setInterval(() => { void consultar(); }, INTERVALO_DA_CONSULTA_MS);
    };
    const pararConsulta = () => { if (consulta !== null) { clearInterval(consulta); consulta = null; } };

    const fluxo = typeof EventSource === 'function' ? new EventSource('/api/execucoes/eventos') : null;
    if (fluxo) {
      fluxo.addEventListener('open', pararConsulta);
      fluxo.addEventListener('execucoes', (evento) => {
        pararConsulta();
        try {
          const corpo: unknown = JSON.parse((evento as MessageEvent<string>).data);
          if (pareceLista(corpo)) receber(corpo);
        } catch { /* evento torto: espera o próximo */ }
      });
      // O navegador reconecta sozinho; enquanto isso, a consulta cobre.
      fluxo.addEventListener('error', consultarSempre);
    } else {
      consultarSempre();
    }
    return () => { vivo = false; pararConsulta(); fluxo?.close(); };
  }, []);

  return { estado, despachar, anuncio };
}
