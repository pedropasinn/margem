/**
 * Consultas de leitura da API: estado da biblioteca, detalhe do documento,
 * árvore de seções e snapshot de capítulo.
 *
 * Tudo aqui é leitura. A escrita continua nos repositórios do J03 e nos
 * manipuladores do J06; nenhuma rota monta SQL a partir de texto do cliente.
 */
import { mensagemDaFalha } from '../compreensao/mensagens.js';
import type {
  AnotacaoV1, AvisoDaExecucaoV2, DificuldadeV1, Bloco, CanonicoV1, ConexaoV2, EtiquetaV1, Id, JobResultV1, MarcaV2, ReferenciaModo, Secao,
} from '@margem/contratos';
import { hashMarcas } from '@margem/contratos';
import { completarPaginasDoCapitulo, paginasDoCapitulo } from '@margem/core';
import type { Transacao } from '../db/transacao.js';
import * as anotacoesRepo from '../repos/anotacoes.js';
import * as camadasRepo from '../repos/camadas.js';
import * as conexoesRepo from '../repos/conexoes.js';
import * as conversasRepo from '../repos/conversas.js';
import { obterVersao } from '../repos/documentos.js';
import { modoOuNada } from '../modos.js';
import { resumirAvisos } from '../execucoes/avisos.js';
import { resumirLimites, type ResumoDoLimite } from '../execucoes/limites.js';
import { listarPorVersao, listarV2PorVersao } from '../repos/marcas.js';
import * as marcasRepo from '../repos/marcas.js';
import * as etiquetasRepo from '../repos/etiquetas.js';
import * as dificuldadesRepo from '../repos/dificuldades.js';
import { lerTipoDoDocumento } from '../tipo-de-texto/identificar.js';
import { modoDoTipo } from '../compreensao/preparacao.js';
import * as preferenciasRepo from '../repos/preferencias.js';
import { geometriaDisponivel } from '../geometria/arquivos.js';
import { paginasSemTexto } from '../escaneado/transcricao.js';

export type EstadoDoDocumento =
  | 'sem_texto' | 'canonizando' | 'transcrevendo' | 'pronto' | 'marcando' | 'revisando' | 'preparando' | 'falhou';

/** Uma função na contagem da biblioteca: chave, rótulo do modo da marca e quantas o leitor mostra. */
export interface FuncaoContada {
  funcao: string;
  rotulo: string;
  quantidade: number;
}

/**
 * Marcas que o leitor mostra na última versão (J107): por capítulo, as da camada que o leitor abre
 * ali e os grifos do leitor; visíveis, resolvidas, não rejeitadas e desenhadas (a IA sem função não
 * conta; o grifo sem função do leitor, sim). Todos os níveis de atenção, como os chips do Caderno.
 */
export interface ContagemDeMarcas {
  /** Por função, na ordem do modo (o modo com mais marcas primeiro), sem as zeradas; "sem função" por último. */
  por_funcao: FuncaoContada[];
  /** Os campos de F1 (`argumentativa`), mantidos para os consumidores antigos; o mesmo recorte de `por_funcao`. */
  tese: number;
  conceito: number;
  justificativa: number;
  nenhuma: number;
  /** Soma de `por_funcao`: o número que o leitor mostra. */
  total: number;
}

interface FuncaoNaLinha { funcao: string; modo_id: string; modo_revisao: number; quantidade: number }

/**
 * Rótulo e ordem vêm do modo das marcas: os modos com mais marcas primeiro e, dentro de cada um, a ordem
 * das funções dele. A mesma chave em modos diferentes soma numa linha só, no lugar do modo que mais a usa.
 */
export function contagemPorFuncao(linhas: readonly FuncaoNaLinha[]): ContagemDeMarcas {
  const chaveDoModo = (linha: FuncaoNaLinha): string => `${linha.modo_id}@${String(linha.modo_revisao)}`;
  const totalDoModo = new Map<string, number>();
  for (const linha of linhas) totalDoModo.set(chaveDoModo(linha), (totalDoModo.get(chaveDoModo(linha)) ?? 0) + linha.quantidade);
  const modos = [...totalDoModo.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([chave]) => chave);
  const funcoes = new Map<string, { quantidade: number; linha: FuncaoNaLinha }>();
  for (const linha of linhas) {
    const atual = funcoes.get(linha.funcao);
    const daCasa = atual === undefined || modos.indexOf(chaveDoModo(linha)) < modos.indexOf(chaveDoModo(atual.linha));
    funcoes.set(linha.funcao, { quantidade: (atual?.quantidade ?? 0) + linha.quantidade, linha: daCasa ? linha : atual.linha });
  }
  const descrever = (funcao: string, linha: FuncaoNaLinha): { rotulo: string; posicao: number } => {
    if (funcao === 'nenhuma') return { rotulo: 'Sem função', posicao: Number.POSITIVE_INFINITY };
    const lista = modoOuNada({ id: linha.modo_id, revisao: linha.modo_revisao })?.funcoes ?? [];
    const indice = lista.findIndex((item) => item.chave === funcao);
    return indice < 0
      ? { rotulo: funcao.replaceAll('_', ' '), posicao: Number.MAX_SAFE_INTEGER }
      : { rotulo: lista[indice]!.rotulo, posicao: modos.indexOf(chaveDoModo(linha)) * 1000 + indice };
  };
  const por_funcao = [...funcoes.entries()].filter(([, { quantidade }]) => quantidade > 0)
    .map(([funcao, { quantidade, linha }]) => ({ funcao, quantidade, ...descrever(funcao, linha) }))
    .sort((a, b) => a.posicao - b.posicao || (a.funcao < b.funcao ? -1 : 1))
    .map(({ funcao, rotulo, quantidade }) => ({ funcao, rotulo, quantidade }));
  const de = (funcao: string): number => funcoes.get(funcao)?.quantidade ?? 0;
  return {
    por_funcao, tese: de('tese'), conceito: de('conceito'), justificativa: de('justificativa'), nenhuma: de('nenhuma'),
    total: por_funcao.reduce((soma, item) => soma + item.quantidade, 0),
  };
}

