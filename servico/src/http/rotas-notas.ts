/**
 * Notas do livro e da biblioteca (modelo D): um item por grifo, com a nota do leitor e o comentário do Codex,
 * mais as notas antigas soltas.
 *
 *   GET /api/notas                  { itens }   filtros: documento, mostrar (com_nota|grifos), funcao, modo, texto
 *   GET /api/notas/exportacao.csv   o mesmo recorte, para baixar
 *   GET /api/notas/exportacao.json  idem, em JSON
 *   GET /api/notas/central          a central (J145): tudo de todos os documentos (grifos, notas, comentários do
 *                                   Codex, relações, dificuldades, resoluções, flashcards, perguntas, visuais),
 *                                   paginada; filtros documento, tipo, autoria, funcao, modo, texto, desde, ate,
 *                                   ordem (recentes|antigos|documento), limite, deslocamento; facetas=1 traz as contagens
 */
import type { Context, Hono } from 'hono';
import type pg from 'pg';
import type { Id } from '@margem/contratos';
import { comTransacao } from '../db/transacao.js';
import { listarNotas, notasEmCsv, RECORTES_DE_NOTAS, type FiltroDeNotas, type RecorteDeNotas } from '../notas/listar.js';
import { FILTROS_DE_TIPO, ORDENS_DA_CENTRAL, listarCentral, type FiltroDaCentral, type FiltroDeTipo, type OrdemDaCentral } from '../notas/central.js';
import { ErroDaApi } from './erros.js';

export interface ApoioDasNotas { banco: pg.Pool; exigirUlid: (valor: string, papel: string) => Id }

export function registrarRotasDasNotas(api: Hono, { banco, exigirUlid }: ApoioDasNotas): void {
  function filtro(c: Context): FiltroDeNotas {
    const documento = c.req.query('documento');
    const mostrar = c.req.query('mostrar');
    const funcao = c.req.query('funcao');
    const modo = c.req.query('modo');
    const texto = c.req.query('texto')?.trim();
    if (mostrar !== undefined && !RECORTES_DE_NOTAS.includes(mostrar as RecorteDeNotas)) throw new ErroDaApi(400, 'recorte_invalido', 'Use com_nota ou grifos.');
    if (funcao !== undefined && !/^[a-z][a-z0-9_]{0,59}$/.test(funcao)) throw new ErroDaApi(400, 'funcao_invalida', 'Função inválida.');
    if (modo !== undefined && !/^[a-z][a-z0-9_-]{0,59}$/.test(modo)) throw new ErroDaApi(400, 'modo_invalido', 'Modo inválido.');
    if (texto !== undefined && texto.length > 200) throw new ErroDaApi(400, 'texto_longo_demais', 'Procure por até 200 caracteres.');
    return {
      ...(documento ? { documento_id: exigirUlid(documento, 'documento') } : {}),
      ...(mostrar ? { mostrar: mostrar as RecorteDeNotas } : {}),
      ...(funcao ? { funcao } : {}),
      ...(modo ? { modo } : {}),
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

  function data(valor: string | undefined, nome: string): string | undefined {
    if (valor === undefined || valor === '') return undefined;
    if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/.test(valor) || Number.isNaN(Date.parse(valor))) throw new ErroDaApi(400, 'data_invalida', `Data inválida em ${nome}.`);
    return valor;
  }
  function inteiro(valor: string | undefined, nome: string): number | undefined {
    if (valor === undefined || valor === '') return undefined;
    if (!/^\d{1,7}$/.test(valor)) throw new ErroDaApi(400, 'numero_invalido', `Número inválido em ${nome}.`);
    return Number(valor);
  }
  api.get('/api/notas/central', async (c) => {
    const q = (nome: string) => { const valor = c.req.query(nome)?.trim(); return valor === '' ? undefined : valor; };
    const documento = q('documento');
    const tipo = q('tipo');
    const autoria = q('autoria');
    const funcao = q('funcao');
    const modo = q('modo');
    const texto = q('texto');
    const ordem = q('ordem');
    if (tipo !== undefined && !FILTROS_DE_TIPO.includes(tipo as FiltroDeTipo)) throw new ErroDaApi(400, 'tipo_invalido', 'Tipo inválido.');
    if (autoria !== undefined && autoria !== 'leitor' && autoria !== 'codex') throw new ErroDaApi(400, 'autoria_invalida', 'Use leitor ou codex.');
    if (funcao !== undefined && !/^[a-z][a-z0-9_]{0,59}$/.test(funcao)) throw new ErroDaApi(400, 'funcao_invalida', 'Função inválida.');
    if (modo !== undefined && !/^[a-z][a-z0-9_-]{0,59}$/.test(modo)) throw new ErroDaApi(400, 'modo_invalido', 'Modo inválido.');
    if (texto !== undefined && texto.length > 200) throw new ErroDaApi(400, 'texto_longo_demais', 'Procure por até 200 caracteres.');
    if (ordem !== undefined && !ORDENS_DA_CENTRAL.includes(ordem as OrdemDaCentral)) throw new ErroDaApi(400, 'ordem_invalida', 'Use recentes, antigos ou documento.');
    const desde = data(q('desde'), 'desde');
    const ate = data(q('ate'), 'ate');
    const limite = inteiro(q('limite'), 'limite');
    const deslocamento = inteiro(q('deslocamento'), 'deslocamento');
    const escolha: FiltroDaCentral = {
      ...(documento ? { documento_id: exigirUlid(documento, 'documento') } : {}),
      ...(tipo ? { tipo: tipo as FiltroDeTipo } : {}), ...(autoria ? { autoria: autoria } : {}),
      ...(funcao ? { funcao } : {}), ...(modo ? { modo } : {}), ...(texto ? { texto } : {}),
      ...(desde ? { desde } : {}), ...(ate ? { ate } : {}), ...(ordem ? { ordem: ordem as OrdemDaCentral } : {}),
      ...(limite === undefined ? {} : { limite }), ...(deslocamento === undefined ? {} : { deslocamento }),
    };
    const pagina = await comTransacao(banco, (cliente) => listarCentral(cliente, escolha, { facetas: q('facetas') === '1' }));
    c.header('Cache-Control', 'no-store');
    return c.json(pagina);
  });

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
    return c.json({ versao: 2, exportado_em: new Date().toISOString(), filtro: escolha, total: itens.length, itens });
  });
}
