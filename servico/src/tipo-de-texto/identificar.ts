/**
 * Tipo de texto do documento (v0.1, J131, auditoria A §6.2).
 *
 * - Job `identificar_tipo` (`dedup_key = identificar_tipo:<versão>`), enfileirado quando a canonização
 *   publica uma versão de um documento ainda sem tipo. O Codex, com pouco esforço, vê título, sumário,
 *   sinais contados e amostras curtas, e escolhe um tipo de `contratos/tipos-de-texto.json`.
 * - Publicação: grava `documento.tipo_de_texto` com origem `detectado`, nunca por cima de uma escolha da
 *   pessoa (`escolhido`). Se um "Preparar leitura" esperava pelo tipo (`preparacao_pedida`), a preparação
 *   começa na mesma transação.
 * - Atalhos sem Codex: Notícias já entram como notícia; cabeçalhos de e-mail no início viram e-mail.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import {
  idsDosTipos, lerTiposDeTexto, tipoDeTexto, type Bloco, type CanonicoV1, type ConfiancaDoTipo, type Id, type JobResultV1,
  type TipoDoDocumentoV1, type TiposDeTextoV1,
} from '@margem/contratos';
import { comTransacao, type Transacao } from '../db/transacao.js';
import { lerPadrao } from '../compreensao/itens.js';
import { lerJsonLimitado, ORCAMENTOS } from '../entrada-json.js';
import { registrarNaAuditoria } from '../executor/auditoria.js';
import { sha256 } from '../executor/artefato.js';
import { prepararEntrada } from '../executor/entrada.js';
import type { ExecucaoOk, Executor, ResultadoExecutor } from '../executor/tipos.js';
import { cercar, corpoDoModelo, ehObjeto, lerPrompt, preencher } from '../leitura/v2/prompt.js';
import { obterVersao } from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import { exigirTransacao } from '../worker/canonizar.js';
import { entradaDoJob } from '../worker/fila-postgres.js';
import type { ContextoPublicacao } from '../worker/fila.js';
import type { Manipulador, Tarefa } from '../worker/worker.js';

export const TIPO_IDENTIFICAR = 'identificar_tipo';
export const VERSAO_PROMPT_TIPO = 'identificar-tipo@1';
/** Reconhecer o tipo é tarefa leve: `low` por padrão (`MARGEM_ESFORCO_TIPO` troca). */
export const ESFORCO_DO_TIPO_PADRAO = 'low';
/** Reconhecer o tipo leva segundos; três minutos sobram (passado o prazo da espera, a leitura já seguiu). */
export const PRAZO_DO_TIPO_MS = 180_000;
export function esforcoDoTipo(ambiente: NodeJS.ProcessEnv = process.env): string {
  const valor = ambiente.MARGEM_ESFORCO_TIPO?.trim();
  return valor === undefined || valor === '' ? ESFORCO_DO_TIPO_PADRAO : valor;
}

let cache: TiposDeTextoV1 | undefined;
/** O catálogo de tipos, lido e validado uma vez por processo. */
export function tiposDeTexto(): TiposDeTextoV1 {
  cache ??= lerTiposDeTexto();
  return cache;
}

export const chaveDaIdentificacao = (versaoId: Id): string => `${TIPO_IDENTIFICAR}:${versaoId}`;
function versaoDaChave(dedupKey: string): Id {
  const [tipo, versao, ...resto] = dedupKey.split(':');
  if (tipo !== TIPO_IDENTIFICAR || !versao || resto.length > 0) throw new Error(`Chave de identificação malformada: ${dedupKey}`);
  return versao;
}

// ---------------------------------------------------------------- tipo gravado

export async function lerTipoDoDocumento(cliente: Transacao, documentoId: Id): Promise<TipoDoDocumentoV1 | null> {
  return (await cliente.query<{ tipo_de_texto: TipoDoDocumentoV1 | null }>('SELECT tipo_de_texto FROM documento WHERE id=$1', [documentoId])).rows[0]?.tipo_de_texto ?? null;
}

export class TipoInexistente extends Error {
  constructor(id: string) { super(`Tipo de texto desconhecido: ${id}.`); this.name = 'TipoInexistente'; }
}