export interface ItemDaBiblioteca {
  id: Id;
  titulo: string;
  autor: string | null;
  formato: string;
  criado_em: string;
  versao_id: Id | null;
  texto_disponivel: boolean;
  estado: EstadoDoDocumento;
  /** Motivo legível quando `estado` é `falhou`, ou a fatia já lida quando está marcando. */
  detalhe: string | null;
  partes_prontas: number;
  partes_total: number;
  marcas: ContagemDeMarcas;
  progresso: { capitulos_concluidos: number; atualizado_em: string } | null;
  jobs_em_curso: number;
  /** Quando foi arquivado (J14); `null` para os que estão na biblioteca. */
  arquivado_em: string | null;
  /** Vídeo ou áudio com transcrição (J71), o mais recente; `null` para os textos. */
  midia: { tipo: 'video' | 'audio'; duracao_s: number; fonte_url: string | null } | null;
  /** Capítulos (seções de nível 1) da última versão; `null` sem versão. A lista não precisa da árvore. */
  capitulos_total: number | null;
}

interface LinhaDaBiblioteca {
  id: Id;
  titulo: string;
  autor: string | null;
  formato: string;
  criado_em: string;
  versao_id: Id | null;
  marcas_por_funcao: FuncaoNaLinha[];
  partes_prontas: number;
  partes_total: number;
  jobs_em_curso: number;
  canonizando: number;
  transcrevendo: number;
  marcando: number;
  revisando: number;
  falha: string | null;
  /** Jobs abertos da compreensão vigente (e a identificação do tipo, quando uma leitura espera por ela). */
  preparando: number;
  /** Código da última falha da preparação vigente (compreensão ou identificação esperada). */
  falha_preparacao: string | null;
  capitulos_compreensao: number;
  capitulos_compreendidos: number;
  capitulos_concluidos: number | null;
  progresso_em: string | null;
  arquivado_em: string | null;
  midia_tipo: 'video' | 'audio' | null;
  midia_duracao: number | null;
  midia_url: string | null;
  capitulos_total: number | null;
}

const ESTADOS_ABERTOS = "('fila','reservado','adiado')";
/** Jobs da compreensão do capítulo (`servico/src/compreensao/pipeline.ts`). */
const TIPOS_DA_PREPARACAO = "('analisar_passagens','sintetizar_capitulo','revisar_capitulo','planejar_leitura')";

/** Filtro final da consulta; nunca vem do cliente, só destas três formas fixas. */
type FiltroDaBiblioteca = 'ativos' | 'arquivados' | 'um';
const FILTROS: Readonly<Record<FiltroDaBiblioteca, string>> = {
  ativos: 'WHERE d.arquivado_em IS NULL',
  arquivados: 'WHERE d.arquivado_em IS NOT NULL',
  um: 'WHERE d.id=$1',
};

/**
 * As marcas da versão `v` que o leitor mostra (J107), capítulo a capítulo, como `snapshotDoCapitulo`:
 * a camada é a preferida do documento `d` (quando é desta versão) ou, como `camadaPadrao` com o recorte
 * do capítulo, a mais recente com marca no capítulo; com o "primeiro eu" e sem nota no capítulo, só as
 * manuais dela. Os grifos do leitor (camada `leitor`; `pedro` antes da migração 0025) entram sempre. Fica o que o texto desenha.
 */
const MARCAS_QUE_O_LEITOR_MOSTRA = `
  WITH cap AS (
    SELECT s.id, bi.ordem AS inicio, bf.ordem AS fim FROM secao s
    JOIN bloco bi ON bi.versao_id=s.versao_id AND bi.id=s.bloco_inicio
    JOIN bloco bf ON bf.versao_id=s.versao_id AND bf.id=s.bloco_fim
    WHERE s.versao_id=v.id AND s.nivel=1
  ), no_capitulo AS MATERIALIZED (
    SELECT mk.id, mk.funcao, mk.modo_id, mk.modo_revisao, mk.camada_id, mk.origem, mk.visivel, mk.validade,
      mk.avaliacao, cm.tipo AS camada_tipo, cap.id AS capitulo
    FROM cap
    JOIN bloco b ON b.versao_id=v.id AND b.ordem BETWEEN cap.inicio AND cap.fim
    JOIN marca mk ON mk.versao_id=b.versao_id AND mk.bloco_id=b.id
    JOIN camada cm ON cm.id=mk.camada_id
  ), presentes AS MATERIALIZED (
    SELECT DISTINCT capitulo, camada_id FROM no_capitulo
  ), escolha AS MATERIALIZED (
    SELECT cap.id AS capitulo,
      coalesce(pref.id, (SELECT c.id FROM camada c WHERE c.versao_id=v.id AND c.tipo<>'leitor'
        ORDER BY EXISTS (SELECT 1 FROM presentes p WHERE p.capitulo=cap.id AND p.camada_id=c.id) DESC,
                 c.criada_em DESC, c.id DESC LIMIT 1)) AS camada_id,
      NOT coalesce(pd.primeiro_eu,false) OR EXISTS (SELECT 1 FROM anotacao a JOIN bloco ba ON ba.versao_id=a.versao_id AND ba.id=a.bloco_id
        WHERE a.versao_id=v.id AND ba.ordem BETWEEN cap.inicio AND cap.fim)
        OR EXISTS (SELECT 1 FROM no_capitulo g WHERE g.capitulo=cap.id AND g.origem='manual') AS liberado
    FROM cap
    LEFT JOIN preferencia_documento pd ON pd.documento_id=d.id
    LEFT JOIN camada pref ON pref.id=pd.camada_padrao AND pref.versao_id=v.id AND pref.tipo<>'leitor'
  )
  SELECT DISTINCT n.id, n.funcao, n.modo_id, n.modo_revisao
  FROM no_capitulo n JOIN escolha e ON e.capitulo=n.capitulo
  WHERE n.visivel AND n.validade='resolvida' AND n.avaliacao<>'rejeitada' AND (n.funcao<>'nenhuma' OR n.origem='manual')
    AND (n.camada_tipo='leitor' OR (n.camada_id=e.camada_id AND (e.liberado OR n.origem='manual')))`;

