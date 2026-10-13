/**
 * Rotas da visita guiada (J91, `docs/jobs/J91-SPEC.md`).
 *
 *   GET  /api/compreensoes/:id/capitulos/:secao/visita   estado, roteiro e narração do capítulo
 *   POST /api/compreensoes/:id/capitulos/:secao/visita   enfileira o roteiro (idempotente)
 *   GET  /api/narracoes-visita/:id/arquivo               o MP3 da narração (Range/ETag)
 *
 * A voz não tem rota de geração: sai da fábrica pela ferramenta `narrar-visita` (como J63/J64).
 */
import type { Hono } from 'hono';
import type pg from 'pg';
import type { Id } from '@margem/contratos';
import { comTransacao } from '../db/transacao.js';
import * as compreensaoRepo from '../repos/compreensao.js';
import { CapituloSemModelo, estadoDaVisita, pedirVisita } from '../visita/manipuladores.js';
import * as repo from '../visita/repo.js';
import { ErroDaApi } from './erros.js';
import { servirMp3 } from './rotas-audio.js';

export interface ApoioDaVisita { banco: pg.Pool; exigirUlid: (valor: string, papel: string) => Id }

export function registrarRotasDaVisita(api: Hono, { banco, exigirUlid }: ApoioDaVisita): void {
  async function exigirCapitulo(execucaoId: Id, secaoId: Id): Promise<void> {
    await comTransacao(banco, async (cliente) => {
      const execucao = await compreensaoRepo.obterExecucao(cliente, execucaoId);
      if (!execucao) throw new ErroDaApi(404, 'compreensao_inexistente');
      const { rows: [secao] } = await cliente.query<{ id: Id }>('SELECT id FROM secao WHERE versao_id=$1 AND id=$2 AND nivel=1', [execucao.versao_id, secaoId]);
      if (!secao) throw new ErroDaApi(404, 'capitulo_inexistente');
    });
  }
  async function detalhe(execucaoId: Id, secaoId: Id) {
    return comTransacao(banco, async (cliente) => {
      const { estado, roteiro } = await estadoDaVisita(cliente, execucaoId, secaoId);
      const narracao = roteiro ? await repo.narracaoDoRoteiro(cliente, roteiro.id) : null;
      return { estado, roteiro, narracao };
    });
  }

  api.get('/api/compreensoes/:id/capitulos/:secao/visita', async (c) => {
    const execucaoId = exigirUlid(c.req.param('id'), 'compreensão');
    const secaoId = exigirUlid(c.req.param('secao'), 'capítulo');
    await exigirCapitulo(execucaoId, secaoId);
    return c.json(await detalhe(execucaoId, secaoId));
  });

  api.post('/api/compreensoes/:id/capitulos/:secao/visita', async (c) => {
    const execucaoId = exigirUlid(c.req.param('id'), 'compreensão');
    const secaoId = exigirUlid(c.req.param('secao'), 'capítulo');
    await exigirCapitulo(execucaoId, secaoId);
    try {
      await comTransacao(banco, (cliente) => pedirVisita(cliente, execucaoId, secaoId));
    } catch (erro) {
      if (erro instanceof CapituloSemModelo) throw new ErroDaApi(409, 'capitulo_sem_compreensao', erro.message);
      throw erro;
    }
    return c.json(await detalhe(execucaoId, secaoId), 202);
  });

  api.get('/api/narracoes-visita/:id/arquivo', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'narração');
    const narracao = await comTransacao(banco, (cliente) => repo.obterNarracao(cliente, id));
    if (!narracao) throw new ErroDaApi(404, 'audio_indisponivel');
    return servirMp3(c, narracao.sha256_audio);
  });
}
