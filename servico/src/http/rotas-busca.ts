/**
 * Busca no texto: na biblioteca inteira (`GET /api/busca?q=`) e dentro de um documento
 * (`GET /api/documentos/:id/busca?q=`).
 *
 * Usa a coluna `bloco.busca` (tsvector gerado no idioma do documento, com índice GIN) e
 * `websearch_to_tsquery` no mesmo idioma de cada bloco.
 * Consulta com mais de uma palavra vira frase literal (ver `padraoDaFrase`). O realce vem do `ts_headline` com
 * marcadores de controle, que o serviço converte em offsets UTF-16 no texto do bloco e em
 * segmentos `{ texto, marcado }`: nenhum HTML sai do banco para a web.
 *
 * Só a última versão de cada documento é buscada; na biblioteca, só os não arquivados.
 */
import type { Hono } from 'hono';
import type pg from 'pg';
import type { Faixa, Id, OrigemBloco } from '@margem/contratos';
import { ehUlid } from '../dados.js';
import { comTransacao } from '../db/transacao.js';
import { ErroDaApi } from './erros.js';

export interface SegmentoDoTrecho { texto: string; marcado: boolean }

export interface ResultadoDaBusca {
  documento_id: Id;
  titulo: string;
  autor: string | null;
  formato: string;
  versao_id: Id;
  /** O capítulo (seção de nível 1) que contém o bloco; `null` quando o bloco fica fora de todos. */
  capitulo: { id: Id; titulo: string } | null;
  bloco_id: Id;
  /** Página do PDF de onde o bloco veio, quando o canônico a registra. */
  pagina: number | null;
  /** Cada termo achado, em offsets UTF-16 no texto do bloco (vazio se o realce não pôde ser conferido). */
  ocorrencias: Faixa[];
  /** Um recorte do bloco em volta da primeira ocorrência, com os termos achados marcados. */
  trecho: SegmentoDoTrecho[];
}

export interface RespostaDaBusca {
  consulta: string;
  total: number;
  resultados: ResultadoDaBusca[];
  /** O `deslocamento` da página seguinte, ou `null` quando não há mais. */
  proximo: number | null;
}

const INICIO = '\u0001';
const FIM = '\u0002';
const OPCOES_DO_REALCE = `HighlightAll=true, StartSel=${INICIO}, StopSel=${FIM}`;
const TAMANHO_MAXIMO_DA_CONSULTA = 200;
/** Caracteres de contexto antes e depois da primeira ocorrência, no recorte. */
const CONTEXTO_ANTES = 80;
const CONTEXTO_DEPOIS = 160;

/**
 * Converte o texto realçado pelo `ts_headline` em faixas UTF-16 no texto original. Confere que,
 * sem os marcadores, o realce é exatamente o texto do bloco; se não for, devolve `null` (melhor
 * não marcar nada do que marcar no lugar errado).
 */
export function ocorrenciasDoRealce(realce: string, texto: string): Faixa[] | null {
  const faixas: Faixa[] = [];
  let limpo = '';
  let aberta: number | null = null;
  for (const caractere of realce) {
    if (caractere === INICIO) { aberta = limpo.length; continue; }
    if (caractere === FIM) {
      if (aberta !== null && limpo.length > aberta) faixas.push({ inicio_utf16: aberta, fim_utf16: limpo.length });
      aberta = null;
      continue;
    }
    limpo += caractere;
  }
  return limpo === texto ? faixas : null;
}

/** Recua (ou avança) até um espaço, para o recorte não começar nem terminar no meio de uma palavra. */
function limiteDePalavra(texto: string, posicao: number, direcao: -1 | 1): number {
  if (posicao <= 0) return 0;
  if (posicao >= texto.length) return texto.length;
  const busca = direcao < 0 ? texto.lastIndexOf(' ', posicao) : texto.indexOf(' ', posicao);
  if (busca < 0) return direcao < 0 ? 0 : texto.length;
  // Não recuar nem avançar mais que 20 caracteres atrás de um espaço: numa palavra enorme, corta onde estiver.
  return Math.abs(busca - posicao) > 20 ? posicao : direcao < 0 ? busca + 1 : busca;
}

/** O recorte do bloco em volta da primeira ocorrência, em segmentos; reticências marcam o corte. */
export function trechoEmSegmentos(texto: string, ocorrencias: readonly Faixa[]): SegmentoDoTrecho[] {
  const primeira = ocorrencias[0];
  const inicio = primeira ? limiteDePalavra(texto, primeira.inicio_utf16 - CONTEXTO_ANTES, -1) : 0;
  const fim = limiteDePalavra(texto, (primeira?.fim_utf16 ?? 0) + CONTEXTO_DEPOIS, 1);
  const segmentos: SegmentoDoTrecho[] = [];
  const acrescentar = (pedaco: string, marcado: boolean) => {
    if (pedaco === '') return;
    const ultimo = segmentos.at(-1);
    if (ultimo && ultimo.marcado === marcado) ultimo.texto += pedaco;
    else segmentos.push({ texto: pedaco, marcado });
  };
  if (inicio > 0) acrescentar('…', false);
  let cursor = inicio;
  for (const { inicio_utf16: a, fim_utf16: b } of ocorrencias) {
    if (b <= cursor || a >= fim) continue;
    acrescentar(texto.slice(cursor, Math.max(cursor, a)), false);
    acrescentar(texto.slice(Math.max(cursor, a), Math.min(b, fim)), true);
    cursor = Math.min(b, fim);
  }
  acrescentar(texto.slice(cursor, fim), false);
  if (fim < texto.length) acrescentar('…', false);
  return segmentos;
}