const sqlDaBiblioteca = (filtro: FiltroDaBiblioteca): string => `
SELECT d.id, d.titulo, d.autor, d.formato,
  to_char(d.criado_em AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS criado_em,
  to_char(d.arquivado_em AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS arquivado_em,
  v.id AS versao_id,
  coalesce(m.por_funcao,'[]'::jsonb) AS marcas_por_funcao,
  coalesce(p.prontas,0)::int AS partes_prontas, coalesce(p.total,0)::int AS partes_total,
  coalesce(j.abertos,0)::int AS jobs_em_curso,
  coalesce(j.canonizando,0)::int AS canonizando,
  coalesce(j.transcrevendo,0)::int AS transcrevendo,
  coalesce(j.marcando,0)::int AS marcando,
  coalesce(j.revisando,0)::int AS revisando,
  j.falha,
  coalesce(cj.preparando,0)::int AS preparando, cj.falha AS falha_preparacao,
  coalesce(cc.capitulos,0)::int AS capitulos_compreensao, coalesce(cc.prontos,0)::int AS capitulos_compreendidos,
  pr.capitulos_concluidos_total AS capitulos_concluidos,
  pr.atualizado_em AS progresso_em,
  -- J109: vídeo importado do YouTube é vídeo mesmo quando a mídia local é só o áudio (ou não há mídia).
  CASE WHEN yt.url IS NOT NULL THEN 'video' ELSE md.tipo END AS midia_tipo,
  coalesce(md.duracao, yt.duracao) AS midia_duracao, coalesce(md.url, yt.url) AS midia_url,
  CASE WHEN v.id IS NULL THEN NULL
    ELSE (SELECT count(*)::int FROM secao s WHERE s.versao_id=v.id AND s.nivel=1) END AS capitulos_total
FROM documento d
LEFT JOIN LATERAL (
  SELECT id FROM versao_texto WHERE documento_id=d.id ORDER BY numero DESC LIMIT 1
) v ON true
LEFT JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object('funcao',g.funcao,'modo_id',g.modo_id,'modo_revisao',g.modo_revisao,'quantidade',g.n)) AS por_funcao
  FROM (SELECT vm.funcao, vm.modo_id, vm.modo_revisao, count(*)::int AS n FROM (${MARCAS_QUE_O_LEITOR_MOSTRA}) vm GROUP BY 1,2,3) g
) m ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS total, count(*) FILTER (WHERE pt.estado='ok') AS prontas
  FROM parte pt JOIN execucao_leitura e ON e.id=pt.execucao_id WHERE e.versao_id=v.id
) p ON true
LEFT JOIN LATERAL (
  SELECT count(*) FILTER (WHERE estado IN ${ESTADOS_ABERTOS}) AS abertos,
         count(*) FILTER (WHERE estado IN ${ESTADOS_ABERTOS} AND tipo IN ('canonizar','importar_youtube')) AS canonizando,
         count(*) FILTER (WHERE estado IN ${ESTADOS_ABERTOS} AND tipo='transcrever_escaneado') AS transcrevendo,
         count(*) FILTER (WHERE estado IN ${ESTADOS_ABERTOS} AND tipo='ler_parte') AS marcando,
         count(*) FILTER (WHERE estado IN ${ESTADOS_ABERTOS} AND tipo='revisar_consistencia') AS revisando,
         (SELECT error_code FROM job WHERE documento_id=d.id AND estado='falhou'
            ORDER BY atualizado_em DESC LIMIT 1) AS falha
  FROM job WHERE documento_id=d.id
) j ON true
-- v0.1: a compreensão vigente da última versão (a da camada padrão, senão a mais recente) e os jobs dela.
LEFT JOIN LATERAL (
  SELECT e.id AS execucao_id FROM execucao_leitura e
  LEFT JOIN preferencia_documento pd ON pd.documento_id = d.id
  WHERE e.versao_id = v.id AND e.schema_versao = 3
  ORDER BY (e.id = pd.camada_padrao) IS TRUE DESC, e.criada_em DESC, e.id DESC LIMIT 1
) ce ON true
LEFT JOIN LATERAL (
  SELECT count(DISTINCT pt.secao_id) AS capitulos,
    (SELECT count(DISTINCT m.secao_id) FROM modelo_capitulo m WHERE m.execucao_id = ce.execucao_id AND m.revisao >= 2) AS prontos
  FROM parte pt WHERE pt.execucao_id = ce.execucao_id AND pt.secao_id IS NOT NULL
) cc ON true
LEFT JOIN LATERAL (
  SELECT count(*) FILTER (WHERE jb.estado IN ${ESTADOS_ABERTOS}) AS preparando,
    (array_agg(coalesce(jb.error_code, jb.estado) ORDER BY jb.atualizado_em DESC) FILTER (WHERE jb.estado IN ('falhou','cancelado')))[1] AS falha
  FROM job jb WHERE jb.documento_id = d.id AND (
    (jb.tipo IN ${TIPOS_DA_PREPARACAO} AND jb.dedup_key LIKE '%:' || ce.execucao_id || ':%')
    OR (jb.tipo = 'identificar_tipo' AND d.preparacao_pedida IS NOT NULL AND jb.versao_id = v.id))
) cj ON true
LEFT JOIN LATERAL (
  SELECT jsonb_array_length(capitulos_concluidos) AS capitulos_concluidos_total,
         to_char(atualizado_em AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS atualizado_em
  FROM progresso WHERE documento_id=d.id
) pr ON true
LEFT JOIN LATERAL (
  SELECT tipo, (conteudo->>'duracao_s')::float8 AS duracao, conteudo->'fonte'->>'url' AS url
  FROM midia WHERE documento_id=d.id ORDER BY criado_em DESC LIMIT 1
) md ON true
LEFT JOIN LATERAL (
  SELECT (conteudo->>'duracao_s')::float8 AS duracao, conteudo->>'url' AS url FROM video_youtube WHERE documento_id=d.id
) yt ON true
${FILTROS[filtro]}
ORDER BY d.criado_em DESC, d.id DESC`;

