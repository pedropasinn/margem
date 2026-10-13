import type { Context, Hono } from 'hono';
import type pg from 'pg';
import type { AudioNarrado } from '@margem/contratos';
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { caminhoDoAudio } from '../audio/publicacao';
import { ehUlid } from '../dados';
import { arquivoNosDados } from '../geometria/arquivos';
import { faixaDeBytes } from './documento-original';
import { ErroDaApi } from './erros';
export function registrarAudio(api: Hono, banco: pg.Pool): void {
  api.get('/api/versoes/:versao/capitulos/:secao/audios', async c => {
    const versao = c.req.param('versao'), secao = c.req.param('secao');
    if (!ehUlid(versao) || !ehUlid(secao)) throw new ErroDaApi(400, 'id_invalido');
    const { rows } = await banco.query<{ conteudo: AudioNarrado }>('SELECT conteudo FROM audio WHERE versao_id=$1 AND secao_id=$2 ORDER BY criado_em DESC,id DESC', [versao, secao]);
    return c.json({ audios: rows.map(r => r.conteudo) });
  });
  api.get('/api/audios/:id/arquivo', async c => {
    const id = c.req.param('id');
    if (!ehUlid(id)) throw new ErroDaApi(400, 'id_invalido');
    const { rows: [audio] } = await banco.query<{ sha256_audio: string }>('SELECT sha256_audio FROM audio WHERE id=$1', [id]);
    if (!audio) throw new ErroDaApi(404, 'audio_indisponivel');
    return servirMp3(c, audio.sha256_audio);
  });
}

/** Um MP3 guardado por hash em MARGEM_DADOS/audio, com Range, ETag e 304/416 (J64; reaproveitado pela visita, J91). */
export async function servirMp3(c: Context, sha256Audio: string): Promise<Response> {
  const caminho = await arquivoNosDados(caminhoDoAudio(sha256Audio));
  if (!caminho) throw new ErroDaApi(404, 'audio_indisponivel');
  const arquivo = await open(caminho, 'r');
  try {
    const tamanho = (await arquivo.stat()).size;
    const etag = `"${sha256Audio}"`;
    c.header('Content-Type', 'audio/mpeg'); c.header('Accept-Ranges', 'bytes'); c.header('ETag', etag);
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    if (c.req.header('if-none-match') === etag) { await arquivo.close(); return c.body(null, 304); }
    const range = c.req.header('range');
    const condicao = c.req.header('if-range');
    const parcial = range !== undefined && (condicao === undefined || condicao === etag);
    const faixa = parcial ? faixaDeBytes(range, tamanho) : { inicio: 0, fim: tamanho - 1 };
    if (faixa === null || tamanho === 0) { await arquivo.close(); c.header('Content-Range', `bytes */${String(tamanho)}`); return c.body(null, 416); }
    if (parcial) c.header('Content-Range', `bytes ${String(faixa.inicio)}-${String(faixa.fim)}/${String(tamanho)}`);
    c.header('Content-Length', String(faixa.fim - faixa.inicio + 1));
    return c.body(Readable.toWeb(arquivo.createReadStream({ start: faixa.inicio, end: faixa.fim, autoClose: true })) as ReadableStream<Uint8Array>, parcial ? 206 : 200);
  } catch (erro) { await arquivo.close(); throw erro; }
}
