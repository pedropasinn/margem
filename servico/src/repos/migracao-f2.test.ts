/**
 * Migração 0004 sobre um banco com dados de F1 (o que `persistencia.test.ts` monta:
 * documento, versão, execução, parte e marca), mais marcas sem execução e uma segunda
 * versão. Nenhuma marca se perde, a projeção V1 tem o mesmo hash de antes, e aplicar a
 * 0004 de novo não muda nada.
 */
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { ulid } from 'ulid';
import { expect, test } from 'vitest';
import {
  hashMarcas, marcaV2ParaV1, validarCanonico, validarExecucaoLeitura, validarMarca, validarMarcaV2, validarParte,
  type MarcaV1,
} from '@margem/contratos';
import { comBancoDeTeste } from '../db/conexao.js';
import { migrar } from '../db/migrar.js';
import { comTransacao } from '../db/transacao.js';
import * as documentos from './documentos.js';
import * as execucoes from './execucoes.js';
import * as marcas from './marcas.js';
import * as partes from './partes.js';

function caso<T>(nome: string, validar: (entrada: unknown) => entrada is T): T {
  const entrada: unknown = JSON.parse(readFileSync(new URL(`../../../contratos/casos/${nome}/valido-minimo.json`, import.meta.url), 'utf8'));
  if (!validar(entrada)) throw new Error(`Caso inválido: ${nome}`);
  return entrada;
}

/** O INSERT de marca de F1 (0001–0003), sem as colunas da 0004. */
async function inserirMarcaF1(banco: pg.Pool, marca: MarcaV1): Promise<void> {
  const a = marca.ancora;
  await banco.query(`INSERT INTO marca
    (id,versao_id,bloco_id,inicio_utf16,fim_utf16,citacao,prefixo,sufixo,funcao,subfaixas,comentario,
      origem,validade,visivel,avaliacao,execucao_id,job_id,criada_em,criada_em_literal)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::text::timestamptz,$18::text)`,
  [marca.id, a.versao_id, a.bloco_id, a.inicio_utf16, a.fim_utf16, a.citacao, a.prefixo, a.sufixo,
    marca.funcao, JSON.stringify(marca.subfaixas), marca.comentario === null ? null : JSON.stringify(marca.comentario),
    marca.origem, marca.validade, marca.visivel, marca.avaliacao, marca.execucao_id ?? null, marca.job_id ?? null, marca.criada_em]);
}

/** A leitura de F1 (`listarPorVersao` antes da 0004), sem filtro nenhum. */
async function marcasF1(banco: pg.Pool, versaoId: string): Promise<MarcaV1[]> {
  return (await banco.query<{ marca: MarcaV1 }>(`SELECT jsonb_build_object(
    'id',id,'ancora',jsonb_build_object('versao_id',versao_id,'bloco_id',bloco_id,
      'inicio_utf16',inicio_utf16,'fim_utf16',fim_utf16,'citacao',citacao,'prefixo',prefixo,'sufixo',sufixo),
    'funcao',funcao,'subfaixas',subfaixas,'comentario',comentario,'origem',origem,'validade',validade,
    'visivel',visivel,'avaliacao',avaliacao,'criada_em',criada_em_literal)
    || CASE WHEN execucao_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('execucao_id',execucao_id) END
    || CASE WHEN job_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('job_id',job_id) END AS marca
    FROM marca WHERE versao_id=$1 ORDER BY id`, [versaoId])).rows.map((linha) => linha.marca);
}

