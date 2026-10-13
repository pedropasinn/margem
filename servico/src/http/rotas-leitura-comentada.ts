/**
 * Rotas da leitura comentada integral (J92, `docs/jobs/J92-SPEC.md`).
 *
 *   GET  /api/compreensoes/:id/capitulos/:secao/leitura-comentada   estado, leitura e narração do capítulo
 *   POST /api/compreensoes/:id/capitulos/:secao/leitura-comentada   enfileira as falas (idempotente)
 *   GET  /api/narracoes-leitura/:id/arquivo                         o MP3 montado (Range/ETag)
 *
 * A voz não tem rota de geração: sai da fábrica pela ferramenta `narrar-leitura-comentada`.
 */
import type { Hono } from 'hono';
import type pg from 'pg';
import type { Id } from '@margem/contratos';
import { comTransacao } from '../db/transacao.js';
import * as compreensaoRepo from '../repos/compreensao.js';
import { CapituloSemCompreensao, estadoDaLeituraComentada, pedirLeituraComentada } from '../leitura-comentada/manipuladores.js';
import * as repo from '../leitura-comentada/repo.js';
import { ErroDaApi } from './erros.js';
import { servirMp3 } from './rotas-audio.js';

export interface ApoioDaLeituraComentada { banco: pg.Pool; exigirUlid: (valor: string, papel: string) => Id }

export function registrarRotasDaLeituraComentada(api: Hono, { banco, exigirUlid }: ApoioDaLeituraComentada): void {
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
      const { estado, leitura } = await estadoDaLeituraComentada(cliente, execucaoId, secaoId);
      const narracao = leitura ? await repo.narracaoDaLeitura(cliente, leitura.id) : null;
      return { estado, leitura, narracao };
    });
  }
  const rota = '/api/compreensoes/:id/capitulos/:secao/leitura-comentada';

  api.get(rota, async (c) => {
    const execucaoId = exigirUlid(c.req.param('id'), 'compreensão');
    const secaoId = exigirUlid(c.req.param('secao'), 'capítulo');
    await exigirCapitulo(execucaoId, secaoId);
    return c.json(await detalhe(execucaoId, secaoId));
  });

  api.post(rota, async (c) => {
    const execucaoId = exigirUlid(c.req.param('id'), 'compreensão');
    const secaoId = exigirUlid(c.req.param('secao'), 'capítulo');
    await exigirCapitulo(execucaoId, secaoId);
    try {
      await comTransacao(banco, (cliente) => pedirLeituraComentada(cliente, execucaoId, secaoId));
    } catch (erro) {
      if (erro instanceof CapituloSemCompreensao) throw new ErroDaApi(409, 'capitulo_sem_compreensao', erro.message);
      throw erro;
    }
    return c.json(await detalhe(execucaoId, secaoId), 202);
  });

  api.get('/api/narracoes-leitura/:id/arquivo', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'narração');
    const narracao = await comTransacao(banco, (cliente) => repo.obterNarracao(cliente, id));
    if (!narracao) throw new ErroDaApi(404, 'audio_indisponivel');
    return servirMp3(c, narracao.sha256_audio);
  });
}
