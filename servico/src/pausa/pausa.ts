/**
 * Trabalho do Codex parado não volta a rodar sozinho (V-F1, decisão de produto: "perguntar antes").
 *
 * Ao partir, o worker põe em pausa o trabalho do Codex que esperava havia mais de `ESPERA_PARA_PAUSAR_MS`
 * (3 h por padrão; `MARGEM_PAUSAR_PARADOS_H` troca, `0` desliga):
 *
 * - os jobs que chamam o Codex na fila, adiados ou com a concessão vencida (o app fechou no meio), cuja
 *   última atividade (`atualizado_em`: criação, adiamento, batida, retomada) é anterior ao limite. A
 *   canonização, o vídeo do YouTube e a narração não chamam o Codex: seguem sempre (`TIPOS_SEM_CODEX`);
 * - as preparações que esperavam o tipo do texto (`documento.preparacao_pedida`) pedidas antes do limite: o
 *   `seguirSemTipo` as começaria todas de uma vez com o tipo padrão.
 *
 * Em pausa, o worker não reserva o job (`repos/jobs.ts`, `reservar`) e o `seguirSemTipo` não começa a
 * preparação. A janela mostra "N trabalhos do Codex esperando" com Retomar, Ver e Descartar
 * (`http/rotas-pausa.ts`). O que for pedido depois da partida não ganha a marca; pedir de novo o mesmo
 * trabalho (abrir o capítulo, clicar em Analisar) o tira da pausa.
 */
import type { Id } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import { cancelarOperacoes } from '../apagar/cancelar.js';
import { CANCELAVEIS } from '../repos/jobs.js';

/** Quanto tempo parado faz um trabalho do Codex esperar a pessoa na partida do worker. */
export const ESPERA_PARA_PAUSAR_MS = 3 * 60 * 60_000;

/** `MARGEM_PAUSAR_PARADOS_H` (horas, aceita fração) troca o limite; `0` desliga a pausa. `null` = desligada. */
export function esperaParaPausarMs(ambiente: NodeJS.ProcessEnv = process.env): number | null {
  const bruto = ambiente.MARGEM_PAUSAR_PARADOS_H;
  if (bruto === undefined || bruto.trim() === '') return ESPERA_PARA_PAUSAR_MS;
  const horas = Number(bruto);
  if (!Number.isFinite(horas) || horas < 0) return ESPERA_PARA_PAUSAR_MS;
  return horas === 0 ? null : Math.round(horas * 60 * 60_000);
}

/** Jobs que não chamam o Codex (motor local, download, voz): nunca entram em pausa. */
export const TIPOS_SEM_CODEX: readonly string[] = ['canonizar', 'canonizar_revisao', 'importar_youtube', 'narrar_audio', 'narrar_noticias'];

/** Prefixo do id da preparação em pausa na API (ela não é um job: é o pedido guardado no documento). */
export const PREFIXO_DA_PREPARACAO = 'preparacao:';

export interface ResultadoDaPausa { jobs: Id[]; preparacoes: Id[] }

/**
 * Põe em pausa o trabalho do Codex parado desde antes de `partida - esperaMs`. Idempotente: o que já está
 * em pausa fica como está. Cada job pausado ganha o evento `retido` (o aviso do banco acorda a janela).
 */
export async function pausarParados(cliente: Transacao, opcoes: { partida: Date; esperaMs: number }): Promise<ResultadoDaPausa> {
  const limite = new Date(opcoes.partida.getTime() - opcoes.esperaMs);
  const jobs = (await cliente.query<{ id: Id }>(`UPDATE job SET retido_em=$1
    WHERE retido_em IS NULL AND cancel_requested_at IS NULL AND NOT (tipo = ANY($3::text[])) AND atualizado_em <= $2
      AND (estado IN ('fila','adiado') OR (estado='reservado' AND lease_expires_at <= $1))
    RETURNING id`, [opcoes.partida, limite, TIPOS_SEM_CODEX])).rows.map((linha) => linha.id);
  for (const id of jobs) {
    await cliente.query('INSERT INTO evento_job(job_id,tipo,detalhe) VALUES ($1,$2,$3)', [id, 'retido', JSON.stringify({ limite: limite.toISOString() })]);
  }
  // `em` é gravado pelo próprio serviço (ISO); um pedido sem data legível conta como antigo.
  const preparacoes = (await cliente.query<{ id: Id }>(`UPDATE documento SET preparacao_retida_em=$1
    WHERE preparacao_pedida IS NOT NULL AND tipo_de_texto IS NULL AND preparacao_retida_em IS NULL
      AND (CASE WHEN preparacao_pedida->>'em' ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN (preparacao_pedida->>'em')::timestamptz <= $2 ELSE true END)
    RETURNING id`, [opcoes.partida, limite])).rows.map((linha) => linha.id);
  return { jobs, preparacoes };
}

