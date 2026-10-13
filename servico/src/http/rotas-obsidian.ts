/**
 * Exportação para o Obsidian (só leitura):
 *
 * - `GET /api/documentos/:id/obsidian.md` — a nota de um documento;
 * - `GET /api/obsidian/indice` — `IndiceObsidianV1`: um item por documento, com o sha256 da nota;
 * - `GET /api/obsidian/exportacao.zip` — todas as notas num ZIP.
 *
 * Parâmetros comuns: `marcas=minhas|todas` (padrão `minhas`) e `base=<url>`, o endereço do Margem
 * nos links de volta. Sem `base`, vale `MARGEM_URL_PUBLICA`; sem ela, a origem do próprio pedido
 * (com https quando o pedido chegou pelo nome do Tailscale Serve). No índice e no ZIP, `todos=1`
 * inclui também os documentos sem nada do leitor.
 */
import type { Hono } from 'hono';
import type pg from 'pg';
import { validarIndiceObsidian, type Id, type MarcasDaExportacao } from '@margem/contratos';
import { comTransacao } from '../db/transacao.js';
import { exportarTudo, notaDoDocumento, type OpcoesDaExportacao } from '../obsidian/dados.js';
import { FUSO_DA_NOTA } from '../obsidian/exportar.js';
import { criarZip } from '../obsidian/zip.js';
import { hostTailscale } from './ambiente.js';
import { ErroDaApi } from './erros.js';

export interface DependenciasDoObsidian {
  banco: pg.Pool;
  exigirUlid: (valor: string, papel: string) => Id;
}

/** URL que pode ir crua num link Markdown: http(s), sem espaço, aspas, parênteses nem colchetes. */
const URL_SEGURA = /^https?:\/\/[^\s/?#()<>[\]"'`\\]+(\/[^\s?#()<>[\]"'`\\]*)?$/;

export function normalizarUrlBase(bruta: string): string | null {
  const limpa = bruta.trim().replace(/\/+$/, '');
  return URL_SEGURA.test(limpa) ? limpa : null;
}

function urlBase(c: { req: { query: (nome: string) => string | undefined; url: string; header: (nome: string) => string | undefined } }): string {
  const pedida = c.req.query('base');
  if (pedida !== undefined && pedida !== '') {
    const base = normalizarUrlBase(pedida);
    if (base === null) throw new ErroDaApi(400, 'base_invalida', 'Use base=<http(s)://host[/caminho]>, sem espaços nem parênteses.');
    return base;
  }
  const configurada = process.env.MARGEM_URL_PUBLICA;
  if (configurada !== undefined && configurada.trim() !== '') {
    const base = normalizarUrlBase(configurada);
    if (base === null) throw new ErroDaApi(500, 'url_publica_invalida', 'MARGEM_URL_PUBLICA não é uma URL http(s) válida.');
    return base;
  }
  const url = new URL(c.req.url);
  const host = (c.req.header('host') ?? url.host).toLowerCase();
  const tailscale = hostTailscale();
  const origem = tailscale !== undefined && (host === tailscale || host === `${tailscale}:443`) ? `https://${tailscale}` : `${url.protocol}//${host}`;
  return normalizarUrlBase(origem) ?? 'http://127.0.0.1';
}

function lerMarcas(bruto: string | undefined): MarcasDaExportacao {
  if (bruto === undefined || bruto === '' || bruto === 'minhas') return 'minhas';
  if (bruto === 'todas') return 'todas';
  throw new ErroDaApi(400, 'marcas_invalidas', 'Use marcas=minhas ou marcas=todas.');
}

/** `Content-Disposition` com o nome em UTF-8 (RFC 6266) e um substituto ASCII. */
function disposicao(nome: string): string {
  const ascii = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`;
}

/** A data do ZIP é a hora local do leitor, gravada nos campos DOS (que não têm fuso). */
function horaLocal(instante: string): Date {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_DA_NOTA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(instante)).map((parte) => [parte.type, parte.value]));
  return new Date(Date.UTC(Number(partes.year), Number(partes.month) - 1, Number(partes.day),
    Number(partes.hour), Number(partes.minute), Number(partes.second)));
}

export function registrarRotasDoObsidian(api: Hono, { banco, exigirUlid }: DependenciasDoObsidian): void {
  api.get('/api/documentos/:id/obsidian.md', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'documento');
    const opcoes: OpcoesDaExportacao = { marcas: lerMarcas(c.req.query('marcas')), url_base: urlBase(c) };
    const resultado = await comTransacao(banco, (cliente) => notaDoDocumento(cliente, id, opcoes));
    if (resultado.estado === 'inexistente') throw new ErroDaApi(404, 'documento_inexistente');
    if (resultado.estado === 'sem_texto') throw new ErroDaApi(409, 'sem_texto', 'O documento ainda não tem texto canonizado.');
    const etiqueta = `"${resultado.sha256}"`;
    c.header('ETag', etiqueta);
    c.header('Cache-Control', 'no-cache');
    c.header('X-Margem-Itens', String(resultado.nota.itens));
    if (c.req.header('if-none-match') === etiqueta) return c.body(null, 304);
    c.header('Content-Type', 'text/markdown; charset=utf-8');
    c.header('Content-Disposition', disposicao(resultado.nota.arquivo));
    return c.body(resultado.nota.conteudo);
  });

  api.get('/api/obsidian/indice', async (c) => {
    const opcoes = { marcas: lerMarcas(c.req.query('marcas')), url_base: urlBase(c), todos: c.req.query('todos') === '1' };
    const { indice } = await comTransacao(banco, (cliente) => exportarTudo(cliente, opcoes));
    if (!validarIndiceObsidian(indice)) throw new ErroDaApi(500, 'indice_invalido', 'O índice gerado não segue IndiceObsidianV1.');
    c.header('Cache-Control', 'no-cache');
    return c.json(indice);
  });

  api.get('/api/obsidian/exportacao.zip', async (c) => {
    const opcoes = { marcas: lerMarcas(c.req.query('marcas')), url_base: urlBase(c), todos: c.req.query('todos') === '1' };
    const { indice, notas } = await comTransacao(banco, (cliente) => exportarTudo(cliente, opcoes));
    const codificador = new TextEncoder();
    const zip = criarZip(indice.documentos.map((documento) => ({
      nome: documento.arquivo,
      conteudo: codificador.encode(notas.get(documento.documento_id)?.conteudo ?? ''),
      modificado_em: horaLocal(documento.atualizado_em),
    })));
    c.header('Content-Type', 'application/zip');
    c.header('Content-Disposition', disposicao('Margem.zip'));
    c.header('Cache-Control', 'no-cache');
    return c.body(new Uint8Array(zip));
  });
}
