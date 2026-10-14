/**
 * J138 (V-G1): migração 0032 (modelo D dos grifos) sobre um banco até a 0031, com o que o leitor tinha:
 * - um grifo com duas anotações (impressão e fonte): viram uma nota só, em ordem, com o tipo como rótulo;
 * - uma anotação solta sobre um trecho sem grifo: ganha um grifo sem função ("nenhuma") e vira a nota dele;
 * - uma anotação solta que cruza o grifo: é juntada à nota dele;
 * - etiquetas "?" de dificuldade: viram sinais de dificuldade do leitor; as etiquetas continuam no banco.
 * Nada é apagado: as anotações juntadas ficam marcadas, com o texto original na própria linha.
 */
import { ulid } from 'ulid';
import { expect, test } from 'vitest';
import { MODO_F1, notaDoGrifoDaAnotacao, validarDificuldade, validarNotaDoGrifo, validarMarcaV2 } from '@margem/contratos';
import { canonicoDeTeste } from '../../testes/apoio.js';
import { comBancoDeTeste } from './conexao.js';
import { migracoesPendentes, migrar } from './migrar.js';
import { comTransacao } from './transacao.js';
import * as documentos from '../repos/documentos.js';
import * as marcas from '../repos/marcas.js';
import * as anotacoes from '../repos/anotacoes.js';
import * as dificuldades from '../repos/dificuldades.js';

const doComentarioId = (anotacao: { id: string } | null): string => anotacao?.id ?? '';

