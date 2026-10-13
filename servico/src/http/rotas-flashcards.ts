/**
 * Flashcards:
 *
 *   POST   /api/versoes/:versao/capitulos/:secao/flashcards   pede ao Codex cartões do capítulo (202; 409 se já em curso)
 *   GET    /api/flashcards                                      { cartoes, em_curso }  filtros: documento, fila=hoje
 *   POST   /api/flashcards                                      cartão manual { ancora, frente, verso }
 *   PATCH  /api/flashcards/:id                                  { frente?, verso? }
 *   DELETE /api/flashcards/:id
 *   POST   /api/flashcards/:id/revisoes                         { nota: 1 Errei | 2 Difícil | 3 Bom | 4 Fácil } → { agenda }
 *   GET    /api/flashcards/exportacao.csv                       para o Anki (frente;verso;tags), filtro documento
 */
import type { Context, Hono } from 'hono';
import type pg from 'pg';
import type { AncoraV1, Id } from '@margem/contratos';
import { comTransacao } from '../db/transacao.js';
import { ehNota } from '../flashcards/agenda.js';
import { capitulosEmCurso, FlashcardsEmCurso, pedirFlashcards } from '../flashcards/manipuladores.js';
import * as repo from '../flashcards/repo.js';
import { DadoRecusado } from '../repos/anotacoes.js';
import { ErroDaApi } from './erros.js';

export interface ApoioDosFlashcards {
  banco: pg.Pool;
  corpoJson: (c: { req: { raw: Request } }) => Promise<unknown>;
  exigirUlid: (valor: string, papel: string) => Id;
}

type Corpo = Record<string, unknown>;
function objeto(bruto: unknown, permitidas: readonly string[]): Corpo {
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) throw new ErroDaApi(400, 'corpo_invalido', 'O corpo precisa ser um objeto JSON.');
  const desconhecidas = Object.keys(bruto).filter((chave) => !permitidas.includes(chave));
  if (desconhecidas.length > 0) throw new ErroDaApi(400, 'campo_desconhecido', `Campos desconhecidos: ${desconhecidas.join(', ')}.`);
  return bruto as Corpo;
}

async function comDados<T>(acao: () => Promise<T>): Promise<T> {
  try {
    return await acao();
  } catch (erro) {
    if (erro instanceof DadoRecusado) throw new ErroDaApi(422, erro.codigo, erro.message);
    throw erro;
  }
}

function ehAncora(valor: unknown): valor is AncoraV1 {
  const a = valor as Partial<AncoraV1> | null;
  return typeof a === 'object' && a !== null && typeof a.versao_id === 'string' && typeof a.bloco_id === 'string'
    && Number.isSafeInteger(a.inicio_utf16) && Number.isSafeInteger(a.fim_utf16)
    && typeof a.citacao === 'string' && typeof a.prefixo === 'string' && typeof a.sufixo === 'string';
}

