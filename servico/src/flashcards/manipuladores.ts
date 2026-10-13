/**
 * Job `gerar_flashcards`: cartões frente/verso de um capítulo, a partir do texto, dos grifos e das
 * notas do leitor.
 *
 * - Fila: `dedup_key = flashcards:<versão>:<seção>:<pedido>`. Gerar de novo é outro pedido; um pedido
 *   em curso recusa outro do mesmo capítulo.
 * - Execução (fora de transação): o Codex recebe os blocos com apelidos (`B1`…) e devolve cartões com
 *   bloco + citação literal. O serviço traduz o apelido e resolve a citação no bloco; ausente ou ambígua
 *   vira diagnóstico e o cartão sai (nunca a primeira ocorrência). Nenhum cartão válido = falha legível.
 * - Publicação: os cartões entram na transação que fecha a tentativa, com o `job_id` (uma publicação só).
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { ulid } from 'ulid';
import type { AncoraV1, Bloco, Id, JobResultV1 } from '@margem/contratos';
import { ancoraDeSelecao, resolverCitacao } from '@margem/core';
import { comTransacao, type Transacao } from '../db/transacao.js';
import { sha256 } from '../executor/artefato.js';
import { prepararEntrada } from '../executor/entrada.js';
import { falhou, type ExecucaoOk, type Executor, type ResultadoExecutor } from '../executor/tipos.js';
import { obterVersao } from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import { blocosDaSecao } from '../visuais/manipuladores.js';
import { exigirTransacao } from '../worker/canonizar.js';
import { entradaDoJob } from '../worker/fila-postgres.js';
import type { ContextoPublicacao } from '../worker/fila.js';
import type { Manipulador, Tarefa } from '../worker/worker.js';
import { montarPromptDosFlashcards, VERSAO_PROMPT_FLASHCARDS, type MarcaDoLeitor } from './prompts.js';
import { criarCartao, frentesDoCapitulo, FRENTE_MAXIMA, VERSO_MAXIMO } from './repo.js';

export const TIPO_GERAR_FLASHCARDS = 'gerar_flashcards';
/** Um capítulo longo leva de 1 a 3 minutos no esforço low. */
export const PRAZO_DOS_FLASHCARDS_MS = 600_000;
/** Cartões são tarefa leve: `low` por padrão (`MARGEM_ESFORCO_FLASHCARDS` troca). */
export const ESFORCO_DOS_FLASHCARDS_PADRAO = 'low';
export function esforcoDosFlashcards(ambiente: NodeJS.ProcessEnv = process.env): string {
  const valor = ambiente.MARGEM_ESFORCO_FLASHCARDS?.trim();
  return valor === undefined || valor === '' ? ESFORCO_DOS_FLASHCARDS_PADRAO : valor;
}

export interface ConfiguracaoDosFlashcards {
  banco: pg.Pool;
  executor: Executor;
  modelo: string;
  esforco: string;
  prazoMs?: number;
  diretorioArtefatos?: string;
}

interface Diagnostico { codigo: string; mensagem: string }

// ---------------------------------------------------------------- fila

export interface ChaveDosFlashcards { versaoId: Id; secaoId: Id; pedidoId: Id }
export const prefixoDosFlashcards = (versaoId: Id, secaoId: Id): string => `flashcards:${versaoId}:${secaoId}:`;
export function lerChaveDosFlashcards(dedupKey: string): ChaveDosFlashcards {
  const [prefixo, versaoId, secaoId, pedidoId, ...resto] = dedupKey.split(':');
  if (prefixo !== 'flashcards' || !versaoId || !secaoId || !pedidoId || resto.length > 0) throw new Error(`Chave de flashcards malformada: ${dedupKey}`);
  return { versaoId, secaoId, pedidoId };
}

export class FlashcardsEmCurso extends Error {
  constructor() { super('Já há flashcards sendo criados para este capítulo.'); this.name = 'FlashcardsEmCurso'; }
}

