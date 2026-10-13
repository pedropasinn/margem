/**
 * Notas do livro e da biblioteca: anotações e grifos/marcas manuais fora do capítulo aberto.
 *
 *   GET /api/notas                  { itens }   filtros: documento, especie (anotacao|grifo), tipo, texto
 *   GET /api/notas/exportacao.csv   o mesmo recorte, para baixar
 *   GET /api/notas/exportacao.json  idem, em JSON
 */
import type { Context, Hono } from 'hono';
import type pg from 'pg';
import type { Id } from '@margem/contratos';
import { comTransacao } from '../db/transacao.js';
import { listarNotas, notasEmCsv, type FiltroDeNotas } from '../notas/listar.js';
import { ErroDaApi } from './erros.js';

export interface ApoioDasNotas { banco: pg.Pool; exigirUlid: (valor: string, papel: string) => Id }

export function registrarRotasDasNotas(api: Hono, { banco, exigirUlid }: ApoioDasNotas): void {
  function filtro(c: Context): FiltroDeNotas {
    const documento = c.req.query('documento');
    const especie = c.req.query('especie');
    const tipo = c.req.query('tipo');
    const texto = c.req.query('texto')?.trim();
    if (especie !== undefined && especie !== 'anotacao' && especie !== 'grifo') throw new ErroDaApi(400, 'especie_invalida', 'Use anotacao ou grifo.');
    if (tipo !== undefined && !/^[a-z][a-z0-9_]{0,59}$/.test(tipo)) throw new ErroDaApi(400, 'tipo_invalido', 'Tipo inválido.');
    if (texto !== undefined && texto.length > 200) throw new ErroDaApi(400, 'texto_longo_demais', 'Procure por até 200 caracteres.');
    return {
      ...(documento ? { documento_id: exigirUlid(documento, 'documento') } : {}),
      ...(especie ? { especie } : {}),
      ...(tipo ? { tipo } : {}),
      ...(texto ? { texto } : {}),
    };
  }
  const listar = (escolha: FiltroDeNotas) => comTransacao(banco, (cliente) => listarNotas(cliente, escolha));
  async function nomeDoArquivo(escolha: FiltroDeNotas, extensao: string): Promise<string> {
    const dia = new Date().toISOString().slice(0, 10);
    if (!escolha.documento_id) return `margem-notas-${dia}.${extensao}`;
    const titulo = await comTransacao(banco, async (cliente) => (await cliente.query<{ titulo: string }>(
      'SELECT titulo FROM documento WHERE id=$1', [escolha.documento_id])).rows[0]?.titulo ?? 'documento');
    const lesma = titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'documento';
    return `margem-notas-${lesma}-${dia}.${extensao}`;
  }

  api.get('/api/notas', async (c) => c.json({ itens: await listar(filtro(c)) }));

  api.get('/api/notas/exportacao.csv', async (c) => {
    const escolha = filtro(c);
    c.header('Content-Disposition', `attachment; filename="${await nomeDoArquivo(escolha, 'csv')}"`);
    c.header('Cache-Control', 'no-store');
    return c.body(notasEmCsv(await listar(escolha)), 200, { 'Content-Type': 'text/csv; charset=utf-8' });
  });

  api.get('/api/notas/exportacao.json', async (c) => {
    const escolha = filtro(c);
    c.header('Content-Disposition', `attachment; filename="${await nomeDoArquivo(escolha, 'json')}"`);
    c.header('Cache-Control', 'no-store');
    const itens = await listar(escolha);
    return c.json({ versao: 1, exportado_em: new Date().toISOString(), filtro: escolha, total: itens.length, itens });
  });
}
