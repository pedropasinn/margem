import type { TipoDificuldadeTextual, TipoRelacaoSemantica } from '@margem/contratos';

/** Como cada tipo de relação semântica se lê na tela: um verbo, da origem para o destino. */
export const ROTULO_DA_RELACAO: Record<TipoRelacaoSemantica, string> = {
  suporta: 'sustenta', desenvolve: 'desenvolve', pressupoe: 'pressupõe', contrasta: 'contrasta com', exemplifica: 'exemplifica',
  retoma: 'retoma', responde: 'responde a', tensiona: 'tensiona', ecoa: 'ecoa',
};

/** Nome de cada dificuldade textual na margem (nível 3). */
export const ROTULO_DA_DIFICULDADE: Record<TipoDificuldadeTextual, string> = {
  premissa_implicita: 'Premissa implícita', mudanca_de_notacao: 'Mudança de notação', sintaxe_complexa: 'Sintaxe complexa',
  conceito_sem_definicao: 'Conceito sem definição', salto_argumentativo: 'Salto no argumento', referencia_externa: 'Referência externa',
  ambiguidade: 'Ambiguidade',
};