function estadoDaLinha(linha: LinhaDaBiblioteca): { estado: EstadoDoDocumento; detalhe: string | null } {
  if (linha.versao_id === null) {
    if (linha.canonizando > 0) return { estado: 'canonizando', detalhe: null };
    if (linha.falha !== null) return { estado: 'falhou', detalhe: linha.falha };
    return { estado: 'sem_texto', detalhe: null };
  }
  if (linha.transcrevendo > 0) return { estado: 'transcrevendo', detalhe: null };
  if (linha.marcando > 0) {
    return {
      estado: 'marcando',
      detalhe: `${String(linha.partes_prontas)} de ${String(linha.partes_total)}`,
    };
  }
  // Revisão de consistência só conta como "revisando" enquanto nada falhou: ela é
  // adiada de 5 em 5 minutos enquanto houver parte pendente, e uma parte que falhou
  // deixaria o documento eternamente "revisando", escondendo o motivo da falha (J10).
  if (linha.revisando > 0 && linha.falha === null) return { estado: 'revisando', detalhe: null };
  // A preparação da leitura (compreensão), contada à parte: "preparando · capítulo 2 de 9".
  if (linha.preparando > 0) {
    const total = linha.capitulos_compreensao;
    return { estado: 'preparando', detalhe: total > 1 ? `capítulo ${String(Math.min(linha.capitulos_compreendidos + 1, total))} de ${String(total)}` : null };
  }
  if (linha.falha_preparacao !== null) return { estado: 'falhou', detalhe: mensagemDaFalha(linha.falha_preparacao) };
  // Texto disponível é independente da marcação: uma leitura falhada não o esconde.
  return { estado: 'pronto', detalhe: linha.falha };
}

function itemDaLinha(linha: LinhaDaBiblioteca): ItemDaBiblioteca {
  const { estado, detalhe } = estadoDaLinha(linha);
  return {
      id: linha.id, titulo: linha.titulo, autor: linha.autor, formato: linha.formato,
      criado_em: linha.criado_em, versao_id: linha.versao_id,
      texto_disponivel: linha.versao_id !== null,
      estado, detalhe,
      partes_prontas: linha.partes_prontas, partes_total: linha.partes_total,
      marcas: contagemPorFuncao(linha.marcas_por_funcao),
      progresso: linha.progresso_em === null ? null : {
        capitulos_concluidos: linha.capitulos_concluidos ?? 0,
        atualizado_em: linha.progresso_em,
      },
      jobs_em_curso: linha.jobs_em_curso,
      arquivado_em: linha.arquivado_em,
      midia: linha.midia_tipo === null ? null : { tipo: linha.midia_tipo, duracao_s: linha.midia_duracao ?? 0, fonte_url: linha.midia_url },
      capitulos_total: linha.capitulos_total,
  };
}

/** Biblioteca padrão (sem os arquivados) ou, com `arquivados`, só os arquivados. */
export async function biblioteca(cliente: Transacao, opcoes: { arquivados?: boolean } = {}): Promise<ItemDaBiblioteca[]> {
  return (await cliente.query<LinhaDaBiblioteca>(sqlDaBiblioteca(opcoes.arquivados === true ? 'arquivados' : 'ativos')))
    .rows.map(itemDaLinha);
}

export interface VersaoResumida {
  id: Id;
  numero: number;
  criado_em: string;
  motor: string;
  hash_estrutural: string;
  blocos: number;
  secoes: number;
  assets: number;
  limites: string[];
  /** Os limites resumidos para quem lê (V-T4): o que se perdeu, como aviso, e o esperado, como informação. */
  resumo_dos_limites: ResumoDoLimite[];
}