test('0032 junta as notas do grifo, dá grifo às soltas e transforma as etiquetas de dificuldade em sinais, sem apagar', async () => comBancoDeTeste('migracao_modelo_d', async (banco) => {
  await migrar(banco, { ate: '0031_tipo_de_texto.sql' });
  expect((await migracoesPendentes(banco))[0]).toBe('0032_modelo_d_grifos.sql');
  const canonico = canonicoDeTeste({
    blocos: [{ tipo: 'capitulo', texto: 'Capítulo' }, { tipo: 'paragrafo', texto: 'Um café forte e uma tese clara.' }],
    secoes: [{ nivel: 1, inicio: 0, fim: 1 }],
  });
  const bloco = canonico.blocos[1]!;
  const trecho = (citacao: string) => {
    const inicio = bloco.texto.indexOf(citacao);
    return { inicio, fim: inicio + citacao.length, citacao, prefixo: bloco.texto.slice(0, inicio), sufixo: bloco.texto.slice(inicio + citacao.length) };
  };
  const { versao, grifo } = await comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'teste.md' });
    const versao = await documentos.criarVersao(cliente, documento.id, canonico);
    const t = trecho('café forte');
    const grifo = await marcas.criarGrifo(cliente, {
      id: ulid(), funcao: 'tese', modo: MODO_F1, criada_em: '2026-10-01T10:00:00.000Z',
      ancora: { versao_id: versao.id, bloco_id: bloco.id, inicio_utf16: t.inicio, fim_utf16: t.fim, citacao: t.citacao, prefixo: t.prefixo, sufixo: t.sufixo },
    });
    return { versao, grifo };
  });
  // Um segundo grifo do leitor com a nota antiga no comentário (J37).
  const comComentario = await comTransacao(banco, async (cliente) => {
    const t = trecho('Um');
    const g = await marcas.criarGrifo(cliente, { id: ulid(), funcao: 'nenhuma', modo: MODO_F1, criada_em: '2026-10-01T09:00:00.000Z',
      ancora: { versao_id: versao.id, bloco_id: bloco.id, inicio_utf16: t.inicio, fim_utf16: t.fim, citacao: t.citacao, prefixo: t.prefixo, sufixo: t.sufixo } });
    await marcas.editarComentario(cliente, g.id, 'Começo seco.');
    return g;
  });
  const ids = { primeira: ulid(), fonte: ulid(), solta: ulid(), cruza: ulid(), etiqueta: ulid(), livre: ulid() };
  const inserir = async (id: string, citacao: string, tipo: string, texto: string, marca: string | null, quando: string, fonte: unknown = null) => {
    const t = trecho(citacao);
    await banco.query(`INSERT INTO anotacao (id,versao_id,bloco_id,inicio_utf16,fim_utf16,citacao,prefixo,sufixo,tipo,texto,fonte,marca_id,criada_em,atualizada_em)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
    [id, versao.id, bloco.id, t.inicio, t.fim, t.citacao, t.prefixo, t.sufixo, tipo, texto, fonte === null ? null : JSON.stringify(fonte), marca, quando]);
  };
  await inserir(ids.primeira, 'café forte', 'impressao', 'Parece pouco.', grifo.id, '2026-10-01T10:01:00Z');
  await inserir(ids.fonte, 'café forte', 'fonte', 'Ver o capítulo 2.', grifo.id, '2026-10-01T10:02:00Z', { titulo: 'Livro', pagina: '3' });
  await inserir(ids.solta, 'tese clara', 'hipotese', 'A tese vem do fim.', null, '2026-10-01T10:03:00Z');
  await inserir(ids.cruza, 'forte e uma', 'duvida', 'Forte como?', null, '2026-10-01T10:04:00Z');
  await banco.query(`INSERT INTO etiqueta (id,versao_id,marca_id,nome,criada_em) VALUES ($1,$2,$3,'ambiguidade','2026-10-01T10:05:00Z'),($4,$2,$3,'minha','2026-10-01T10:05:00Z')`,
    [ids.etiqueta, versao.id, grifo.id, ids.livre]);
  const contar = async (tabela: string) => (await banco.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${tabela}`)).rows[0]!.n;
  expect(await contar('anotacao')).toBe(4);

  await migrar(banco);
  expect(await migracoesPendentes(banco)).toEqual([]);
  // Nada sai: as 4 anotações e as 2 etiquetas continuam; nasce um grifo (o da anotação solta) e um sinal.
  expect(await contar('anotacao')).toBe(5);
  expect(await contar('etiqueta')).toBe(2);
  // A nota que estava no comentário do grifo virou a nota dele; o comentário ficou guardado.
  const doComentario = (await banco.query<{ texto: string; modelo_d: string; comentario: unknown; antes: { texto: string } }>(`SELECT a.texto, a.modelo_d, m.comentario,
    m.comentario_antes_do_modelo_d AS antes FROM anotacao a JOIN marca m ON m.id=a.marca_id WHERE m.id=$1`, [comComentario.id])).rows;
  expect(doComentario).toEqual([{ texto: 'Começo seco.', modelo_d: 'nota_do_grifo', comentario: null, antes: expect.objectContaining({ texto: 'Começo seco.' }) as unknown }]);
  expect(await contar('dificuldade')).toBe(1);

  const linhas = new Map((await banco.query<{ id: string; texto: string; marca_id: string | null; fundida_em: string | null; modelo_d: string; texto_antes_do_modelo_d: string | null }>(
    'SELECT id, texto, marca_id, fundida_em, modelo_d, texto_antes_do_modelo_d FROM anotacao')).rows.map((linha) => [linha.id, linha]));
  expect(linhas.get(ids.primeira)).toMatchObject({
    marca_id: grifo.id, fundida_em: null, modelo_d: 'juntou_notas', texto_antes_do_modelo_d: 'Parece pouco.',
    texto: 'Impressão: Parece pouco.\n\n—\n\nFonte: Ver o capítulo 2.\nFonte: Livro, p. 3\n\n—\n\nDúvida: Forte como?',
  });
  expect(linhas.get(ids.fonte)).toMatchObject({ fundida_em: ids.primeira, modelo_d: 'fundida', texto: 'Ver o capítulo 2.' });
  expect(linhas.get(ids.cruza)).toMatchObject({ fundida_em: ids.primeira, modelo_d: 'fundida', marca_id: grifo.id, texto: 'Forte como?' });
  const solta = linhas.get(ids.solta)!;
  expect(solta).toMatchObject({ modelo_d: 'grifo_criado', fundida_em: null, texto: 'A tese vem do fim.' });

  await comTransacao(banco, async (cliente) => {
    // O grifo novo é do leitor, sem função, no trecho da anotação, e vale o contrato.
    const doLeitor = await marcas.listarDoLeitor(cliente, versao.id);
    const novo = doLeitor.find((marca) => marca.id === solta.marca_id)!;
    expect(validarMarcaV2(novo)).toBe(true);
    expect(novo).toMatchObject({ origem: 'manual', funcao: 'nenhuma', ancora: { citacao: 'tese clara' }, modo: MODO_F1 });
    // Cada grifo tem uma nota só, lida como NotaDoGrifoV1; as juntadas saem das listas.
    for (const marcaId of [grifo.id, novo.id, comComentario.id]) {
      const nota = notaDoGrifoDaAnotacao((await anotacoes.notaDoGrifo(cliente, marcaId))!);
      expect(validarNotaDoGrifo(nota), JSON.stringify(validarNotaDoGrifo.errors)).toBe(true);
    }
    expect((await anotacoes.listarNosBlocos(cliente, versao.id, [bloco.id])).map((a) => a.id).sort()).toEqual([ids.primeira, ids.solta, doComentarioId(await anotacoes.notaDoGrifo(cliente, comComentario.id))].sort());
    // A etiqueta de dificuldade virou o sinal do leitor, confirmado, no trecho do grifo.
    const [sinal] = await dificuldades.listarNosBlocos(cliente, versao.id, [bloco.id]);
    expect(validarDificuldade(sinal), JSON.stringify(validarDificuldade.errors)).toBe(true);
    expect(sinal).toMatchObject({ origem: 'leitor', estado: 'confirmada', tipo: 'ambiguidade', marca_id: grifo.id, ancora: { citacao: 'café forte' } });
  });
  // Uma nota por grifo daqui em diante.
  await expect(banco.query(`INSERT INTO anotacao (id,versao_id,bloco_id,inicio_utf16,fim_utf16,citacao,prefixo,sufixo,tipo,texto,marca_id,criada_em,atualizada_em)
    SELECT $1,versao_id,bloco_id,inicio_utf16,fim_utf16,citacao,prefixo,sufixo,'nota','Outra.',marca_id,criada_em,atualizada_em FROM anotacao WHERE id=$2`,
  [ulid(), ids.primeira])).rejects.toThrow(/anotacao_uma_por_grifo/);
}));
