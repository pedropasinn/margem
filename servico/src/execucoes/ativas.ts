/**
 * Execuções do Codex visíveis na interface: os jobs que chamam o `codex exec` e estão na fila,
 * rodando ou terminaram há pouco, cada um com um rótulo em português, o documento, a seção e o
 * caminho do leitor onde o resultado aparece. Só leitura: nada aqui escreve no banco.
 *
 * A canonização (motor Python) fica de fora: não é o Codex. Jobs cancelados também: quem cancelou
 * já sabe. O trabalho em pausa (V-F1) também: ele tem o aviso próprio, "N trabalhos esperando".
 */
import type { ExecucaoDoCodexV2, ExecucoesDoCodexV2, Id, JobResultV1 } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import { mensagemDosAvisos, resumirAvisos } from './avisos.js';

/** Tipos de job que rodam o Codex, com o verbo do rótulo. */
export const TIPOS_DO_CODEX = [
  'ler_parte', 'revisar_consistencia',
  'analisar_passagens', 'sintetizar_capitulo', 'revisar_capitulo', 'planejar_leitura',
  'resolver_exercicio', 'explicar_resolucao', 'revisar_anotacao', 'responder',
  'gerar_imagem', 'gerar_diagrama', 'gerar_esquema', 'roteirizar_visita', 'comentar_leitura', 'gerar_flashcards', 'responder_agente',
  // J142: a análise do vídeo (transcrição passada a limpo; partes e momentos sobre o vídeo).
  'revisar_transcricao', 'conceitos_do_video',
] as const;
export type TipoDoCodex = typeof TIPOS_DO_CODEX[number];

/** Tipos cuja `dedup_key` traz a seção na terceira posição (`<prefixo>:<execução>:<seção>:…`). */
const SECAO_NA_CHAVE: readonly TipoDoCodex[] = [
  'sintetizar_capitulo', 'revisar_capitulo', 'planejar_leitura', 'gerar_esquema', 'roteirizar_visita', 'comentar_leitura', 'gerar_flashcards',
];

/** Quanto tempo uma execução terminada continua na lista. */
export const JANELA_DE_TERMINADAS_MS = 5 * 60_000;
/** Teto da lista; o resto (sempre o fim da fila) vira `omitidas`. */
export const LIMITE_DA_LISTA = 50;

export interface LinhaDaExecucao {
  id: Id; tipo: string; estado: 'fila' | 'reservado' | 'adiado' | 'ok' | 'falhou';
  error_code: string | null; inicio: string; fim: string | null;
  /** V-W2: frase legível da causa, quando o executor a reconheceu no stderr (diagnóstico `causa`). */
  causa?: string | null;
  documento_id: Id | null; documento_titulo: string | null;
  secao_id: Id | null; secao_titulo: string | null; secao_numero: number | null;
  /** Os da tentativa vencedora (ou da última); só os de um job `ok` viram avisos. */
  diagnosticos?: JobResultV1['diagnosticos'] | null;
}

const TITULO_MAXIMO = 60;
function encurtar(texto: string): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length <= TITULO_MAXIMO ? limpo : `${limpo.slice(0, TITULO_MAXIMO - 1).trimEnd()}…`;
}

interface Alvo { o: string; de: string }
/** "o capítulo 3 de Mixtape" / "do capítulo 3 de Mixtape"; sem número, o título entre aspas. */
function alvoDa(linha: LinhaDaExecucao): Alvo | null {
  const documento = linha.documento_titulo ? encurtar(linha.documento_titulo) : null;
  const doDocumento = documento ? ` de ${documento}` : '';
  if (linha.secao_numero !== null) {
    return { o: `o capítulo ${String(linha.secao_numero)}${doDocumento}`, de: `do capítulo ${String(linha.secao_numero)}${doDocumento}` };
  }
  if (linha.secao_titulo) {
    const titulo = `“${encurtar(linha.secao_titulo)}”`;
    return { o: titulo, de: `de ${titulo}` };
  }
  return documento ? { o: documento, de: `de ${documento}` } : null;
}