const VARIANTES: Record<string, string> = { a: 'aáàâãä', e: 'eéèêë', i: 'iíìîï', o: 'oóòôõö', u: 'uúùûü', c: 'cç' };

/**
 * Consulta com mais de uma palavra ("um homem") é uma frase: casa o texto literal, sem
 * diferenciar maiúsculas nem acentos e aceitando quebra de linha ou hífen de sílaba entre
 * as palavras. Devolve a expressão regular (a mesma no Postgres e no JS) ou `null` para
 * uma palavra só, que segue pelo tsvector (acha também as flexões), e para consultas com sintaxe de busca.
 */
export function padraoDaFrase(consulta: string): string | null {
  const palavras = consulta.replace(/^"(.*)"$/s, '$1').trim().split(/\s+/).filter((p) => p !== '');
  // Com sintaxe de busca ("a -b", "a or b", aspas no meio), segue o websearch_to_tsquery.
  if (palavras.length < 2 || palavras.some((p) => p.startsWith('-') || p.includes('"') || p.toLowerCase() === 'or')) return null;
  const palavra = (p: string) => [...p.toLowerCase()].map((ch) => {
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '');
    const variantes = VARIANTES[base];
    return variantes ? `[${variantes}]` : ch.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');
  }).join('');
  return palavras.map(palavra).join('[\\s\\u00AD-]+');
}

/** Ocorrências da frase no texto do bloco, em offsets UTF-16. */
export function ocorrenciasDaFrase(padrao: string, texto: string): Faixa[] {
  return [...texto.matchAll(new RegExp(padrao, 'gi'))].map((m) => ({ inicio_utf16: m.index, fim_utf16: m.index + m[0].length }));
}

function lerConsulta(bruta: string | undefined): string {
  const consulta = (bruta ?? '').trim();
  if (consulta === '' || consulta.length > TAMANHO_MAXIMO_DA_CONSULTA) {
    throw new ErroDaApi(400, 'busca_invalida', `Use q= com 1 a ${String(TAMANHO_MAXIMO_DA_CONSULTA)} caracteres.`);
  }
  return consulta;
}

function lerInteiro(bruto: string | undefined, padrao: number, minimo: number, maximo: number, campo: string): number {
  if (bruto === undefined || bruto === '') return padrao;
  const valor = Number(bruto);
  if (!/^\d+$/.test(bruto) || !Number.isSafeInteger(valor) || valor < minimo || valor > maximo) {
    throw new ErroDaApi(400, 'busca_invalida', `${campo} vai de ${String(minimo)} a ${String(maximo)}.`);
  }
  return valor;
}

interface LinhaDaBusca {
  documento_id: Id; titulo: string; autor: string | null; formato: string; versao_id: Id;
  capitulo_id: Id | null; capitulo_titulo: string | null;
  bloco_id: Id; texto: string; origens: OrigemBloco[]; realce: string; total: string;
}

/**
 * O filtro dos documentos vem só destas duas formas fixas; o texto do cliente entra
 * sempre como parâmetro. A condição em três ramos (um por idioma) deixa o planejador
 * usar o índice GIN de `bloco.busca` em cada um. A frase não passa pelo tsvector (o stemmer
 * separaria "própria" de "propria"): a expressão regular percorre os blocos.
 */
