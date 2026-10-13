/**
 * Rotas do esquema do capítulo (o mapa esquemático):
 *
 *   GET  /api/compreensoes/:id/capitulos/:secao/esquema   estado e o esquema pronto mais recente
 *   POST /api/compreensoes/:id/capitulos/:secao/esquema   pede um esquema novo (gerar ou gerar de novo)
 *
 * O esquema sai do modelo da compreensão do capítulo; sem modelo, 409. Um pedido em curso
 * recusa outro (409). O estado vem do job; o esquema, do arquivo guardado na pasta da versão.
 */
import type { Hono } from 'hono';
import type pg from 'pg';
import type { Id } from '@margem/contratos';
import { comTransacao } from '../db/transacao.js';
import { EsquemaEmCurso, esquemaPronto, pedirEsquema, situacaoDoEsquema } from '../esquema/manipuladores.js';
import * as repo from '../repos/compreensao.js';
import { ErroDaApi } from './erros.js';

export interface ApoioDoEsquema {
  banco: pg.Pool;
  exigirUlid: (valor: string, papel: string) => Id;
}

export function registrarRotasDoEsquema(api: Hono, apoio: ApoioDoEsquema): void {
  const { banco, exigirUlid } = apoio;
  const ler = async (compreensaoId: Id, secaoId: Id) => comTransacao(banco, async (cliente) => {
    const situacao = await situacaoDoEsquema(cliente, compreensaoId, secaoId);
    return { ...situacao, esquema: await esquemaPronto(cliente, compreensaoId, secaoId, situacao) };
  });
  const alvo = async (id: string, secao: string) => {
    const compreensaoId = exigirUlid(id, 'compreensão');
    const secaoId = exigirUlid(secao, 'capítulo');
    const execucao = await comTransacao(banco, (cliente) => repo.obterExecucao(cliente, compreensaoId));
    if (!execucao) throw new ErroDaApi(404, 'compreensao_inexistente', 'Execução de compreensão inexistente.');
    return { execucao, secaoId };
  };

  api.get('/api/compreensoes/:id/capitulos/:secao/esquema', async (c) => {
    const { execucao, secaoId } = await alvo(c.req.param('id'), c.req.param('secao'));
    return c.json(await ler(execucao.id, secaoId));
  });

  api.post('/api/compreensoes/:id/capitulos/:secao/esquema', async (c) => {
    const { execucao, secaoId } = await alvo(c.req.param('id'), c.req.param('secao'));
    try {
      await comTransacao(banco, async (cliente) => {
        const modelo = await repo.revisaoDoCapitulo(cliente, execucao.id, secaoId);
        if (!modelo) throw new ErroDaApi(409, 'capitulo_nao_preparado', 'O capítulo ainda não tem o modelo da compreensão.');
        await pedirEsquema(cliente, { compreensaoId: execucao.id, secaoId, versaoId: execucao.versao_id });
      });
    } catch (erro) {
      if (erro instanceof EsquemaEmCurso) throw new ErroDaApi(409, 'esquema_em_curso', erro.message);
      throw erro;
    }
    return c.json(await ler(execucao.id, secaoId), 202);
  });
}
