/**
 * Configuração do áudio gerado no app (J106): a chave da ElevenLabs da pessoa e a voz/modelo escolhidos.
 *
 * Onde a chave mora — um arquivo, não o banco:
 *   `MARGEM_SEGREDOS` (padrão `<MARGEM_DADOS>/segredos`)/elevenlabs.chave, pasta 0700 e arquivo 0600.
 * Por quê: fica fora do Git (a pasta de dados nunca está no repositório), fora do `pg_dump`/backups do
 * banco, fora das consultas SQL e dos eventos de job, e só o dono do processo a lê. A API nunca a
 * devolve: só "configurada" e os 4 últimos caracteres. O worker lê o arquivo na hora de narrar e
 * não a guarda em lugar nenhum.
 *
 * A voz e o modelo não são segredos: ficam em `<MARGEM_DADOS>/configuracao/audio.json`.
 */
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { raizDeDados } from '../dados';
import { MODELO_PADRAO, MODELOS_ELEVENLABS } from './voz/elevenlabs';

export function pastaDosSegredos(): string {
  const bruto = process.env.MARGEM_SEGREDOS;
  return bruto !== undefined && bruto.trim() !== '' ? resolve(bruto) : join(raizDeDados(), 'segredos');
}
const arquivoDaChave = (): string => join(pastaDosSegredos(), 'elevenlabs.chave');
const arquivoDasPreferencias = (): string => join(raizDeDados(), 'configuracao', 'audio.json');

/** Chave plausível: só caracteres visíveis, sem espaço, de 16 a 256. Não diz nada sobre ser válida. */
export function chaveBemFormada(chave: string): boolean {
  return /^[\x21-\x7e]{16,256}$/u.test(chave);
}

async function gravarAtomico(caminho: string, pasta: string, conteudo: string, modoPasta: number): Promise<void> {
  await mkdir(pasta, { recursive: true, mode: modoPasta });
  await chmod(pasta, modoPasta);
  const temporario = join(pasta, `.tmp-${randomUUID()}`);
  try {
    await writeFile(temporario, conteudo, { mode: 0o600, flag: 'wx' });
    await chmod(temporario, 0o600);
    await rename(temporario, caminho);
  } finally { await rm(temporario, { force: true }); }
}

export async function gravarChave(chave: string): Promise<void> {
  const limpa = chave.trim();
  if (!chaveBemFormada(limpa)) throw new Error('Chave malformada.');
  await gravarAtomico(arquivoDaChave(), pastaDosSegredos(), limpa, 0o700);
}

export async function apagarChave(): Promise<void> {
  await rm(arquivoDaChave(), { force: true });
}

/** A chave, para o worker e o teste da chave. Arquivo com permissão aberta demais é fechado antes de ler. */
export async function lerChave(): Promise<string | null> {
  const caminho = arquivoDaChave();
  try {
    const info = await stat(caminho);
    if ((info.mode & 0o077) !== 0) await chmod(caminho, 0o600);
    const chave = (await readFile(caminho, 'utf8')).trim();
    return chaveBemFormada(chave) ? chave : null;
  } catch (erro) {
    if (erro instanceof Error && 'code' in erro && erro.code === 'ENOENT') return null;
    throw erro;
  }
}

export interface SituacaoDaChave { configurada: boolean; final: string | null }
export async function situacaoDaChave(): Promise<SituacaoDaChave> {
  const chave = await lerChave();
  return chave === null ? { configurada: false, final: null } : { configurada: true, final: chave.slice(-4) };
}

export interface PreferenciasDeAudio { provedor: 'elevenlabs'; voz_id: string | null; voz_nome: string | null; modelo_id: string }
export const PREFERENCIAS_PADRAO: PreferenciasDeAudio = { provedor: 'elevenlabs', voz_id: null, voz_nome: null, modelo_id: MODELO_PADRAO };

export function preferenciasValidas(valor: unknown): valor is Omit<PreferenciasDeAudio, 'provedor'> {
  const v = valor as Record<string, unknown> | null;
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  if (Object.keys(v).some((k) => !['voz_id', 'voz_nome', 'modelo_id'].includes(k))) return false;
  const vozOk = (v.voz_id === null && v.voz_nome === null)
    || (typeof v.voz_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/u.test(v.voz_id) && typeof v.voz_nome === 'string' && v.voz_nome.trim() !== '' && v.voz_nome.length <= 200);
  return vozOk && typeof v.modelo_id === 'string' && MODELOS_ELEVENLABS.some((m) => m.id === v.modelo_id);
}

export async function lerPreferencias(): Promise<PreferenciasDeAudio> {
  try {
    const bruto: unknown = JSON.parse(await readFile(arquivoDasPreferencias(), 'utf8'));
    if (preferenciasValidas(bruto)) return { provedor: 'elevenlabs', voz_id: bruto.voz_id, voz_nome: bruto.voz_nome, modelo_id: bruto.modelo_id };
  } catch { /* sem arquivo ou ilegível: padrão */ }
  return { ...PREFERENCIAS_PADRAO };
}

export async function gravarPreferencias(preferencias: Omit<PreferenciasDeAudio, 'provedor'>): Promise<PreferenciasDeAudio> {
  if (!preferenciasValidas(preferencias)) throw new Error('Preferências de áudio inválidas.');
  const { voz_id, voz_nome, modelo_id } = preferencias;
  const gravadas = { voz_id, voz_nome: voz_nome?.trim() ?? null, modelo_id };
  await gravarAtomico(arquivoDasPreferencias(), join(raizDeDados(), 'configuracao'), `${JSON.stringify(gravadas, null, 2)}\n`, 0o700);
  return { provedor: 'elevenlabs', ...gravadas };
}
