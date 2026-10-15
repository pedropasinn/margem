/**
 * Trabalho do Codex em pausa (V-F1): o que ficou parado desde antes de o app abrir espera a pessoa.
 *
 *   GET  /api/trabalhos-em-pausa                       quantos, desde quando e a lista por documento
 *   POST /api/trabalhos-em-pausa/retomar   { todos: true } | { ids: [...] }
 *   POST /api/trabalhos-em-pausa/descartar { todos: true } | { ids: [...] }
 *
 * Os ids são os da lista (`ItemEmPausa.ids`): ids de job, ou `preparacao:<documento>` para a análise que
 * esperava o tipo do texto. Um id que não está mais em pausa é ignorado (outra janela já retomou).
 */
import type { Hono } from 'hono';
import type pg from 'pg';
import type { Id } from '@margem/contratos';
import { comTransacao } from '../db/transacao.js';
import { PREFIXO_DA_PREPARACAO, descartar, listarEmPausa, retomar } from '../pausa/pausa.js';
import { lerCorpoJson } from './entrada-json.js';
import { ErroDaApi } from './erros.js';

export interface ApoioDaPausa {
  banco: pg.Pool;
  exigirUlid: (valor: string, papel: string) => Id;
}

/** Teto de ids num pedido: a lista da janela nunca passa disso. */
const MAXIMO_DE_IDS = 500;

export function registrarRotasDaPausa(api: Hono, apoio: ApoioDaPausa): void {
  const { banco, exigirUlid } = apoio;
  const pedido = async (bruto: Request): Promise<{ todos: true } | { ids: Id[] }> => {
    const corpo = await lerCorpoJson(bruto);
    if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) throw new ErroDaApi(400, 'corpo_invalido', 'O corpo precisa ser um objeto JSON.');
    const { todos, ids, ...resto } = corpo as Record<string, unknown>;
    if (Object.keys(resto).length > 0) throw new ErroDaApi(400, 'campo_desconhecido', `Campos desconhecidos: ${Object.keys(resto).join(', ')}.`);
    if (todos === true && ids === undefined) return { todos: true };
    if (todos !== undefined || !Array.isArray(ids) || ids.length === 0 || ids.length > MAXIMO_DE_IDS) {
      throw new ErroDaApi(400, 'pedido_invalido', 'Mande { "todos": true } ou { "ids": [...] } com os ids da lista.');
    }
    return { ids: ids.map((id) => {
      if (typeof id !== 'string') throw new ErroDaApi(400, 'pedido_invalido', 'Cada id é um texto.');
      return id.startsWith(PREFIXO_DA_PREPARACAO)
        ? `${PREFIXO_DA_PREPARACAO}${exigirUlid(id.slice(PREFIXO_DA_PREPARACAO.length), 'documento')}`
        : exigirUlid(id, 'trabalho');
    }) };
  };

  api.get('/api/trabalhos-em-pausa', async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(await comTransacao(banco, (cliente) => listarEmPausa(cliente)));
  });

  api.post('/api/trabalhos-em-pausa/retomar', async (c) => {
    const alvo = await pedido(c.req.raw);
    const resultado = await comTransacao(banco, (cliente) => retomar(cliente, alvo));
    return c.json({ ...resultado, ...await comTransacao(banco, (cliente) => listarEmPausa(cliente)) });
  });

  api.post('/api/trabalhos-em-pausa/descartar', async (c) => {
    const alvo = await pedido(c.req.raw);
    const resultado = await comTransacao(banco, (cliente) => descartar(cliente, alvo));
    return c.json({ ...resultado, ...await comTransacao(banco, (cliente) => listarEmPausa(cliente)) });
  });
}
