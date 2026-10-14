/**
 * Cancelar e apagar (V-T8): o cliente das rotas de `servico/src/http/rotas-apagar.ts`.
 *
 * Ponto de ligação para o balão e o painel do grifo (J138): apagar um grifo é `apagarGrifoDeQualquerUm`
 * (do Codex ou do leitor); apagar uma relação ou uma dificuldade da análise é `apagarItemDaAnalise`.
 * Os dois devolvem quando o servidor confirmou; quem chama recarrega o capítulo.
 */
import { escrever, pedir } from '../biblioteca/api';

export interface ItemApagavel { chave: string; rotulo: string; singular: string; total: number }
export interface Apagaveis { codex: ItemApagavel[]; leitor: ItemApagavel[] }
export type QuemApagar = 'codex' | 'leitor' | 'tudo';
export interface ResultadoDoCancelamento { cancelados: number; capitulos_descartados: number; execucoes_descartadas: number }

/** A frase que "Apagar tudo" exige (a mesma do serviço). */
export const CONFIRMACAO_DE_APAGAR_TUDO = 'apagar tudo';

export const cancelarJob = (id: string) => escrever<ResultadoDoCancelamento & { estado: string }>(`/api/jobs/${id}/cancelar`, {});
export const cancelarDoDocumento = (documentoId: string, secaoId?: string) =>
  escrever<ResultadoDoCancelamento>(`/api/documentos/${documentoId}/cancelar`, secaoId === undefined ? {} : { secao_id: secaoId });
export const apagaveis = (documentoId: string, secaoId?: string) =>
  pedir<Apagaveis>(`/api/documentos/${documentoId}/apagaveis${secaoId === undefined ? '' : `?secao=${encodeURIComponent(secaoId)}`}`);
export const apagarDoDocumento = (documentoId: string, quem: QuemApagar, opcoes: { secaoId?: string; confirmacao?: string } = {}) =>
  escrever<{ apagados: Record<string, Record<string, number>> }>(`/api/documentos/${documentoId}/apagar`, {
    quem, ...(opcoes.secaoId === undefined ? {} : { secao_id: opcoes.secaoId }), ...(opcoes.confirmacao === undefined ? {} : { confirmacao: opcoes.confirmacao }),
  });
/** Um grifo, do Codex ou do leitor. */
export const apagarGrifoDeQualquerUm = (marcaId: string) => pedir<unknown>(`/api/marcas/${marcaId}`, { method: 'DELETE' });
/** Uma relação, uma dificuldade ou um elemento da análise do capítulo. */
export const apagarItemDaAnalise = (compreensaoId: string, secaoId: string, itemId: string) =>
  pedir<unknown>(`/api/compreensoes/${compreensaoId}/capitulos/${secaoId}/itens/${itemId}`, { method: 'DELETE' });
/** O mapa do capítulo; `soPedido` só cancela um mapa sendo gerado (o pronto fica). */
export const apagarMapa = (compreensaoId: string, secaoId: string, soPedido = false) =>
  pedir<unknown>(`/api/compreensoes/${compreensaoId}/capitulos/${secaoId}/esquema${soPedido ? '?pendente=1' : ''}`, { method: 'DELETE' });