export function registrarRotasDosFlashcards(api: Hono, { banco, corpoJson, exigirUlid }: ApoioDosFlashcards): void {
  const documentoDo = (c: Context): Id | undefined => {
    const documento = c.req.query('documento');
    return documento ? exigirUlid(documento, 'documento') : undefined;
  };

  api.post('/api/versoes/:versao/capitulos/:secao/flashcards', async (c) => {
    const versaoId = exigirUlid(c.req.param('versao'), 'versão');
    const secaoId = exigirUlid(c.req.param('secao'), 'capítulo');
    try {
      const job = await comTransacao(banco, async (cliente) => {
        const secao = await cliente.query('SELECT 1 FROM secao WHERE versao_id=$1 AND id=$2', [versaoId, secaoId]);
        if (!secao.rowCount) throw new ErroDaApi(404, 'capitulo_inexistente', 'Capítulo inexistente nesta versão.');
        return pedirFlashcards(cliente, { versaoId, secaoId });
      });
      return c.json({ job_id: job.id, estado: 'pendente' }, 202);
    } catch (erro) {
      if (erro instanceof FlashcardsEmCurso) throw new ErroDaApi(409, 'flashcards_em_curso', erro.message);
      throw erro;
    }
  });

  api.get('/api/flashcards', async (c) => {
    const documento = documentoDo(c);
    const fila = c.req.query('fila');
    if (fila !== undefined && fila !== 'hoje') throw new ErroDaApi(400, 'fila_invalida', 'Use fila=hoje.');
    return c.json(await comTransacao(banco, async (cliente) => ({
      cartoes: await repo.listarCartoes(cliente, { ...(documento ? { documento_id: documento } : {}), hoje: fila === 'hoje' }),
      em_curso: await capitulosEmCurso(cliente, documento ?? null),
    })));
  });

  api.get('/api/flashcards/exportacao.csv', async (c) => {
    const documento = documentoDo(c);
    const cartoes = await comTransacao(banco, (cliente) => repo.listarCartoes(cliente, documento ? { documento_id: documento } : {}));
    const dia = new Date().toISOString().slice(0, 10);
    const nome = documento && cartoes[0] ? `margem-flashcards-${repo.etiquetaDoAnki(cartoes[0].documento.titulo)}-${dia}.csv` : `margem-flashcards-${dia}.csv`;
    c.header('Content-Disposition', `attachment; filename="${nome}"`);
    c.header('Cache-Control', 'no-store');
    return c.body(repo.cartoesEmCsv(cartoes), 200, { 'Content-Type': 'text/csv; charset=utf-8' });
  });

  api.post('/api/flashcards', async (c) => {
    const corpo = objeto(await corpoJson(c), ['ancora', 'frente', 'verso']);
    if (!ehAncora(corpo.ancora)) throw new ErroDaApi(422, 'ancora_invalida', 'A âncora do cartão não é válida.');
    const ancora = corpo.ancora;
    exigirUlid(ancora.versao_id, 'versão'); exigirUlid(ancora.bloco_id, 'bloco');
    const cartao = await comDados(() => comTransacao(banco, async (cliente) => {
      const id = await repo.criarCartao(cliente, { ancora, frente: corpo.frente, verso: corpo.verso, origem: 'manual' });
      return repo.obterCartao(cliente, id);
    }));
    return c.json({ cartao }, 201);
  });

  api.patch('/api/flashcards/:id', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'cartão');
    const corpo = objeto(await corpoJson(c), ['frente', 'verso']);
    const cartao = await comDados(() => comTransacao(banco, async (cliente) => {
      if (!await repo.atualizarCartao(cliente, id, corpo)) return null;
      return repo.obterCartao(cliente, id);
    }));
    if (!cartao) throw new ErroDaApi(404, 'cartao_inexistente', 'Cartão inexistente.');
    return c.json({ cartao });
  });

  api.delete('/api/flashcards/:id', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'cartão');
    if (!await comTransacao(banco, (cliente) => repo.apagarCartao(cliente, id))) throw new ErroDaApi(404, 'cartao_inexistente', 'Cartão inexistente.');
    return c.body(null, 204);
  });

  api.post('/api/flashcards/:id/revisoes', async (c) => {
    const id = exigirUlid(c.req.param('id'), 'cartão');
    const corpo = objeto(await corpoJson(c), ['nota']);
    if (!ehNota(corpo.nota)) throw new ErroDaApi(400, 'nota_invalida', 'A nota é 1 (Errei), 2 (Difícil), 3 (Bom) ou 4 (Fácil).');
    const nota = corpo.nota;
    const agenda = await comTransacao(banco, (cliente) => repo.revisarCartao(cliente, id, nota));
    if (!agenda) throw new ErroDaApi(404, 'cartao_inexistente', 'Cartão inexistente.');
    return c.json({ agenda }, 201);
  });
}
