/**
 * Cancelar e apagar (V-T8): o que se pediu ao Codex para no meio sem deixar nada, e o que foi feito sai,
 * um item ou em lote, do Codex ou do leitor.
 *
 *   POST   /api/jobs/:id/cancelar                                 cancela o job (uma etapa da análise cancela o capítulo)
 *   POST   /api/documentos/:id/cancelar          { secao_id? }    cancela tudo o que está pendente no documento (ou capítulo)
 *   GET    /api/documentos/:id/apagaveis?secao=                   o que cada lote apagaria, com a contagem
 *   POST   /api/documentos/:id/apagar            { quem, secao_id?, confirmacao? }
 *            quem: "codex" (a análise do Codex), "leitor" (tudo seu) ou "tudo" (exige confirmacao: "apagar tudo")
 *   DELETE /api/marcas/:id                                        um grifo, do Codex ou do leitor
 *   DELETE /api/compreensoes/:id/capitulos/:secao/itens/:item     uma relação, uma dificuldade ou um elemento da análise
 *   DELETE /api/compreensoes/:id/capitulos/:secao/esquema         o mapa do capítulo (e um pedido em curso);
 *                                                     ?pendente=1  só cancela o mapa sendo gerado
 *
 * As outras exclusões de item já existiam e agora também cancelam o que está rodando: resolução
 * (`rotas-resolucao.ts`), imagem e fluxograma (`rotas-visuais.ts`); flashcard e nota continuam iguais.
 */
import type { Hono } from 'hono';
import type pg from 'pg';
import type { Id } from '@margem/contratos';
import { comTransacao } from '../db/transacao.js';
import * as jobsRepo from '../repos/jobs.js';
import * as repo from '../repos/compreensao.js';
import { cancelarOperacoes } from '../apagar/cancelar.js';
import { apagarJobs, apagarMarcas, ligarApagamento, marcarApagado, tipoDoItem } from '../apagar/compreensao.js';
import { apagarDoCodex, apagarDoLeitor, CapituloInexistente, contarApagaveis } from '../apagar/lote.js';
import { TIPO_GERAR_ESQUEMA, prefixoDoEsquema } from '../esquema/manipuladores.js';
import { lerCorpoJson } from './entrada-json.js';
import { ErroDaApi } from './erros.js';

export interface ApoioDoApagar {
  banco: pg.Pool;
  exigirUlid: (valor: string, papel: string) => Id;
}

/** A frase que "Apagar tudo" exige, digitada pela pessoa. */
export const CONFIRMACAO_DE_APAGAR_TUDO = 'apagar tudo';

type Corpo = Record<string, unknown>;
function objeto(bruto: unknown, permitidas: readonly string[]): Corpo {
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) throw new ErroDaApi(400, 'corpo_invalido', 'O corpo precisa ser um objeto JSON.');
  const desconhecidas = Object.keys(bruto).filter((chave) => !permitidas.includes(chave));
  if (desconhecidas.length > 0) throw new ErroDaApi(400, 'campo_desconhecido', `Campos desconhecidos: ${desconhecidas.join(', ')}.`);
  return bruto as Corpo;
}