// ---------------------------------------------------------------- lista

/** O que é cada trabalho, em palavras da interface (sem "job" nem o nome interno do tipo). */
export function rotuloDoTrabalho(tipo: string): string {
  switch (tipo) {
    case 'ler_parte': case 'analisar_passagens': case 'revisar_consistencia':
    case 'sintetizar_capitulo': case 'revisar_capitulo': case 'planejar_leitura':
      return 'Análise do texto';
    case 'identificar_tipo': return 'Reconhecer o tipo do texto';
    case 'gerar_esquema': return 'Mapa do capítulo';
    case 'gerar_flashcards': return 'Flashcards';
    case 'roteirizar_visita': return 'Visita guiada';
    case 'comentar_leitura': return 'Leitura comentada';
    case 'gerar_imagem': return 'Imagem';
    case 'gerar_diagrama': return 'Fluxograma';
    case 'resolver_exercicio': return 'Resolução de exercício';
    case 'explicar_resolucao': return 'Explicação de uma resolução';
    case 'revisar_anotacao': return 'Revisão de uma nota';
    case 'responder': return 'Resposta a uma pergunta';
    case 'responder_agente': return 'Resposta na página Perguntar';
    case 'revisar_transcricao': return 'Transcrição passada a limpo';
    case 'conceitos_do_video': return 'Partes e momentos do vídeo';
    case 'transcrever_escaneado': return 'Transcrição das páginas escaneadas';
    case 'preparar_quadro': return 'Análise do quadro';
    case 'editar_noticias': return 'Edição das notícias';
    case 'ilustrar_noticias': return 'Capa das notícias';
    default: return 'Trabalho do Codex';
  }
}
const ROTULO_DA_PREPARACAO = 'Análise pedida antes';

export interface ItemEmPausa {
  /** Os ids que "Retomar" e "Descartar" deste item recebem (jobs, ou `preparacao:<documento>`). */
  ids: Id[];
  rotulo: string;
  quantidade: number;
  /** O mais antigo do item (ISO). */
  desde: string;
}
export interface GrupoEmPausa { documento_id: Id | null; titulo: string | null; itens: ItemEmPausa[] }
export interface TrabalhosEmPausa {
  /** Quantos trabalhos esperam (jobs mais preparações). */
  total: number;
  /** O mais antigo de todos (ISO); `null` sem nada em pausa. */
  desde: string | null;
  grupos: GrupoEmPausa[];
}