/** O rótulo humano da execução, em português. */
export function rotuloDaExecucao(linha: LinhaDaExecucao): string {
  const alvo = alvoDa(linha);
  const com = (verbo: string, forma: keyof Alvo, sem: string) => alvo ? `${verbo} ${alvo[forma]}` : sem;
  switch (linha.tipo as TipoDoCodex) {
    case 'ler_parte':
    case 'analisar_passagens': return com('Lendo', 'o', 'Lendo o texto');
    case 'revisar_consistencia': return com('Revisando as marcas', 'de', 'Revisando as marcas');
    case 'sintetizar_capitulo': return com('Resumindo', 'o', 'Resumindo o capítulo');
    case 'revisar_capitulo': return com('Conferindo a compreensão', 'de', 'Conferindo a compreensão');
    case 'planejar_leitura': return com('Planejando o estudo', 'de', 'Planejando o estudo');
    case 'gerar_imagem': return com('Desenhando uma imagem para', 'o', 'Desenhando uma imagem');
    case 'gerar_diagrama': return com('Desenhando um fluxograma para', 'o', 'Desenhando um fluxograma');
    case 'gerar_esquema': return com('Montando o mapa', 'de', 'Montando o mapa do capítulo');
    case 'roteirizar_visita': return com('Preparando a visita guiada', 'de', 'Preparando a visita guiada');
    case 'comentar_leitura': return com('Preparando a leitura comentada', 'de', 'Preparando a leitura comentada');
    case 'gerar_flashcards': return com('Criando flashcards', 'de', 'Criando flashcards do capítulo');
    case 'revisar_transcricao': return com('Passando a limpo a transcrição', 'de', 'Passando a limpo a transcrição');
    case 'conceitos_do_video': return com('Separando as partes e os momentos', 'de', 'Separando as partes e os momentos do vídeo');
    case 'responder': return 'Respondendo à sua pergunta';
    case 'responder_agente': return 'Lendo a biblioteca para responder';
    case 'revisar_anotacao': return 'Revisando sua nota';
    case 'resolver_exercicio': return 'Resolvendo o exercício';
    case 'explicar_resolucao': return 'Explicando a resolução';
    default: return 'O Codex está trabalhando';
  }
}

/** Por que falhou (ou por que espera, quando adiado), em uma frase curta. Nunca o texto cru do erro. */
export function mensagemDaExecucao(linha: Pick<LinhaDaExecucao, 'estado' | 'error_code' | 'causa'>): string | null {
  if (linha.estado === 'adiado') {
    return linha.error_code === 'cota'
      ? 'A cota do Codex da sua conta acabou por agora. Esta leitura espera na fila e continua sozinha quando ela voltar.'
      : 'Vai tentar de novo daqui a pouco.';
  }
  if (linha.estado !== 'falhou') return null;
  // A causa vem de uma tabela fixa do serviço (`executor/stderr.ts`), nunca do texto cru do erro.
  if (linha.causa) return linha.causa.slice(0, 200);
  switch (linha.error_code) {
    case 'cota': return 'A cota do Codex da sua conta acabou. Peça de novo quando ela voltar.';
    case 'auth': return 'O Codex não está conectado à sua conta do ChatGPT. Entre de novo (o aviso no topo mostra o comando) e peça outra vez.';
    case 'timeout': return 'O Codex demorou demais e parou.';
    case 'processo': return 'O Codex parou antes de terminar.';
    case 'json_invalido':
    case 'schema': return 'A resposta do Codex veio num formato que não deu para usar.';
    case 'cli_incompativel': return 'A versão instalada do Codex é antiga para o Margem. Atualize o Codex e peça outra vez.';
    case 'sem_imagem': return 'O Codex terminou sem gerar a imagem.';
    case 'publicacao': return 'O Codex terminou, mas o resultado não pôde ser guardado no disco.';
    default: return 'O Codex não conseguiu terminar.';
  }
}

const ESTADO: Record<LinhaDaExecucao['estado'], ExecucaoDoCodexV2['estado']> = {
  fila: 'na_fila', adiado: 'na_fila', reservado: 'rodando', ok: 'concluida', falhou: 'falhou',
};

export function projetarExecucao(linha: LinhaDaExecucao): ExecucaoDoCodexV2 {
  const estado = ESTADO[linha.estado];
  const terminou = estado === 'concluida' || estado === 'falhou';
  const documento = linha.documento_id === null ? null : { id: linha.documento_id, titulo: linha.documento_titulo ?? '' };
  const secao = linha.secao_id === null ? null : { id: linha.secao_id, titulo: linha.secao_titulo ?? '', numero: linha.secao_numero };
  let rota: string | null = null;
  if (linha.tipo === 'responder_agente') rota = '/perguntar';
  else if (documento) {
    // Revisão de marcas e resolução não pertencem a um capítulo: abrem o leitor no ponto da leitura.
    rota = linha.tipo === 'gerar_flashcards' ? `/documentos/${documento.id}/flashcards`
      : secao ? `/ler/${documento.id}/${secao.id}` : `/ler/${documento.id}`;
  }
  // `fim` antes de `inicio` só aconteceria com relógios fora de ordem; o contrato não aceita.
  const fim = terminou ? (linha.fim !== null && Date.parse(linha.fim) >= Date.parse(linha.inicio) ? linha.fim : linha.inicio) : null;
  // Concluída com ressalvas (leitura parcial, marcas que não ancoraram…): os avisos e um resumo.
  const avisos = estado === 'concluida' ? resumirAvisos(linha.tipo, linha.diagnosticos) : [];
  return {
    id: linha.id, tipo: linha.tipo, rotulo: rotuloDaExecucao(linha), estado,
    inicio: linha.inicio, fim, documento, secao, rota,
    mensagem: estado === 'concluida' ? mensagemDosAvisos(avisos) : mensagemDaExecucao(linha),
    avisos,
  };
}

