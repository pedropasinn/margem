/**
 * J101: migração 0025 (`pedro` → `leitor`) sobre um banco com dados semeados como o da produção até a 0024:
 * conversa com pergunta e resposta, conexão do leitor, lote de revisão, camada de grifos com marca,
 * sessão de resolução `ResolucaoV1` em `dados` e conversa do agente. Nada se perde, nada fica com
 * `pedro`, os repositórios leem tudo como V2 e as constraints novas recusam o valor antigo.
 */
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { ulid } from 'ulid';
import { expect, test } from 'vitest';
import {
  validarCanonico, validarConexaoV2, validarConversaV2, validarExecucaoLeitura, validarResolucaoV2,
} from '@margem/contratos';
import { comBancoDeTeste } from './conexao.js';
import { migracoesPendentes, migrar } from './migrar.js';
import { comTransacao } from './transacao.js';
import * as documentos from '../repos/documentos.js';
import * as execucoes from '../repos/execucoes.js';
import * as camadas from '../repos/camadas.js';
import * as conexoes from '../repos/conexoes.js';
import * as conversas from '../repos/conversas.js';
import * as resolucoes from '../repos/resolucoes.js';
import * as agente from '../agente/repo.js';

const ler = (caminho: string): unknown => JSON.parse(readFileSync(new URL(`../../../contratos/casos/${caminho}.json`, import.meta.url), 'utf8')) as unknown;
function caso<T>(nome: string, validar: (entrada: unknown) => entrada is T): T {
  const entrada = ler(`${nome}/valido-minimo`);
  if (!validar(entrada)) throw new Error(`Caso inválido: ${nome}`);
  return entrada;
}
const ULTIMA_ANTES = '0024_noticia_capa.sql';
const SNAPSHOT = 'a'.repeat(64);

async function semear(banco: pg.Pool) {
  const canonico = caso('Canonico', validarCanonico);
  const base = await comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/unicode.md' });
    const versao = await documentos.criarVersao(cliente, documento.id, canonico);
    const execucao = { ...caso('ExecucaoLeitura', validarExecucaoLeitura), id: ulid(), versao_id: versao.id, plano_partes: [ulid()] };
    await execucoes.criar(cliente, execucao);
    return { documento, versao, execucao };
  });
  const v = base.versao.id;
  const bloco = canonico.blocos[0]!;
  // "Um 🧭, café e ﬁ.": café em [7,11).
  const ancora = [v, bloco.id, 7, 11, 'café', 'Um 🧭, ', ' e ﬁ.'];
  const ids = { conversa: ulid(), pergunta: ulid(), resposta: ulid(), conexao: ulid(), lote: ulid(), camada: ulid(),
    marca: ulid(), resolucao: ulid(), agenteConversa: ulid(), agentePergunta: ulid(), agenteResposta: ulid() };
  await comTransacao(banco, async (c) => {
    await c.query(`INSERT INTO conversa (id,versao_id,bloco_id,inicio_utf16,fim_utf16,citacao,prefixo,sufixo,criada_em)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'2026-09-24T12:00:00Z')`, [ids.conversa, ...ancora]);
    await c.query(`INSERT INTO mensagem (id,conversa_id,ordem,autor,texto,criada_em)
      VALUES ($1,$2,0,'pedro','Por que café?','2026-09-24T12:00:00Z')`, [ids.pergunta, ids.conversa]);
    await c.query(`INSERT INTO mensagem (id,conversa_id,ordem,autor,texto,citacoes,em_resposta_a,criada_em)
      VALUES ($1,$2,1,'ia','Porque sim.','[]'::jsonb,$3,'2026-09-24T12:01:00Z')`, [ids.resposta, ids.conversa, ids.pergunta]);
    await c.query(`INSERT INTO conexao (id,versao_id,bloco_id,inicio_utf16,fim_utf16,citacao,prefixo,sufixo,
        destino_tipo,destino_documento_id,relacao,justificativa,autor,estado,criada_em,decidida_em)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'documento',$9,'semelhanca','Liga os dois.','pedro','aceita',
        '2026-09-24T12:02:00Z','2026-09-24T12:02:00Z')`, [ids.conexao, ...ancora, base.documento.id]);
    await c.query(`INSERT INTO lote_revisao (id,execucao_id,versao_id,snapshot_base,autor,motivo,operacoes)
      VALUES ($1,$2,$3,$4,'pedro','Ajuste do leitor.','[]'::jsonb)`, [ids.lote, base.execucao.id, v, SNAPSHOT]);
    await c.query(`INSERT INTO lote_revisao (id,execucao_id,versao_id,snapshot_base,autor,motivo,operacoes)
      VALUES ($1,$2,$3,$4,'codex','Revisão do Codex.','[]'::jsonb)`, [ulid(), base.execucao.id, v, SNAPSHOT]);
    await c.query(`INSERT INTO camada (id,versao_id,tipo,execucao_id,modo_id,modo_revisao,criada_em)
      VALUES ($1,$2,'pedro',NULL,'argumentativa',1,'2026-09-24T12:03:00Z')`, [ids.camada, v]);
    const resolucao = ler('Resolucao/valido-com-perguntas') as Record<string, unknown>;
    Object.assign(resolucao, { id: ids.resolucao, documento_id: base.documento.id, versao_id: v });
    await c.query('INSERT INTO resolucao (id,documento_id,versao_id,dados) VALUES ($1,$2,$3,$4)',
      [ids.resolucao, base.documento.id, v, JSON.stringify(resolucao)]);
    await c.query(`INSERT INTO agente_conversa (id,titulo) VALUES ($1,'Mapa')`, [ids.agenteConversa]);
    await c.query(`INSERT INTO agente_mensagem (id,conversa_id,autor,texto,criada_em) VALUES ($1,$2,'pedro','Faça um mapa','2026-09-24T12:04:00Z')`,
      [ids.agentePergunta, ids.agenteConversa]);
    await c.query(`INSERT INTO agente_mensagem (id,conversa_id,autor,texto,em_resposta_a,criada_em) VALUES ($1,$2,'agente','Pronto.',$3,'2026-09-24T12:05:00Z')`,
      [ids.agenteResposta, ids.agenteConversa, ids.agentePergunta]);
  });
  return { ...base, ids, resolucaoAntes: ler('Resolucao/valido-com-perguntas') as Record<string, unknown> };
}

