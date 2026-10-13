import type { Id } from '@margem/contratos';
import { fatiaSegura } from '@margem/core';

/** Teto do registro de continuidade, em unidades UTF-16. */
export const LIMITE_CONTINUIDADE = 2_000;

export interface ResumoDeParte {
  parte_id: Id;
  ordem: number;
  resumo: string;
}

export interface PedidoDeContinuidade {
  /** Ordem da parte que vai ser lida. */
  ordem: number;
  /** Resumos já publicados por partes desta execução. */
  anteriores: readonly ResumoDeParte[];
  /** Ordens que continuam um capítulo cortado (`planejarLeitura`). */
  continuacoes: ReadonlySet<number>;
  /** Ordem da parte → capítulo, para não misturar resumos de capítulos diferentes. */
  capituloDaParte?: ReadonlyMap<number, Id>;
  modo?: 'capitulos' | 'sequencial';
  limite?: number;
}

/** Corta em fronteira UTF-16, nunca no meio de um par substituto. */
const RETICENCIAS = ' […]';

function truncar(texto: string, limite: number): string {
  if (texto.length <= limite) return texto;
  for (let fim = limite - RETICENCIAS.length; fim > 0; fim--) {
    try {
      return `${fatiaSegura(texto, 0, fim).trimEnd()}${RETICENCIAS}`;
    } catch {
      continue;
    }
  }
  return '';
}

/**
 * Registro de continuidade de uma parte. Só existe quando o capítulo foi cortado
 * (ou, em `modo: 'sequencial'`, também entre capítulos): sem corte não há sequência
 * a manter e gerar resumo seria trabalho perdido. Nunca inclui resumo de parte futura.
 */
export function montarContinuidade(pedido: PedidoDeContinuidade): string | undefined {
  const modo = pedido.modo ?? 'capitulos';
  if (!pedido.continuacoes.has(pedido.ordem)) return undefined;
  const capitulo = pedido.capituloDaParte?.get(pedido.ordem);
  const relevantes = pedido.anteriores
    .filter((item) => item.ordem < pedido.ordem)
    .filter((item) => modo === 'sequencial' || capitulo === undefined
      || pedido.capituloDaParte?.get(item.ordem) === capitulo)
    .filter((item) => item.resumo.trim() !== '')
    .sort((a, b) => a.ordem - b.ordem);
  if (relevantes.length === 0) return undefined;
  const corpo = relevantes
    .map((item) => `## Parte ${String(item.ordem + 1)}\n\n${item.resumo.trim()}`)
    .join('\n\n');
  const texto = `# Continuidade\n\nO que as partes anteriores já registraram. Não repita estas marcas nem contradiga estas definições sem dizer por quê.\n\n${corpo}\n`;
  return truncar(texto, pedido.limite ?? LIMITE_CONTINUIDADE);
}
