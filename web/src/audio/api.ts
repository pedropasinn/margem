/**
 * Cliente das rotas do áudio gerado no app (J106): configuração da ElevenLabs e narração do capítulo.
 * A chave só sobe (PUT/testar); a API nunca a devolve — só "configurada" e os 4 últimos caracteres.
 */
import type { AncoraV1, Id } from '@margem/contratos';
import { pedir } from '../biblioteca/api';

export interface ModeloDeVoz { id: string; nome: string; creditos_por_caractere: number; usd_por_mil: number }
export interface ConfiguracaoDeAudio {
  provedor: 'elevenlabs';
  chave: { configurada: boolean; final: string | null };
  voz: { id: string; nome: string | null } | null;
  modelo_id: string;
  modelos: ModeloDeVoz[];
  guardada: string;
}
export interface VozDaConta { id: string; nome: string; categoria?: string; descricao?: string }

const JSON_ = { 'Content-Type': 'application/json' };

export const lerConfiguracaoDeAudio = (): Promise<ConfiguracaoDeAudio> => pedir('/api/configuracoes/audio');
export const gravarChaveDeAudio = (chave: string): Promise<ConfiguracaoDeAudio> =>
  pedir('/api/configuracoes/audio/chave', { method: 'PUT', headers: JSON_, body: JSON.stringify({ chave }) });
export const apagarChaveDeAudio = (): Promise<ConfiguracaoDeAudio> => pedir('/api/configuracoes/audio/chave', { method: 'DELETE' });
export const testarChaveDeAudio = (chave?: string): Promise<{ ok: true; creditos_restantes?: number }> =>
  pedir('/api/configuracoes/audio/testar', { method: 'POST', headers: JSON_, body: JSON.stringify(chave ? { chave } : {}) });
export const listarVozesDaConta = (): Promise<{ vozes: VozDaConta[] }> => pedir('/api/configuracoes/audio/vozes');
export const gravarPreferenciasDeAudio = (p: { voz_id: string | null; voz_nome: string | null; modelo_id: string }): Promise<ConfiguracaoDeAudio> =>
  pedir('/api/configuracoes/audio/preferencias', { method: 'PUT', headers: JSON_, body: JSON.stringify(p) });

export type EstadoDaNarracao = 'nenhum' | 'pendente' | 'executando' | 'pronto' | 'falhou';
export interface SituacaoDaNarracao {
  estado: EstadoDaNarracao;
  pedido_id: Id | null;
  progresso: { feitos: number; total: number } | null;
  codigo?: string;
  motivo?: string;
  chave_configurada: boolean;
}
export interface PreviaDaNarracao {
  caracteres: number; pedidos: number; creditos: number; custo_usd: number; cenas: number;
  modelo_id: string; modelo_nome: string; voz_id: string | null; voz_nome: string | null; titulo: string;
}

const base = (versaoId: Id, secaoId: Id): string => `/api/versoes/${versaoId}/capitulos/${secaoId}/narracao`;
export const situacaoDaNarracao = (versaoId: Id, secaoId: Id): Promise<SituacaoDaNarracao> => pedir(base(versaoId, secaoId));
export const previaDaNarracao = (versaoId: Id, secaoId: Id, trecho: AncoraV1 | null): Promise<PreviaDaNarracao> =>
  pedir(`${base(versaoId, secaoId)}/previa`, { method: 'POST', headers: JSON_, body: JSON.stringify(trecho ? { trecho } : {}) });
export const gerarNarracao = (versaoId: Id, secaoId: Id, trecho: AncoraV1 | null, caracteres: number): Promise<SituacaoDaNarracao> =>
  pedir(base(versaoId, secaoId), { method: 'POST', headers: JSON_, body: JSON.stringify({ ...(trecho ? { trecho } : {}), caracteres_confirmados: caracteres }) });

/** "US$ 0,16": vírgula decimal; abaixo de um centavo, "menos de US$ 0,01". */
export function rotuloDoCusto(usd: number): string {
  if (usd < 0.01) return 'menos de US$ 0,01';
  return `US$ ${usd.toFixed(2).replace('.', ',')}`;
}
export const numero = (n: number): string => n.toLocaleString('pt-BR');