const contar = async (banco: pg.Pool, sql: string): Promise<number> => (await banco.query<{ n: number }>(sql)).rows[0]!.n;

test('0025 converte pedro em leitor, preserva os dados e recusa o valor antigo', async () => comBancoDeTeste('migracao_leitor', async (banco) => {
  await migrar(banco, { ate: ULTIMA_ANTES });
  // A 0025 é a primeira pendente; as seguintes (0026, 0028…) vêm de outros jobs.
  expect((await migracoesPendentes(banco))[0]).toBe('0025_leitor.sql');
  const { versao, documento, ids, resolucaoAntes } = await semear(banco);
  const totais = async () => Promise.all(['mensagem', 'conexao', 'lote_revisao', 'camada', 'resolucao', 'agente_mensagem']
    .map((tabela) => contar(banco, `SELECT count(*)::int AS n FROM ${tabela}`)));
  const antes = await totais();

  await migrar(banco);
  expect(await migracoesPendentes(banco)).toEqual([]);
  expect(await totais()).toEqual(antes);

  // Nenhuma coluna de autoria ou tipo de camada com 'pedro'.
  expect(await contar(banco, `SELECT (
    (SELECT count(*) FROM mensagem WHERE autor='pedro') + (SELECT count(*) FROM conexao WHERE autor='pedro')
    + (SELECT count(*) FROM lote_revisao WHERE autor='pedro') + (SELECT count(*) FROM camada WHERE tipo='pedro')
    + (SELECT count(*) FROM agente_mensagem WHERE autor='pedro'))::int AS n`)).toBe(0);
  expect((await banco.query<{ autor: string }>('SELECT autor FROM lote_revisao ORDER BY autor')).rows.map((l) => l.autor)).toEqual(['codex', 'leitor']);

  await comTransacao(banco, async (c) => {
    const conversa = await conversas.obter(c, ids.conversa);
    expect(validarConversaV2(conversa), JSON.stringify(validarConversaV2.errors)).toBe(true);
    expect(conversa?.mensagens.map((m) => [m.id, m.autor, m.texto])).toEqual([[ids.pergunta, 'leitor', 'Por que café?'], [ids.resposta, 'ia', 'Porque sim.']]);

    const conexao = await conexoes.obter(c, ids.conexao);
    expect(validarConexaoV2(conexao), JSON.stringify(validarConexaoV2.errors)).toBe(true);
    expect(conexao).toMatchObject({ versao: 2, autor: 'leitor', estado: 'aceita', destino: { tipo: 'documento', documento_id: documento.id } });

    // A sessão de resolução virou ResolucaoV2: só `versao` e o autor das perguntas mudaram.
    const sessao = await resolucoes.obter(c, ids.resolucao);
    expect(validarResolucaoV2(sessao), JSON.stringify(validarResolucaoV2.errors)).toBe(true);
    const mensagensAntes = resolucaoAntes.mensagens as { autor: string }[];
    expect(sessao?.mensagens).toEqual(mensagensAntes.map((m) => ({ ...m, autor: m.autor === 'pedro' ? 'leitor' : m.autor })));
    expect({ ...sessao, versao: 1, mensagens: mensagensAntes })
      .toEqual({ ...resolucaoAntes, id: ids.resolucao, documento_id: documento.id, versao_id: versao.id });

    // A camada de grifos é a mesma (o índice único novo a encontra), e não entra nas de leitura.
    const camada = await camadas.camadaDoLeitor(c, versao.id, { id: 'argumentativa', revisao: 1 });
    expect(camada).toMatchObject({ id: ids.camada, tipo: 'leitor' });
    expect((await camadas.listarDeLeitura(c, versao.id)).map((x) => x.id)).not.toContain(ids.camada);

    const fio = await agente.mensagens(c, ids.agenteConversa);
    expect(fio.map((m) => m.autor)).toEqual(['leitor', 'agente']);
  });

  // As constraints novas recusam o valor antigo, e o índice único vale para `leitor`.
  await expect(banco.query(`UPDATE mensagem SET autor='pedro' WHERE id=$1`, [ids.pergunta])).rejects.toThrow(/mensagem_autor_check/);
  await expect(banco.query(`UPDATE conexao SET autor='pedro' WHERE id=$1`, [ids.conexao])).rejects.toThrow(/conexao_autor_check/);
  await expect(banco.query(`UPDATE lote_revisao SET autor='pedro' WHERE id=$1`, [ids.lote])).rejects.toThrow(/lote_revisao_autor_check/);
  await expect(banco.query(`UPDATE camada SET tipo='pedro' WHERE id=$1`, [ids.camada])).rejects.toThrow(/camada_(tipo_check|check1)/);
  await expect(banco.query(`UPDATE agente_mensagem SET autor='pedro' WHERE id=$1`, [ids.agentePergunta])).rejects.toThrow(/agente_mensagem_autor_check/);
  await expect(banco.query(`INSERT INTO camada (id,versao_id,tipo,execucao_id,modo_id,modo_revisao,criada_em)
    VALUES ($1,$2,'leitor',NULL,'argumentativa',1,now())`, [ulid(), versao.id])).rejects.toThrow(/camada_do_leitor/);

  // Migrar de novo não muda nada.
  await migrar(banco);
  expect(await totais()).toEqual(antes);
}));

test('0025 desfaz tudo se uma sessão de resolução não puder virar V2', async () => comBancoDeTeste('migracao_leitor_rb', async (banco) => {
  await migrar(banco, { ate: ULTIMA_ANTES });
  const { ids } = await semear(banco);
  // Uma sessão com `versao` desconhecida não é convertida; a conferência final aborta a transação.
  await banco.query(`UPDATE resolucao SET dados = jsonb_set(dados, '{versao}', '7'::jsonb) WHERE id=$1`, [ids.resolucao]);
  await expect(migrar(banco)).rejects.toThrow(/ResolucaoV2/);
  expect((await migracoesPendentes(banco))[0]).toBe('0025_leitor.sql');
  expect(await contar(banco, `SELECT count(*)::int AS n FROM mensagem WHERE autor='pedro'`)).toBe(1);
  expect(await contar(banco, `SELECT count(*)::int AS n FROM camada WHERE tipo='pedro'`)).toBe(1);
}));
