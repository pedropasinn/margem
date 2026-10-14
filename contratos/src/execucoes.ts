/**
 * Execuções do Codex visíveis na interface (avisos no canto da tela): o que está na fila, rodando
 * ou acabou de terminar. É uma projeção de leitura da fila de jobs, montada pelo serviço; o leitor
 * só a mostra. `GET /api/execucoes/ativas` devolve uma; `GET /api/execucoes/eventos` (SSE) manda
 * uma nova a cada mudança.
 *
 * Invariantes além do schema:
 * - `fim` é `null` exatamente quando a execução ainda não terminou (`na_fila`, `rodando`);
 * - `fim` nunca vem antes de `inicio`;
 * - `mensagem` só aparece em `falhou` ou `na_fila` (a fila explica uma espera, como a cota);
 * - ids não se repetem.
 *
 * A V2 (`ExecucoesDoCodexV2`) acrescenta `avisos` a cada execução: o que a tentativa vencedora deixou
 * de ressalva (leitura parcial, marcas que não ancoraram, narração aproximada…), já em frases para
 * quem lê. Nela, `mensagem` também pode vir em `concluida`, mas só quando há aviso (resume os avisos).
 * Avisos só existem em `concluida`. A V1 continua válida para quem ainda a lê.
 */
import type { Id } from './tipos';

export type EstadoDaExecucaoV1 = 'na_fila' | 'rodando' | 'concluida' | 'falhou';
export const ESTADOS_DA_EXECUCAO: readonly EstadoDaExecucaoV1[] = ['na_fila', 'rodando', 'concluida', 'falhou'];

export interface ExecucaoDoCodexV1 {
  /** O id do job. */
  id: Id;
  /** O tipo do job (`ler_parte`, `responder`…). */
  tipo: string;
  /** Em português, para quem lê: "Lendo o capítulo 3 de Mixtape". */
  rotulo: string;
  estado: EstadoDaExecucaoV1;
  /** Na fila: quando entrou. Nos outros estados: quando a tentativa atual começou a rodar. */
  inicio: string;
  fim: string | null;
  documento: { id: Id; titulo: string } | null;
  secao: { id: Id; titulo: string; numero: number | null } | null;
  /** Caminho do leitor onde o resultado aparece (`/ler/<doc>/<seção>`), ou `null`. */
  rota: string | null;
  /** Curta, em português: por que falhou ou por que espera. */
  mensagem: string | null;
}

export interface ExecucoesDoCodexV1 {
  versao: 1;
  gerado_em: string;
  execucoes: ExecucaoDoCodexV1[];
  /** Quantas ficaram de fora do limite da lista (todas na fila). */
  omitidas: number;
}

export function regrasExecucoesDoCodex(valor: ExecucoesDoCodexV1): boolean {
  const ids = new Set<string>();
  for (const execucao of valor.execucoes) {
    if (ids.has(execucao.id)) return false;
    ids.add(execucao.id);
    const terminou = execucao.estado === 'concluida' || execucao.estado === 'falhou';
    if (terminou !== (execucao.fim !== null)) return false;
    if (execucao.fim !== null && Date.parse(execucao.fim) < Date.parse(execucao.inicio)) return false;
    if (execucao.mensagem !== null && execucao.estado !== 'falhou' && execucao.estado !== 'na_fila') return false;
    if (execucao.mensagem !== null && execucao.mensagem.trim() === '') return false;
  }
  return true;
}

/** Uma ressalva de uma execução concluída, em português para quem lê (nunca o texto cru do erro). */
export interface AvisoDaExecucaoV2 {
  /** O código do diagnóstico de origem (`leitura_parcial`, `alinhamento_aproximado`…). */
  codigo: string;
  mensagem: string;
}

export interface ExecucaoDoCodexV2 extends ExecucaoDoCodexV1 {
  /** Vazio fora de `concluida`; em `concluida`, as ressalvas da tentativa vencedora. */
  avisos: AvisoDaExecucaoV2[];
}

export interface ExecucoesDoCodexV2 {
  versao: 2;
  gerado_em: string;
  execucoes: ExecucaoDoCodexV2[];
  omitidas: number;
}

export function regrasExecucoesDoCodexV2(valor: ExecucoesDoCodexV2): boolean {
  const ids = new Set<string>();
  for (const execucao of valor.execucoes) {
    if (ids.has(execucao.id)) return false;
    ids.add(execucao.id);
    const terminou = execucao.estado === 'concluida' || execucao.estado === 'falhou';
    if (terminou !== (execucao.fim !== null)) return false;
    if (execucao.fim !== null && Date.parse(execucao.fim) < Date.parse(execucao.inicio)) return false;
    if (execucao.avisos.length > 0 && execucao.estado !== 'concluida') return false;
    const comAviso = execucao.estado === 'concluida' && execucao.avisos.length > 0;
    if (execucao.mensagem !== null && execucao.estado !== 'falhou' && execucao.estado !== 'na_fila' && !comAviso) return false;
    if (execucao.mensagem !== null && execucao.mensagem.trim() === '') return false;
    if (execucao.avisos.some((aviso) => aviso.mensagem.trim() === '')) return false;
  }
  return true;
}
