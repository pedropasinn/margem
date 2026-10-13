/** Cliente dos visuais ancorados (J70). */
import type { AlvoDoVisual, Id, TipoDoVisual, VisualV1 } from '@margem/contratos';
import { pedir } from '../../biblioteca/api';

const JSON_CABECALHO = { 'Content-Type': 'application/json' };

export function listarVisuais(versaoId: Id, secaoId: Id): Promise<{ visuais: VisualV1[] }> {
  return pedir(`/api/versoes/${versaoId}/capitulos/${secaoId}/visuais`);
}

export function criarVisual(corpo: { tipo: TipoDoVisual; versao_id: Id; secao_id: Id; alvo: AlvoDoVisual; pedido?: string }): Promise<{ visual: VisualV1 }> {
  return pedir('/api/visuais', { method: 'POST', headers: JSON_CABECALHO, body: JSON.stringify(corpo) });
}

/** `pedido` ausente mantém o anterior; `null` tira. */
export function regenerarVisual(id: Id, pedido?: string | null): Promise<{ visual: VisualV1 }> {
  return pedir(`/api/visuais/${id}/regenerar`, { method: 'POST', headers: JSON_CABECALHO, body: JSON.stringify(pedido === undefined ? {} : { pedido }) });
}

export function apagarVisual(id: Id): Promise<{ visual_id: Id; apagado: true }> {
  return pedir(`/api/visuais/${id}`, { method: 'DELETE' });
}

export function urlDaImagem(id: Id): string {
  return `/api/visuais/${id}/imagem`;
}