const iso = (coluna: string) => `to_char(${coluna} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * A lista que a interface mostra: rodando, falhas e conclusões recentes primeiro, depois a fila
 * (por prioridade, como o worker a consome). `agora` vem do chamador para os testes.
 */
export async function listarExecucoes(cliente: Transacao, agora: Date = new Date()): Promise<ExecucoesDoCodexV2> {
  const desde = new Date(agora.getTime() - JANELA_DE_TERMINADAS_MS);
  const linhas = (await cliente.query<LinhaDaExecucao & { total: number }>(`
    WITH alvo AS (
      SELECT j.id, j.tipo, j.estado, j.error_code, j.diagnosticos, j.dedup_key, j.parte_id, j.versao_id, j.prioridade, j.criado_em,
        coalesce(j.documento_id, v.documento_id) AS documento_id,
        CASE WHEN j.estado IN ('fila','adiado') THEN j.criado_em
          ELSE coalesce((SELECT max(e.quando) FROM evento_job e WHERE e.job_id=j.id AND e.tipo='reservado'), j.criado_em) END AS inicio,
        CASE WHEN j.estado IN ('ok','falhou') THEN j.atualizado_em END AS fim,
        count(*) OVER ()::int AS total
      FROM job j LEFT JOIN versao_texto v ON v.id=j.versao_id
      WHERE j.tipo = ANY($1::text[]) AND j.retido_em IS NULL
        AND (j.estado IN ('fila','reservado','adiado') OR (j.estado IN ('ok','falhou') AND j.atualizado_em > $2))
      ORDER BY CASE j.estado WHEN 'reservado' THEN 0 WHEN 'falhou' THEN 1 WHEN 'ok' THEN 2 ELSE 3 END,
        CASE WHEN j.estado IN ('ok','falhou') THEN j.atualizado_em END DESC NULLS LAST,
        j.prioridade DESC, j.criado_em, j.id
      LIMIT $4
    )
    SELECT a.id, a.tipo, a.estado, a.error_code, a.diagnosticos, a.total, ${iso('a.inicio')} AS inicio, ${iso('a.fim')} AS fim,
      CASE WHEN a.estado = 'falhou' THEN (SELECT d->>'mensagem' FROM jsonb_array_elements(a.diagnosticos) d WHERE d->>'codigo' = 'causa' LIMIT 1) END AS causa,
      d.id AS documento_id, d.titulo AS documento_titulo,
      s.id AS secao_id, s.titulo AS secao_titulo, s.numero AS secao_numero
    FROM alvo a
    LEFT JOIN documento d ON d.id=a.documento_id
    LEFT JOIN LATERAL (
      SELECT
        CASE WHEN a.tipo = ANY($3::text[]) THEN split_part(a.dedup_key, ':', 3)
          WHEN a.tipo IN ('gerar_imagem','gerar_diagrama') THEN (SELECT vi.secao_id FROM visual vi WHERE vi.job_id=a.id LIMIT 1)
        END AS secao_id,
        CASE WHEN a.tipo IN ('ler_parte','analisar_passagens') THEN (SELECT p.blocos_responsaveis->>0 FROM parte p WHERE p.id=a.parte_id)
          WHEN a.tipo='responder' THEN (SELECT c.bloco_id FROM conversa c WHERE c.id::text=split_part(a.dedup_key, ':', 2))
          WHEN a.tipo='revisar_anotacao' THEN (SELECT an.bloco_id FROM anotacao an WHERE an.id::text=split_part(a.dedup_key, ':', 2))
        END AS bloco_id
    ) ref ON true
    LEFT JOIN LATERAL (
      SELECT x.id, x.titulo,
        CASE WHEN x.nivel=1 THEN (SELECT count(*)::int FROM secao y WHERE y.versao_id=x.versao_id AND y.nivel=1 AND y.ordem<=x.ordem) END AS numero
      FROM secao x
      WHERE x.versao_id=a.versao_id AND (
        x.id::text=ref.secao_id
        OR (ref.secao_id IS NULL AND ref.bloco_id IS NOT NULL AND x.nivel=1
          AND (SELECT b.ordem FROM bloco b WHERE b.versao_id=a.versao_id AND b.id::text=ref.bloco_id)
            BETWEEN (SELECT b.ordem FROM bloco b WHERE b.versao_id=x.versao_id AND b.id=x.bloco_inicio)
                AND (SELECT b.ordem FROM bloco b WHERE b.versao_id=x.versao_id AND b.id=x.bloco_fim)))
      ORDER BY x.ordem LIMIT 1
    ) s ON true
    ORDER BY CASE a.estado WHEN 'reservado' THEN 0 WHEN 'falhou' THEN 1 WHEN 'ok' THEN 2 ELSE 3 END,
      a.fim DESC NULLS LAST, a.prioridade DESC, a.criado_em, a.id`,
  [TIPOS_DO_CODEX, desde, SECAO_NA_CHAVE, LIMITE_DA_LISTA])).rows;
  const total = linhas[0]?.total ?? 0;
  return {
    versao: 2,
    gerado_em: agora.toISOString(),
    execucoes: linhas.map(projetarExecucao),
    omitidas: Math.max(0, total - linhas.length),
  };
}
