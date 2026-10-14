/**
 * Modelo D dos grifos (J138): "o trecho no centro, um dono por pergunta".
 *
 * - o **grifo** é o trecho marcado com a cor e o rótulo de uma função do modo dele (`MarcaV2`);
 * - a **nota do grifo** (`NotaDoGrifoV1`) é do leitor, uma por grifo, texto simples e sem tipo;
 * - o **comentário do Codex** continua no grifo (`MarcaV2.comentario`);
 * - a **dificuldade** (`DificuldadeV1`) é um sinal à parte, que pode existir sem grifo.
 *
 * Sem dependência de Node: importável no navegador (as regras dos contratos ficam em `regras-f2.ts`).
 */
import type { AnotacaoV1, NotaDoGrifoV1, TipoDificuldadeTextual } from './tipos';

/** As sete categorias do método, na ordem em que aparecem no menu pequeno do "⋯". */
export const TIPOS_DE_DIFICULDADE: readonly TipoDificuldadeTextual[] = [
  'conceito_sem_definicao', 'premissa_implicita', 'salto_argumentativo', 'sintaxe_complexa', 'ambiguidade', 'mudanca_de_notacao', 'referencia_externa',
];

/** A anotação ligada a uma marca, lida como a nota do grifo (o mesmo id: o Obsidian e os links não mudam). */
export function notaDoGrifoDaAnotacao(anotacao: AnotacaoV1): NotaDoGrifoV1 | null {
  if (anotacao.marca_id === undefined) return null;
  return {
    versao: 1, id: anotacao.id, marca_id: anotacao.marca_id, versao_id: anotacao.versao_id, texto: anotacao.texto,
    ...(anotacao.revisao === undefined ? {} : { revisao: { ...anotacao.revisao } }),
    criada_em: anotacao.criada_em, atualizada_em: anotacao.atualizada_em, revisao_edicao: anotacao.revisao_edicao,
  };
}
