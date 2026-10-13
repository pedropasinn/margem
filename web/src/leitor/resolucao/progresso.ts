/**
 * Até onde a resolução está à mostra. Um item de cada vez: os passos do item atual aparecem um a um,
 * e o último já é a resposta; só então o próximo item aparece. Os itens anteriores ficam como foram vistos.
 */
import type { ItemDaResolucaoV1 } from '@margem/contratos';

export interface Progresso {
  /** O item em andamento; os de antes já foram vistos, os de depois ainda não aparecem. */
  atual: number;
  /** Quantos passos de cada item estão à mostra. */
  passos: readonly number[];
}

export type AcaoDoAvanco = { tipo: 'passo'; rotulo: string } | { tipo: 'item'; rotulo: string } | { tipo: 'fim'; rotulo: string };

/** Quantos passos o item mostra: os passos da resolução, dos quais o último já é a resposta; sem passos, a resposta é o único. */
export function passosDoItem(item: ItemDaResolucaoV1 | undefined): number {
  return item ? Math.max(item.passos.length, 1) : 0;
}

export function progressoInicial(itens: readonly ItemDaResolucaoV1[]): Progresso {
  return { atual: 0, passos: itens.map(() => 0) };
}

export function nomeDoItem(item: ItemDaResolucaoV1 | undefined, indice: number): string {
  return item?.rotulo.trim() || String(indice + 1);
}

/** O que o botão de avançar faz agora, e com que nome. */
export function proximaAcao(itens: readonly ItemDaResolucaoV1[], progresso: Progresso): AcaoDoAvanco {
  const item = itens[progresso.atual];
  if (!item) return { tipo: 'fim', rotulo: 'Resolução completa' };
  const vistos = progresso.passos[progresso.atual] ?? 0;
  const total = passosDoItem(item);
  if (vistos < total) return { tipo: 'passo', rotulo: vistos === 0 ? 'Mostrar o primeiro passo' : `Próximo passo (${String(vistos + 1)} de ${String(total)})` };
  if (progresso.atual < itens.length - 1) return { tipo: 'item', rotulo: `Ir para o item ${nomeDoItem(itens[progresso.atual + 1], progresso.atual + 1)}` };
  return { tipo: 'fim', rotulo: 'Resolução completa' };
}

function com<T>(lista: readonly T[], indice: number, valor: T): T[] {
  return lista.map((atual, posicao) => (posicao === indice ? valor : atual));
}

/** Um passo à frente: o próximo passo ou o próximo item. */
export function avancar(itens: readonly ItemDaResolucaoV1[], progresso: Progresso): Progresso {
  const acao = proximaAcao(itens, progresso);
  const { atual } = progresso;
  if (acao.tipo === 'passo') return { ...progresso, passos: com(progresso.passos, atual, (progresso.passos[atual] ?? 0) + 1) };
  if (acao.tipo === 'item') return { ...progresso, atual: atual + 1 };
  return progresso;
}

/** Um passo atrás, dentro do item atual: esconde o último passo. */
export function recuar(progresso: Progresso): Progresso {
  const { atual } = progresso;
  const vistos = progresso.passos[atual] ?? 0;
  return vistos > 0 ? { ...progresso, passos: com(progresso.passos, atual, vistos - 1) } : progresso;
}

/** Todos os passos do item atual, até a resposta. */
export function mostrarTodos(itens: readonly ItemDaResolucaoV1[], progresso: Progresso): Progresso {
  const { atual } = progresso;
  return { ...progresso, passos: com(progresso.passos, atual, passosDoItem(itens[atual])) };
}