const sqlDaBusca = (escopo: 'biblioteca' | 'documento', frase: boolean): string => `
WITH alvo AS (
  SELECT d.id AS documento_id, d.titulo, d.autor, d.formato, v.id AS versao_id
  FROM documento d
  JOIN LATERAL (SELECT id FROM versao_texto WHERE documento_id=d.id ORDER BY numero DESC LIMIT 1) v ON true
  WHERE ${escopo === 'biblioteca' ? 'd.arquivado_em IS NULL' : frase ? 'd.id=$6' : 'd.id=$5'}
), achados AS (
  SELECT a.*, b.id AS bloco_id, b.ordem, b.texto, b.origens, b.idioma_busca,
    ${frase ? 'length(b.texto)*0' : 'ts_rank(b.busca, websearch_to_tsquery(b.idioma_busca, $1))'} AS relevancia,
    count(*) OVER () AS total
  FROM alvo a JOIN bloco b ON b.versao_id=a.versao_id
  WHERE ${frase ? 'b.texto ~* $5' : `(b.idioma_busca='portuguese'::regconfig AND b.busca @@ websearch_to_tsquery('portuguese'::regconfig, $1))
     OR (b.idioma_busca='english'::regconfig AND b.busca @@ websearch_to_tsquery('english'::regconfig, $1))
     OR (b.idioma_busca='simple'::regconfig AND b.busca @@ websearch_to_tsquery('simple'::regconfig, $1))`}
  ORDER BY ${escopo === 'biblioteca' ? 'relevancia DESC, a.titulo, a.documento_id, b.ordem' : 'b.ordem'}
  LIMIT $2 OFFSET $3
)
SELECT h.documento_id, h.titulo, h.autor, h.formato, h.versao_id, h.bloco_id, h.texto, h.origens,
  h.total::text AS total, cap.id AS capitulo_id, cap.titulo AS capitulo_titulo,
  ts_headline(h.idioma_busca, h.texto, websearch_to_tsquery(h.idioma_busca, $1), $4) AS realce
FROM achados h
LEFT JOIN LATERAL (
  SELECT s.id, s.titulo FROM secao s
  JOIN bloco bi ON bi.versao_id=s.versao_id AND bi.id=s.bloco_inicio
  JOIN bloco bf ON bf.versao_id=s.versao_id AND bf.id=s.bloco_fim
  WHERE s.versao_id=h.versao_id AND s.nivel=1 AND h.ordem BETWEEN bi.ordem AND bf.ordem
  ORDER BY s.ordem LIMIT 1
) cap ON true
ORDER BY ${escopo === 'biblioteca' ? 'h.relevancia DESC, h.titulo, h.documento_id, h.ordem' : 'h.ordem'}`;

function resultadoDaLinha(linha: LinhaDaBusca, frase: string | null): ResultadoDaBusca {
  const ocorrencias = frase === null ? ocorrenciasDoRealce(linha.realce, linha.texto) ?? [] : ocorrenciasDaFrase(frase, linha.texto);
  const pdf = linha.origens.find((origem) => origem.tipo === 'pdf');
  return {
    documento_id: linha.documento_id, titulo: linha.titulo, autor: linha.autor, formato: linha.formato,
    versao_id: linha.versao_id,
    capitulo: linha.capitulo_id === null ? null : { id: linha.capitulo_id, titulo: linha.capitulo_titulo ?? '' },
    bloco_id: linha.bloco_id,
    pagina: pdf?.tipo === 'pdf' ? pdf.pagina : null,
    ocorrencias,
    trecho: trechoEmSegmentos(linha.texto, ocorrencias),
  };
}

async function buscar(
  banco: pg.Pool, escopo: 'biblioteca' | 'documento', consulta: string, limite: number, deslocamento: number, documentoId?: Id,
): Promise<RespostaDaBusca> {
  const frase = padraoDaFrase(consulta);
  const parametros: unknown[] = [consulta, limite, deslocamento, OPCOES_DO_REALCE];
  if (frase !== null) parametros.push(frase);
  if (escopo === 'documento') parametros.push(documentoId);
  const linhas = await comTransacao(banco, async (cliente) => (await cliente.query<LinhaDaBusca>(sqlDaBusca(escopo, frase !== null), parametros)).rows);
  const total = linhas.length > 0 ? Number(linhas[0]!.total) : 0;
  return {
    consulta, total, resultados: linhas.map((linha) => resultadoDaLinha(linha, frase)),
    proximo: deslocamento + linhas.length < total ? deslocamento + linhas.length : null,
  };
}

export function registrarBusca(api: Hono, banco: pg.Pool): void {
  api.get('/api/busca', async (c) => {
    const consulta = lerConsulta(c.req.query('q'));
    const limite = lerInteiro(c.req.query('limite'), 30, 1, 100, 'limite');
    const deslocamento = lerInteiro(c.req.query('deslocamento'), 0, 0, 100_000, 'deslocamento');
    return c.json(await buscar(banco, 'biblioteca', consulta, limite, deslocamento));
  });

  api.get('/api/documentos/:id/busca', async (c) => {
    const id = c.req.param('id');
    if (!ehUlid(id)) throw new ErroDaApi(400, 'identificador_invalido', 'Identificador de documento inválido.');
    const consulta = lerConsulta(c.req.query('q'));
    const limite = lerInteiro(c.req.query('limite'), 200, 1, 500, 'limite');
    const deslocamento = lerInteiro(c.req.query('deslocamento'), 0, 0, 100_000, 'deslocamento');
    const estado = await comTransacao(banco, async (cliente) => (await cliente.query<{ versoes: string }>(
      'SELECT (SELECT count(*) FROM versao_texto WHERE documento_id=d.id)::text AS versoes FROM documento d WHERE d.id=$1', [id])).rows[0]);
    if (!estado) throw new ErroDaApi(404, 'documento_inexistente');
    if (estado.versoes === '0') throw new ErroDaApi(409, 'sem_texto', 'O documento ainda não tem texto canonizado.');
    return c.json(await buscar(banco, 'documento', consulta, limite, deslocamento, id));
  });
}
