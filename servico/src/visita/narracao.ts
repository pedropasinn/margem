/**
 * Voz da visita guiada (J91). O roteiro vira um roteiro de fala da fábrica auto-colab (uma aula por
 * capítulo, **uma cena por fala**), e a aula gerada volta como `NarracaoDaVisitaV1`: o MP3 por hash em
 * MARGEM_DADOS/audio e o intervalo de cada fala, lido do manifesto da fábrica.
 *
 * A receita é a vigente do Margem (`margem-poesia-omnivoice`: OmniVoice, sem abertura descartável — a
 * "nova geração sem abertura" preferida no J79). Este módulo não muda receita nem worker.
 */
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ulid } from 'ulid';
import type { NarracaoDaVisitaV1, RoteiroGuiadoV1 } from '@margem/contratos';
import { prepararArquivoAudio } from '../audio/publicacao.js';
import { lerJsonLimitado, ORCAMENTOS } from '../entrada-json.js';

const executar = promisify(execFile);
export const RECEITA_DA_VISITA = 'margem-poesia-omnivoice';

/** O id da aula na fábrica: o nome do arquivo do roteiro de fala. */
export const aulaDoRoteiro = (roteiro: Pick<RoteiroGuiadoV1, 'id'>): string => `visita-${roteiro.id.toLowerCase()}`;
const normalizar = (texto: string): string => texto.replace(/\s+/gu, ' ').trim();
/** O cabeçalho do roteiro de fala é `chave: valor` numa linha; nada de quebras nem `---`. */
const linhaSegura = (texto: string): string => normalizar(texto).replace(/-{3,}/gu, '—').replace(/"/gu, '”');

/** O roteiro de fala (Markdown da fábrica): cena `c001` = fala `f001`, na mesma ordem. */
export function roteiroDeFala(roteiro: RoteiroGuiadoV1): string {
  const linhas = ['---', `titulo: "${linhaSegura(`Visita · ${roteiro.capitulo.titulo}`)}"`, `id: ${aulaDoRoteiro(roteiro)}`, '---', ''];
  roteiro.falas.forEach((fala, indice) => {
    const texto = normalizar(fala.texto);
    if (texto === '' || /<!--|-->/u.test(texto)) throw new Error(`Fala ${fala.id} vazia ou com marcador de cena.`);
    linhas.push(`<!-- cena: c${String(indice + 1).padStart(3, '0')} -->`, texto, '');
  });
  return linhas.join('\n');
}

export interface CenaDoManifesto { cena: string; inicio_s: number; fim_s: number; narracao: string }
export interface ManifestoDaAula { id: string; total_s: number; voz_sha256: string; cenas: CenaDoManifesto[] }

function objeto(valor: unknown, onde: string): Record<string, unknown> {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error(`${onde}: objeto esperado.`);
  return valor as Record<string, unknown>;
}

export function lerManifestoDaAula(bruto: unknown): ManifestoDaAula {
  const m = objeto(bruto, 'manifesto da aula');
  if (typeof m.id !== 'string' || typeof m.total_s !== 'number' || typeof m.voz_sha256 !== 'string' || !Array.isArray(m.cenas)) throw new Error('Manifesto da aula incompleto.');
  const cenas = m.cenas.map((bruta) => {
    const c = objeto(bruta, 'cena');
    if (typeof c.cena !== 'string' || typeof c.inicio_s !== 'number' || typeof c.fim_s !== 'number' || typeof c.narracao !== 'string') throw new Error('Cena incompleta no manifesto.');
    return { cena: c.cena, inicio_s: c.inicio_s, fim_s: c.fim_s, narracao: c.narracao };
  });
  return { id: m.id, total_s: m.total_s, voz_sha256: m.voz_sha256, cenas };
}

/**
 * Confere o manifesto contra o roteiro (mesmas falas, mesmo texto, mesma ordem) e devolve os tempos.
 * Puro: a duração medida do MP3 entra como argumento.
 */
export function temposDasFalas(roteiro: RoteiroGuiadoV1, manifesto: ManifestoDaAula, duracaoMedida: number, taxa: number): NarracaoDaVisitaV1['falas'] {
  if (manifesto.id !== aulaDoRoteiro(roteiro)) throw new Error(`A aula ${manifesto.id} não é deste roteiro.`);
  if (manifesto.cenas.length !== roteiro.falas.length) throw new Error(`A aula tem ${String(manifesto.cenas.length)} cenas; o roteiro, ${String(roteiro.falas.length)} falas.`);
  // MP3 tem quadros de 1152 amostras: folga de dois quadros e do arredondamento do manifesto (como J64).
  const tolerancia = 2 * 1152 / taxa + 0.01;
  if (Math.abs(duracaoMedida - manifesto.total_s) > tolerancia) throw new Error('A duração do MP3 não corresponde ao manifesto.');
  return roteiro.falas.map((fala, indice) => {
    const cena = manifesto.cenas[indice]!;
    if (cena.cena !== `c${String(indice + 1).padStart(3, '0')}`) throw new Error(`Cena fora de ordem: ${cena.cena}.`);
    if (normalizar(cena.narracao) !== normalizar(fala.texto)) throw new Error(`A cena ${cena.cena} não diz a fala ${fala.id}.`);
    if (!(cena.fim_s > cena.inicio_s) || cena.fim_s > duracaoMedida + tolerancia) throw new Error(`Tempos inválidos na cena ${cena.cena}.`);
    return { fala_id: fala.id, inicio_s: cena.inicio_s, fim_s: Math.min(cena.fim_s, duracaoMedida) };
  });
}

/** Mede o MP3 e prepara o arquivo por hash (fora de transação, como o áudio do J64). */
export async function importarAulaDaVisita(
  roteiro: RoteiroGuiadoV1, pastaDaAula: string, job: { id: string; receita: string; hashes: ReadonlyMap<string, string> },
): Promise<NarracaoDaVisitaV1> {
  const manifesto = lerManifestoDaAula(await lerJsonLimitado(join(pastaDaAula, 'manifest.json'), ORCAMENTOS.canonico));
  const caminho = join(pastaDaAula, 'aula.mp3');
  const { stdout } = await executar('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,sample_rate', '-of', 'json', caminho], { timeout: 60_000 });
  const sonda = objeto(JSON.parse(stdout), 'ffprobe');
  const faixa = Array.isArray(sonda.streams) && sonda.streams.length === 1 ? objeto(sonda.streams[0], 'faixa') : null;
  const duracao = Number(objeto(sonda.format, 'formato').duration);
  const taxa = Number(faixa?.sample_rate);
  if (!faixa || faixa.codec_name !== 'mp3' || !Number.isFinite(duracao) || !Number.isFinite(taxa) || taxa <= 0) throw new Error('A aula não é um MP3 de uma faixa.');
  const falas = temposDasFalas(roteiro, manifesto, duracao, taxa);
  const sha = await prepararArquivoAudio(caminho);
  const esperado = job.hashes.get(`audio/${manifesto.id}/aula.mp3`);
  if (esperado !== sha) throw new Error('O MP3 não corresponde ao manifesto do job.');
  return {
    versao: 1, id: ulid(), roteiro_id: roteiro.id, sha256_audio: sha, voz_sha256: manifesto.voz_sha256, job_colab: job.id,
    receita: job.receita, duracao_s: duracao, falas, criado_em: new Date().toISOString(),
  };
}