/** Enfileira um pedido (recusa se outro do mesmo capítulo está na fila ou rodando). */
export async function pedirFlashcards(cliente: Transacao, entrada: { versaoId: Id; secaoId: Id }): Promise<jobsRepo.Job> {
  const prefixo = prefixoDosFlashcards(entrada.versaoId, entrada.secaoId);
  await cliente.query('SELECT pg_advisory_xact_lock(hashtext($1))', [prefixo]);
  const emCurso = await cliente.query(`SELECT 1 FROM job WHERE tipo=$1 AND starts_with(dedup_key, $2) AND estado IN ('fila','reservado','adiado')`,
    [TIPO_GERAR_FLASHCARDS, prefixo]);
  if (emCurso.rowCount) throw new FlashcardsEmCurso();
  const dedup_key = `${prefixo}${ulid()}`;
  return jobsRepo.enfileirar(cliente, {
    tipo: TIPO_GERAR_FLASHCARDS, dedup_key, input_snapshot_hash: sha256(dedup_key), versao_id: entrada.versaoId,
    prioridade: jobsRepo.PRIORIDADE.artefato_pedido,
  });
}

/** Pedidos de flashcards em curso por capítulo, de um documento (a página mostra "criando…"). */
export async function capitulosEmCurso(cliente: Transacao, documentoId: Id | null): Promise<Id[]> {
  const { rows } = await cliente.query<{ dedup_key: string }>(`SELECT j.dedup_key FROM job j JOIN versao_texto v ON v.id = j.versao_id
    WHERE j.tipo=$1 AND j.estado IN ('fila','reservado','adiado') AND ($2::text IS NULL OR v.documento_id = $2)`, [TIPO_GERAR_FLASHCARDS, documentoId]);
  return [...new Set(rows.map((linha) => lerChaveDosFlashcards(linha.dedup_key).secaoId))];
}

// ---------------------------------------------------------------- saída do modelo

export interface SaidaDosFlashcards { cartoes: { frente: string; verso: string; citacao: { bloco: string; texto: string } }[] }

const ehTexto = (valor: unknown): valor is string => typeof valor === 'string';
function ehSaida(valor: unknown): valor is SaidaDosFlashcards {
  const v = valor as Partial<SaidaDosFlashcards> | null;
  return v !== null && typeof v === 'object' && Array.isArray(v.cartoes) && v.cartoes.every((c) => typeof c === 'object' && c !== null
    && ehTexto(c.frente) && ehTexto(c.verso) && typeof c.citacao === 'object' && c.citacao !== null && ehTexto(c.citacao.bloco) && ehTexto(c.citacao.texto));
}

const limpo = (valor: string, maximo: number): string => valor.replace(/[ \t]+/gu, ' ').trim().slice(0, maximo).trim();

export interface CartaoResolvido { frente: string; verso: string; ancora: AncoraV1 }

/** Saída do modelo → cartões com âncora resolvida. O que não se ancora vira diagnóstico. */
export function resolverCartoes(saida: SaidaDosFlashcards, apelidos: ReadonlyMap<string, Id>, blocos: readonly Bloco[], versaoId: Id, existentes: readonly string[] = []):
  { cartoes: CartaoResolvido[]; diagnosticos: Diagnostico[] } {
  const porId = new Map(blocos.map((bloco) => [bloco.id, bloco]));
  const vistas = new Set(existentes.map((frente) => frente.toLocaleLowerCase('pt-BR').replace(/\s+/gu, ' ').trim()));
  const diagnosticos: Diagnostico[] = [];
  const cartoes: CartaoResolvido[] = [];
  saida.cartoes.forEach((cartao, indice) => {
    const n = `Cartão ${String(indice + 1)}`;
    const frente = limpo(cartao.frente, FRENTE_MAXIMA);
    const verso = limpo(cartao.verso, VERSO_MAXIMO);
    if (frente === '' || verso === '') { diagnosticos.push({ codigo: 'cartao_vazio', mensagem: `${n}: frente ou verso vazio; saiu.` }); return; }
    const chave = frente.toLocaleLowerCase('pt-BR').replace(/\s+/gu, ' ');
    if (vistas.has(chave)) { diagnosticos.push({ codigo: 'cartao_repetido', mensagem: `${n}: a pergunta já existe; saiu.` }); return; }
    const bloco = porId.get(apelidos.get(cartao.citacao.bloco) ?? '');
    if (!bloco) { diagnosticos.push({ codigo: 'bloco_inexistente', mensagem: `${n}: o bloco ${cartao.citacao.bloco} não existe no capítulo; saiu.` }); return; }
    const resolvida = resolverCitacao({ ...bloco, versao_id: versaoId }, { citacao: cartao.citacao.texto });
    if (!resolvida.ok) {
      diagnosticos.push(resolvida.motivo === 'ambigua'
        ? { codigo: 'citacao_ambigua', mensagem: `${n}: a citação aparece ${String(resolvida.ocorrencias)} vezes no bloco; saiu.` }
        : { codigo: 'citacao_ausente', mensagem: `${n}: a citação não está literalmente no bloco; saiu.` });
      return;
    }
    vistas.add(chave);
    cartoes.push({ frente, verso, ancora: ancoraDeSelecao({ ...bloco, versao_id: versaoId }, resolvida.ancora.inicio_utf16, resolvida.ancora.fim_utf16) });
  });
  return { cartoes, diagnosticos };
}

