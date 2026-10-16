/**
 * "Abrir com" o Margem no app de computador (U-08): os PDFs e EPUBs que o sistema mandou abrir chegam
 * como arquivos e vão para a tela Adicionar, na fila, esperando a pessoa confirmar. No navegador nada muda.
 *
 * Espelho de `desktop/src/principal/ponte.ts` (`ArquivosDoDesktop`).
 */
import { useEffect, useRef } from 'react';

export interface ArquivoAberto { nome: string; tipo: string; dados: Uint8Array<ArrayBuffer> }
export interface PonteDosArquivos {
  pegar: () => Promise<ArquivoAberto[]>;
  aoChegar: (ouvir: () => void) => () => void;
}

/** Evento da janela que leva os arquivos à tela Adicionar já aberta (detalhe: `File[]`). */
export const EVENTO_ARQUIVOS_ABERTOS = 'margem:arquivos-abertos';

export function ponteDosArquivos(): PonteDosArquivos | null {
  const ponte = (window as { margemDesktop?: { arquivos?: Partial<PonteDosArquivos> } }).margemDesktop?.arquivos;
  return typeof ponte?.pegar === 'function' && typeof ponte.aoChegar === 'function' ? ponte as PonteDosArquivos : null;
}

export function comoArquivos(abertos: readonly ArquivoAberto[]): File[] {
  return abertos.map(({ nome, tipo, dados }) => new File([dados], nome, { type: tipo }));
}

/** Pega o que já chegou (o app abriu por um arquivo) e o que chegar depois; entrega como `File[]`. */
export function usarArquivosAbertos(aoReceber: (arquivos: File[]) => void, ponte: PonteDosArquivos | null = ponteDosArquivos()): void {
  const receber = useRef(aoReceber); receber.current = aoReceber;
  useEffect(() => {
    if (ponte === null) return undefined;
    let vivo = true;
    const pegar = () => {
      ponte.pegar().then((abertos) => { if (vivo && abertos.length > 0) receber.current(comoArquivos(abertos)); }, () => undefined);
    };
    pegar();
    const parar = ponte.aoChegar(pegar);
    return () => { vivo = false; parar(); };
  }, [ponte]);
}