interface Linha { id: Id; tipo: string | null; documento_id: Id | null; titulo: string | null; desde: string }
const iso = (coluna: string) => `to_char(${coluna} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** Os trabalhos em pausa, por documento e pelo que são (as etapas da análise de um texto viram um item só). */
export async function listarEmPausa(cliente: Transacao): Promise<TrabalhosEmPausa> {
  const linhas = (await cliente.query<Linha>(`
    SELECT j.id::text AS id, j.tipo, d.id AS documento_id, d.titulo, ${iso('j.atualizado_em')} AS desde, j.atualizado_em AS ordem
      FROM job j LEFT JOIN versao_texto v ON v.id=j.versao_id LEFT JOIN documento d ON d.id=coalesce(j.documento_id, v.documento_id)
      WHERE j.retido_em IS NOT NULL AND j.estado = ANY($1::text[])
    UNION ALL
    SELECT '${PREFIXO_DA_PREPARACAO}' || d.id, NULL, d.id, d.titulo,
        ${iso(`coalesce(CASE WHEN d.preparacao_pedida->>'em' ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN (d.preparacao_pedida->>'em')::timestamptz END, d.preparacao_retida_em)`)},
        coalesce(CASE WHEN d.preparacao_pedida->>'em' ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN (d.preparacao_pedida->>'em')::timestamptz END, d.preparacao_retida_em)
      FROM documento d WHERE d.preparacao_retida_em IS NOT NULL AND d.preparacao_pedida IS NOT NULL
    ORDER BY ordem, id`, [CANCELAVEIS])).rows;
  const grupos = new Map<string, GrupoEmPausa>();
  for (const linha of linhas) {
    const chave = linha.documento_id ?? '';
    let grupo = grupos.get(chave);
    if (!grupo) { grupo = { documento_id: linha.documento_id, titulo: linha.titulo, itens: [] }; grupos.set(chave, grupo); }
    const rotulo = linha.tipo === null ? ROTULO_DA_PREPARACAO : rotuloDoTrabalho(linha.tipo);
    const item = grupo.itens.find((outro) => outro.rotulo === rotulo);
    if (item) { item.ids.push(linha.id); item.quantidade += 1; continue; }
    grupo.itens.push({ ids: [linha.id], rotulo, quantidade: 1, desde: linha.desde });
  }
  // Os sem documento (uma pergunta na página Perguntar, as notícias) vão por último.
  const ordenados = [...grupos.values()].sort((a, b) => Number(a.documento_id === null) - Number(b.documento_id === null));
  return { total: linhas.length, desde: linhas[0]?.desde ?? null, grupos: ordenados };
}

// ---------------------------------------------------------------- retomar e descartar

function separar(ids: readonly Id[]): { jobs: Id[]; documentos: Id[] } {
  const jobs: Id[] = [];
  const documentos: Id[] = [];
  for (const id of ids) {
    if (id.startsWith(PREFIXO_DA_PREPARACAO)) documentos.push(id.slice(PREFIXO_DA_PREPARACAO.length));
    else jobs.push(id);
  }
  return { jobs, documentos };
}

/** `todos` ou os ids da lista; devolve os ids em pausa que o pedido alcança. */
async function alvos(cliente: Transacao, pedido: { todos: true } | { ids: readonly Id[] }): Promise<{ jobs: Id[]; documentos: Id[] }> {
  const filtro = 'todos' in pedido ? null : separar(pedido.ids);
  const jobs = (await cliente.query<{ id: Id }>(`SELECT id FROM job WHERE retido_em IS NOT NULL AND estado = ANY($1::text[])
    AND ($2::text[] IS NULL OR id = ANY($2::text[])) ORDER BY id FOR UPDATE`, [CANCELAVEIS, filtro?.jobs ?? null])).rows.map((linha) => linha.id);
  const documentos = (await cliente.query<{ id: Id }>(`SELECT id FROM documento WHERE preparacao_retida_em IS NOT NULL
    AND ($1::text[] IS NULL OR id = ANY($1::text[])) ORDER BY id FOR UPDATE`, [filtro?.documentos ?? null])).rows.map((linha) => linha.id);
  return { jobs, documentos };
}

export interface ResultadoDaRetomada { retomados: number }

/**
 * Tira da pausa: os jobs voltam a ser reservados pela ordem de sempre (o evento `retomado` acorda o worker
 * na hora) e a preparação que esperava o tipo começa na próxima volta do `seguirSemTipo` (até 15 s).
 */
export async function retomar(cliente: Transacao, pedido: { todos: true } | { ids: readonly Id[] }): Promise<ResultadoDaRetomada> {
  const { jobs, documentos } = await alvos(cliente, pedido);
  if (jobs.length > 0) {
    await cliente.query('UPDATE job SET retido_em=NULL, atualizado_em=clock_timestamp() WHERE id = ANY($1::text[])', [jobs]);
    for (const id of jobs) await cliente.query('INSERT INTO evento_job(job_id,tipo,detalhe) VALUES ($1,$2,$3)', [id, 'retomado', JSON.stringify({ motivo: 'pessoa' })]);
  }
  if (documentos.length > 0) await cliente.query('UPDATE documento SET preparacao_retida_em=NULL WHERE id = ANY($1::text[])', [documentos]);
  return { retomados: jobs.length + documentos.length };
}

export interface ResultadoDoDescarte { descartados: number }

/**
 * Descarta: cada job em pausa é cancelado pelo caminho de sempre (`cancelarOperacoes`: a análise
 * incompleta do capítulo sai, o pedido guardado também) e a preparação à espera do tipo é esquecida.
 */
export async function descartar(cliente: Transacao, pedido: { todos: true } | { ids: readonly Id[] }): Promise<ResultadoDoDescarte> {
  const { jobs, documentos } = await alvos(cliente, pedido);
  let descartados = 0;
  for (const id of jobs) {
    // Um job anterior da mesma análise pode já ter levado este junto (o capítulo inteiro sai).
    const ativo = (await cliente.query('SELECT 1 FROM job WHERE id=$1 AND estado = ANY($2::text[])', [id, CANCELAVEIS])).rowCount ?? 0;
    if (ativo > 0) await cancelarOperacoes(cliente, { job_id: id });
    descartados += 1;
  }
  if (documentos.length > 0) {
    await cliente.query('UPDATE documento SET preparacao_pedida=NULL, preparacao_retida_em=NULL WHERE id = ANY($1::text[])', [documentos]);
    descartados += documentos.length;
  }
  return { descartados };
}