export function registrarRotasDoApagar(api: Hono, apoio: ApoioDoApagar): void {
  const { banco, exigirUlid } = apoio;
  const secaoOpcional = (valor: unknown): Id | undefined => {
    if (valor === undefined || valor === null || valor === '') return undefined;
    if (typeof valor !== 'string') throw new ErroDaApi(400, 'secao_invalida', 'secao_id é o id de um capítulo.');
    return exigirUlid(valor, 'capítulo');
  };
  const exigirDocumento = async (id: Id) => {
    if (!(await banco.query('SELECT 1 FROM documento WHERE id=$1', [id])).rowCount) throw new ErroDaApi(404, 'documento_inexistente');
  };
  const comCapitulo = async <T>(acao: () => Promise<T>): Promise<T> => {
    try { return await acao(); }
    catch (erro) {
      if (erro instanceof CapituloInexistente) throw new ErroDaApi(404, 'capitulo_inexistente', erro.message);
      throw erro;
    }
  };

  api.post('/api/jobs/:id/cancelar', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'job');
    const antes = await comTransacao(banco, (cliente) => jobsRepo.obter(cliente, id));
    if (!antes) throw new ErroDaApi(404, 'job_inexistente');
    if (antes.estado === 'cancelado') return c.json({ job_id: id, estado: 'cancelado', alterado: false });
    const resultado = jobsRepo.CANCELAVEIS.includes(antes.estado)
      ? await comTransacao(banco, (cliente) => cancelarOperacoes(cliente, { job_id: id }))
      : null;
    if (!resultado || resultado.cancelados === 0) {
      const atual = await comTransacao(banco, (cliente) => jobsRepo.obter(cliente, id));
      throw new ErroDaApi(409, 'job_nao_cancelavel',
        `Só se cancela job pendente, adiado ou em execução; este está em ${atual?.estado ?? antes.estado}.`);
    }
    return c.json({ job_id: id, estado: 'cancelado', alterado: true, estado_anterior: antes.estado, ...resultado });
  });

  api.post('/api/documentos/:id/cancelar', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'documento');
    const corpo = objeto(await lerCorpoJson(c.req.raw, true), ['secao_id']);
    const secao = secaoOpcional(corpo.secao_id);
    await exigirDocumento(id);
    const resultado = await comTransacao(banco, (cliente) => cancelarOperacoes(cliente, { documento_id: id, ...(secao === undefined ? {} : { secao_id: secao }) }));
    return c.json(resultado);
  });

  api.get('/api/documentos/:id/apagaveis', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'documento');
    const secao = secaoOpcional(c.req.query('secao'));
    await exigirDocumento(id);
    return c.json(await comCapitulo(() => comTransacao(banco, (cliente) => contarApagaveis(cliente, id, secao))));
  });

  api.post('/api/documentos/:id/apagar', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'documento');
    const corpo = objeto(await lerCorpoJson(c.req.raw), ['quem', 'secao_id', 'confirmacao']);
    const quem = corpo.quem;
    if (quem !== 'codex' && quem !== 'leitor' && quem !== 'tudo') throw new ErroDaApi(400, 'quem_invalido', 'quem é "codex", "leitor" ou "tudo".');
    if (quem === 'tudo' && corpo.confirmacao !== CONFIRMACAO_DE_APAGAR_TUDO) {
      throw new ErroDaApi(422, 'confirmacao_ausente', `Para apagar tudo, digite "${CONFIRMACAO_DE_APAGAR_TUDO}".`);
    }
    const secao = secaoOpcional(corpo.secao_id);
    await exigirDocumento(id);
    const apagados = await comCapitulo(() => comTransacao(banco, async (cliente) => ({
      ...(quem === 'leitor' ? {} : { codex: await apagarDoCodex(cliente, id, secao) }),
      ...(quem === 'codex' ? {} : { leitor: await apagarDoLeitor(cliente, id, secao) }),
    })));
    return c.json({ documento_id: id, secao_id: secao ?? null, apagados });
  });

  api.delete('/api/marcas/:id', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'marca');
    const apagada = await comTransacao(banco, async (cliente) => {
      const linha = (await cliente.query<{ elemento_id: Id | null; execucao_id: Id | null; secao_id: Id | null }>(`SELECT me.elemento_id, mc.execucao_id, mc.secao_id
        FROM marca m LEFT JOIN marca_elemento me ON me.marca_id = m.id LEFT JOIN modelo_capitulo mc ON mc.id = me.modelo_id WHERE m.id=$1 FOR UPDATE OF m`, [id])).rows[0];
      if (!linha) return false;
      await ligarApagamento(cliente);
      // Grifo da análise: o elemento sai da leitura também (as relações que o tocam somem junto).
      if (linha.elemento_id && linha.execucao_id && linha.secao_id) await marcarApagado(cliente, linha.execucao_id, linha.secao_id, linha.elemento_id, 'elemento');
      return (await apagarMarcas(cliente, [id])) > 0;
    });
    if (!apagada) throw new ErroDaApi(404, 'marca_inexistente');
    return c.json({ marca_id: id, apagada: true });
  });

  api.delete('/api/compreensoes/:id/capitulos/:secao/itens/:item', async (c) => {
    const execucaoId = exigirUlid(c.req.param('id'), 'compreensão');
    const secaoId = exigirUlid(c.req.param('secao'), 'capítulo');
    const itemId = exigirUlid(c.req.param('item'), 'item');
    const resultado = await comTransacao(banco, async (cliente) => {
      const modelo = await repo.revisaoDoCapitulo(cliente, execucaoId, secaoId);
      if (!modelo) throw new ErroDaApi(404, 'capitulo_nao_preparado', 'O capítulo não tem análise.');
      const tipo = tipoDoItem(modelo, itemId);
      if (!tipo) throw new ErroDaApi(404, 'item_inexistente', 'O item não está na análise do capítulo.');
      await ligarApagamento(cliente);
      await marcarApagado(cliente, execucaoId, secaoId, itemId, tipo);
      // Um elemento apagado leva junto os grifos projetados dele.
      const marcas = tipo === 'elemento'
        ? (await cliente.query<{ marca_id: Id }>(`SELECT me.marca_id FROM marca_elemento me JOIN modelo_capitulo mc ON mc.id = me.modelo_id
            WHERE me.elemento_id=$1 AND mc.execucao_id=$2`, [itemId, execucaoId])).rows.map((l) => l.marca_id)
        : [];
      await apagarMarcas(cliente, marcas);
      // Uma dificuldade apontada pelo Codex leva a decisão do leitor sobre ela (DificuldadeV1, origem codex).
      if (tipo === 'dificuldade') await cliente.query(`DELETE FROM dificuldade WHERE origem='codex' AND codex_dificuldade_id=$1`, [itemId]);
      return { tipo, marcas: marcas.length };
    });
    return c.json({ item_id: itemId, apagado: true, ...resultado });
  });

  api.delete('/api/compreensoes/:id/capitulos/:secao/esquema', async (c) => {
    const execucaoId = exigirUlid(c.req.param('id'), 'compreensão');
    const secaoId = exigirUlid(c.req.param('secao'), 'capítulo');
    // `?pendente=1`: só o mapa sendo gerado para (o pronto fica); sem ele, sai tudo.
    const soPedido = c.req.query('pendente') === '1';
    const apagados = await comTransacao(banco, async (cliente) => {
      const todos = (await cliente.query<{ id: Id; estado: jobsRepo.EstadoJob }>('SELECT id, estado FROM job WHERE tipo=$1 AND starts_with(dedup_key, $2)',
        [TIPO_GERAR_ESQUEMA, prefixoDoEsquema(execucaoId, secaoId)])).rows;
      const jobs = soPedido ? todos.filter((job) => jobsRepo.CANCELAVEIS.includes(job.estado)) : todos;
      for (const job of jobs) if (jobsRepo.CANCELAVEIS.includes(job.estado)) await cancelarOperacoes(cliente, { job_id: job.id });
      await ligarApagamento(cliente);
      await apagarJobs(cliente, jobs.map((job) => job.id));
      return jobs.length;
    });
    if (apagados === 0) throw new ErroDaApi(404, 'esquema_inexistente', 'O capítulo não tem mapa.');
    return c.json({ apagado: true });
  });
}
