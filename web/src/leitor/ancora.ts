import type { AncoraV1, Bloco, Id } from '@margem/contratos';
import { fronteiraUtf16 } from '@margem/contratos/texto';
import type { PontoDeTexto } from './tipos';

/** Tamanhos da citação e do contexto literal gravados na âncora de retomada. */
export const TAMANHO_DA_CITACAO = 48;
export const TAMANHO_DO_CONTEXTO = 32;

function paraTras(texto: string, indice: number): number {
  return fronteiraUtf16(texto, indice) ? indice : indice - 1;
}

function paraFrente(texto: string, indice: number): number {
  return fronteiraUtf16(texto, indice) ? indice : indice + 1;
}

/**
 * Converte a identidade textual da posição de leitura numa `AncoraV1` completa, com citação
 * e contexto literais tirados do próprio bloco — é o que `conferirProgresso` exige no serviço.
 * Nenhum corte cai no meio de um par substituto.
 */
export function ancoraDoPonto(
  blocos: readonly Bloco[], versaoId: Id, ponto: PontoDeTexto,
): AncoraV1 | null {
  const bloco = blocos.find((candidato) => candidato.id === ponto.bloco_id);
  if (bloco === undefined || bloco.texto.length === 0) return null;
  const { texto } = bloco;

  // A citação precisa de pelo menos um caractere: no fim do bloco, recua uma posição.
  const inicio = paraTras(texto, Math.min(Math.max(0, ponto.offset_utf16), texto.length - 1));
  const fim = paraFrente(texto, Math.min(texto.length, inicio + TAMANHO_DA_CITACAO));
  const antes = paraFrente(texto, Math.max(0, inicio - TAMANHO_DO_CONTEXTO));
  const depois = paraTras(texto, Math.min(texto.length, fim + TAMANHO_DO_CONTEXTO));

  return {
    versao_id: versaoId,
    bloco_id: bloco.id,
    citacao: texto.slice(inicio, fim),
    prefixo: texto.slice(antes, inicio),
    sufixo: texto.slice(fim, depois),
    inicio_utf16: inicio,
    fim_utf16: fim,
  };
}

/** O caminho de volta: a âncora guardada vira de novo bloco + deslocamento. */
export function pontoDaAncora(ancora: AncoraV1): PontoDeTexto {
  return { bloco_id: ancora.bloco_id, offset_utf16: ancora.inicio_utf16 };
}

/** Âncora literal de seleção: limites locais, sem cortar pares substitutos. */
export function ancoraDaFaixa(bloco: Bloco, versaoId: Id, inicio: number, fim: number): AncoraV1 | null {
  if (!Number.isInteger(inicio) || !Number.isInteger(fim) || inicio < 0 || fim > bloco.texto.length || inicio >= fim) return null;
  const a = paraTras(bloco.texto, inicio);
  const b = paraFrente(bloco.texto, fim);
  return { versao_id: versaoId, bloco_id: bloco.id, inicio_utf16: a, fim_utf16: b,
    citacao: bloco.texto.slice(a, b),
    prefixo: bloco.texto.slice(paraFrente(bloco.texto, Math.max(0, a - TAMANHO_DO_CONTEXTO)), a),
    sufixo: bloco.texto.slice(b, paraTras(bloco.texto, Math.min(bloco.texto.length, b + TAMANHO_DO_CONTEXTO))),
  };
}
