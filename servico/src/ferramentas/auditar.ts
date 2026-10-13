/**
 * Auditor (J26, `docs/desenho/10-MODELO-DO-CAPITULO.md` §8): texto puro, deliberadamente simples.
 *
 *   npm run auditar -- --job <ULID> [--resumo]
 *   npm run auditar -- --parte <ULID> [--resumo]
 *   npm run auditar -- --marca <ULID> [--resumo]
 *   npm run auditar -- --capitulo <execucao> <secao>
 *
 * Lê o banco (jobs, eventos, marcas, revisões do modelo) e os arquivos gravados pela
 * auditoria de cada tentativa (`<MARGEM_ARTEFATOS ou ~/.cache/margem>/auditoria`).
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type pg from 'pg';
import { raizDaAuditoria } from '../executor/auditoria.js';
import { historicoDoElemento, resumoDoCapitulo } from '../compreensao/auditoria.js';

export interface OpcoesDoRelatorio {
  raiz: string;
  /** Corta prompt e resposta em poucas linhas. */
  resumo?: boolean;
}

type Consultavel = Pick<pg.Pool, 'query'>;

const LIMITE_RESUMO = 1_200;

function cortar(texto: string, resumo: boolean | undefined): string {
  if (!resumo || texto.length <= LIMITE_RESUMO) return texto;
  return `${texto.slice(0, LIMITE_RESUMO)}\n[… ${String(texto.length - LIMITE_RESUMO)} caracteres omitidos; sem --resumo mostra tudo]`;
}

function caixa(titulo: string, conteudo: string): string {
  const linha = '─'.repeat(Math.max(4, 60 - titulo.length));
  return `┌─ ${titulo} ${linha}\n${conteudo.trimEnd()}\n└${'─'.repeat(64)}`;
}

async function lerSeExistir(caminho: string): Promise<string | undefined> {
  try {
    return await readFile(caminho, 'utf8');
  } catch {
    return undefined;
  }
}

interface LinhaDoJob {
  id: string; tipo: string; estado: string; attempt: number; dedup_key: string;
  parte_id: string | null; error_code: string | null; diagnosticos: { nivel: string; codigo: string; mensagem: string }[];
  criado_em: string; atualizado_em: string;
}

/** Relatório de um job: estado, eventos e, por tentativa, prompt, resposta e diagnósticos gravados. */
export async function relatorioDoJob(banco: Consultavel, jobId: string, opcoes: OpcoesDoRelatorio): Promise<string> {
  const job = (await banco.query<LinhaDoJob>(`SELECT id, tipo, estado, attempt, dedup_key, parte_id, error_code, diagnosticos,
      to_char(criado_em AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS criado_em,
      to_char(atualizado_em AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS atualizado_em
    FROM job WHERE id=$1`, [jobId])).rows[0];
  if (!job) return `Job ${jobId} não encontrado.`;
  const linhas: string[] = [
    `Job ${job.id} · ${job.tipo} · ${job.estado} · tentativa ${String(job.attempt)}`,
    `  chave: ${job.dedup_key}`,
    ...(job.parte_id === null ? [] : [`  parte: ${job.parte_id}`]),
    `  criado ${job.criado_em} · atualizado ${job.atualizado_em}${job.error_code ? ` · erro ${job.error_code}` : ''}`,
  ];
  const eventos = (await banco.query<{ tipo: string; quando: string; detalhe: unknown }>(
    `SELECT tipo, to_char(quando AT TIME ZONE 'UTC','HH24:MI:SS') AS quando, detalhe FROM evento_job WHERE job_id=$1 ORDER BY id`,
    [jobId])).rows;
  if (eventos.length > 0) {
    linhas.push('', 'Eventos:');
    for (const evento of eventos) linhas.push(`  ${evento.quando} ${evento.tipo} ${JSON.stringify(evento.detalhe)}`);
  }
  const resolvidas = await contarResolvidas(banco, jobId);
  if (resolvidas !== null) linhas.push('', `Marcas publicadas por este job: ${String(resolvidas)}`);
  if (job.diagnosticos.length > 0) {
    const descartes = job.diagnosticos.filter((item) => item.nivel === 'aviso').length;
    linhas.push(`Diagnósticos: ${String(job.diagnosticos.length)} (${String(descartes)} avisos)`);
    for (const item of job.diagnosticos) linhas.push(`  [${item.nivel}] ${item.codigo}: ${item.mensagem}`);
  }
  const pasta = join(opcoes.raiz, 'jobs', jobId);
  let tentativas: string[] = [];
  try {
    tentativas = (await readdir(pasta)).filter((nome) => nome.startsWith('tentativa-')).sort();
  } catch {
    linhas.push('', `Sem auditoria gravada em ${pasta} (job anterior ao J26 ou worker com MARGEM_AUDITORIA=0).`);
  }
  for (const tentativa of tentativas) {
    const dir = join(pasta, tentativa);
    linhas.push('', `═══ ${tentativa} (${dir})`);
    const metadados = await lerSeExistir(join(dir, 'metadados.json'));
    if (metadados !== undefined) linhas.push(caixa('METADADOS', metadados));
    const prompt = await lerSeExistir(join(dir, 'prompt.txt'));
    if (prompt !== undefined) linhas.push(caixa('PROMPT', cortar(prompt, opcoes.resumo)));
    const aliases = await lerSeExistir(join(dir, 'aliases.json'));
    if (aliases !== undefined) linhas.push(caixa('ALIASES', cortar(aliases, opcoes.resumo)));
    const resultado = await lerSeExistir(join(dir, 'resultado.json'));
    if (resultado !== undefined) linhas.push(caixa('RESULTADO', resultado));
    const resposta = await lerSeExistir(join(dir, 'resposta.bruta.json'));
    if (resposta !== undefined) linhas.push(caixa('RESPOSTA', cortar(resposta, opcoes.resumo)));
    const validada = await lerSeExistir(join(dir, 'resposta.validada.json'));
    if (validada !== undefined) linhas.push(caixa('RESPOSTA VALIDADA', cortar(validada, opcoes.resumo)));
    const diagnosticos = await lerSeExistir(join(dir, 'diagnosticos.json'));
    if (diagnosticos !== undefined) linhas.push(caixa('DIAGNÓSTICOS', cortar(diagnosticos, opcoes.resumo)));
  }
  return linhas.join('\n');
}

