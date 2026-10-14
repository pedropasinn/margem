/**
 * GET /api/documentos/:id/miniatura — a imagem do vídeo do documento, para a capa na biblioteca
 * (J133). Vem da pasta do documento; um vídeo do YouTube sem ela a ganha agora (uma vez). Sem
 * imagem, 404: a interface desenha a capa com o título.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Hono } from 'hono';
import type pg from 'pg';
import type { Id } from '@margem/contratos';
import { caminhoDaMiniaturaDoVideo, guardarMiniaturaDoYoutube, type Buscar } from '../midia/miniatura-do-video.js';

export function registrarRotasDaMiniatura(api: Hono, apoio: { banco: pg.Pool; exigirUlid: (valor: string, papel: string) => Id; buscar?: Buscar }): void {
  const { banco, exigirUlid } = apoio;
  api.get('/api/documentos/:id/miniatura', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'documento');
    let caminho: string | null = caminhoDaMiniaturaDoVideo(id);
    if (!existsSync(caminho)) {
      const video = (await banco.query<{ video_id: string }>('SELECT video_id FROM video_youtube WHERE documento_id=$1', [id])).rows[0];
      caminho = video ? await guardarMiniaturaDoYoutube(id, video.video_id, apoio.buscar) : null;
    }
    if (caminho === null) return c.json({ erro: 'sem_miniatura' }, 404);
    c.header('Content-Type', 'image/jpeg');
    c.header('Cache-Control', 'private, max-age=86400');
    return c.body(new Uint8Array(await readFile(caminho)));
  });
}
