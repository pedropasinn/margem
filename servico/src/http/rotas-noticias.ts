import { readFile } from 'node:fs/promises';
import { caminhoDaImagem } from '../visuais/arquivos.js';
import { pedirCapa } from '../noticias/capas.js';
import type { CapaDeNoticiasV1 } from '@margem/contratos';
import type { Hono } from 'hono';
import type pg from 'pg';
import { ehUlid } from '../dados.js';
import { lerCorpoJson } from './entrada-json.js';
import { comTransacao } from '../db/transacao.js';
import { reenfileirar } from '../repos/jobs.js';
import { hubNoticias, pedirEdicao, pedirNarracao, registro } from '../noticias/repositorio.js';
import { guardarNaBiblioteca } from '../noticias/biblioteca.js';
import { ErroDaApi } from './erros.js';
import { servirMp3 } from './rotas-audio.js';

export function registrarNoticias(api: Hono, banco: pg.Pool): void {
  api.get('/api/noticias', async c => c.json(await hubNoticias(banco)));
  api.post('/api/noticias/gerar', async c => c.json({ id: await pedirEdicao(banco) }, 202));
  api.put('/api/noticias/agenda', async c => {
    const v: unknown = await lerCorpoJson(c.req.raw);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ErroDaApi(400, 'agenda_invalida');
    const p = v as Record<string, unknown>;
    if (Object.keys(p).some(k => k !== 'ativa' && k !== 'hora') || typeof p.ativa !== 'boolean' || typeof p.hora !== 'number' || !Number.isInteger(p.hora) || p.hora < 0 || p.hora > 23) throw new ErroDaApi(400, 'agenda_invalida');
    await banco.query('UPDATE noticia_agenda SET ativa=$1,hora=$2 WHERE id=true', [p.ativa, p.hora]);
    return c.json({ ok: true });
  });
  api.use('/api/noticias/:id/*', async (c, next) => {
    const id = c.req.param('id');
    if (!id || !ehUlid(id)) throw new ErroDaApi(400, 'id_invalido');
    if (!(await banco.query('SELECT 1 FROM noticia_edicao WHERE id=$1', [id])).rowCount) throw new ErroDaApi(404, 'edicao_inexistente');
    await next();
  });
  api.post('/api/noticias/:id/repetir', async c => {
    const e = await registro(banco, c.req.param('id'));
    if (e.conteudo) throw new ErroDaApi(409, 'edicao_ja_publicada');
    const job = await reenfileirar(banco, e.job_id);
    if (!job) throw new ErroDaApi(409, 'edicao_em_curso');
    return c.json({ ok: true }, 202);
  });
  api.post('/api/noticias/:id/narrar', async c => {
    const id = c.req.param('id');
    await comTransacao(banco, async cliente => {
      await cliente.query('SELECT id FROM noticia_edicao WHERE id=$1 FOR UPDATE', [id]);
      const e = await registro(cliente, id);
      if (!e.conteudo?.roteiro) throw new ErroDaApi(409, 'edicao_sem_roteiro');
      await pedirNarracao(cliente, e);
    });
    return c.json({ ok: true }, 202);
  });
  api.post('/api/noticias/:id/capa', async c => {
    const id = c.req.param('id');
    if (!(await registro(banco, id)).conteudo) throw new ErroDaApi(409, 'edicao_em_preparo');
    await comTransacao(banco, cliente => pedirCapa(cliente, id));
    return c.json({ ok: true }, 202);
  });
  api.get('/api/noticias/:id/capa', async c => {
    const capa = (await banco.query<{ conteudo: CapaDeNoticiasV1 }>('SELECT conteudo FROM noticia_capa WHERE edicao_id=$1', [c.req.param('id')])).rows[0]?.conteudo;
    if (!capa) throw new ErroDaApi(404, 'capa_indisponivel');
    c.header('Content-Type', 'image/png');
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    c.header('ETag', `"${capa.sha256}"`);
    if (c.req.header('if-none-match') === `"${capa.sha256}"`) return c.body(null, 304);
    const bytes = await readFile(caminhoDaImagem(capa.sha256));
    return c.body(bytes);
  });
  api.post('/api/noticias/:id/ler', async c => {
    const id = c.req.param('id');
    if (!(await registro(banco, id)).conteudo) throw new ErroDaApi(409, 'edicao_em_preparo');
    return c.json({ documento_id: await guardarNaBiblioteca(banco, id) });
  });
  api.get('/api/noticias/:id/audio', async c => {
    const a = (await banco.query<{ sha256_audio: string }>('SELECT sha256_audio FROM noticia_audio WHERE edicao_id=$1', [c.req.param('id')])).rows[0];
    if (!a) throw new ErroDaApi(404, 'audio_indisponivel');
    return servirMp3(c, a.sha256_audio);
  });
}
