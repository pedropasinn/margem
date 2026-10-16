/**
 * Conferência do sumário (J164).
 *
 *   GET  /api/documentos/:id/sumario          o aviso da página do documento (`situacao: null` sem aviso)
 *   POST /api/documentos/:id/sumario          { decisao: "usar" | "manter" } → usa a sugestão ou fica com o original
 *   GET  /api/configuracoes/sumario           { conferir_ao_importar }
 *   PUT  /api/configuracoes/sumario           { conferir_ao_importar: boolean }
 *
 * "Usar" não cria versão nem toca no texto: só a apresentação do sumário (`GET /api/versoes/:id/secoes`)
 * passa a usar a sugestão. "Manter" depois de usar volta ao sumário original.
 */
import type { Hono } from 'hono';
import type pg from 'pg';
import type { Id } from '@margem/contratos';
import { comTransacao } from '../db/transacao.js';
import { DecisaoInvalida, decidirSumario, gravarPreferenciaDoSumario, lerPreferenciaDoSumario, situacaoDoSumario } from '../sumario/conferencia.js';
import { lerCorpoJson } from './entrada-json.js';
import { ErroDaApi } from './erros.js';

export interface ApoioDoSumario {
  banco: pg.Pool;
  exigirUlid: (valor: string, papel: string) => Id;
}

async function objetoCom(bruto: Request, campo: string): Promise<unknown> {
  const corpo = await lerCorpoJson(bruto);
  if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) throw new ErroDaApi(400, 'corpo_invalido', 'O corpo precisa ser um objeto JSON.');
  const { [campo]: valor, ...resto } = corpo as Record<string, unknown>;
  if (Object.keys(resto).length > 0) throw new ErroDaApi(400, 'campo_desconhecido', `Campos desconhecidos: ${Object.keys(resto).join(', ')}.`);
  return valor;
}

export function registrarRotasDoSumario(api: Hono, apoio: ApoioDoSumario): void {
  const { banco, exigirUlid } = apoio;

  api.get('/api/documentos/:id/sumario', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'documento');
    return c.json({ situacao: await comTransacao(banco, (cliente) => situacaoDoSumario(cliente, id)) });
  });

  api.post('/api/documentos/:id/sumario', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'documento');
    const decisao = await objetoCom(c.req.raw, 'decisao');
    if (decisao !== 'usar' && decisao !== 'manter') throw new ErroDaApi(400, 'decisao_invalida', 'Use { "decisao": "usar" } ou { "decisao": "manter" }.');
    try {
      return c.json({ situacao: await comTransacao(banco, (cliente) => decidirSumario(cliente, id, decisao)) });
    } catch (erro) {
      if (erro instanceof DecisaoInvalida) throw new ErroDaApi(409, 'sem_sugestao', erro.message);
      throw erro;
    }
  });

  api.get('/api/configuracoes/sumario', async (c) => c.json(await comTransacao(banco, (cliente) => lerPreferenciaDoSumario(cliente))));

  api.put('/api/configuracoes/sumario', async (c) => {
    const valor = await objetoCom(c.req.raw, 'conferir_ao_importar');
    if (typeof valor !== 'boolean') throw new ErroDaApi(400, 'valor_invalido', 'Use { "conferir_ao_importar": true | false }.');
    return c.json(await comTransacao(banco, (cliente) => gravarPreferenciaDoSumario(cliente, { conferir_ao_importar: valor })));
  });
}