export interface JobResumido {
  id: Id;
  tipo: string;
  estado: string;
  attempt: number;
  not_before: string | null;
  error_code: string | null;
  atualizado_em: string;
  /** Só os da tentativa vencedora, quando `ok`; os da última tentativa, quando não (J14). */
  diagnosticos: { nivel: string; codigo: string; mensagem: string }[];
  /** Concluído com ressalvas: os diagnósticos de nível `aviso` em frases para quem lê (vazio fora de `ok`). */
  avisos: AvisoDaExecucaoV2[];
}

export interface ExecucaoResumida {
  id: Id;
  versao_id: Id;
  /** O que o executor declarou (desde a 0003), ou o pedido enquanto nenhuma parte publicou. */
  modelo: string;
  esforco: string;
  modelo_pedido: string | null;
  esforco_pedido: string | null;
  proveniencia: 'configuracao' | 'executor';
  /** Partes (ou a revisão) que rodaram com modelo ou esforço diferentes dos da execução. */
  divergencias: unknown[];
  criada_em: string;
  partes_total: number;
  partes_prontas: number;
  /** 1 = F1; 2 = leitura por modo (J19). */
  schema_versao: number;
  modo: { id: string; revisao: number };
  nivel_de_atencao_alvo: number;
}

export interface ExportacaoResumida {
  id: Id;
  tipo: string;
  criada_em: string;
  sha256: string;
}

export interface DetalheDoDocumento extends ItemDaBiblioteca {
  /** Páginas da última versão sem camada de texto (PDF escaneado): o que a transcrição por visão cobre. */
  paginas_sem_texto: number;
  versoes: VersaoResumida[];
  execucoes: ExecucaoResumida[];
  jobs: JobResumido[];
  exportacoes: ExportacaoResumida[];
}

export async function detalhe(cliente: Transacao, documentoId: Id): Promise<DetalheDoDocumento | null> {
  const linhas = (await cliente.query<LinhaDaBiblioteca>(
    sqlDaBiblioteca('um'), [documentoId])).rows;
  const linha = linhas[0];
  if (!linha) return null;
  const item = itemDaLinha(linha);
  const versoes = (await cliente.query<Omit<VersaoResumida, 'resumo_dos_limites'>>(`SELECT id, numero::int AS numero, motor, hash_estrutural,
      to_char(criado_em AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS criado_em,
      jsonb_array_length(canonico->'blocos') AS blocos,
      jsonb_array_length(canonico->'secoes') AS secoes,
      jsonb_array_length(canonico->'assets') AS assets,
      canonico->'limites' AS limites
    FROM versao_texto WHERE documento_id=$1 ORDER BY numero DESC`, [documentoId])).rows
    .map((versao): VersaoResumida => ({ ...versao, resumo_dos_limites: resumirLimites(versao.limites ?? []) }));
  const execucoes = (await cliente.query<ExecucaoResumida>(`SELECT e.id, e.versao_id, e.modelo, e.esforco,
      e.modelo_pedido, e.esforco_pedido, e.proveniencia, e.divergencias,
      e.schema_versao::int AS schema_versao, jsonb_build_object('id', e.modo_id, 'revisao', e.modo_revisao) AS modo,
      e.nivel_de_atencao_alvo::int AS nivel_de_atencao_alvo,
      to_char(e.criada_em AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS criada_em,
      (SELECT count(*)::int FROM parte p WHERE p.execucao_id=e.id) AS partes_total,
      (SELECT count(*)::int FROM parte p WHERE p.execucao_id=e.id AND p.estado='ok') AS partes_prontas
    FROM execucao_leitura e JOIN versao_texto v ON v.id=e.versao_id
    WHERE v.documento_id=$1 ORDER BY e.criada_em DESC`, [documentoId])).rows;
  const jobs = (await cliente.query<Omit<JobResumido, 'avisos'>>(`SELECT id, tipo, estado, attempt, diagnosticos,
      to_char(not_before AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS not_before, error_code,
      to_char(atualizado_em AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS atualizado_em
    FROM job WHERE documento_id=$1 ORDER BY criado_em DESC LIMIT 20`, [documentoId])).rows
    .map((job) => ({ ...job, avisos: job.estado === 'ok' ? resumirAvisos(job.tipo, job.diagnosticos as JobResultV1['diagnosticos']) : [] }));
  const exportacoes = (await cliente.query<ExportacaoResumida>(`SELECT id, tipo, sha256,
      to_char(criada_em AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS criada_em
    FROM exportacao WHERE documento_id=$1 ORDER BY criada_em DESC`, [documentoId])).rows;
  return { ...item, paginas_sem_texto: paginasSemTexto(versoes[0]?.limites ?? []).length, versoes, execucoes, jobs, exportacoes };
}

export interface NoDaArvore {
  id: Id;
  titulo: string;
  nivel: number;
  ordem: number;
  bloco_inicio: Id;
  bloco_fim: Id;
  filhos: NoDaArvore[];
}

