import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import type { MiddlewareHandler } from 'hono';

const comprimirGzip = promisify(gzip);
const comprimirBrotli = promisify(brotliCompress);

/** Só texto finito: PDF, mídia, SSE e intervalos conservam seus bytes e validadores. */
export function compressao(): MiddlewareHandler {
  return async (c, proximo) => {
    await proximo();
    const resposta = c.res;
    const cabecalhos = resposta.headers;
    const tipo = cabecalhos.get('Content-Type') ?? '';
    if (!resposta.body || c.req.method === 'HEAD' || resposta.status === 206 ||
      cabecalhos.has('Content-Range') || cabecalhos.has('Content-Encoding') ||
      /(?:^|,)\s*no-transform\s*(?:,|$)/iu.test(cabecalhos.get('Cache-Control') ?? '') ||
      !/^(?:application\/(?:json|[^;]+\+json|javascript)|text\/(?:html|css|javascript|plain)|image\/svg\+xml)(?:;|$)/iu.test(tipo)) return;

    const vary = cabecalhos.get('Vary');
    if (vary !== '*' && !vary?.split(',').some((parte) => parte.trim().toLowerCase() === 'accept-encoding')) {
      cabecalhos.set('Vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
    }
    const aceitos = new Map((c.req.header('Accept-Encoding') ?? '').toLowerCase().split(',').map((parte) => {
      const [nome = '', ...parametros] = parte.trim().split(';');
      const parametro = parametros.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const peso = parametro === undefined ? 1 : Number(parametro.slice(2));
      return [nome.trim(), Number.isFinite(peso) && peso >= 0 && peso <= 1 ? peso : 0];
    }));
    const peso = (nome: string) => aceitos.get(nome) ?? aceitos.get('*') ?? 0;
    const formato = peso('br') >= peso('gzip') ? 'br' : 'gzip';
    if (peso(formato) <= 0 || (aceitos.get('identity') ?? 0) > peso(formato)) return;
    const bytes = Buffer.from(await resposta.arrayBuffer());
    // Abaixo de 1 KB o cabeçalho do formato come o ganho.
    if (bytes.length < 1024) { c.res = new Response(new Uint8Array(bytes), { status: resposta.status, statusText: resposta.statusText, headers: cabecalhos }); return; }
    const comprimido = formato === 'br'
      ? await comprimirBrotli(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })
      : await comprimirGzip(bytes);
    cabecalhos.set('Content-Encoding', formato);
    cabecalhos.delete('Content-Length');
    const etag = cabecalhos.get('ETag');
    if (etag && !etag.startsWith('W/')) cabecalhos.set('ETag', `W/${etag}`);
    c.res = new Response(new Uint8Array(comprimido), { status: resposta.status, statusText: resposta.statusText, headers: cabecalhos });
  };
}
