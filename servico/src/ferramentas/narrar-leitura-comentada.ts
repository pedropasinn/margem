/**
 * Voz da leitura comentada (J92), pela fábrica auto-colab. Como a visita (J91), três passos:
 *
 *   npm run narrar-leitura-comentada -- enviar <execução> <seção>
 *       roteiros de fala → um ou mais jobs da fábrica (três aulas por job; não aloca VM)
 *   node colab/executar.mjs executar <job>          (para cada job; de preferência por systemd-run --user)
 *   npm run narrar-leitura-comentada -- importar <job> [<job>…] [--sem-sinal] [--contraste] [--sem-palavras] [--copia <arquivo.mp3>] [--nao-publicar]
 *       confere as aulas, monta o MP3 do capítulo, alinha as palavras (GPU local) e publica a narração
 *       (`--nao-publicar` só monta e copia: para comparar a transição de ouvido)
 *
 * Usa a leitura mais recente do capítulo e a receita da leitura (`margem-leitura-omnivoice-seed123`, ou
 * MARGEM_RECEITA_LEITURA). Precisa de DATABASE_URL e MARGEM_DADOS (o MP3 vai por hash para
 * MARGEM_DADOS/audio). O alinhamento usa o venv do J71 (MARGEM_ALINHADOR_PYTHON, padrão
 * ~/.local/share/margem/j71-alinhar/venv/bin/python); sem ele, a narração sai só com frases.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { ulid } from 'ulid';
import type { Id, NarracaoDaLeituraV1 } from '@margem/contratos';
import { alinharPalavras } from '@margem/core';
import { prepararArquivoAudio } from '../audio/publicacao.js';
import { raizDoRepositorio } from '../dados.js';
import { pool } from '../db/conexao.js';
import { migrar } from '../db/migrar.js';
import { comTransacao } from '../db/transacao.js';
import { lerJsonLimitado, ORCAMENTOS } from '../entrada-json.js';
import {
  AULAS_POR_JOB, RECEITA_DA_LEITURA, TRANSICAO_PADRAO, aulasDaLeitura, conferirAula, lerManifestoDaAula, montarMp3, palavrasDosTrechos, pastaDaAula,
  roteiroDeFalaDaAula, segmentosParaAlinhar, type CenaParaMontar, type PalavraAlinhada,
} from '../leitura-comentada/narracao.js';
import * as repo from '../leitura-comentada/repo.js';
import { exigirRecurso } from '../recursos.js';

const executar = promisify(execFile);

interface Colab {
  argumentosEnvio: (roteiro: string, receita: string) => string[];
  comando: (args: string[]) => Promise<Record<string, unknown>>;
  exigirJobDoMargem: (job: unknown, id: string) => void;
}
async function colab(): Promise<Colab> {
  return await import(pathToFileURL(join(raizDoRepositorio(), 'colab/executar.mjs')).href) as Colab;
}

async function enviar(execucao: Id, secao: Id, receita: string): Promise<void> {
  const leitura = await comTransacao(pool, (cliente) => repo.leituraDoCapitulo(cliente, execucao, secao));
  if (!leitura) throw new Error(`O capítulo ${secao} ainda não tem leitura comentada.`);
  const aulas = aulasDaLeitura(leitura);
  const { argumentosEnvio, comando } = await colab();
  const jobs: unknown[] = [];
  for (let de = 0; de < aulas.length; de += AULAS_POR_JOB) {
    const lote = aulas.slice(de, de + AULAS_POR_JOB);
    const arquivos = lote.map((aula) => ({ nome: `${aula.id}.md`, texto: roteiroDeFalaDaAula(aula) }));
    const hash = createHash('sha256').update(JSON.stringify(arquivos)).digest('hex');
    const pasta = join(homedir(), 'dados/margem/colab/entradas', `comentada-${hash.slice(0, 32)}`, 'roteiros');
    await mkdir(pasta, { recursive: true });
    for (const arquivo of arquivos) await writeFile(join(pasta, arquivo.nome), arquivo.texto, { flag: 'w' });
    // A entrada da fábrica é a própria pasta `roteiros/` (armadilha conhecida: nunca a mãe).
    const job = await comando(argumentosEnvio(pasta, receita));
    const palavras = lote.reduce((soma, aula) => soma + aula.cenas.reduce((s, c) => s + c.falado.split(/\s+/u).length, 0), 0);
    jobs.push({ job_id: job.job_id, estado: job.state, pasta, aulas: lote.map((a) => a.id), cenas: lote.reduce((s, a) => s + a.cenas.length, 0), palavras });
  }
  console.log(JSON.stringify({ leitura: leitura.id, aulas: aulas.length, jobs }, null, 1));
}

interface AulaImportada { base: string; hashes: Map<string, string>; job: string; receita: string }

async function sondar(caminho: string): Promise<{ duracao: number; taxa: number }> {
  const { stdout } = await executar('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,sample_rate', '-of', 'json', caminho], { timeout: 60_000 });
  const sonda = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_name?: string; sample_rate?: string }[] };
  const faixa = sonda.streams?.length === 1 ? sonda.streams[0] : undefined;
  const duracao = Number(sonda.format?.duration);
  const taxa = Number(faixa?.sample_rate);
  if (!faixa || faixa.codec_name !== 'mp3' || !Number.isFinite(duracao) || !Number.isFinite(taxa) || taxa <= 0) throw new Error(`${caminho} não é um MP3 de uma faixa.`);
  return { duracao, taxa };
}

async function alinhar(mp3: string, segmentos: { start: number; end: number; text: string }[]): Promise<PalavraAlinhada[] | null> {
  const python = process.env.MARGEM_ALINHADOR_PYTHON ?? join(homedir(), '.local/share/margem/j71-alinhar/venv/bin/python');
  try { await access(python); } catch { console.error('Alinhador local ausente; a narração sai só com frases.'); return null; }
  const pasta = await mkdtemp(join(tmpdir(), 'margem-alinhar-'));
  try {
    await writeFile(join(pasta, 'segments.json'), JSON.stringify({ segments: segmentos }));
    const inicio = Date.now();
    const { stdout } = await executar(python, [join(raizDoRepositorio(), 'tools/midia/alinhar_whisperx.py'), '--segmentos', join(pasta, 'segments.json'), '--audio', mp3, '--saida', join(pasta, 'words.jsonl')],
      { timeout: 3_600_000, maxBuffer: 16 * 1024 * 1024 });
    console.error(`alinhamento: ${stdout.trim().split('\n').at(-1) ?? ''} (${String(Math.round((Date.now() - inicio) / 1000))} s)`);
    return (await readFile(join(pasta, 'words.jsonl'), 'utf8')).split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as PalavraAlinhada);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

async function importar(jobs: readonly string[], opcoes: { sinal: boolean; contraste: boolean; palavras: boolean; copia: string | null; publicar: boolean }): Promise<void> {
  const { comando, exigirJobDoMargem } = await colab();
  const aulas = new Map<string, AulaImportada>();
  for (const jobId of jobs) {
    const job = await comando(['inspect', jobId, '--json']);
    exigirJobDoMargem(job, jobId);
    if (job.state !== 'COMPLETED' || typeof job.manifest_path !== 'string') throw new Error(`Job ${jobId} ainda não concluído.`);
    const spec = job.spec as { recipe?: unknown } | undefined;
    const base = dirname(job.manifest_path);
    const execucao = await lerJsonLimitado(job.manifest_path, ORCAMENTOS.canonico) as { job_id?: unknown; outputs?: unknown };
    if (execucao.job_id !== jobId || !Array.isArray(execucao.outputs)) throw new Error('Manifesto da execução incompatível.');
    const hashes = new Map((execucao.outputs as { path: string; sha256: string }[]).map((saida) => [saida.path, saida.sha256]));
    for (const d of await readdir(join(base, 'audio'), { withFileTypes: true })) {
      if (d.isDirectory() && d.name.startsWith('comentada-')) aulas.set(d.name, { base, hashes, job: jobId, receita: typeof spec?.recipe === 'string' ? spec.recipe : RECEITA_DA_LEITURA });
    }
  }
  const leituras = new Set([...aulas.keys()].map((nome) => nome.replace(/^comentada-/u, '').replace(/-a\d+$/u, '').toUpperCase()));
  if (leituras.size !== 1) throw new Error(`Os jobs têm aulas de ${String(leituras.size)} leituras; importe uma leitura por vez.`);
  const leituraId = [...leituras][0]!;
  await migrar(pool);
  const leitura = await comTransacao(pool, (cliente) => repo.obterLeitura(cliente, leituraId));
  if (!leitura) throw new Error(`A leitura ${leituraId} não existe neste banco.`);
  const esperadas = aulasDaLeitura(leitura);
  const receitas = new Set<string>();
  let voz: string | null = null;
  const cenas: CenaParaMontar[] = [];
  const blocoDoTrecho = new Map(leitura.trechos.map((t) => [t.id, t.bloco_id]));
  for (const aula of esperadas) {
    const importada = aulas.get(aula.id);
    if (!importada) throw new Error(`Falta a aula ${aula.id} nos jobs informados.`);
    const pasta = pastaDaAula(importada.base, aula.id);
    const mp3 = join(pasta, 'aula.mp3');
    const esperado = importada.hashes.get(`audio/${aula.id}/aula.mp3`);
    const sha = createHash('sha256').update(await readFile(mp3)).digest('hex');
    if (esperado !== sha) throw new Error(`O MP3 de ${aula.id} não corresponde ao manifesto do job.`);
    const manifesto = lerManifestoDaAula(await lerJsonLimitado(join(pasta, 'manifest.json'), ORCAMENTOS.canonico));
    if (voz !== null && manifesto.voz_sha256 !== voz) throw new Error('As aulas foram geradas com vozes diferentes.');
    voz = manifesto.voz_sha256;
    receitas.add(importada.receita);
    const { duracao, taxa } = await sondar(mp3);
    const conferidas = conferirAula(aula, manifesto, duracao, taxa);
    aula.cenas.forEach((cena, i) => {
      const tempo = conferidas[i]!;
      const trecho = cena.fala_id.startsWith('t');
      cenas.push({ fala_id: cena.fala_id, tipo: trecho ? 'trecho' : 'pausa', bloco_id: trecho ? blocoDoTrecho.get(cena.fala_id) ?? null : null, mp3, inicio_s: tempo.inicio_s, fim_s: tempo.fim_s });
    });
  }
  if (receitas.size !== 1) throw new Error('As aulas vieram de receitas diferentes.');
  const transicao = { ...TRANSICAO_PADRAO, sinal: opcoes.sinal, contraste: opcoes.contraste };
  const pasta = await mkdtemp(join(tmpdir(), 'margem-comentada-mp3-'));
  try {
    const destino = join(pasta, 'capitulo.mp3');
    const inicio = Date.now();
    const { falas } = await montarMp3(cenas, destino, transicao);
    const { duracao } = await sondar(destino);
    console.error(`montagem: ${String(cenas.length)} cenas, ${duracao.toFixed(1)} s, ${String(Math.round((Date.now() - inicio) / 1000))} s de trabalho`);
    if (!opcoes.publicar) {
      if (opcoes.copia) await copyFile(destino, opcoes.copia);
      console.log(JSON.stringify({ leitura: leitura.id, montado: opcoes.copia, duracao_s: duracao, falas, publicado: false }));
      return;
    }
    const alinhadas = opcoes.palavras ? await alinhar(destino, segmentosParaAlinhar(leitura, falas)) : null;
    const palavras = alinhadas ? palavrasDosTrechos(leitura, falas, alinhadas, (blocos, transcritas) => alinharPalavras(blocos, transcritas)) : [];
    const tokens = leitura.trechos.reduce((soma, t) => soma + (t.texto.match(/\S+/gu)?.length ?? 0), 0);
    if (alinhadas) console.error(`palavras: ${String(palavras.length)} de ${String(tokens)} com tempo (${(100 * palavras.length / Math.max(1, tokens)).toFixed(1)} %)`);
    if (opcoes.copia) await copyFile(destino, opcoes.copia);
    const sha = await prepararArquivoAudio(destino);
    const narracao: NarracaoDaLeituraV1 = {
      versao: 1, id: ulid(), leitura_id: leitura.id, sha256_audio: sha, voz_sha256: voz!, jobs_colab: [...new Set(esperadas.map((a) => aulas.get(a.id)!.job))],
      receita: [...receitas][0]!, duracao_s: Math.round(duracao * 1000) / 1000,
      transicao: { silencio_antes_s: transicao.silencio_antes_s, silencio_depois_s: transicao.silencio_depois_s, sinal: transicao.sinal, contraste: transicao.contraste },
      falas, palavras, criado_em: new Date().toISOString(),
    };
    const publicada = await comTransacao(pool, (cliente) => repo.gravarNarracao(cliente, narracao));
    console.log(JSON.stringify({ leitura: leitura.id, capitulo: leitura.capitulo.titulo, narracao: publicada.id, duracao_s: publicada.duracao_s, falas: publicada.falas.length, palavras: publicada.palavras.length, sha256: sha }));
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

const [acao, ...resto] = process.argv.slice(2);
try {
  // Geração pela fábrica auto-colab (OmniVoice): recurso pessoal, desligado numa instalação nova (J102).
  exigirRecurso('audio-colab');
  if (acao === 'enviar' && resto.length === 2) {
    await enviar(resto[0]!, resto[1]!, process.env.MARGEM_RECEITA_LEITURA ?? RECEITA_DA_LEITURA);
  } else if (acao === 'importar' && resto.length >= 1) {
    const jobs = resto.filter((a, i) => !a.startsWith('--') && resto[i - 1] !== '--copia');
    const copia = resto.includes('--copia') ? resto[resto.indexOf('--copia') + 1] ?? null : null;
    await importar(jobs, { sinal: !resto.includes('--sem-sinal'), contraste: resto.includes('--contraste'), palavras: !resto.includes('--sem-palavras'), copia, publicar: !resto.includes('--nao-publicar') });
  } else {
    throw new Error('Use: enviar <execução> <seção> | importar <job> [<job>…] [--sem-sinal] [--contraste] [--sem-palavras] [--copia <arquivo.mp3>] [--nao-publicar]');
  }
} catch (erro) {
  console.error(erro instanceof Error ? erro.message : 'Falha na narração da leitura comentada.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