/** A lista de seções do canônico já vem em pré-ordem; aqui ela vira árvore. */
export function arvoreDeSecoes(secoes: readonly Secao[]): NoDaArvore[] {
  const raizes: NoDaArvore[] = [];
  const pilha: NoDaArvore[] = [];
  for (const secao of [...secoes].sort((a, b) => a.ordem - b.ordem)) {
    const no: NoDaArvore = {
      id: secao.id, titulo: secao.titulo, nivel: secao.nivel, ordem: secao.ordem,
      bloco_inicio: secao.bloco_inicio, bloco_fim: secao.bloco_fim, filhos: [],
    };
    while (pilha.length > 0 && (pilha.at(-1)?.nivel ?? 0) >= no.nivel) pilha.pop();
    const pai = pilha.at(-1);
    if (pai) pai.filhos.push(no); else raizes.push(no);
    pilha.push(no);
  }
  return raizes;
}

export interface PerguntasDaSecao {
  secao_id: Id;
  perguntas: string[];
}

export interface CamadaResumida {
  id: Id;
  tipo: 'execucao' | 'importacao' | 'leitor';
  modo: ReferenciaModo;
  criada_em: string;
  /** Marcas da camada no recorte pedido (no snapshot, as do capítulo; na rota de camadas, as da versão). */
  marcas: number;
  /** Camada da compreensão do capítulo (J29). */
  compreensao: boolean;
  /** Rótulo cego (J32): quando existe, o leitor mostra só ele. */
  rotulo: string | null;
}

/** Camada pedida no snapshot: um id, `todas`, ou nenhuma (o padrão do documento). */
export type EscolhaDeCamada = string | undefined;

export class CamadaInexistente extends Error {
  constructor() { super('Camada inexistente nesta versão.'); this.name = 'CamadaInexistente'; }
}

export interface SnapshotDoCapitulo {
  palavras_no_livro?: { antes: number; total: number };
  formato: CanonicoV1['documento']['formato'];
  paginas: { inicio: number; fim: number } | null;
  geometria_disponivel: boolean;
  versao_id: Id;
  documento_id: Id;
  /** Idioma do documento (BCP-47, do canônico): a web o usa em `lang` para hifenizar o texto justificado. */
  idioma: string;
  secao: Secao;
  blocos: Bloco[];
  /**
   * `MarcaV2` da camada escolhida (0004). É superconjunto da `MarcaV1`: a web de F1 lê
   * `id`, `ancora`, `funcao`, `subfaixas`, `comentario`, `origem`, `validade`, `visivel` e
   * `avaliacao` como antes. Vazio enquanto "primeiro eu" segura o capítulo.
   */
  marcas: MarcaV2[];
  /** J37: o que o leitor mudou nas marcas da IA do capítulo (função e nota originais), por marca. */
  edicoes: Record<Id, marcasRepo.EdicaoDaMarca>;
  /** J37: etiquetas "?" do leitor sobre as marcas e anotações. */
  etiquetas: EtiquetaV1[];
  /** J37: as notas do leitor do capítulo que o Codex está revisando. */
  revisoes_pendentes: Id[];
  /** J138: os sinais de dificuldade gravados no capítulo (do leitor e decisões sobre as do Codex). */
  dificuldades: DificuldadeV1[];
  /**
   * J138: o modo do tipo de texto do documento, quando já se sabe: as funções dele vêm primeiro no balão do
   * grifo. Não restringe nada: cada grifo guarda o seu modo, e o leitor grifa com funções de qualquer modo.
   */
  modo_principal: ReferenciaModo | null;
  /** Camada cujas marcas vieram: um id, `todas` ou `null` (versão sem camada). */
  camada: string | null;
  /** Com `todas`, a precedência declarada: da camada mais recente para a mais antiga. */
  precedencia: Id[];
  camadas: CamadaResumida[];
  anotacoes: AnotacaoV1[];
  /** As que têm origem ou destino (trecho) num bloco do capítulo. */
  conexoes: ConexaoV2[];
  conversas: conversasRepo.ResumoDaConversa[];
  primeiro_eu: { ativo: boolean; liberado: boolean };
  assets: Record<Id, string>;
  /** `hashMarcas` da projeção V1 de **todas** as marcas da versão: é o `snapshot_base` de um lote. */
  revisao_marcas: string;
  /** Perguntas de recuperação das seções deste capítulo (coluna `parte.recuperacao`). */
  recuperacao: PerguntasDaSecao[];
  anterior: Id | null;
  proxima: Id | null;
}

function fatiaDoCapitulo(canonico: CanonicoV1, secao: Secao): Bloco[] {
  const ordem = new Map(canonico.blocos.map((bloco, indice) => [bloco.id, indice]));
  const inicio = ordem.get(secao.bloco_inicio);
  const fim = ordem.get(secao.bloco_fim);
  if (inicio === undefined || fim === undefined) return [];
  return canonico.blocos.slice(inicio, fim + 1);
}

/**
 * Seções que caem dentro do capítulo: ele próprio e as descendentes, identificadas
 * pela faixa de blocos. A árvore do canônico é uma lista em pré-ordem, então comparar
 * posições de bloco é mais barato — e mais fiel ao texto — do que remontar a hierarquia.
 */
function secoesDoCapitulo(canonico: CanonicoV1, secao: Secao): Set<Id> {
  const ordem = new Map(canonico.blocos.map((bloco, indice) => [bloco.id, indice]));
  const inicio = ordem.get(secao.bloco_inicio);
  const fim = ordem.get(secao.bloco_fim);
  const dentro = new Set<Id>([secao.id]);
  if (inicio === undefined || fim === undefined) return dentro;
  for (const candidata of canonico.secoes) {
    const a = ordem.get(candidata.bloco_inicio);
    const b = ordem.get(candidata.bloco_fim);
    if (a !== undefined && b !== undefined && a >= inicio && b <= fim) dentro.add(candidata.id);
  }
  return dentro;
}

