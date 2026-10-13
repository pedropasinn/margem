/**
 * Voz da visita guiada (J91), pela fábrica auto-colab. Três passos, como o áudio do J63/J64:
 *
 *   npm run narrar-visita -- enviar <execução> <seção> [<seção>…]   roteiros de fala → job da fábrica (não aloca VM)
 *   node colab/executar.mjs executar <job>                            executa (supervisor do Margem; ver colab/README.md)
 *   npm run narrar-visita -- importar <job>                           confere e publica a narração de cada capítulo
 *
 * Usa o roteiro mais recente de cada capítulo e a receita vigente (`margem-poesia-omnivoice`).
 * Precisa de DATABASE_URL e MARGEM_DADOS (o MP3 vai por hash para MARGEM_DADOS/audio).
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Id, RoteiroGuiadoV1 } from '@margem/contratos';
import { raizDoRepositorio } from '../dados.js';
import { pool } from '../db/conexao.js';
import { migrar } from '../db/migrar.js';
import { comTransacao } from '../db/transacao.js';
import { lerJsonLimitado, ORCAMENTOS } from '../entrada-json.js';
import { RECEITA_DA_VISITA, aulaDoRoteiro, importarAulaDaVisita, roteiroDeFala } from '../visita/narracao.js';
import * as repo from '../visita/repo.js';
import { exigirRecurso } from '../recursos.js';

interface Colab {
  argumentosEnvio: (roteiro: string, receita: string) => string[];
  comando: (args: string[]) => Promise<Record<string, unknown>>;
  exigirJobDoMargem: (job: unknown, id: string) => void;
}
async function colab(): Promise<Colab> {
  return await import(pathToFileURL(join(raizDoRepositorio(), 'colab/executar.mjs')).href) as Colab;
}

async function enviar(execucao: Id, secoes: readonly Id[], receita: string): Promise<void> {
  const roteiros: RoteiroGuiadoV1[] = [];
  await comTransacao(pool, async (cliente) => {
    for (const secao of secoes) {
      const roteiro = await repo.roteiroDoCapitulo(cliente, execucao, secao);
      if (!roteiro) throw new Error(`O capítulo ${secao} ainda não tem roteiro.`);
      roteiros.push(roteiro);
    }
  });
  const arquivos = roteiros.map((roteiro) => ({ nome: `${aulaDoRoteiro(roteiro)}.md`, texto: roteiroDeFala(roteiro) }));
  const hash = createHash('sha256').update(JSON.stringify(arquivos)).digest('hex');
  const pasta = join(homedir(), 'dados/margem/colab/entradas', `visita-${hash.slice(0, 32)}`, 'roteiros');
  await mkdir(pasta, { recursive: true });
  for (const arquivo of arquivos) await writeFile(join(pasta, arquivo.nome), arquivo.texto, { flag: 'w' });
  const { argumentosEnvio, comando } = await colab();
  // A entrada da fábrica é a própria pasta `roteiros/` (armadilha conhecida: nunca a mãe).
  const job = await comando(argumentosEnvio(pasta, receita));
  const palavras = roteiros.reduce((soma, r) => soma + r.falas.reduce((s, f) => s + f.texto.split(/\s+/u).length, 0), 0);
  console.log(JSON.stringify({ job_id: job.job_id, estado: job.state, pasta, aulas: arquivos.map((a) => a.nome), falas: roteiros.reduce((s, r) => s + r.falas.length, 0), palavras }));
}

async function importar(jobId: string): Promise<void> {
  const { comando, exigirJobDoMargem } = await colab();
  const job = await comando(['inspect', jobId, '--json']);
  exigirJobDoMargem(job, jobId);
  if (job.state !== 'COMPLETED' || typeof job.manifest_path !== 'string') throw new Error('Job da fábrica ainda não concluído.');
  const spec = job.spec as { recipe?: unknown } | undefined;
  const receita = typeof spec?.recipe === 'string' ? spec.recipe : RECEITA_DA_VISITA;
  const base = dirname(job.manifest_path);
  const execucao = await lerJsonLimitado(job.manifest_path, ORCAMENTOS.canonico) as { job_id?: unknown; outputs?: unknown };
  if (execucao.job_id !== jobId || !Array.isArray(execucao.outputs)) throw new Error('Manifesto da execução incompatível.');
  const hashes = new Map((execucao.outputs as { path: string; sha256: string }[]).map((saida) => [saida.path, saida.sha256]));
  const aulas = (await readdir(join(base, 'audio'), { withFileTypes: true })).filter((d) => d.isDirectory() && d.name.startsWith('visita-')).map((d) => d.name);
  await migrar(pool);
  for (const aula of aulas) {
    const roteiroId = aula.slice('visita-'.length).toUpperCase();
    const roteiro = await comTransacao(pool, (cliente) => repo.obterRoteiro(cliente, roteiroId));
    if (!roteiro) { console.error(`${aula}: roteiro inexistente neste banco; pulado.`); continue; }
    const narracao = await importarAulaDaVisita(roteiro, join(base, 'audio', aula), { id: jobId, receita, hashes });
    const publicada = await comTransacao(pool, (cliente) => repo.gravarNarracao(cliente, narracao));
    console.log(JSON.stringify({ aula, capitulo: roteiro.capitulo.titulo, narracao: publicada.id, duracao_s: publicada.duracao_s, falas: publicada.falas.length }));
  }
}

const [acao, ...resto] = process.argv.slice(2);
try {
  // Geração pela fábrica auto-colab (OmniVoice): recurso pessoal, desligado numa instalação nova (J102).
  exigirRecurso('audio-colab');
  if (acao === 'enviar' && resto.length >= 2) {
    const receita = process.env.MARGEM_RECEITA_VISITA ?? RECEITA_DA_VISITA;
    await enviar(resto[0]!, resto.slice(1), receita);
  } else if (acao === 'importar' && resto.length === 1) {
    await importar(resto[0]!);
  } else {
    throw new Error('Use: enviar <execução> <seção> [<seção>…] | importar <job>');
  }
} catch (erro) {
  console.error(erro instanceof Error ? erro.message : 'Falha na narração da visita.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
