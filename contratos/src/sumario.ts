/**
 * Conferência do sumário (J164): quando um EPUB ou PDF chega e as heurísticas locais acham o sumário
 * suspeito, o Codex (esforço baixo) devolve esta resposta. A proposta só reordena o que já existe:
 * cada entrada aponta o `bloco_inicio` de uma seção do canônico, com outro título e outro nível; o
 * serviço confere cada uma contra as seções e nunca reescreve o texto.
 */
import type { Id } from './tipos';

export interface EntradaDoSumarioSugerido {
  titulo: string;
  nivel: number;
  bloco_inicio: Id;
}

export interface ConferenciaDoSumarioV1 {
  ok: boolean;
  problemas: string[];
  proposta?: EntradaDoSumarioSugerido[];
}