interface LinhaDeRecuperacao {
  recuperacao: PerguntasDaSecao[];
}

/**
 * Perguntas de recuperação gravadas pelas partes daquela versão, na ordem das partes.
 * Uma seção lida duas vezes (reexecução) aparece uma vez só: as perguntas são
 * deduplicadas por seção, mantendo a primeira ocorrência.
 */
async function recuperacaoDoCapitulo(
  cliente: Transacao, versaoId: Id, secoes: ReadonlySet<Id>,
): Promise<PerguntasDaSecao[]> {
  const linhas = (await cliente.query<LinhaDeRecuperacao>(
    `SELECT p.recuperacao FROM parte p
       JOIN execucao_leitura e ON e.id = p.execucao_id
      WHERE e.versao_id = $1 AND p.recuperacao <> '[]'::jsonb
      ORDER BY e.criada_em, p.ordem`, [versaoId])).rows;
  const porSecao = new Map<Id, string[]>();
  for (const linha of linhas) {
    for (const item of linha.recuperacao) {
      if (!secoes.has(item.secao_id) || porSecao.has(item.secao_id)) continue;
      const perguntas = item.perguntas.filter((pergunta) => pergunta.trim() !== '');
      if (perguntas.length > 0) porSecao.set(item.secao_id, perguntas);
    }
  }
  const ordem = [...secoes];
  return [...porSecao.entries()]
    .sort((a, b) => ordem.indexOf(a[0]) - ordem.indexOf(b[0]))
    .map(([secao_id, perguntas]) => ({ secao_id, perguntas }));
}

/** Capítulos são as seções de nível 1, na ordem do texto. */
export function capitulos(canonico: CanonicoV1): Secao[] {
  return [...canonico.secoes].sort((a, b) => a.ordem - b.ordem).filter((secao) => secao.nivel === 1);
}

/** Camadas da versão, da mais recente para a mais antiga, com a contagem no recorte. */
export async function camadasResumidas(cliente: Transacao, versaoId: Id, blocos?: readonly Id[]): Promise<CamadaResumida[]> {
  const contagem = await camadasRepo.contarMarcas(cliente, versaoId, blocos);
  return (await camadasRepo.listarDeLeitura(cliente, versaoId)).reverse().map((camada) => ({
    id: camada.id, tipo: camada.tipo, modo: camada.modo, criada_em: camada.criada_em, marcas: contagem.get(camada.id) ?? 0,
    compreensao: camada.compreensao, rotulo: camada.rotulo,
  }));
}

/** Palavras do livro inteiro e das que vêm antes do capítulo (mesma separação por espaços do leitor). */
/** Capítulos do fim do livro que não se leem de ponta a ponta: o progresso termina antes deles (V-T5). */
const FIM_DO_LIVRO = /^(?:refer[êe]ncias(?: bibliogr[áa]ficas)?|bibliografia|references|bibliography|works cited|[íi]ndice(?: remissivo)?|index|gloss[áa]rio|glossary)$/iu;
function normalizarTitulo(titulo: string): string {
  return titulo.normalize('NFC').replace(/^[\d.\s]+/u, '').trim();
}

/**
 * Palavras antes do capítulo e no documento, para o percentual do leitor. Referências, bibliografia e
 * índice no fim não contam: chegar ao fim da última parte lida é 100% (V-T5).
 */
export function palavrasNoLivro(canonico: Pick<CanonicoV1, 'blocos' | 'secoes'>, inicio: string): { antes: number; total: number } {
  const ordem = [...canonico.secoes].sort((a, b) => a.ordem - b.ordem).filter((secao) => secao.nivel === 1);
  let corte: string | null = null;
  for (let i = ordem.length - 1; i > 0; i -= 1) {
    if (!FIM_DO_LIVRO.test(normalizarTitulo(ordem[i]!.titulo))) break;
    corte = ordem[i]!.bloco_inicio;
  }
  let antes = 0; let total = 0; let contando = true;
  for (const bloco of canonico.blocos) {
    if (bloco.id === corte) contando = false;
    if (bloco.id === inicio) antes = total;
    if (contando) total += bloco.texto.match(/\S+/g)?.length ?? 0;
  }
  return { antes, total };
}

/** O modo do tipo de texto do documento (J131), ou `null` enquanto o tipo não é conhecido. */
async function modoPrincipal(cliente: Transacao, documentoId: Id): Promise<ReferenciaModo | null> {
  const tipo = await lerTipoDoDocumento(cliente, documentoId);
  if (!tipo) return null;
  try { const { modo } = modoDoTipo(tipo); return { id: modo.id, revisao: modo.revisao }; } catch { return null; }
}