/** A escolha da pessoa: vale mais que qualquer detecção, a de agora e as futuras. */
export async function gravarTipoEscolhido(cliente: Transacao, documentoId: Id, tipoId: string, agora = new Date()): Promise<TipoDoDocumentoV1> {
  if (!tipoDeTexto(tiposDeTexto(), tipoId)) throw new TipoInexistente(tipoId);
  const tipo: TipoDoDocumentoV1 = { tipo_id: tipoId, origem: 'escolhido', confianca: null, justificativa: null, alternativas: [], job_id: null, em: agora.toISOString() };
  await cliente.query('UPDATE documento SET tipo_de_texto=$2 WHERE id=$1', [documentoId, JSON.stringify(tipo)]);
  return tipo;
}

/** Grava a detecção, a menos que a pessoa já tenha escolhido. Devolve se gravou. */
export async function gravarTipoDetectado(cliente: Transacao, documentoId: Id, tipo: Omit<TipoDoDocumentoV1, 'origem'>): Promise<boolean> {
  const gravado = await cliente.query(`UPDATE documento SET tipo_de_texto=$2
    WHERE id=$1 AND (tipo_de_texto IS NULL OR tipo_de_texto->>'origem' <> 'escolhido')`, [documentoId, JSON.stringify({ ...tipo, origem: 'detectado' })]);
  return (gravado.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------- atalhos e enfileiramento

const CABECALHO_DE_EMAIL = /^(de|from|para|to|assunto|subject|data|date|cc)\s*:/imu;
/** Tipo que se sabe sem Codex, pelos primeiros blocos; `null` quando é preciso perguntar. */
export function tipoDeterministico(canonico: Pick<CanonicoV1, 'blocos'>): string | null {
  const inicio = canonico.blocos.slice(0, 6).map((bloco) => bloco.texto).join('\n');
  const linhas = inicio.split('\n').filter((linha) => CABECALHO_DE_EMAIL.test(linha));
  const temRemetente = linhas.some((linha) => /^(de|from)\s*:/iu.test(linha));
  const temAssunto = linhas.some((linha) => /^(assunto|subject)\s*:/iu.test(linha));
  return temRemetente && temAssunto ? 'email' : null;
}

/**
 * Depois de uma versão nova: documento sem tipo ganha o atalho determinístico ou o job de identificação.
 * Documento que já tem tipo (detectado ou escolhido) não pergunta de novo.
 */
export async function aoPublicarVersao(cliente: Transacao, documentoId: Id, versaoId: Id, canonico: Pick<CanonicoV1, 'blocos'>,
  prioridade: number = jobsRepo.PRIORIDADE.padrao): Promise<jobsRepo.Job | null> {
  // O padrão das Configurações: preparar sozinho ao importar. Só uma vez por documento (nunca pedido antes),
  // só com texto de verdade (um PDF escaneado espera a transcrição) e não para vídeo e áudio, que têm o
  // próprio caminho (transcrição, conceitos).
  const candidato = (await cliente.query(`SELECT 1 FROM documento d WHERE d.id=$1 AND d.preparacao_itens IS NULL AND d.preparacao_pedida IS NULL
    AND NOT EXISTS (SELECT 1 FROM video_youtube y WHERE y.documento_id=d.id) AND NOT EXISTS (SELECT 1 FROM midia m WHERE m.documento_id=d.id)`, [documentoId])).rowCount ?? 0;
  const comTexto = canonico.blocos.reduce((soma, bloco) => soma + (bloco.tipo === 'capitulo' || bloco.tipo === 'secao' ? 0 : bloco.texto.length), 0) >= 80;
  const padrao = await lerPadrao(cliente);
  if (candidato > 0 && comTexto && padrao.ao_importar && padrao.itens.length > 0) {
    await cliente.query('UPDATE documento SET preparacao_pedida=$2 WHERE id=$1 AND preparacao_pedida IS NULL',
      [documentoId, JSON.stringify({ todos: false, itens: padrao.itens, origem: 'importacao', em: new Date().toISOString() })]);
    // A preparação começa quando a identificação publicar (com o tipo, ou o já escolhido).
    return enfileirarIdentificacao(cliente, versaoId, prioridade);
  }
  if (await lerTipoDoDocumento(cliente, documentoId)) return null;
  const atalho = tipoDeterministico(canonico);
  if (atalho !== null) {
    await gravarTipoDetectado(cliente, documentoId, { tipo_id: atalho, confianca: 'alta', justificativa: 'Cabeçalhos de e-mail no início do texto.', alternativas: [], job_id: null, em: new Date().toISOString() });
    return null;
  }
  return enfileirarIdentificacao(cliente, versaoId, prioridade);
}

export async function enfileirarIdentificacao(cliente: Transacao, versaoId: Id, prioridade: number = jobsRepo.PRIORIDADE.padrao): Promise<jobsRepo.Job> {
  return jobsRepo.enfileirar(cliente, {
    tipo: TIPO_IDENTIFICAR, dedup_key: chaveDaIdentificacao(versaoId), input_snapshot_hash: sha256(`${VERSAO_PROMPT_TIPO}:${versaoId}`),
    versao_id: versaoId, prioridade,
  });
}

// ---------------------------------------------------------------- prompt

const TAMANHO_DA_AMOSTRA = 1_400;
const TIPOS_DE_TEXTO_CORRIDO = new Set<Bloco['tipo']>(['paragrafo', 'citacao', 'estrofe', 'lista', 'epigrafe', 'equacao', 'codigo']);

function trechoAPartir(blocos: readonly Bloco[], inicio: number): string {
  let saida = '';
  for (let i = Math.max(0, inicio); i < blocos.length && saida.length < TAMANHO_DA_AMOSTRA; i += 1) {
    const bloco = blocos[i]!;
    if (!TIPOS_DE_TEXTO_CORRIDO.has(bloco.tipo)) continue;
    saida += `${saida ? '\n\n' : ''}${bloco.texto}`;
  }
  return saida.length > TAMANHO_DA_AMOSTRA ? `${saida.slice(0, TAMANHO_DA_AMOSTRA).trimEnd()}…` : saida;
}

/** Até seis amostras: começo, meio e fim do texto, e o começo do segundo e do terceiro capítulos. */
export function amostrasDoTexto(canonico: Pick<CanonicoV1, 'blocos' | 'secoes'>): { rotulo: string; texto: string }[] {
  const blocos = canonico.blocos;
  const posicao = new Map(blocos.map((bloco, indice) => [bloco.id, indice]));
  const capitulos = canonico.secoes.filter((secao) => secao.nivel === 1).map((secao) => posicao.get(secao.bloco_inicio) ?? 0);
  const candidatos: { rotulo: string; inicio: number }[] = [
    { rotulo: 'Começo do texto', inicio: 0 },
    ...capitulos.slice(1, 3).map((inicio, i) => ({ rotulo: `Começo do capítulo ${String(i + 2)}`, inicio })),
    { rotulo: 'Meio do texto', inicio: Math.floor(blocos.length / 2) },
    { rotulo: 'Fim do texto', inicio: Math.max(0, blocos.length - 4) },
  ];
  const vistas = new Set<string>();
  const saida: { rotulo: string; texto: string }[] = [];
  for (const candidato of candidatos) {
    const texto = trechoAPartir(blocos, candidato.inicio);
    if (texto === '' || vistas.has(texto)) continue;
    vistas.add(texto);
    saida.push({ rotulo: candidato.rotulo, texto });
  }
  return saida.slice(0, 6);
}

/** Sinais contados (determinísticos) que ajudam a reconhecer o tipo. */
export function sinaisDoTexto(canonico: Pick<CanonicoV1, 'blocos' | 'secoes'>): string {
  const total = canonico.blocos.length || 1;
  const contar = (tipo: Bloco['tipo']) => canonico.blocos.filter((bloco) => bloco.tipo === tipo).length;
  const palavras = canonico.blocos.reduce((soma, bloco) => soma + (bloco.texto.match(/\S+/gu)?.length ?? 0), 0);
  const percentual = (n: number) => `${String(Math.round((n / total) * 100))}%`;
  const dialogos = canonico.blocos.filter((bloco) => bloco.tipo === 'paragrafo' && /^\s*[—–-]\s/u.test(bloco.texto)).length;
  return [
    `- ${String(palavras)} palavras, ${String(canonico.blocos.length)} blocos, ${String(canonico.secoes.filter((secao) => secao.nivel === 1).length)} capítulos.`,
    `- Estrofes (versos): ${String(contar('estrofe'))} (${percentual(contar('estrofe'))} dos blocos).`,
    `- Equações: ${String(contar('equacao'))}; código: ${String(contar('codigo'))}; tabelas: ${String(contar('tabela'))}; notas de rodapé: ${String(contar('nota_rodape'))}.`,
    `- Parágrafos que começam com travessão (diálogo): ${String(dialogos)}.`,
    `- Cabeçalhos de e-mail no início: ${tipoDeterministico(canonico) === 'email' ? 'sim' : 'não'}.`,
  ].join('\n');
}

export interface DadosDoPrompt {
  titulo: string; autor: string | null; formato: string; origem: string;
  canonico: Pick<CanonicoV1, 'blocos' | 'secoes'>;
}

export function montarPromptDeTipo(dados: DadosDoPrompt, tipos: TiposDeTextoV1 = tiposDeTexto()): { prompt: string; schema: Record<string, unknown> } {
  const schema: unknown = JSON.parse(lerPrompt(`${VERSAO_PROMPT_TIPO}.schema.json`));
  if (!ehObjeto(schema)) throw new Error('Schema da identificação não é um objeto.');
  const sumario = dados.canonico.secoes.slice(0, 40).map((secao) => `${'  '.repeat(Math.max(0, secao.nivel - 1))}- ${secao.titulo}`).join('\n');
  const amostras = amostrasDoTexto(dados.canonico).map((amostra) => `### ${amostra.rotulo}\n\n${cercar(amostra.texto)}`).join('\n\n');
  const lista = tipos.grupos.flatMap((grupo) => grupo.tipos.map((tipo) => `- \`${tipo.id}\` — ${grupo.rotulo} · ${tipo.rotulo} (${tipo.exemplos})`)).join('\n');
  return {
    prompt: preencher(corpoDoModelo(lerPrompt(`${VERSAO_PROMPT_TIPO}.md`)), {
      titulo: cercar(dados.titulo), autor: dados.autor === null ? '(sem autor informado)' : cercar(dados.autor),
      formato: dados.formato, origem: cercar(dados.origem), sumario: sumario === '' ? '(sem seções)' : cercar(sumario),
      sinais: sinaisDoTexto(dados.canonico), amostras: amostras === '' ? '(o texto não tem trechos corridos)' : amostras, tipos: lista,
    }),
    schema,
  };
}

// ---------------------------------------------------------------- execução e publicação

export interface ConfiguracaoDoTipo {
  banco: pg.Pool;
  executor: Executor;
  modelo: string;
  esforco: string;
  prazoMs?: number;
  /**
   * Quando um "Preparar leitura" esperava pelo tipo, a publicação começa a preparação: o worker passa aqui
   * a função que a faz (a da compreensão), dentro da mesma transação.
   */
  aoConhecerTipo?: (cliente: Transacao, documentoId: Id, pedido: { todos?: boolean }) => Promise<void>;
}

async function dadosDaVersao(cliente: Transacao, versaoId: Id): Promise<DadosDoPrompt & { documento_id: Id }> {
  const versao = await obterVersao(cliente, versaoId);
  const documento = (await cliente.query<{ titulo: string; autor: string | null; formato: string; origem_caminho: string }>(
    'SELECT titulo, autor, formato, origem_caminho FROM documento WHERE id=$1', [versao.documento_id])).rows[0];
  if (!documento) throw new Error('Documento inexistente.');
  // Só o nome do arquivo (ou o endereço): o caminho local não diz nada sobre o texto.
  const origem = /^https?:\/\//u.test(documento.origem_caminho) ? documento.origem_caminho : documento.origem_caminho.split(/[\\/]/u).at(-1) ?? '';
  return { documento_id: versao.documento_id, titulo: documento.titulo, autor: documento.autor, formato: documento.formato, origem: origem || '(desconhecida)', canonico: versao.canonico };
}

export async function executarIdentificacao(config: ConfiguracaoDoTipo, dedupKey: string, sinal?: AbortSignal): Promise<ResultadoExecutor> {
  const dados = await comTransacao(config.banco, (cliente) => dadosDaVersao(cliente, versaoDaChave(dedupKey)));
  const raiz = await mkdtemp(join(tmpdir(), 'margem-tipo-'));
  try {
    const montado = montarPromptDeTipo(dados);
    const preparada = await prepararEntrada(raiz, montado.prompt, montado.schema);
    return await config.executor({
      diretorioEntrada: preparada.diretorioEntrada, prompt: preparada.prompt, schema: preparada.schema,
      prazoMs: config.prazoMs ?? PRAZO_DO_TIPO_MS, modelo: config.modelo, esforco: config.esforco,
      ...(sinal === undefined ? {} : { sinal }),
    });
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
}

export interface SaidaDoTipo { tipo_id: string; confianca: ConfiancaDoTipo; justificativa: string; alternativas: string[] }
/** A saída do Codex, conferida campo a campo contra o catálogo (o schema já é estrito; aqui não se confia nele). */
export function lerSaidaDoTipo(bruto: unknown, tipos: TiposDeTextoV1 = tiposDeTexto()): SaidaDoTipo {
  const ids = new Set(idsDosTipos(tipos));
  if (!ehObjeto(bruto)) throw new Error('Resposta da identificação não é um objeto.');
  const { tipo_id, confianca, justificativa, alternativas, ...resto } = bruto as Record<string, unknown>;
  if (Object.keys(resto).length > 0) throw new Error('Resposta da identificação com campos desconhecidos.');
  if (typeof tipo_id !== 'string' || !ids.has(tipo_id)) throw new Error('Tipo de texto fora do catálogo.');
  if (confianca !== 'alta' && confianca !== 'media' && confianca !== 'baixa') throw new Error('Confiança inválida.');
  if (typeof justificativa !== 'string' || justificativa.trim() === '' || justificativa.length > 200) throw new Error('Justificativa inválida.');
  if (!Array.isArray(alternativas) || alternativas.length > 2 || !alternativas.every((item) => typeof item === 'string' && ids.has(item))) {
    throw new Error('Alternativas inválidas.');
  }
  return { tipo_id, confianca, justificativa: justificativa.trim(), alternativas: (alternativas as string[]).filter((item) => item !== tipo_id) };
}

export async function publicarIdentificacao(
  config: ConfiguracaoDoTipo, cliente: Transacao, dedupKey: string, jobId: Id, execucao: ExecucaoOk, agora = new Date(),
): Promise<JobResultV1['diagnosticos']> {
  const versaoId = versaoDaChave(dedupKey);
  const { documento_id: documentoId } = await obterVersao(cliente, versaoId);
  // O "Preparar leitura" e a escolha da pessoa disputam a mesma linha: um de cada vez.
  const linha = (await cliente.query<{ preparacao_pedida: { todos?: boolean } | null }>(
    'SELECT preparacao_pedida FROM documento WHERE id=$1 FOR UPDATE', [documentoId])).rows[0];
  const saida = lerSaidaDoTipo(await lerJsonLimitado(execucao.artefato, ORCAMENTOS.resposta));
  await registrarNaAuditoria('resposta.validada.json', saida);
  const gravou = await gravarTipoDetectado(cliente, documentoId, { ...saida, job_id: jobId, em: agora.toISOString() });
  const diagnosticos: JobResultV1['diagnosticos'] = [{ nivel: 'info', codigo: 'tipo_detectado', mensagem: `${saida.tipo_id} (${saida.confianca})` }];
  if (!gravou) diagnosticos.push({ nivel: 'info', codigo: 'tipo_escolhido_mantido', mensagem: 'A pessoa já escolheu o tipo; a detecção não o substitui.' });
  if (linha?.preparacao_pedida && config.aoConhecerTipo) {
    await config.aoConhecerTipo(cliente, documentoId, linha.preparacao_pedida);
    diagnosticos.push({ nivel: 'info', codigo: 'preparacao_iniciada', mensagem: 'A leitura pedida começou com o tipo detectado.' });
  }
  return diagnosticos;
}

function chaveDo(contexto: ContextoPublicacao | Tarefa): string { return entradaDoJob(contexto.job.entrada).dedup_key; }

export function manipuladoresDoTipo(config: ConfiguracaoDoTipo): Record<string, Manipulador> {
  return {
    [TIPO_IDENTIFICAR]: {
      executar: (tarefa) => executarIdentificacao(config, chaveDo(tarefa), tarefa.sinal),
      publicar: async (_tarefa: Tarefa, execucao: ExecucaoOk, contexto: ContextoPublicacao): Promise<JobResultV1> => ({
        job_id: contexto.job.id, attempt: contexto.job.attempt, lease_token: contexto.lease_token, duracao_ms: execucao.duracao_ms,
        estado: 'ok', modelo: execucao.modelo, artefato: { caminho: execucao.artefato, sha256: execucao.sha256 },
        diagnosticos: await publicarIdentificacao(config, exigirTransacao(contexto), chaveDo(contexto), contexto.job.id, execucao),
      }),
    },
  };
}
