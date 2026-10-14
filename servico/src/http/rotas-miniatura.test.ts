/** A miniatura do vídeo na capa da biblioteca (J133): guardada uma vez na pasta do documento. */
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, expect, test, vi } from 'vitest';
import { comBanco } from '../../testes/apoio.js';
import { registrarImportacaoYoutube } from '../midia/importacao-youtube.js';
import { caminhoDaMiniaturaDoVideo, enderecoDaMiniaturaDoYoutube } from '../midia/miniatura-do-video.js';
import { registrarRotasDaMiniatura } from './rotas-miniatura.js';

const dadosOriginais = process.env.MARGEM_DADOS;
const temporarios: string[] = [];
afterEach(async () => {
  for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true });
  if (dadosOriginais === undefined) delete process.env.MARGEM_DADOS; else process.env.MARGEM_DADOS = dadosOriginais;
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

test('a miniatura do vídeo do YouTube é baixada uma vez, guardada e servida de lá; sem vídeo ou sem JPEG, 404', async () => comBanco('j133_miniatura', async (banco) => {
  const dados = await mkdtemp(join(tmpdir(), 'margem-j133-'));
  temporarios.push(dados);
  process.env.MARGEM_DADOS = dados;
  const buscar = vi.fn<(url: string, inicio: { signal: AbortSignal }) => Promise<Response>>(() => Promise.resolve(new Response(JPEG, { status: 200 })));
  const api = new Hono();
  registrarRotasDaMiniatura(api, { banco, exigirUlid: (valor) => valor, buscar });
  const importado = await registrarImportacaoYoutube(banco, { video_id: 'dQw4w9WgXcQ' });
  if (!('job_id' in importado)) throw new Error('importação recusada');
  const primeira = await api.request(`/api/documentos/${importado.documento_id}/miniatura`);
  expect(primeira.status).toBe(200);
  expect(primeira.headers.get('content-type')).toBe('image/jpeg');
  expect(new Uint8Array(await primeira.arrayBuffer())).toEqual(JPEG);
  expect(buscar).toHaveBeenCalledWith(enderecoDaMiniaturaDoYoutube('dQw4w9WgXcQ'), expect.anything());
  expect(existsSync(caminhoDaMiniaturaDoVideo(importado.documento_id))).toBe(true);
  expect((await api.request(`/api/documentos/${importado.documento_id}/miniatura`)).status).toBe(200);
  expect(buscar).toHaveBeenCalledTimes(1);

  // Resposta que não é imagem JPEG não vira miniatura.
  const outro = await registrarImportacaoYoutube(banco, { video_id: 'aaaaaaaaaaa' });
  if (!('job_id' in outro)) throw new Error('importação recusada');
  buscar.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
  expect((await api.request(`/api/documentos/${outro.documento_id}/miniatura`)).status).toBe(404);
  expect(existsSync(caminhoDaMiniaturaDoVideo(outro.documento_id))).toBe(false);
  // Documento sem vídeo: nada a buscar.
  expect((await api.request('/api/documentos/00000000000000000000000000/miniatura')).status).toBe(404);
  expect(buscar).toHaveBeenCalledTimes(2);
}));