// ---------------------------------------------------------------- execução

interface Entrada { documentoId: Id; documento: string; capitulo: string; blocos: Bloco[]; marcas: MarcaDoLeitor[]; existentes: string[] }

async function montarEntrada(cliente: Transacao, chave: ChaveDosFlashcards): Promise<Entrada | string> {
  const versao = await obterVersao(cliente, chave.versaoId);
  const secao = versao.canonico.secoes.find((candidata) => candidata.id === chave.secaoId);
  if (!secao) return 'O capítulo não existe na versão.';
  const blocos = blocosDaSecao(versao.canonico, secao);
  const ids = blocos.map((bloco) => bloco.id);
  const ordem = new Map(ids.map((id, indice) => [id, indice]));
  // Grifos do leitor (marcas manuais não rejeitadas) e as notas dele, na ordem do texto.
  const { rows } = await cliente.query<MarcaDoLeitor & { inicio: number }>(`
    SELECT bloco_id, citacao, comentario->>'texto' AS nota, inicio_utf16::int AS inicio FROM marca
      WHERE versao_id=$1 AND bloco_id = ANY($2::text[]) AND origem='manual' AND avaliacao <> 'rejeitada'
    UNION ALL
    SELECT bloco_id, citacao, texto AS nota, inicio_utf16::int FROM anotacao WHERE versao_id=$1 AND bloco_id = ANY($2::text[])`, [versao.id, ids]);
  const marcas = rows.sort((a, b) => (ordem.get(a.bloco_id) ?? 0) - (ordem.get(b.bloco_id) ?? 0) || a.inicio - b.inicio)
    .map(({ bloco_id, citacao, nota }) => ({ bloco_id, citacao, nota: nota?.trim() ? nota : null }));
  return {
    documentoId: versao.documento_id, documento: versao.canonico.documento.titulo, capitulo: secao.titulo, blocos, marcas,
    existentes: await frentesDoCapitulo(cliente, versao.id, secao.id),
  };
}

interface ArtefatoDosFlashcards {
  versao_id: Id; secao_id: Id; cartoes: CartaoResolvido[]; diagnosticos: Diagnostico[];
  execucao: { modelo: string; esforco: string; prompt_versao: string };
}

async function gravarArtefato(config: ConfiguracaoDosFlashcards, tarefa: Tarefa, chave: ChaveDosFlashcards, artefato: ArtefatoDosFlashcards): Promise<{ caminho: string; hash: string }> {
  const conteudo = `${JSON.stringify(artefato, null, 2)}\n`;
  const pasta = join(config.diretorioArtefatos ?? join(homedir(), '.cache/margem/flashcards'), `flashcards-${chave.pedidoId}`);
  await mkdir(pasta, { recursive: true, mode: 0o700 });
  const caminho = join(pasta, `tentativa-${String(tarefa.job.attempt)}-${ulid()}.json`);
  await writeFile(caminho, conteudo, { mode: 0o600 });
  return { caminho, hash: sha256(conteudo) };
}