/** O que `persistencia.test.ts` monta, e mais duas marcas sem execução no mesmo bloco. */
async function dadosDeF1(banco: pg.Pool) {
  const canonico = caso('Canonico', validarCanonico);
  const base = await comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/unicode.md' });
    const versao = await documentos.criarVersao(cliente, documento.id, canonico);
    const execucao = { ...caso('ExecucaoLeitura', validarExecucaoLeitura), id: ulid(), versao_id: versao.id, plano_partes: [ulid()] };
    await execucoes.criar(cliente, execucao);
    const parte = { ...caso('Parte', validarParte), id: execucao.plano_partes[0]!, execucao_id: execucao.id, blocos_responsaveis: [canonico.blocos[0]!.id] };
    await partes.criar(cliente, execucao.id, [parte]);
    return { documento, versao, execucao };
  });
  const daExecucao = caso('Marca', validarMarca);
  daExecucao.id = ulid(); daExecucao.ancora.versao_id = base.versao.id; daExecucao.execucao_id = base.execucao.id;
  daExecucao.criada_em = '2026-09-20T15:00:00.123456-03:00';
  // "Um 🧭, café e ﬁ.": café em [7,11), ﬁ em [14,15). Sem execução: importação e manual.
  const importada: MarcaV1 = {
    id: ulid(), ancora: { versao_id: base.versao.id, bloco_id: daExecucao.ancora.bloco_id, inicio_utf16: 7, fim_utf16: 11,
      citacao: 'café', prefixo: 'Um 🧭, ', sufixo: ' e ﬁ.' },
    funcao: 'tese', subfaixas: [], comentario: { tipo: 'OBJECAO', rotulo: 'OBJEÇÃO', texto: 'Café não é argumento.' },
    origem: 'importacao', validade: 'resolvida', visivel: false, avaliacao: 'confirmada', criada_em: '2026-09-19T10:00:00Z',
  };
  const manual: MarcaV1 = {
    id: ulid(), ancora: { versao_id: base.versao.id, bloco_id: daExecucao.ancora.bloco_id, inicio_utf16: 14, fim_utf16: 15,
      citacao: 'ﬁ', prefixo: 'Um 🧭, café e ', sufixo: '.' },
    funcao: 'nenhuma', subfaixas: [], comentario: null,
    origem: 'manual', validade: 'orfa', visivel: true, avaliacao: 'nao_avaliada', criada_em: '2026-09-21T10:00:00Z',
  };
  for (const marca of [daExecucao, importada, manual]) {
    expect(validarMarca(marca)).toBe(true);
    await inserirMarcaF1(banco, marca);
  }
  return { ...base, marcas: [daExecucao, importada, manual] };
}

async function retrato(banco: pg.Pool, versoes: string[]) {
  const camadas = (await banco.query('SELECT * FROM camada ORDER BY id')).rows;
  const porVersao = await comTransacao(banco, async (cliente) => Promise.all(versoes.map((versao) => marcas.listarV2PorVersao(cliente, versao))));
  return { camadas, porVersao };
}

