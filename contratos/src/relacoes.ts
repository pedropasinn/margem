/**
 * Vocabulário único de relação (E-19): duas camadas.
 *
 * - **família** (`RelacaoConexao`, 6): o que o leitor escolhe e vê numa conexão;
 * - **tipo** (`TipoRelacaoSemantica`, 9): o tipo fino que a compreensão do capítulo propõe.
 *
 * Cada tipo pertence a uma família (o mapa abaixo é o canônico; a adoção de uma relação da
 * compreensão grava as duas coisas). Sem dependência de Node: importável no navegador.
 */
import type { RelacaoConexao, TipoRelacaoSemantica } from './tipos';

export const TIPOS_DE_RELACAO_SEMANTICA: readonly TipoRelacaoSemantica[] = [
  'suporta', 'desenvolve', 'pressupoe', 'contrasta', 'exemplifica', 'retoma', 'responde', 'tensiona', 'ecoa',
];

export const RELACOES_DE_CONEXAO: readonly RelacaoConexao[] = ['semelhanca', 'contraste', 'tensao', 'prerequisito', 'desenvolve', 'exemplo'];

/** Tipo fino → família (§7 do desenho da compreensão). */
export const FAMILIA_DA_RELACAO_SEMANTICA: Readonly<Record<TipoRelacaoSemantica, RelacaoConexao>> = {
  suporta: 'desenvolve', desenvolve: 'desenvolve', pressupoe: 'prerequisito', contrasta: 'contraste', exemplifica: 'exemplo',
  retoma: 'semelhanca', responde: 'tensao', tensiona: 'tensao', ecoa: 'semelhanca',
};

/** Rótulos em português, para quem lê (o Obsidian e a interface). */
export const ROTULOS_DA_RELACAO: Readonly<Record<RelacaoConexao, string>> = {
  semelhanca: 'Semelhança', contraste: 'Contraste', tensao: 'Tensão', prerequisito: 'Pré-requisito', desenvolve: 'Desenvolve', exemplo: 'Exemplo',
};
export const ROTULOS_DA_RELACAO_SEMANTICA: Readonly<Record<TipoRelacaoSemantica, string>> = {
  suporta: 'Sustenta', desenvolve: 'Desenvolve', pressupoe: 'Pressupõe', contrasta: 'Contrasta', exemplifica: 'Exemplifica',
  retoma: 'Retoma', responde: 'Responde', tensiona: 'Tensiona', ecoa: 'Ecoa',
};
