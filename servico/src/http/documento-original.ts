import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Hono } from 'hono';
import type pg from 'pg';
import { ehUlid, pastaDaVersao, raizDoRepositorio } from '../dados.js';
import { comTransacao } from '../db/transacao.js';
import { gerarPdfAnotado, marcasDoPdf, montarPedido } from '../exportacao/pdf-anotado.js';
import * as anotacoesRepo from '../repos/anotacoes.js';
import * as camadasRepo from '../repos/camadas.js';
import * as marcasRepo from '../repos/marcas.js';
import { arquivoNosDados, CacheDeGeometria } from '../geometria/arquivos.js';
import { caminhoDaCamada } from '../escaneado/transcricao.js';
import { ErroDaApi } from './erros.js';

/** Uma faixa única, inclusive sufixos; múltiplas faixas são recusadas. */
export function faixaDeBytes(valor: string, tamanho: number): { inicio: number; fim: number } | null {
  const partes = /^bytes=(\d*)-(\d*)$/.exec(valor);
  if (!partes || (!partes[1] && !partes[2]) || tamanho === 0) return null;
  const a = Number(partes[1]);
  const b = Number(partes[2]);
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return null;
  const inicio = partes[1] ? a : Math.max(0, tamanho - b);
  const fim = partes[1] && partes[2] ? Math.min(b, tamanho - 1) : tamanho - 1;
  return inicio <= fim && inicio < tamanho ? { inicio, fim } : null;
}

