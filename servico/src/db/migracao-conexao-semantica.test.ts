/**
 * v0.1: migração 0030 (tipo semântico da conexão) sobre um banco até a 0029, com conexões antigas:
 * uma adotada da compreensão (`relacao_adotada` com `responde`), uma do leitor sem adoção e uma
 * adotada cuja família não bate com o tipo (não deveria existir; fica sem o tipo fino). Nada se
 * perde, o preenchimento vem de `relacao_adotada` e as leituras V3 valem o contrato.
 */
import { readFileSync } from 'node:fs';
import { ulid } from 'ulid';
import { expect, test } from 'vitest';
import { validarCanonico, validarConexaoV3, validarExecucaoLeitura } from '@margem/contratos';
import { comBancoDeTeste } from './conexao.js';
import { migracoesPendentes, migrar } from './migrar.js';
import { comTransacao } from './transacao.js';
import * as documentos from '../repos/documentos.js';
import * as execucoes from '../repos/execucoes.js';
import * as conexoes from '../repos/conexoes.js';

const ler = (caminho: string): unknown => JSON.parse(readFileSync(new URL(`../../../contratos/casos/${caminho}.json`, import.meta.url), 'utf8')) as unknown;
function caso<T>(nome: string, validar: (entrada: unknown) => entrada is T): T {
  const entrada = ler(`${nome}/valido-minimo`);
  if (!validar(entrada)) throw new Error(`Caso inválido: ${nome}`);
  return entrada;
}

test('0030 acrescenta o tipo semântico e o preenche a partir de relacao_adotada', async () => comBancoDeTeste('migracao_relacao', async (banco) => {
  await migrar(banco, { ate: '0029_quadros_da_pessoa.sql' });
  expect((await migracoesPendentes(banco))[0]).toBe('0030_conexao_semantica.sql');
  const canonico = caso('Canonico', validarCanonico);
  const { documento, versao, execucao } = await comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/unicode.md' });
    const versao = await documentos.criarVersao(cliente, documento.id, canonico);
    const execucao = { ...caso('ExecucaoLeitura', validarExecucaoLeitura), id: ulid(), versao_id: versao.id, plano_partes: [ulid()] };
    await execucoes.criar(cliente, execucao);
    return { documento, versao, execucao };
  });
  const bloco = canonico.blocos[0]!;
  const ancora = [versao.id, bloco.id, 7, 11, 'café', 'Um 🧭, ', ' e ﬁ.'];
  const ids = { adotada: ulid(), livre: ulid(), torta: ulid(), modelo: ulid(), relacao: ulid(), relacaoTorta: ulid() };
  await comTransacao(banco, async (c) => {
    await c.query(`INSERT INTO modelo_capitulo (id,execucao_id,secao_id,revisao,estagio,conteudo) VALUES ($1,$2,$3,0,'revisao','{}'::jsonb)`,
      [ids.modelo, execucao.id, ulid()]);
    for (const [id, relacao] of [[ids.adotada, 'tensao'], [ids.livre, 'semelhanca'], [ids.torta, 'semelhanca']] as const) {
      await c.query(`INSERT INTO conexao (id,versao_id,bloco_id,inicio_utf16,fim_utf16,citacao,prefixo,sufixo,
          destino_tipo,destino_documento_id,relacao,justificativa,autor,estado,criada_em,decidida_em)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'documento',$9,$10,'Liga os dois.','leitor','aceita','2026-09-24T12:02:00Z','2026-09-24T12:02:00Z')`,
      [id, ...ancora, documento.id, relacao]);
    }
    await c.query(`INSERT INTO relacao_adotada (relacao_id,modelo_id,conexao_id,tipo_original) VALUES ($1,$2,$3,'responde'),($4,$2,$5,'responde')`,
      [ids.relacao, ids.modelo, ids.adotada, ids.relacaoTorta, ids.torta]);
  });
  const total = async () => (await banco.query<{ n: number }>('SELECT count(*)::int AS n FROM conexao')).rows[0]!.n;
  expect(await total()).toBe(3);

  await migrar(banco);
  expect(await migracoesPendentes(banco)).toEqual([]);
  expect(await total()).toBe(3);

  await comTransacao(banco, async (c) => {
    const adotada = await conexoes.obterV3(c, ids.adotada);
    expect(validarConexaoV3(adotada), JSON.stringify(validarConexaoV3.errors)).toBe(true);
    expect(adotada).toMatchObject({ versao: 3, relacao: 'tensao', relacao_semantica: 'responde',
      origem_compreensao: { modelo_id: ids.modelo, relacao_id: ids.relacao } });
    for (const id of [ids.livre, ids.torta]) {
      const antiga = await conexoes.obterV3(c, id);
      expect(validarConexaoV3(antiga), JSON.stringify(validarConexaoV3.errors)).toBe(true);
      expect(antiga).not.toHaveProperty('relacao_semantica');
      expect(antiga).not.toHaveProperty('origem_compreensao');
    }
    // A leitura V2 não muda.
    expect(await conexoes.obter(c, ids.adotada)).toMatchObject({ versao: 2, relacao: 'tensao' });
    expect(await conexoes.obter(c, ids.adotada)).not.toHaveProperty('relacao_semantica');
  });
  // O tipo fora dos 9 e a origem sem tipo são recusados pelo banco.
  await expect(banco.query(`UPDATE conexao SET relacao_semantica='refuta' WHERE id=$1`, [ids.livre])).rejects.toThrow(/relacao_semantica/);
  await expect(banco.query(`UPDATE conexao SET relacao_origem_id=$2, relacao_modelo_id=$2 WHERE id=$1`, [ids.livre, ids.modelo]))
    .rejects.toThrow(/conexao_origem_com_semantica/);
}));
