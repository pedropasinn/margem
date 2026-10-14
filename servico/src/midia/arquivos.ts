/**
 * Arquivos de mídia (J71): recebidos por fluxo, guardados por hash em `MARGEM_DADOS/midia/<sha>`,
 * sondados pelo ffprobe. O arquivo é gravado e sincronizado antes de qualquer referência no banco;
 * uma falha depois deixa no máximo um arquivo órfão, nunca uma referência a arquivo parcial.
 */
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, mkdir, open, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { MidiaV1 } from '@margem/contratos';
import { raizDeDados } from '../dados';
import { sincronizarPasta } from '../plataforma/disco.js';
import { ffprobe } from '../plataforma/executaveis.js';

const executar = promisify(execFile);

/** 4 GiB: um vídeo de algumas horas em 720p. `MARGEM_LIMITE_MIDIA` sobrepõe (em bytes). */
export function limiteDeMidia(): number {
  const bruto = Number(process.env.MARGEM_LIMITE_MIDIA);
  return Number.isSafeInteger(bruto) && bruto > 0 ? bruto : 4 * 1024 ** 3;
}

export function pastaDasMidias(): string {
  return join(raizDeDados(), 'midia');
}

export function caminhoDaMidia(sha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Hash de mídia inválido.');
  return join(pastaDasMidias(), sha256);
}

export class MidiaGrandeDemais extends Error {
  constructor() { super('A mídia excede o limite configurado.'); }
}

async function hashDoArquivo(caminho: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const parte of createReadStream(caminho)) hash.update(parte as Buffer);
  return hash.digest('hex');
}

/** Grava o fluxo num temporário, calcula o hash enquanto grava e publica por link atômico. */
export async function receberMidia(fluxo: ReadableStream<Uint8Array>, limite = limiteDeMidia()): Promise<{ sha256: string; bytes: number }> {
  const pasta = pastaDasMidias();
  await mkdir(pasta, { recursive: true, mode: 0o700 });
  const temporario = join(pasta, `.tentativa-${randomUUID()}`);
  const arquivo = await open(temporario, 'wx', 0o600);
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    const leitor = fluxo.getReader();
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limite) { await leitor.cancel(); throw new MidiaGrandeDemais(); }
      hash.update(value);
      await arquivo.write(value);
    }
    await arquivo.sync();
    await arquivo.close();
    if (bytes === 0) throw new Error('Mídia vazia.');
    const sha256 = hash.digest('hex');
    const destino = caminhoDaMidia(sha256);
    try { await link(temporario, destino); }
    catch (erro) { if (!(erro instanceof Error && 'code' in erro && erro.code === 'EEXIST')) throw erro; }
    // O destino pode ter vindo de uma tentativa anterior: só vale se tiver os mesmos bytes.
    if ((await stat(destino)).size !== bytes || await hashDoArquivo(destino) !== sha256) throw new Error('Arquivo de mídia divergente do hash.');
    await sincronizarPasta(pasta);
    return { sha256, bytes };
  } finally {
    await arquivo.close().catch(() => undefined);
    await rm(temporario, { force: true });
  }
}

export interface SondaDaMidia {
  tipo: MidiaV1['tipo'];
  mime: MidiaV1['mime'];
  duracao_s: number;
  bytes: number;
  largura?: number;
  altura?: number;
}

interface SaidaDoFfprobe {
  format?: { duration?: string; format_name?: string; size?: string };
  streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; disposition?: { attached_pic?: number } }[];
}

/** Tipo e MIME a partir do contêiner e das faixas; a extensão e o cabeçalho do cliente não contam. */
export function interpretarSonda(saida: SaidaDoFfprobe, bytes: number): SondaDaMidia {
  const duracao = Number(saida.format?.duration);
  const formato = saida.format?.format_name ?? '';
  const faixas = saida.streams ?? [];
  const video = faixas.find((f) => f.codec_type === 'video' && f.disposition?.attached_pic !== 1);
  const audio = faixas.some((f) => f.codec_type === 'audio');
  if (!Number.isFinite(duracao) || duracao <= 0 || (!video && !audio)) throw new Error('O arquivo não é uma mídia reconhecível.');
  let mime: MidiaV1['mime'];
  if (/mp4|mov|m4a/.test(formato)) mime = video ? 'video/mp4' : 'audio/mp4';
  else if (/webm|matroska/.test(formato)) mime = video ? 'video/webm' : 'audio/webm';
  else if (!video && /^mp3$|,mp3|mp3,/.test(formato)) mime = 'audio/mpeg';
  else if (!video && /ogg/.test(formato)) mime = 'audio/ogg';
  else throw new Error(`Contêiner de mídia não aceito: ${formato || 'desconhecido'}.`);
  const largura = video?.width, altura = video?.height;
  return {
    tipo: video ? 'video' : 'audio', mime, duracao_s: Math.round(duracao * 1000) / 1000, bytes,
    ...(video && largura && altura ? { largura, altura } : {}),
  };
}

export async function sondarMidia(caminho: string): Promise<SondaDaMidia> {
  const { size } = await stat(caminho);
  const { stdout } = await executar(ffprobe(), ['-v', 'error', '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,width,height:stream_disposition=attached_pic', '-of', 'json', caminho], { timeout: 60_000, maxBuffer: 1024 * 1024, windowsHide: true });
  return interpretarSonda(JSON.parse(stdout) as SaidaDoFfprobe, size);
}
