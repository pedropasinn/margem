/**
 * A miniatura de um vídeo do YouTube na biblioteca (pedido do J133): a imagem do próprio vídeo,
 * guardada uma vez na pasta do documento (`miniatura.jpg`) e servida de lá, sem link direto para o
 * YouTube a cada abertura. O worker a guarda ao importar; vídeos importados antes ganham a sua na
 * primeira vez que a biblioteca a pede. Sem rede, nada quebra: a capa volta ao título.
 */
import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pastaDoDocumento } from '../dados';

/** Teto da imagem baixada; a `hqdefault` do YouTube tem uns 30 KB. */
export const LIMITE_DA_MINIATURA_BYTES = 2 * 1024 * 1024;
const PRAZO_MS = 8000;

export const caminhoDaMiniaturaDoVideo = (documentoId: string): string => join(pastaDoDocumento(documentoId), 'miniatura.jpg');
/** O endereço público da miniatura do vídeo (formato estável do YouTube; o id já foi validado). */
export const enderecoDaMiniaturaDoYoutube = (videoId: string): string => `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;

export type Buscar = (url: string, inicio: { signal: AbortSignal }) => Promise<Response>;

/** Os primeiros bytes de um JPEG. */
const ehJpeg = (bytes: Uint8Array): boolean => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

/**
 * Baixa e guarda a miniatura, se ainda não existe. Devolve o caminho, ou `null` quando não deu
 * (sem rede, resposta que não é JPEG, grande demais). Nunca lança.
 */
export async function guardarMiniaturaDoYoutube(documentoId: string, videoId: string, buscar: Buscar = fetch, sinal?: AbortSignal): Promise<string | null> {
  const destino = caminhoDaMiniaturaDoVideo(documentoId);
  if (existsSync(destino)) return destino;
  try {
    const prazo = AbortSignal.timeout(PRAZO_MS);
    const resposta = await buscar(enderecoDaMiniaturaDoYoutube(videoId), { signal: sinal ? AbortSignal.any([sinal, prazo]) : prazo });
    if (!resposta.ok) return null;
    const bytes = new Uint8Array(await resposta.arrayBuffer());
    if (bytes.length > LIMITE_DA_MINIATURA_BYTES || !ehJpeg(bytes)) return null;
    await mkdir(pastaDoDocumento(documentoId), { recursive: true, mode: 0o700 });
    const temporario = `${destino}.${String(process.pid)}.parcial`;
    await writeFile(temporario, bytes, { mode: 0o600 });
    await rename(temporario, destino);
    return destino;
  } catch { return null; }
}
