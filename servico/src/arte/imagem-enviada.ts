/**
 * A imagem de uma obra enviada pela pessoa (J118): reconhecimento pelo conteúdo (a assinatura dos
 * primeiros bytes, nunca o nome nem o tipo declarado), a orientação EXIF de um JPEG e a conversão para o
 * `imagem.jpg` que o acervo, a análise e o leitor de quadros usam.
 */
import { copyFile, open } from 'node:fs/promises';
import { converterParaJpeg, dimensoesDaImagem, type Dimensoes } from './v2/imagens.js';

export type FormatoDaImagem = 'jpeg' | 'png' | 'webp';
/** Teto do envio: fotos de celular e reproduções de museu em alta cabem com folga. */
export const LIMITE_DA_IMAGEM_DO_QUADRO = 40 * 1024 * 1024;
/** Menor lado aceito: abaixo disso não há detalhe para percorrer. */
export const LADO_MINIMO = 200;
export const EXTENSAO_DO_FORMATO: Readonly<Record<FormatoDaImagem, string>> = { jpeg: 'jpg', png: 'png', webp: 'webp' };
export const TIPO_DO_FORMATO: Readonly<Record<FormatoDaImagem, string>> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ascii = (bytes: Uint8Array, inicio: number, fim: number): string => String.fromCharCode(...bytes.subarray(inicio, fim));
/** Marcas do contêiner ISO (ftyp) de HEIC/HEIF/AVIF, que o motor de imagens desta versão não lê. */
const MARCAS_HEIF = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'avif', 'avis']);

/** O formato pelo conteúdo: `heif` (HEIC/AVIF) é reconhecido para recusar com uma mensagem clara. */
export function formatoPelaAssinatura(bytes: Uint8Array): FormatoDaImagem | 'heif' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && PNG.every((b, i) => bytes[i] === b)) return 'png';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'webp';
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp' && MARCAS_HEIF.has(ascii(bytes, 8, 12))) return 'heif';
  return null;
}

/** Orientação EXIF (1 a 8) de um JPEG; 1 quando não há ou não dá para ler. Só o cabeçalho é lido. */
export function orientacaoExif(bytes: Uint8Array): number {
  const dados = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 2;
  while (p + 4 <= dados.length && dados[p] === 0xff) {
    const marcador = dados[p + 1]!;
    const tamanho = dados.readUInt16BE(p + 2);
    if (marcador === 0xda || tamanho < 2) break; // início da imagem: acabaram os cabeçalhos
    if (marcador === 0xe1 && p + 4 + tamanho - 2 <= dados.length && dados.toString('latin1', p + 4, p + 10) === 'Exif\0\0') {
      const tiff = p + 10;
      const le = dados.toString('latin1', tiff, tiff + 2) === 'II';
      const u16 = (o: number) => (le ? dados.readUInt16LE(o) : dados.readUInt16BE(o));
      const u32 = (o: number) => (le ? dados.readUInt32LE(o) : dados.readUInt32BE(o));
      const ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > dados.length) return 1;
      const entradas = u16(ifd);
      for (let i = 0; i < entradas; i += 1) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > dados.length) return 1;
        if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1; }
      }
      return 1;
    }
    p += 2 + tamanho;
  }
  return 1;
}

/** O filtro do ffmpeg que endireita cada orientação EXIF (2 a 8). */
const ROTACOES: Readonly<Record<number, string>> = {
  2: 'hflip', 3: 'hflip,vflip', 4: 'vflip', 5: 'transpose=0', 6: 'transpose=1', 7: 'transpose=3', 8: 'transpose=2',
};

export interface ImagemNormalizada { largura: number; altura: number; convertida: boolean }
export type NormalizarImagem = (origem: string, destino: string, formato: FormatoDaImagem) => Promise<ImagemNormalizada>;

async function cabecalho(caminho: string, tamanho = 256 * 1024): Promise<Uint8Array> {
  const arquivo = await open(caminho, 'r');
  try {
    const buffer = Buffer.alloc(tamanho);
    const { bytesRead } = await arquivo.read(buffer, 0, tamanho, 0);
    return buffer.subarray(0, bytesRead);
  } finally { await arquivo.close(); }
}

/** Normalização real: JPEG direito é copiado; o resto, convertido pelo ffmpeg. Dimensões pelo ffprobe. */
export function normalizadorComFfmpeg(dimensoes: (caminho: string) => Promise<Dimensoes> = dimensoesDaImagem): NormalizarImagem {
  return async (origem, destino, formato) => {
    const rotacao = formato === 'jpeg' ? ROTACOES[orientacaoExif(await cabecalho(origem))] ?? null : null;
    if (formato === 'jpeg' && rotacao === null) {
      await copyFile(origem, destino);
      return { ...await dimensoes(destino), convertida: false };
    }
    await converterParaJpeg(origem, destino, rotacao, await dimensoes(origem));
    return { ...await dimensoes(destino), convertida: true };
  };
}
