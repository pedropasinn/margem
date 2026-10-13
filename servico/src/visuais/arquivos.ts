/**
 * Arquivo da imagem de um visual (J70): um PNG por hash em `MARGEM_DADOS/visuais/<sha256>.png`.
 * Mesmo desenho do áudio (J64): a cópia acontece fora do SQL, por arquivo temporário + `link`,
 * e a publicação só grava a referência a um arquivo inteiro. Falha depois disso deixa, no pior
 * caso, um arquivo órfão, nunca uma referência a arquivo parcial.
 */
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, link, mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { raizDeDados } from '../dados.js';

/** Teto de um PNG gerado (os do Codex ficam em 1–4 MB). */
export const TETO_DA_IMAGEM = 25 * 1024 * 1024;
const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function pastaDasImagens(): string {
  return join(raizDeDados(), 'visuais');
}

export function caminhoDaImagem(hash: string): string {
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error('Hash de imagem inválido.');
  return join(pastaDasImagens(), `${hash}.png`);
}

export interface ImagemGuardada { sha256: string; bytes: number; largura: number; altura: number }

/** Largura e altura do cabeçalho IHDR; `null` se não for PNG. */
export function dimensoesDoPng(bytes: Buffer): { largura: number; altura: number } | null {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(ASSINATURA_PNG) || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  const largura = bytes.readUInt32BE(16);
  const altura = bytes.readUInt32BE(20);
  return largura > 0 && altura > 0 ? { largura, altura } : null;
}

async function sincronizar(caminho: string): Promise<void> {
  const arquivo = await open(caminho, 'r');
  try { await arquivo.sync(); } finally { await arquivo.close(); }
}

/** Confere o PNG gerado e o guarda pelo hash. Devolve o que a publicação grava. */
export async function guardarImagem(origem: string): Promise<ImagemGuardada> {
  const informacao = await stat(origem);
  if (!informacao.isFile() || informacao.size === 0) throw new Error('Imagem gerada vazia.');
  if (informacao.size > TETO_DA_IMAGEM) throw new Error('Imagem gerada grande demais.');
  const bytes = await readFile(origem);
  const dimensoes = dimensoesDoPng(bytes);
  if (dimensoes === null) throw new Error('O arquivo gerado não é PNG.');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const destino = caminhoDaImagem(sha256);
  await mkdir(pastaDasImagens(), { recursive: true });
  const temporario = join(pastaDasImagens(), `.tentativa-${randomUUID()}`);
  try {
    await copyFile(origem, temporario, constants.COPYFILE_EXCL);
    if (createHash('sha256').update(await readFile(temporario)).digest('hex') !== sha256) throw new Error('Imagem alterada durante a cópia.');
    await sincronizar(temporario);
    try { await link(temporario, destino); } catch (erro) {
      if (!(erro instanceof Error && 'code' in erro && erro.code === 'EEXIST')) throw erro;
    }
    if (createHash('sha256').update(await readFile(destino)).digest('hex') !== sha256) throw new Error('Arquivo de imagem adulterado.');
    await sincronizar(pastaDasImagens());
  } finally {
    await rm(temporario, { force: true });
  }
  return { sha256, bytes: bytes.length, ...dimensoes };
}