export async function executarFlashcards(config: ConfiguracaoDosFlashcards, tarefa: Tarefa): Promise<ResultadoExecutor> {
  const inicio = Date.now();
  const chave = lerChaveDosFlashcards(entradaDoJob(tarefa.job.entrada).dedup_key);
  const entrada = await comTransacao(config.banco, (cliente) => montarEntrada(cliente, chave));
  if (typeof entrada === 'string') return falhou('desconhecido', entrada, Date.now() - inicio);
  let prompt;
  try {
    prompt = montarPromptDosFlashcards({ documento: entrada.documento, capitulo: entrada.capitulo, blocos: entrada.blocos, marcas: entrada.marcas, existentes: entrada.existentes });
  } catch (erro) {
    return falhou('desconhecido', erro instanceof Error ? erro.message : 'Prompt impossível.', Date.now() - inicio);
  }
  const raiz = await mkdtemp(join(tmpdir(), 'margem-flashcards-'));
  let resultado: ResultadoExecutor;
  try {
    const preparada = await prepararEntrada(raiz, prompt.prompt, prompt.schema);
    resultado = await config.executor({
      diretorioEntrada: preparada.diretorioEntrada, prompt: preparada.prompt, schema: preparada.schema,
      prazoMs: config.prazoMs ?? PRAZO_DOS_FLASHCARDS_MS, modelo: config.modelo, esforco: config.esforco, sinal: tarefa.sinal,
      ...(config.diretorioArtefatos === undefined ? {} : { diretorioArtefatos: join(config.diretorioArtefatos, 'saidas') }),
    });
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
  if (resultado.estado !== 'ok') return resultado;
  const bruto: unknown = JSON.parse(await readFile(resultado.artefato, 'utf8'));
  if (!ehSaida(bruto)) return falhou('schema', 'Resposta fora do schema dos flashcards.', Date.now() - inicio);
  const { cartoes, diagnosticos } = resolverCartoes(bruto, prompt.blocos, entrada.blocos, chave.versaoId, entrada.existentes);
  if (cartoes.length === 0) {
    return falhou('schema', `Nenhum cartão ficou ancorado no texto (${String(bruto.cartoes.length)} recusados: ${diagnosticos.map((d) => d.codigo).join(', ')}).`, Date.now() - inicio);
  }
  const esforco = resultado.esforco ?? config.esforco;
  const artefato = await gravarArtefato(config, tarefa, chave, {
    versao_id: chave.versaoId, secao_id: chave.secaoId, cartoes, diagnosticos,
    execucao: { modelo: resultado.modelo, esforco, prompt_versao: VERSAO_PROMPT_FLASHCARDS },
  });
  return { estado: 'ok', artefato: artefato.caminho, sha256: artefato.hash, duracao_ms: Date.now() - inicio, modelo: resultado.modelo, esforco };
}

export async function publicarFlashcards(cliente: Transacao, jobId: Id, execucao: ExecucaoOk): Promise<Diagnostico[]> {
  const artefato = JSON.parse(await readFile(execucao.artefato, 'utf8')) as ArtefatoDosFlashcards;
  // Execução repetida é tolerada; publicação duplicada, não.
  if ((await cliente.query('SELECT 1 FROM flashcard WHERE job_id=$1 LIMIT 1', [jobId])).rowCount) return artefato.diagnosticos;
  for (const cartao of artefato.cartoes) {
    await criarCartao(cliente, { ancora: cartao.ancora, frente: cartao.frente, verso: cartao.verso, origem: 'ia', job_id: jobId, secao_id: artefato.secao_id });
  }
  return artefato.diagnosticos;
}

export function manipuladoresDosFlashcards(config: ConfiguracaoDosFlashcards): Record<string, Manipulador> {
  return {
    [TIPO_GERAR_FLASHCARDS]: {
      executar: (tarefa) => executarFlashcards(config, tarefa),
      publicar: async (_tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao): Promise<JobResultV1> => {
        const diagnosticos = await publicarFlashcards(exigirTransacao(contexto), contexto.job.id, execucao);
        return {
          job_id: contexto.job.id, attempt: contexto.job.attempt, lease_token: contexto.lease_token, duracao_ms: execucao.duracao_ms,
          estado: 'ok', modelo: execucao.modelo, artefato: { caminho: execucao.artefato, sha256: execucao.sha256 },
          diagnosticos: diagnosticos.map((d) => ({ nivel: 'aviso' as const, codigo: d.codigo, mensagem: d.mensagem })),
        };
      },
    },
  };
}