export function registrarDocumentoOriginal(api: Hono, banco: pg.Pool): void {
  const cache = new CacheDeGeometria();
  api.get('/api/versoes/:versao/capa', async (c) => {
    const versao = c.req.param('versao');
    if (!ehUlid(versao)) throw new ErroDaApi(400, 'id_invalido');
    const linha = (await banco.query<{ documento_id: string }>(
      'SELECT documento_id FROM versao_texto WHERE id=$1', [versao])).rows[0];
    const caminho = linha ? await arquivoNosDados(join(pastaDaVersao(linha.documento_id, versao), 'capa.jpg')) : null;
    if (!caminho) throw new ErroDaApi(404, 'capa_indisponivel');
    const bytes = await readFile(caminho);
    const etag = `"${createHash('sha256').update(bytes).digest('hex')}"`;
    c.header('Content-Type', 'image/jpeg');
    c.header('ETag', etag);
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    if (c.req.header('if-none-match')?.split(',').some((item) => item.trim().replace(/^W\//, '') === etag || item.trim() === '*')) {
      return c.body(null, 304);
    }
    return c.body(new Uint8Array(bytes));
  });
  api.get('/api/documentos/:id/original', async (c) => {
    const id = c.req.param('id');
    if (!ehUlid(id)) throw new ErroDaApi(400, 'id_invalido');
    const documento = (await banco.query<{ origem_caminho: string; sha256_original: string; fonte_da_versao: string | null }>(
      `SELECT d.origem_caminho, d.sha256_original, (SELECT v.canonico->'documento'->>'sha256_original' FROM versao_texto v
        WHERE v.documento_id=d.id ORDER BY v.numero DESC LIMIT 1) AS fonte_da_versao
       FROM documento d WHERE d.id=$1 AND d.formato='pdf'`, [id])).rows[0];
    // Escaneado transcrito: a última versão vem do PDF com a camada invisível (as mesmas imagens), e é ele
    // que a PDF.js precisa para selecionar o texto.
    const camada = documento && documento.fonte_da_versao !== null && documento.fonte_da_versao !== documento.sha256_original
      ? await arquivoNosDados(caminhoDaCamada(id, documento.fonte_da_versao)) : null;
    const caminho = camada ?? (documento ? await arquivoNosDados(documento.origem_caminho) : null);
    if (!documento || caminho === null) throw new ErroDaApi(404, 'original_indisponivel');
    const arquivo = await open(caminho, 'r');
    try {
      const tamanho = (await arquivo.stat()).size;
      const etag = `"${camada === null ? documento.sha256_original : documento.fonte_da_versao ?? ''}"`;
      c.header('Content-Type', 'application/pdf');
      c.header('Accept-Ranges', 'bytes');
      c.header('ETag', etag);
      // A mesma URL passa a servir outro PDF quando o escaneado é transcrito (a cópia com a camada de
      // texto): nada de `immutable`. O navegador revalida pelo ETag e recebe 304 enquanto não mudar.
      c.header('Cache-Control', 'private, no-cache');
      if (c.req.header('if-none-match')?.split(',').some((item) => item.trim().replace(/^W\//, '') === etag || item.trim() === '*')) {
        await arquivo.close();
        return c.body(null, 304);
      }
      const range = c.req.header('range');
      const condicao = c.req.header('if-range');
      const pedirFaixa = range !== undefined && (condicao === undefined || condicao === etag);
      const faixa = pedirFaixa ? faixaDeBytes(range, tamanho) : { inicio: 0, fim: tamanho - 1 };
      if (faixa === null) {
        await arquivo.close();
        c.header('Content-Range', `bytes */${String(tamanho)}`);
        return c.body(null, 416);
      }
      if (pedirFaixa) c.header('Content-Range', `bytes ${String(faixa.inicio)}-${String(faixa.fim)}/${String(tamanho)}`);
      c.header('Content-Length', String(faixa.fim - faixa.inicio + 1));
      if (tamanho === 0) { await arquivo.close(); return c.body(null, 200); }
      const fluxo = arquivo.createReadStream({ start: faixa.inicio, end: faixa.fim, autoClose: true });
      return c.body(Readable.toWeb(fluxo) as ReadableStream<Uint8Array>, pedirFaixa ? 206 : 200);
    } catch (erro) { await arquivo.close(); throw erro; }
  });

  api.get('/api/versoes/:id/geometria', async (c) => {
    const id = c.req.param('id');
    if (!ehUlid(id)) throw new ErroDaApi(400, 'id_invalido');
    const bruto = c.req.query('paginas');
    const faixa = bruto === undefined ? null : /^([1-9]\d*)-([1-9]\d*)$/.exec(bruto);
    const inicio = Number(faixa?.[1]);
    const fim = Number(faixa?.[2]);
    if (bruto !== undefined && (!faixa || !Number.isSafeInteger(inicio) || !Number.isSafeInteger(fim) || inicio > fim)) {
      throw new ErroDaApi(400, 'paginas_invalidas');
    }
    if (faixa && fim - inicio + 1 > 60) throw new ErroDaApi(400, 'limite_de_paginas');
    const versao = (await banco.query<{ documento_id: string }>('SELECT documento_id FROM versao_texto WHERE id=$1', [id])).rows[0];
    const geometria = versao ? await cache.ler(versao.documento_id, id) : null;
    if (!geometria) throw new ErroDaApi(404, 'geometria_indisponivel');
    const paginas = geometria.paginas.filter((pagina) => !faixa || (pagina.numero >= inicio && pagina.numero <= fim));
    if (paginas.length > 60) throw new ErroDaApi(400, 'limite_de_paginas');
    const numeros = new Set(paginas.map((pagina) => pagina.numero));
    return c.json({ versao_id: id, fonte: geometria.fonte, motor: geometria.motor, paginas,
      palavras: geometria.palavras.filter((palavra) => numeros.has(palavra.pagina)) });
  });

  /**
   * Cópia do PDF original com os grifos e as notas como anotações padrão. `?ia=1` inclui as marcas
   * da IA da camada padrão; sem ele, só o que o leitor marcou ou aceitou. Quantas marcas e notas
   * ficaram de fora por falta de geometria vai em `X-Margem-Sem-Geometria`.
   */
  api.get('/api/versoes/:id/pdf-anotado', async (c) => {
    const id = c.req.param('id');
    if (!ehUlid(id)) throw new ErroDaApi(400, 'id_invalido');
    const incluirIa = c.req.query('ia') === '1';
    const documento = (await banco.query<{ documento_id: string; origem_caminho: string; titulo: string }>(
      `SELECT d.id AS documento_id, d.origem_caminho, d.titulo FROM versao_texto v JOIN documento d ON d.id = v.documento_id
        WHERE v.id=$1 AND d.formato='pdf'`, [id])).rows[0];
    const original = documento ? await arquivoNosDados(documento.origem_caminho) : null;
    if (!documento || original === null) throw new ErroDaApi(404, 'original_indisponivel');
    const geometria = await cache.ler(documento.documento_id, id);
    if (!geometria) throw new ErroDaApi(404, 'geometria_indisponivel');
    const pedido = await comTransacao(banco, async (cliente) => {
      const camada = incluirIa ? await camadasRepo.camadaPadrao(cliente, id) : null;
      const marcas = marcasDoPdf(await marcasRepo.listarV2PorVersao(cliente, id), camada, incluirIa);
      return montarPedido(marcas, await anotacoesRepo.listarDaVersao(cliente, id), geometria);
    });
    const pasta = await mkdtemp(join(tmpdir(), 'margem-pdf-anotado-'));
    let bytes: Buffer;
    try {
      const saida = join(pasta, 'anotado.pdf');
      try { await gerarPdfAnotado(raizDoRepositorio(), original, saida, pedido.anotacoes); }
      catch { throw new ErroDaApi(500, 'pdf_anotado_falhou', 'Não foi possível gerar o PDF anotado.'); }
      bytes = await readFile(saida);
    } finally { await rm(pasta, { recursive: true, force: true }); }
    const nome = `${documento.titulo.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim() || 'documento'} (anotado).pdf`;
    c.header('Content-Type', 'application/pdf');
    c.header('Content-Disposition', `attachment; filename="anotado.pdf"; filename*=UTF-8''${encodeURIComponent(nome)}`);
    c.header('Cache-Control', 'no-store');
    c.header('X-Margem-Marcas', String(pedido.marcas));
    c.header('X-Margem-Notas', String(pedido.notas));
    c.header('X-Margem-Sem-Geometria', String(pedido.sem_geometria));
    return c.body(new Uint8Array(bytes), 200);
  });
}