test('0004 sobre dados de F1: nenhuma marca se perde, a projeção V1 tem o mesmo hash e reaplicar é inofensivo', async () =>
  comBancoDeTeste('migracao_f2', async (banco) => {
    await migrar(banco, { ate: '0003_operacao.sql' });
    const a = await dadosDeF1(banco);
    const b = await dadosDeF1(banco);
    const antes = await Promise.all([a, b].map((dados) => marcasF1(banco, dados.versao.id)));
    const hashesAntes = antes.map((lista) => hashMarcas(lista));
    expect(antes.map((lista) => lista.length)).toEqual([3, 3]);

    await migrar(banco);
    expect((await banco.query<{ nome: string }>('SELECT nome FROM migracao ORDER BY nome')).rows.map((linha) => linha.nome)).toContain('0004_f2.sql');

    for (const [indice, dados] of [a, b].entries()) {
      const v2 = await comTransacao(banco, (cliente) => marcas.listarV2PorVersao(cliente, dados.versao.id));
      expect(v2).toHaveLength(3);
      expect(v2.every((marca) => validarMarcaV2(marca))).toBe(true);
      // Nenhuma perda: a volta para V1 é a lista de antes, e o hash é o mesmo.
      expect(v2.map((marca) => marcaV2ParaV1(marca))).toEqual(antes[indice]);
      expect(hashMarcas(v2.map((marca) => marcaV2ParaV1(marca)))).toBe(hashesAntes[indice]);
      expect(hashMarcas(await comTransacao(banco, (cliente) => marcas.listarPorVersao(cliente, dados.versao.id)))).toBe(hashesAntes[indice]);
      for (const marca of v2) expect(marca).toMatchObject({ saliencia: 2, modo: { id: 'argumentativa', revisao: 1 } });
      // Camada = execução; as sem execução formam um lote de importação por versão.
      const daExecucao = v2.find((marca) => marca.execucao_id === dados.execucao.id);
      expect(daExecucao?.camada_id).toBe(dados.execucao.id);
      const semExecucao = v2.filter((marca) => marca.execucao_id === undefined);
      expect(semExecucao).toHaveLength(2);
      expect(new Set(semExecucao.map((marca) => marca.camada_id)).size).toBe(1);
      const lote = (await banco.query<{ tipo: string; execucao_id: string | null; versao_id: string }>(
        'SELECT tipo, execucao_id, versao_id FROM camada WHERE id=$1', [semExecucao[0]!.camada_id])).rows[0];
      expect(lote).toEqual({ tipo: 'importacao', execucao_id: null, versao_id: dados.versao.id });
      expect(semExecucao[0]!.camada_id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    }
    // Uma camada por execução e um lote por versão; a execução de F1 ganhou modo e nível.
    expect((await banco.query('SELECT count(*)::int AS n FROM camada')).rows[0]).toEqual({ n: 4 });
    expect((await banco.query('SELECT modo_id, modo_revisao, nivel_de_atencao_alvo FROM execucao_leitura WHERE id=$1', [a.execucao.id])).rows[0])
      .toEqual({ modo_id: 'argumentativa', modo_revisao: 1, nivel_de_atencao_alvo: 2 });

    const depois = await retrato(banco, [a.versao.id, b.versao.id]);
    // Reaplicar o SQL (fora do controle da tabela `migracao`) e o migrador: nada muda.
    const sql = readFileSync(new URL('../db/migrations/0004_f2.sql', import.meta.url), 'utf8');
    await comTransacao(banco, async (cliente) => { await cliente.query(sql); });
    await comTransacao(banco, async (cliente) => { await cliente.query(sql); });
    await migrar(banco);
    expect(await retrato(banco, [a.versao.id, b.versao.id])).toEqual(depois);
  }));

test('0004: uma execução nova vira camada; marca com função fora do modo e sobreposição na mesma camada são recusadas', async () =>
  comBancoDeTeste('camadas_f2', async (banco) => {
    await migrar(banco);
    const canonico = caso('Canonico', validarCanonico);
    const { versao, execucoes: [um, dois] } = await comTransacao(banco, async (cliente) => {
      const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'x.md' });
      const criada = await documentos.criarVersao(cliente, documento.id, canonico);
      const lista = [];
      for (let i = 0; i < 2; i += 1) {
        const execucao = { ...caso('ExecucaoLeitura', validarExecucaoLeitura), id: ulid(), versao_id: criada.id, plano_partes: [ulid()] };
        await execucoes.criar(cliente, execucao);
        lista.push(execucao);
      }
      return { versao: criada, execucoes: lista };
    });
    expect((await banco.query('SELECT id, tipo FROM camada ORDER BY id')).rows)
      .toEqual([um!, dois!].map((execucao) => ({ id: execucao.id, tipo: 'execucao' })).sort((x, y) => x.id < y.id ? -1 : 1));
    const marca = caso('Marca', validarMarca);
    marca.id = ulid(); marca.ancora.versao_id = versao.id; marca.execucao_id = um!.id;
    await comTransacao(banco, (cliente) => marcas.publicarMarcas(cliente, versao.id, [marca]));
    // A mesma âncora em outra camada (outra execução) não conflita.
    await comTransacao(banco, (cliente) => marcas.publicarMarcas(cliente, versao.id, [{ ...marca, id: ulid(), execucao_id: dois!.id }]));
    // Na mesma camada, conflita, e o erro diz qual camada.
    await expect(comTransacao(banco, (cliente) => marcas.publicarMarcas(cliente, versao.id, [{ ...marca, id: ulid() }])))
      .rejects.toMatchObject({ camadas: [{ camada_id: um!.id }] });
    // Função que o modo argumentativa@1 não tem.
    const v2 = (await comTransacao(banco, (cliente) => marcas.listarV2PorVersao(cliente, versao.id)))[0]!;
    await expect(comTransacao(banco, (cliente) => marcas.publicarMarcasV2(cliente, versao.id, [{ ...v2, id: ulid(), funcao: 'imagem', camada_id: dois!.id, execucao_id: dois!.id }])))
      .rejects.toThrow('fora do modo');
    // Modo diferente do da execução.
    await expect(comTransacao(banco, (cliente) => marcas.publicarMarcasV2(cliente, versao.id, [{ ...v2, id: ulid(), funcao: 'imagem', modo: { id: 'literaria', revisao: 1 } }])))
      .rejects.toThrow('modo');
    expect((await banco.query('SELECT count(*)::int AS n FROM marca')).rows[0]).toEqual({ n: 2 });
  }));
