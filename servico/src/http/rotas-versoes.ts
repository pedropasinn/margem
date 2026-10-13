import type { Hono } from 'hono';
import type pg from 'pg';
import type { AncoraV1 } from '@margem/contratos';
import { compararCanonicos, proporAncoraEntreVersoes } from '@margem/core';
import { ehUlid } from '../dados';
import { comTransacao } from '../db/transacao';
import { obterVersao } from '../repos/documentos';
import { OBJETO_ANCORA } from '../repos/anotacoes';
import { ErroDaApi } from './erros';
/** Relatório paginado, só leitura. Nenhuma versão ou anotação é substituída. */
export function registrarComparacaoDeVersoes(api: Hono, banco: pg.Pool): void {
  api.get('/api/versoes/:antes/comparar/:depois', async c => {
    const a = c.req.param('antes'), b = c.req.param('depois');
    const pagina = Number(c.req.query('pagina') ?? '0');
    if (!ehUlid(a) || !ehUlid(b) || !Number.isSafeInteger(pagina) || pagina < 0) throw new ErroDaApi(400, 'comparacao_invalida');
    const relatorio = await comTransacao(banco, async tx => {
      const existentes = await tx.query('SELECT id FROM versao_texto WHERE id=ANY($1::ulid[])', [[...new Set([a, b])]]);
      if (existentes.rowCount !== new Set([a, b]).size) throw new ErroDaApi(404, 'versao_inexistente');
      const antes = await obterVersao(tx, a), depois = await obterVersao(tx, b);
      if (antes.documento_id !== depois.documento_id) throw new ErroDaApi(422, 'documentos_diferentes');
      const comparacao = compararCanonicos(antes.canonico, depois.canonico);
      // Cinquenta linhas por página da interface; não é limite de validade do contrato.
      const tamanho = 50, inicio = pagina * tamanho;
      if (!Number.isSafeInteger(inicio)) throw new ErroDaApi(400, 'pagina_invalida');
      const notas = await tx.query<{ id: string; ancora: AncoraV1; texto: string }>(
        `SELECT id, ${OBJETO_ANCORA()} AS ancora,texto FROM anotacao WHERE versao_id=$1 ORDER BY criada_em,id LIMIT $2 OFFSET $3`, [a, tamanho, inicio]);
      const contagem = await tx.query<{ total: number }>('SELECT count(*)::int AS total FROM anotacao WHERE versao_id=$1', [a]);
      const recorte = (blocos: typeof comparacao.sem_par_antes) => blocos.slice(inicio, inicio + tamanho).map(({ id, tipo, texto }) => ({ id, tipo, texto }));
      return { antes_id: a, depois_id: b, mesmo_original: comparacao.mesmo_original, pagina,
        totais: { iguais: comparacao.blocos_iguais, sem_par_antes: comparacao.sem_par_antes.length,
          sem_par_depois: comparacao.sem_par_depois.length, anotacoes: contagem.rows[0]!.total },
        antes: recorte(comparacao.sem_par_antes), depois: recorte(comparacao.sem_par_depois),
        anotacoes: notas.rows.map(n => ({ ...n, proposta: proporAncoraEntreVersoes(n.ancora, antes, depois) })),
        ha_proxima: inicio + tamanho < Math.max(comparacao.sem_par_antes.length, comparacao.sem_par_depois.length, contagem.rows[0]!.total) };
    });
    return c.json(relatorio);
  });
}
