/** Importação local de um job concluído; caminhos não são recebidos pela API. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { ulid } from 'ulid';
import type { AncoraV1, AudioV1 } from '@margem/contratos';
import { validarAncora } from '@margem/contratos';
import { lerJsonLimitado, ORCAMENTOS } from '../entrada-json';
import { raizDoRepositorio } from '../dados';
import { prepararArquivoAudio } from './publicacao';
const executar = promisify(execFile);
function objeto(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Objeto inválido no manifesto Colab.');
  return v as Record<string, unknown>;
}
const normalizar = (s: string): string => s.replace(/\s+/gu, ' ').trim();
export async function importarAudioColab(jobId: string, secaoId: string, titulo: string, mapa: Record<string, AncoraV1>): Promise<AudioV1> {
  const { stdout } = await executar(process.execPath, [join(raizDoRepositorio(), 'colab/executar.mjs'), 'consultar', jobId], { maxBuffer: ORCAMENTOS.canonico.bytes, timeout: 60_000 });
  const job = objeto(JSON.parse(stdout));
  if (job.state !== 'COMPLETED' || typeof job.manifest_path !== 'string') throw new Error('Job Colab ainda não concluído.');
  const base = dirname(job.manifest_path);
  const execucao = objeto(await lerJsonLimitado(job.manifest_path, ORCAMENTOS.canonico));
  if (execucao.job_id !== jobId || execucao.project !== 'margem' || !Array.isArray(execucao.outputs)) throw new Error('Manifesto da execução incompatível.');
  const manifesto = objeto(await lerJsonLimitado(join(base, 'audio/roteiro/manifest.json'), ORCAMENTOS.canonico));
  if (!Array.isArray(manifesto.cenas) || typeof manifesto.total_s !== 'number' || typeof manifesto.voz_sha256 !== 'string') throw new Error('Manifesto TTS incompleto.');
  const vistos = new Set<string>();
  const trechos = manifesto.cenas.map((bruto): AudioV1['trechos'][number] => {
    const cena = objeto(bruto);
    if (typeof cena.cena !== 'string' || vistos.has(cena.cena)) throw new Error('Cena ausente ou duplicada.');
    vistos.add(cena.cena);
    const ancora = mapa[cena.cena];
    if (!validarAncora(ancora) || typeof cena.narracao !== 'string' || normalizar(cena.narracao) !== normalizar(ancora.citacao)
      || typeof cena.inicio_s !== 'number' || typeof cena.fim_s !== 'number') throw new Error('Narração não corresponde à âncora.');
    return { inicio_s: cena.inicio_s, fim_s: cena.fim_s, ancora };
  });
  if (!trechos.length || vistos.size !== Object.keys(mapa).length) throw new Error('Cenas não cobrem o roteiro pedido.');
  const caminho = join(base, 'audio/roteiro/aula.mp3');
  const { stdout: sondagem } = await executar('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,sample_rate', '-of', 'json', caminho], { timeout: 60_000 });
  const sonda = objeto(JSON.parse(sondagem));
  const duracao = Number(objeto(sonda.format).duration);
  if (!Array.isArray(sonda.streams) || sonda.streams.length !== 1) throw new Error('Áudio precisa ter uma faixa.');
  const faixa = objeto(sonda.streams[0]);
  const taxa = Number(faixa.sample_rate);
  // MP3 tem quadros de 1152 amostras: folga para dois quadros e arredondamento do manifesto.
  const tolerancia = 2 * 1152 / taxa + 0.01;
  if (faixa.codec_name !== 'mp3' || !Number.isFinite(taxa) || taxa <= 0 || !Number.isFinite(duracao)
    || Math.abs(duracao - manifesto.total_s) > tolerancia || trechos.some(t => t.fim_s > duracao)) {
    throw new Error('Tempos do manifesto não correspondem à duração do MP3.');
  }
  const sha = await prepararArquivoAudio(caminho);
  const arquivo = execucao.outputs.map(objeto).find(o => o.path === 'audio/roteiro/aula.mp3');
  if (arquivo?.sha256 !== sha) throw new Error('MP3 não corresponde ao manifesto do job.');
  return { versao: 1, id: ulid(), versao_id: trechos[0]!.ancora.versao_id, secao_id: secaoId, titulo,
    sha256_audio: sha, voz_sha256: manifesto.voz_sha256, job_colab: jobId,
    duracao_s: duracao, trechos };
}