export async function snapshotDoCapitulo(
  cliente: Transacao, versaoId: Id, secaoId: Id, urlDoAsset: (versaoId: Id, assetId: Id) => string,
  escolha: EscolhaDeCamada = undefined,
  totalDePaginas?: (documentoId: Id, versaoId: Id) => Promise<number | null>,
  etiqueta?: string,
  /** A sala de teste mostra as marcas publicadas da IA mesmo com o "primeiro eu" do leitor ligado. */
  opcoes: { ignorarPrimeiroEu?: boolean } = {},
): Promise<SnapshotDoCapitulo | null> {
  const versao = await obterVersao(cliente, versaoId);
  const canonico = versao.canonico;
  const secao = canonico.secoes.find((candidata) => candidata.id === secaoId);
  if (!secao) return null;
  const blocos = fatiaDoCapitulo(canonico, secao);
  const idsDaFatia = blocos.map((bloco) => bloco.id);
  const daFatia = new Set(idsDaFatia);
  const todas = await listarPorVersao(cliente, versaoId);
  const camadas = await camadasResumidas(cliente, versaoId, idsDaFatia);
  if (escolha !== undefined && escolha !== 'todas' && !camadas.some((camada) => camada.id === escolha)) throw new CamadaInexistente();
  const camada = escolha ?? await camadasRepo.camadaPadrao(cliente, versaoId, idsDaFatia);
  const marcasDaCamada = camada === null ? []
    : await listarV2PorVersao(cliente, versaoId, camada === 'todas' ? {} : { camada_id: camada });
  // Os grifos do leitor (J37) aparecem em qualquer camada escolhida, e mesmo antes do "primeiro eu".
  const doLeitor = camada === 'todas' ? [] : await marcasRepo.listarDoLeitor(cliente, versaoId);
  const idsDaCamada = new Set(marcasDaCamada.map((marca) => marca.id));
  const anotacoes = await anotacoesRepo.listarNosBlocos(cliente, versaoId, idsDaFatia);
  const preferencia = await preferenciasRepo.ler(cliente, versao.documento_id);
  // "Primeiro eu": sem grifo nem anotação do leitor no capítulo, as marcas da IA ficam no banco e fora da resposta.
  const grifouNoCapitulo = [...doLeitor, ...marcasDaCamada].some((marca) => marca.origem === 'manual' && daFatia.has(marca.ancora.bloco_id));
  const liberado = opcoes.ignorarPrimeiroEu === true || !preferencia.primeiro_eu || anotacoes.length > 0 || grifouNoCapitulo;
  const etiquetas = await etiquetasRepo.daVersao(cliente, versaoId);
  const alvos = etiqueta === undefined ? null : new Set(etiquetas.filter((item) => item.nome.toLowerCase() === etiqueta.toLowerCase()).map((item) => item.alvo.id));
  const assets: Record<Id, string> = {};
  for (const asset of canonico.assets) assets[asset.id] = urlDoAsset(versaoId, asset.id);
  const recuperacao = await recuperacaoDoCapitulo(cliente, versaoId, secoesDoCapitulo(canonico, secao));
  const irmas = capitulos(canonico);
  const indice = irmas.findIndex(candidata => candidata.id === secao.id);
  let paginas = paginasDoCapitulo(blocos);
  if (canonico.documento.formato === 'pdf') {
    // Páginas sem texto (escaneadas, só figura) entram no capítulo em volta delas.
    const faixaDe = (candidata: Secao) => paginasDoCapitulo(fatiaDoCapitulo(canonico, candidata));
    const anterior = indice > 0 ? irmas.slice(0, indice).reverse().map(faixaDe).find((faixa) => faixa !== null) ?? null : null;
    const proxima = indice >= 0 ? irmas.slice(indice + 1).map(faixaDe).find((faixa) => faixa !== null) ?? null : null;
    const total = totalDePaginas ? await totalDePaginas(versao.documento_id, versaoId) : null;
    paginas = completarPaginasDoCapitulo(paginas, anterior, proxima, total);
  }
  return {
    palavras_no_livro: palavrasNoLivro(canonico, secao.bloco_inicio),
    idioma: canonico.documento.idioma,
    formato: canonico.documento.formato,
    paginas,
    geometria_disponivel: canonico.documento.formato === 'pdf' && await geometriaDisponivel(versao.documento_id, versaoId),
    versao_id: versaoId,
    documento_id: versao.documento_id,
    secao,
    blocos,
    marcas: [...(liberado ? marcasDaCamada : marcasDaCamada.filter((marca) => marca.origem === 'manual')), ...doLeitor.filter((marca) => !idsDaCamada.has(marca.id))]
      .filter((marca) => daFatia.has(marca.ancora.bloco_id) && (alvos === null || alvos.has(marca.id))),
    edicoes: await marcasRepo.edicoes(cliente, versaoId, idsDaFatia),
    revisoes_pendentes: (await anotacoesRepo.comRevisaoPendente(cliente, versaoId)).filter((id) => anotacoes.some((anotacao) => anotacao.id === id)),
    dificuldades: await dificuldadesRepo.listarNosBlocos(cliente, versaoId, idsDaFatia),
    modo_principal: await modoPrincipal(cliente, versao.documento_id),
    etiquetas: etiquetas.filter((etiqueta) => etiqueta.alvo.tipo === 'anotacao'
      ? anotacoes.some((anotacao) => anotacao.id === etiqueta.alvo.id) : true),
    camada,
    precedencia: camada === 'todas' ? camadas.map((item) => item.id) : [],
    camadas,
    anotacoes: alvos === null ? anotacoes : anotacoes.filter((anotacao) => alvos.has(anotacao.id)),
    conexoes: await conexoesRepo.listarNosBlocos(cliente, versaoId, idsDaFatia),
    conversas: await conversasRepo.resumosNosBlocos(cliente, versaoId, idsDaFatia),
    primeiro_eu: { ativo: preferencia.primeiro_eu, liberado },
    assets,
    revisao_marcas: hashMarcas(todas),
    recuperacao,
    anterior: indice > 0 ? irmas[indice - 1]?.id ?? null : null,
    proxima: indice >= 0 ? irmas[indice + 1]?.id ?? null : null,
  };
}
