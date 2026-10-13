/** Cliente dos flashcards (`servico/src/http/rotas-flashcards.ts`). */
import type { AncoraV1 } from '@margem/contratos';
import { escrever, pedir } from '../biblioteca/api';

export interface AgendaDoCartao { facilidade: number; intervalo_dias: number; repeticoes: number; proxima_revisao: string | null; revisoes: number }
export interface Flashcard {
  id: string;
  documento: { id: string; titulo: string; autor: string | null };
  versao_id: string;
  capitulo: { id: string; titulo: string };
  ancora: AncoraV1;
  frente: string;
  verso: string;
  origem: 'ia' | 'manual';
  criado_em: string;
  atualizado_em: string;
  agenda: AgendaDoCartao;
  link: string;
}
export interface ListaDeCartoes { cartoes: Flashcard[]; em_curso: string[] }
export type Nota = 1 | 2 | 3 | 4;

export interface ApiDosFlashcards {
  listar: (filtro: { documento?: string; hoje?: boolean }) => Promise<ListaDeCartoes>;
  revisar: (id: string, nota: Nota) => Promise<{ agenda: AgendaDoCartao }>;
  editar: (id: string, mudanca: { frente?: string; verso?: string }) => Promise<{ cartao: Flashcard }>;
  apagar: (id: string) => Promise<unknown>;
}

export function consultaDosCartoes(filtro: { documento?: string; hoje?: boolean }): string {
  const parametros = new URLSearchParams();
  if (filtro.documento) parametros.set('documento', filtro.documento);
  if (filtro.hoje) parametros.set('fila', 'hoje');
  return parametros.size ? `?${parametros}` : '';
}

export const API_DOS_FLASHCARDS: ApiDosFlashcards = {
  listar: (filtro) => pedir<ListaDeCartoes>(`/api/flashcards${consultaDosCartoes(filtro)}`),
  revisar: (id, nota) => escrever(`/api/flashcards/${id}/revisoes`, { nota }),
  editar: (id, mudanca) => escrever(`/api/flashcards/${id}`, mudanca, 'PATCH'),
  apagar: (id) => pedir(`/api/flashcards/${id}`, { method: 'DELETE' }),
};

/** Pede ao Codex os flashcards de um capítulo (o job entra na fila; o aviso do Codex mostra o andamento). */
export const pedirFlashcards = (versaoId: string, secaoId: string) =>
  escrever<{ job_id: string }>(`/api/versoes/${versaoId}/capitulos/${secaoId}/flashcards`, {});

export const criarFlashcard = (ancora: AncoraV1, frente: string, verso: string) =>
  escrever<{ cartao: Flashcard }>('/api/flashcards', { ancora, frente, verso });

/** "Na fila", "já em curso" ou o motivo, para o aviso de quem pediu. */
export async function pedirFlashcardsComAviso(versaoId: string, secaoId: string): Promise<string> {
  try {
    await pedirFlashcards(versaoId, secaoId);
    return 'Criando flashcards deste capítulo. Eles aparecem em Flashcards quando o Codex terminar.';
  } catch (falha) {
    const codigo = (falha as { codigo?: string }).codigo;
    if (codigo === 'flashcards_em_curso') return 'Os flashcards deste capítulo já estão sendo criados.';
    return falha instanceof Error ? `Não foi possível pedir os flashcards: ${falha.message}` : 'Não foi possível pedir os flashcards.';
  }
}