async function contarResolvidas(banco: Consultavel, jobId: string): Promise<number | null> {
  const linha = (await banco.query<{ total: number }>('SELECT count(*)::int AS total FROM marca WHERE job_id=$1', [jobId])).rows[0];
  return linha === undefined || linha.total === 0 ? null : linha.total;
}

/** O job mais recente de uma parte (da leitura V1/V2 ou da análise local). */
export async function relatorioDaParte(banco: Consultavel, parteId: string, opcoes: OpcoesDoRelatorio): Promise<string> {
  const jobs = (await banco.query<{ id: string }>('SELECT id FROM job WHERE parte_id=$1 ORDER BY criado_em DESC, id DESC', [parteId])).rows;
  if (jobs.length === 0) return `Parte ${parteId} sem job.`;
  const relatorios: string[] = [];
  for (const job of jobs) relatorios.push(await relatorioDoJob(banco, job.id, opcoes));
  return relatorios.join('\n\n');
}

/** Uma marca: o job que a criou e, se veio da projeção, o caminho do elemento pelas revisões. */
export async function relatorioDaMarca(banco: Consultavel, marcaId: string, opcoes: OpcoesDoRelatorio): Promise<string> {
  const marca = (await banco.query<{ job_id: string | null; origem: string; funcao: string; saliencia: number; citacao: string }>(
    'SELECT job_id, origem, funcao, saliencia, citacao FROM marca WHERE id=$1', [marcaId])).rows[0];
  if (!marca) return `Marca ${marcaId} não encontrada.`;
  const cabecalho = `Marca ${marcaId} · ${marca.origem} · ${marca.funcao} · saliência ${String(marca.saliencia)}\n  “${marca.citacao}”`;
  const partes: string[] = [cabecalho];
  const elemento = (await banco.query<{ elemento_id: string; modelo_id: string; regra: string }>(
    'SELECT elemento_id, modelo_id, regra FROM marca_elemento WHERE marca_id=$1', [marcaId])).rows[0];
  if (elemento) {
    partes.push(`  projetada do elemento ${elemento.elemento_id} (revisão ${elemento.modelo_id}, regra ${elemento.regra})`, '');
    partes.push(await historicoDoElemento(banco, elemento.elemento_id, elemento.modelo_id));
  }
  if (marca.job_id !== null) partes.push('', await relatorioDoJob(banco, marca.job_id, opcoes));
  return partes.join('\n');
}

function argumento(argv: readonly string[], nome: string): string | undefined {
  const indice = argv.indexOf(`--${nome}`);
  return indice === -1 ? undefined : argv[indice + 1];
}

export async function principal(argv: readonly string[] = process.argv.slice(2)): Promise<string> {
  const { pool } = await import('../db/conexao.js');
  const opcoes: OpcoesDoRelatorio = { raiz: raizDaAuditoria(), resumo: argv.includes('--resumo') };
  try {
    const job = argumento(argv, 'job');
    if (job !== undefined) return await relatorioDoJob(pool, job, opcoes);
    const parte = argumento(argv, 'parte');
    if (parte !== undefined) return await relatorioDaParte(pool, parte, opcoes);
    const marca = argumento(argv, 'marca');
    if (marca !== undefined) return await relatorioDaMarca(pool, marca, opcoes);
    const indice = argv.indexOf('--capitulo');
    const execucao = indice === -1 ? undefined : argv[indice + 1];
    const secao = indice === -1 ? undefined : argv[indice + 2];
    if (execucao !== undefined && secao !== undefined) return await resumoDoCapitulo(pool, execucao, secao);
    return 'uso: auditar --job <id> | --parte <id> | --marca <id> | --capitulo <execucao> <secao> [--resumo]';
  } finally {
    await pool.end();
  }
}

const caminho = process.argv[1] ?? '';
if (caminho.endsWith('ferramentas/auditar.ts') || caminho.endsWith('ferramentas/auditar.js')) {
  principal().then((texto) => { console.log(texto); }, (erro: unknown) => {
    console.error(erro instanceof Error ? erro.message : 'falha desconhecida no auditor');
    process.exitCode = 1;
  });
}
