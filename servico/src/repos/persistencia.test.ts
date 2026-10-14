import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { ulid } from 'ulid';
import { expect, test } from 'vitest';
import {
  hashEstrutural, hashMarcas, validarCanonico, validarExecucaoLeitura, validarMarca,
  validarParte, type CanonicoV1, type LoteRevisaoV2, type MarcaV1, type ProgressoV1,
} from '@margem/contratos';
import { comBancoDeTeste } from '../db/conexao.js';
import { migrar } from '../db/migrar.js';
import { comTransacao } from '../db/transacao.js';
import * as documentos from './documentos.js';
import * as execucoes from './execucoes.js';
import * as partes from './partes.js';
import * as marcas from './marcas.js';
import * as jobs from './jobs.js';
import * as progresso from './progresso.js';

function caso<T>(nome: string, validar: (entrada: unknown) => entrada is T): T {
  const entrada: unknown = JSON.parse(readFileSync(new URL(`../../../contratos/casos/${nome}/valido-minimo.json`, import.meta.url), 'utf8'));
  if (!validar(entrada)) throw new Error(`Caso inválido: ${nome}`);
  return entrada;
}
async function comBanco(fn: (banco: pg.Pool) => Promise<void>): Promise<void> {
  await comBancoDeTeste('persistencia', async banco => { await migrar(banco); await fn(banco); });
}
async function preparar(banco: pg.Pool, canonico = caso('Canonico', validarCanonico)) {
  return comTransacao(banco, async cliente => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/unicode.md' });
    const versao = await documentos.criarVersao(cliente, documento.id, canonico);
    const execucao = { ...caso('ExecucaoLeitura', validarExecucaoLeitura), id: ulid(), versao_id: versao.id, plano_partes: [ulid()] };
    await execucoes.criar(cliente, execucao);
    const parte = { ...caso('Parte', validarParte), id: execucao.plano_partes[0]!, execucao_id: execucao.id, blocos_responsaveis: [canonico.blocos[0]!.id] };
    await partes.criar(cliente, execucao.id, [parte]);
    const marca = caso('Marca', validarMarca);
    marca.id = ulid(); marca.ancora.versao_id = versao.id; marca.execucao_id = execucao.id;
    return { documento, versao, execucao, parte, marca };
  });
}
async function enfileirar(banco: pg.Pool, entrada: Partial<jobs.EntradaJob> = {}) {
  return comTransacao(banco, cliente => jobs.enfileirar(cliente, {
    tipo: 'ler_parte', dedup_key: ulid(), input_snapshot_hash: 'a'.repeat(64), ...entrada,
  }));
}
async function reservar(banco: pg.Pool) {
  const job = await jobs.reservar(banco, 'teste', ['ler_parte']);
  if (!job?.lease_token) throw new Error('Reserva ausente.');
  return { job, token: job.lease_token };
}
async function quantidade(banco: pg.Pool, tabela: 'marca' | 'lote_revisao' | 'revisao_marca' | 'lote_recusado' | 'versao_texto' | 'bloco' | 'asset' | 'secao'): Promise<number> {
  return (await banco.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${tabela}`)).rows[0]!.n;
}
function lote(marca: MarcaV1, autor: LoteRevisaoV2['autor'] = 'leitor'): LoteRevisaoV2 {
  return { id: ulid(), execucao_id: marca.execucao_id!, snapshot_base: hashMarcas([marca]), autor,
    motivo_do_lote: 'Conferência', operacoes: [{ ordem: 0, marca_id: marca.id, op: 'avaliar',
      antes: { avaliacao: marca.avaliacao }, depois: { avaliacao: 'confirmada' }, motivo: 'Conferido' }] };
}
function posicao(dados: Awaited<ReturnType<typeof preparar>>): ProgressoV1 {
  return { documento_id: dados.documento.id, versao_id: dados.versao.id, ancora: dados.marca.ancora,
    revisao_esperada: 0, capitulos_concluidos: [], atualizado_em: new Date().toISOString() };
}

test('migração em banco vazio, reaplicação e dois migradores concorrentes', async () => {
  await comBancoDeTeste('migracao', async banco => {
    await Promise.all([migrar(banco), migrar(banco)]);
    await migrar(banco);
    // 0001 (J03), 0002 (J07, colunas que faltavam à leitura do J06), 0003 (J14, operação), 0004 (J16, F2),
    // 0005 (J19, poesia), 0006 (J27, prioridade na fila), 0007 (J29, compreensão do capítulo), 0008 (J34, resolução de exercícios), 0009 (J36, etiquetas) 0010 (J37, grifos e notas), 0011 (J64, áudio) e 0012 (J70, visuais).
    expect((await banco.query('SELECT nome FROM migracao ORDER BY nome')).rows)
      .toEqual([{ nome: '0001_persistencia.sql' }, { nome: '0002_leitura.sql' }, { nome: '0003_operacao.sql' }, { nome: '0004_f2.sql' },
        { nome: '0005_poesia.sql' }, { nome: '0006_prioridade.sql' }, { nome: '0007_compreensao.sql' }, { nome: '0008_resolucao.sql' },
        { nome: '0009_etiqueta.sql' }, { nome: '0010_grifos_e_notas.sql' }, { nome: '0011_audio.sql' }, { nome: '0012_visuais.sql' }, { nome: '0013_midia.sql' },
        { nome: '0014_revisao_transcricao.sql' }, { nome: '0015_visita.sql' }, { nome: '0016_leitura_comentada.sql' }, { nome: '0017_anotacao_revisao.sql' },
        { nome: '0018_salas_de_teste.sql' }, { nome: '0019_etiquetas.sql' }, { nome: '0020_flashcards.sql' }, { nome: '0021_agente.sql' }, { nome: '0022_conceitos_do_video.sql' },
        { nome: '0023_noticias.sql' }, { nome: '0024_noticia_capa.sql' }, { nome: '0025_leitor.sql' }, { nome: '0026_primeira_execucao.sql' }, { nome: '0028_video_youtube.sql' },
        { nome: '0029_quadros_da_pessoa.sql' }, { nome: '0030_conexao_semantica.sql' }, { nome: '0031_tipo_de_texto.sql' }, { nome: '0032_modelo_d_grifos.sql' }, { nome: '0033_apagar.sql' },
        { nome: '0034_analise_do_video.sql' }, { nome: '0035_central_de_notas.sql' }]);
    const tabelas = await banco.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    expect(tabelas.rows.map(linha => linha.tablename)).toEqual(expect.arrayContaining([
      'documento','versao_texto','bloco','secao','asset','execucao_leitura','parte','marca','lote_revisao',
      'revisao_marca','job','evento_job','progresso','exportacao','lote_recusado','resolucao','etiqueta',
    ]));
  });
});

test('canônico válido persiste integralmente; hash errado não cria versão', async () => comBanco(async banco => {
  const dados = await preparar(banco);
  expect(dados.versao.canonico).toEqual(caso('Canonico', validarCanonico));
  const errado = { ...dados.versao.canonico, hash_estrutural: '0'.repeat(64) };
  await expect(comTransacao(banco, c => documentos.criarVersao(c, dados.documento.id, errado))).rejects.toThrow('hash');
  expect(await quantidade(banco, 'versao_texto')).toBe(1);
  expect(await quantidade(banco, 'bloco')).toBe(1);
  const listadas = await comTransacao(banco, c => execucoes.listar(c, dados.versao.id));
  expect(listadas[0]).toMatchObject({ id: dados.execucao.id, plano_partes: dados.execucao.plano_partes, tamanho_parte_tokens: 45000 });
  expect(await comTransacao(banco, c => partes.listar(c, dados.execucao.id))).toEqual([dados.parte]);
}));

test('UPDATE e DELETE de versão e blocos são recusados pelo banco', async () => comBanco(async banco => {
  const dados = await preparar(banco);
  for (const sql of [
    'UPDATE versao_texto SET motor=motor WHERE id=$1', 'DELETE FROM versao_texto WHERE id=$1',
    'UPDATE bloco SET texto=texto WHERE versao_id=$1', 'DELETE FROM bloco WHERE versao_id=$1',
  ]) await expect(banco.query(sql, [dados.versao.id])).rejects.toThrow('imutável');
}));

test('versões concorrentes recebem números distintos e a criação sofre rollback integral', async () => comBanco(async banco => {
  const dados = await preparar(banco);
  const criadas = await Promise.all([1,2].map(() => comTransacao(banco, c => documentos.criarVersao(c, dados.documento.id, dados.versao.canonico))));
  expect(criadas.map(v => v.numero).sort()).toEqual([2,3]);
  await expect(comTransacao(banco, async c => {
    await documentos.criarVersao(c, dados.documento.id, dados.versao.canonico);
    throw new Error('Interrupção');
  })).rejects.toThrow('Interrupção');
  expect(await quantidade(banco, 'versao_texto')).toBe(3);
  expect(await quantidade(banco, 'bloco')).toBe(3);
}));

test('seções, assets e busca por idioma são projeções do canônico', async () => comBanco(async banco => {
  for (const [idioma, config] of [['pt-BR','portuguese'], ['en-US','english'], ['ja','simple']]) {
    const canonico: CanonicoV1 = caso('Canonico', validarCanonico);
    canonico.documento.idioma = idioma!;
    const bloco = canonico.blocos[0]!;
    bloco.tipo = 'capitulo'; bloco.asset_id = ulid();
    canonico.secoes = [{ id: ulid(), nivel: 1, titulo: bloco.texto, ordem: 0, bloco_inicio: bloco.id, bloco_fim: bloco.id }];
    canonico.assets = [{ id: bloco.asset_id, tipo: 'pagina', caminho: 'pagina.png', sha256: 'b'.repeat(64), bloco_id: bloco.id }];
    canonico.hash_estrutural = hashEstrutural(canonico.blocos);
    const dados = await preparar(banco, canonico);
    const busca = await banco.query<{ idioma: string; correta: boolean }>(`SELECT idioma_busca::text AS idioma,
      busca=to_tsvector($2::regconfig,texto) AS correta FROM bloco WHERE versao_id=$1`, [dados.versao.id, config]);
    expect(busca.rows[0]).toEqual({ idioma: config, correta: true });
    await expect(banco.query('DELETE FROM secao WHERE versao_id=$1', [dados.versao.id])).rejects.toThrow('imutável');
    await expect(banco.query('DELETE FROM asset WHERE versao_id=$1', [dados.versao.id])).rejects.toThrow('imutável');
  }
  expect(await quantidade(banco, 'secao')).toBe(3);
  expect(await quantidade(banco, 'asset')).toBe(3);
  expect((await banco.query("SELECT indexname FROM pg_indexes WHERE tablename='bloco' AND indexdef LIKE '%USING gin%'")).rowCount).toBe(1);
}));

test('deduplicação concorrente e duas reservas sobre um único job', async () => comBanco(async banco => {
  const dedup_key = ulid();
  const criados = await Promise.all([enfileirar(banco, { dedup_key }), enfileirar(banco, { dedup_key })]);
  expect(criados[0].id).toBe(criados[1].id);
  const reservas = await Promise.all([jobs.reservar(banco, 'um', ['ler_parte']), jobs.reservar(banco, 'dois', ['ler_parte'])]);
  expect(reservas.filter(Boolean)).toHaveLength(1);
  expect(reservas.find(Boolean)).toMatchObject({ estado: 'reservado', attempt: 1 });
  expect((await banco.query("SELECT * FROM evento_job WHERE tipo='enfileirado'")).rowCount).toBe(1);
}));

test('SKIP LOCKED pula o primeiro job enquanto outro client mantém seu lock', async () => comBanco(async banco => {
  const primeiro = await enfileirar(banco);
  const segundo = await enfileirar(banco);
  await comTransacao(banco, async c => {
    await c.query('SELECT id FROM job WHERE id=$1 FOR UPDATE', [primeiro.id]);
    expect((await jobs.reservar(banco, 'outro', ['ler_parte']))?.id).toBe(segundo.id);
  });
}));

test('token inválido/vencido não executa callback nem permite heartbeat ou falha', async () => comBanco(async banco => {
  await enfileirar(banco);
  const { job, token } = await reservar(banco);
  let executou = false;
  await expect(jobs.publicar(banco, job.id, ulid(), () => { executou = true; return Promise.resolve(); })).rejects.toBeInstanceOf(jobs.ConcessaoPerdida);
  await banco.query("UPDATE job SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [job.id]);
  await expect(jobs.publicar(banco, job.id, token, () => { executou = true; return Promise.resolve(); })).rejects.toBeInstanceOf(jobs.ConcessaoPerdida);
  await expect(jobs.heartbeat(banco, job.id, token)).rejects.toBeInstanceOf(jobs.ConcessaoPerdida);
  await expect(jobs.falhar(banco, job.id, token, 'erro', [])).rejects.toBeInstanceOf(jobs.ConcessaoPerdida);
  expect(executou).toBe(false);
}));

test('publicação parcial reverte marcas, estado e evento; repetição da publicação é impedida', async () => comBanco(async banco => {
  const dados = await preparar(banco);
  await enfileirar(banco, { parte_id: dados.parte.id });
  const { job, token } = await reservar(banco);
  dados.marca.job_id = job.id;
  await expect(jobs.publicar(banco, job.id, token, async c => {
    await marcas.publicarMarcas(c, dados.versao.id, [dados.marca]);
    throw new Error('Falha após inserir marca');
  })).rejects.toThrow('Falha após');
  expect(await quantidade(banco, 'marca')).toBe(0);
  expect(await comTransacao(banco, c => jobs.obter(c, job.id))).toMatchObject({ estado: 'reservado', lease_token: token });
  expect((await banco.query("SELECT * FROM evento_job WHERE tipo='publicado'")).rowCount).toBe(0);
  await jobs.publicar(banco, job.id, token, c => marcas.publicarMarcas(c, dados.versao.id, [dados.marca]), 'c'.repeat(64));
  expect(await quantidade(banco, 'marca')).toBe(1);
  expect(await comTransacao(banco, c => jobs.obter(c, job.id))).toMatchObject({ estado: 'ok', lease_token: null, output_artifact_hash: 'c'.repeat(64) });
  await expect(jobs.publicar(banco, job.id, token, async () => {})).rejects.toBeInstanceOf(jobs.ConcessaoPerdida);
  expect((await banco.query("SELECT * FROM evento_job WHERE tipo='publicado'")).rowCount).toBe(1);
}));

test('concessão vencida durante callback reverte suas escritas', async () => comBanco(async banco => {
  const dados = await preparar(banco);
  await enfileirar(banco, { versao_id: dados.versao.id });
  const { job, token } = await reservar(banco);
  await expect(jobs.publicar(banco, job.id, token, async c => {
    await marcas.publicarMarcas(c, dados.versao.id, [dados.marca]);
    await c.query("UPDATE job SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [job.id]);
  })).rejects.toBeInstanceOf(jobs.ConcessaoPerdida);
  expect(await quantidade(banco, 'marca')).toBe(0);
}));

test('heartbeat, expiração, nova tentativa, adiamento e falha terminal', async () => comBanco(async banco => {
  await enfileirar(banco);
  const { job, token } = await reservar(banco);
  await jobs.heartbeat(banco, job.id, token, 120_000);
  expect((await comTransacao(banco, c => jobs.obter(c, job.id)))!.lease_expires_at!.getTime()).toBeGreaterThan(job.lease_expires_at!.getTime());
  expect(await jobs.expirarConcessoes(banco, new Date(Date.now() + 180_000))).toBe(1);
  expect(await jobs.expirarConcessoes(banco, new Date(Date.now() + 180_000))).toBe(0);
  // A tentativa perdida espera 1 minuto antes de voltar (backoff).
  expect(await jobs.reservar(banco, 'teste', ['ler_parte'], new Date(Date.now() + 200_000))).toBeNull();
  const reservado = await jobs.reservar(banco, 'teste', ['ler_parte'], new Date(Date.now() + 250_000));
  const seguinte = { job: reservado!, token: reservado!.lease_token! };
  expect(seguinte.job.attempt).toBe(2); expect(seguinte.token).not.toBe(token);
  await expect(jobs.publicar(banco, job.id, token, async () => {})).rejects.toBeInstanceOf(jobs.ConcessaoPerdida);
  const futuro = new Date(Date.now() + 60_000);
  await jobs.falhar(banco, job.id, seguinte.token, 'cota', [{ nivel: 'aviso', codigo: 'cota', mensagem: 'Aguardar' }], futuro);
  expect(await jobs.reservar(banco, 'teste', ['ler_parte'])).toBeNull();
  const adiado = await jobs.reservar(banco, 'teste', ['ler_parte'], futuro);
  expect(adiado).toMatchObject({ attempt: 3 });
  await jobs.falhar(banco, job.id, adiado!.lease_token!, 'definitivo', []);
  expect(await comTransacao(banco, c => jobs.obter(c, job.id))).toMatchObject({ estado: 'falhou', error_code: 'definitivo' });
  expect(await jobs.reservar(banco, 'teste', ['ler_parte'])).toBeNull();
}));

test('teto de tentativas: concessões vencidas voltam com espera crescente e esgotam em falhou', async () => comBanco(async banco => {
  const criado = await enfileirar(banco);
  let agora = new Date();
  const esperas: number[] = [];
  for (let tentativa = 1; tentativa <= jobs.MAXIMO_TENTATIVAS; tentativa += 1) {
    const job = await jobs.reservar(banco, 'teste', ['ler_parte'], agora, 1_000);
    expect(job).toMatchObject({ id: criado.id, attempt: tentativa });
    agora = new Date(agora.getTime() + 2_000);
    expect(await jobs.expirarConcessoes(banco, agora)).toBe(1);
    const depois = (await comTransacao(banco, c => jobs.obter(c, criado.id)))!;
    if (tentativa < jobs.MAXIMO_TENTATIVAS) {
      expect(depois).toMatchObject({ estado: 'fila', attempt: tentativa + 1, lease_token: null });
      esperas.push((depois.not_before!.getTime() - agora.getTime()) / 60_000);
      expect(await jobs.reservar(banco, 'teste', ['ler_parte'], agora)).toBeNull();
      agora = depois.not_before!;
    } else {
      expect(depois).toMatchObject({ estado: 'falhou', error_code: 'tentativas_esgotadas', attempt: tentativa, not_before: null, lease_token: null });
    }
  }
  expect(esperas).toEqual(jobs.ESPERA_MINUTOS.slice(0, jobs.MAXIMO_TENTATIVAS - 1));
  expect(await jobs.reservar(banco, 'teste', ['ler_parte'], new Date(agora.getTime() + 86_400_000))).toBeNull();
  const eventos = (await banco.query<{ tipo: string; detalhe: { error_code?: string } }>(
    'SELECT tipo, detalhe FROM evento_job WHERE job_id=$1 ORDER BY id', [criado.id])).rows;
  expect(eventos.filter(e => e.tipo === 'concessao_expirada')).toHaveLength(jobs.MAXIMO_TENTATIVAS);
  expect(eventos.at(-1)).toMatchObject({ tipo: 'falhou', detalhe: { error_code: 'tentativas_esgotadas' } });
  // Reenfileirar à mão ainda dá mais uma tentativa.
  expect(await jobs.reenfileirar(banco, criado.id)).toMatchObject({ estado: 'fila', attempt: jobs.MAXIMO_TENTATIVAS + 1 });
}));

test('not_before e tipos filtram reservas; cancelar revoga concessão e é idempotente', async () => comBanco(async banco => {
  const futuro = await enfileirar(banco, { not_before: new Date(Date.now() + 60_000) });
  expect(await jobs.reservar(banco, 'teste', ['ler_parte'])).toBeNull();
  await jobs.cancelar(banco, futuro.id);
  const pendente = await enfileirar(banco);
  expect(await jobs.reservar(banco, 'teste', ['canonizar'])).toBeNull();
  const { token } = await reservar(banco);
  expect(await jobs.cancelar(banco, pendente.id)).toBe(true);
  expect(await jobs.cancelar(banco, pendente.id)).toBe(false);
  await expect(jobs.publicar(banco, pendente.id, token, async () => {})).rejects.toBeInstanceOf(jobs.ConcessaoPerdida);
  expect(await jobs.expirarConcessoes(banco, new Date(Date.now() + 180_000))).toBe(0);
}));

test('lote repetido concorrente grava uma trilha; snapshot errado não altera nada', async () => comBanco(async banco => {
  const dados = await preparar(banco);
  await comTransacao(banco, c => marcas.publicarMarcas(c, dados.versao.id, [dados.marca]));
  expect(await comTransacao(banco, c => marcas.listarPorVersao(c, dados.versao.id))).toEqual([dados.marca]);
  const revisao = lote(dados.marca);
  expect(await Promise.all([1,2].map(() => comTransacao(banco, c => marcas.aplicarLote(c, revisao))))).toEqual(expect.arrayContaining([{ estado: 'aplicado' }, { estado: 'ja_aplicado' }]));
  expect(await quantidade(banco, 'lote_revisao')).toBe(1);
  expect(await quantidade(banco, 'revisao_marca')).toBe(1);
  await expect(comTransacao(banco, c => marcas.aplicarLote(c, { ...revisao, id: ulid() }))).rejects.toThrow('Snapshot');
  expect((await comTransacao(banco, c => marcas.listarPorVersao(c, dados.versao.id)))[0]?.avaliacao).toBe('confirmada');
}));

test.each(['avaliar', 'mudar_visibilidade'] as const)('codex não altera decisão humana de %s; recusa fica registrada', async op => comBanco(async banco => {
  const dados = await preparar(banco);
  await comTransacao(banco, c => marcas.publicarMarcas(c, dados.versao.id, [dados.marca]));
  const humano = lote(dados.marca);
  if (op === 'mudar_visibilidade') humano.operacoes = [{ ordem: 0, marca_id: dados.marca.id, op, antes: { visivel: true }, depois: { visivel: false }, motivo: 'Ocultar' }];
  await comTransacao(banco, c => marcas.aplicarLote(c, humano));
  const atuais = await comTransacao(banco, c => marcas.listarPorVersao(c, dados.versao.id));
  const automatico: LoteRevisaoV2 = { ...lote(atuais[0]!, 'codex'), operacoes: [
    { ordem: 0, marca_id: dados.marca.id, op: 'remover', antes: atuais[0]!, depois: {}, motivo: 'Remover' },
  ] };
  expect(await comTransacao(banco, c => marcas.aplicarLote(c, automatico))).toMatchObject({ estado: 'recusado' });
  expect(await comTransacao(banco, c => marcas.aplicarLote(c, automatico))).toMatchObject({ estado: 'recusado' });
  expect(await quantidade(banco, 'lote_recusado')).toBe(1);
  expect(await quantidade(banco, 'lote_revisao')).toBe(1);
  expect(await quantidade(banco, 'revisao_marca')).toBe(1);
  expect(await comTransacao(banco, c => marcas.listarPorVersao(c, dados.versao.id))).toEqual(atuais);
}));

test('operações ordenadas seguidas de remoção preservam trilha; lote antigo nunca reaplica', async () => comBanco(async banco => {
  const dados = await preparar(banco);
  await comTransacao(banco, c => marcas.publicarMarcas(c, dados.versao.id, [dados.marca]));
  const revisao: LoteRevisaoV2 = { ...lote(dados.marca, 'codex'), operacoes: [
    { ordem: 1, marca_id: dados.marca.id, op: 'remover', antes: { ...dados.marca, funcao: 'tese' }, depois: {}, motivo: 'Remoção' },
    { ordem: 0, marca_id: dados.marca.id, op: 'mudar_funcao', antes: { funcao: 'conceito' }, depois: { funcao: 'tese' }, motivo: 'Tese' },
  ] };
  await comTransacao(banco, c => marcas.aplicarLote(c, revisao));
  expect(await quantidade(banco, 'marca')).toBe(0);
  expect(await quantidade(banco, 'revisao_marca')).toBe(2);
  expect(await comTransacao(banco, c => marcas.aplicarLote(c, revisao))).toEqual({ estado: 'ja_aplicado' });
}));

test('falha tardia no lote não publica operações anteriores', async () => comBanco(async banco => {
  const dados = await preparar(banco);
  await comTransacao(banco, c => marcas.publicarMarcas(c, dados.versao.id, [dados.marca]));
  const revisao = lote(dados.marca);
  revisao.operacoes.push({ ordem: 1, marca_id: dados.marca.id, op: 'mudar_funcao', antes: { funcao: 'tese' }, depois: { funcao: 'nenhuma' }, motivo: 'Antes errado' });
  await expect(comTransacao(banco, c => marcas.aplicarLote(c, revisao))).rejects.toThrow('diverge');
  expect(await quantidade(banco, 'lote_revisao')).toBe(0);
  expect(await quantidade(banco, 'revisao_marca')).toBe(0);
  expect(await comTransacao(banco, c => marcas.listarPorVersao(c, dados.versao.id))).toEqual([dados.marca]);
}));

test('camada editorial lista pares e serializa publicações concorrentes', async () => comBanco(async banco => {
  const dados = await preparar(banco);
  const outra = { ...dados.marca, id: ulid() };
  await expect(comTransacao(banco, c => marcas.publicarMarcas(c, dados.versao.id, [dados.marca, outra]))).rejects.toMatchObject({ pares: [[dados.marca.id, outra.id]] });
  expect(await quantidade(banco, 'marca')).toBe(0);
  const resultados = await Promise.allSettled([dados.marca, outra].map(marca => comTransacao(banco, c => marcas.publicarMarcas(c, dados.versao.id, [marca]))));
  expect(resultados.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(await quantidade(banco, 'marca')).toBe(1);
  await comTransacao(banco, c => marcas.publicarMarcas(c, dados.versao.id, [{ ...dados.marca, id: ulid(), funcao: 'nenhuma' }]));
  expect(await quantidade(banco, 'marca')).toBe(2);
}));

test('referências de outra versão/documento, citações erradas e planos inválidos são recusados', async () => comBanco(async banco => {
  const a = await preparar(banco); const b = await preparar(banco);
  await expect(comTransacao(banco, c => marcas.publicarMarcas(c, a.versao.id, [b.marca]))).rejects.toThrow('versão');
  await expect(comTransacao(banco, c => marcas.publicarMarcas(c, a.versao.id, [{ ...a.marca, execucao_id: b.execucao.id }]))).rejects.toThrow('Execução');
  await expect(comTransacao(banco, c => marcas.publicarMarcas(c, a.versao.id, [{ ...a.marca, ancora: { ...a.marca.ancora, citacao: 'ab' } }]))).rejects.toThrow('Âncora');
  await expect(enfileirar(banco, { documento_id: a.documento.id, versao_id: b.versao.id })).rejects.toThrow('Versão');
  await expect(enfileirar(banco, { parte_id: a.parte.id, versao_id: b.versao.id })).rejects.toThrow('Parte');
  const execucao = { ...a.execucao, id: ulid(), plano_partes: [ulid()] };
  await expect(comTransacao(banco, async c => {
    await execucoes.criar(c, execucao);
    await partes.criar(c, execucao.id, [{ ...a.parte, id: execucao.plano_partes[0]!, execucao_id: execucao.id, blocos_responsaveis: [ulid()] }]);
  })).rejects.toThrow('Plano');
  await expect(comTransacao(banco, c => progresso.gravar(c, { ...posicao(b), documento_id: a.documento.id }))).rejects.toThrow('documento');
}));

test('progresso obsoleto informa revisão atual; concorrência inicial permite uma gravação', async () => comBanco(async banco => {
  const dados = await preparar(banco);
  const entrada = posicao(dados);
  expect(await comTransacao(banco, c => progresso.ler(c, dados.documento.id))).toBeNull();
  const resultados = await Promise.allSettled([1,2].map(() => comTransacao(banco, c => progresso.gravar(c, entrada))));
  expect(resultados.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const rejeitado = resultados.find(r => r.status === 'rejected');
  expect(rejeitado).toMatchObject({ reason: { revisao_atual: 1 } });
  await expect(comTransacao(banco, c => progresso.gravar(c, entrada))).rejects.toMatchObject({ revisao_atual: 1 });
  expect(await comTransacao(banco, c => progresso.gravar(c, { ...entrada, revisao_esperada: 1 }))).toMatchObject({ revisao: 2 });
  expect(await comTransacao(banco, c => progresso.ler(c, dados.documento.id))).toMatchObject({ revisao: 2, ancora: entrada.ancora });
}));

test('biblioteca deriva última versão, marcas visíveis e trabalho em curso independentemente do texto', async () => comBanco(async banco => {
  const dados = await preparar(banco);
  await comTransacao(banco, c => marcas.publicarMarcas(c, dados.versao.id, [dados.marca]));
  const job = await enfileirar(banco, { versao_id: dados.versao.id });
  expect((await comTransacao(banco, documentos.listar))[0]).toMatchObject({ ultima_versao_id: dados.versao.id, marcas_visiveis: 1, job_em_curso: job.id, estado_texto: 'disponivel' });
  const reserva = await reservar(banco);
  await jobs.falhar(banco, job.id, reserva.token, 'falha', []);
  expect((await comTransacao(banco, documentos.listar))[0]).toMatchObject({ marcas_visiveis: 1, job_em_curso: null, estado_texto: 'disponivel' });
  const nova = await comTransacao(banco, c => documentos.criarVersao(c, dados.documento.id, dados.versao.canonico));
  expect((await comTransacao(banco, documentos.listar))[0]).toMatchObject({ ultima_versao_id: nova.id, marcas_visiveis: 0 });
}));

test('duas publicações concorrentes com o mesmo token executam uma só escrita', async () => comBanco(async banco => {
  const dados = await preparar(banco);
  await enfileirar(banco, { parte_id: dados.parte.id });
  const { job, token } = await reservar(banco);
  let chamadas = 0;
  const resultados = await Promise.allSettled([1,2].map(() => jobs.publicar(banco, job.id, token, async c => {
    chamadas++;
    await marcas.publicarMarcas(c, dados.versao.id, [dados.marca]);
  })));
  expect(resultados.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(chamadas).toBe(1);
  expect(await quantidade(banco, 'marca')).toBe(1);
  expect((await banco.query("SELECT * FROM evento_job WHERE tipo='publicado'")).rowCount).toBe(1);
}));

test('datas literais preservam snapshot e reaplicação histórica não desfaz revisão posterior', async () => comBanco(async banco => {
  const dados = await preparar(banco);
  dados.marca.criada_em = '2026-09-20T15:00:00.123456-03:00';
  await comTransacao(banco, c => marcas.publicarMarcas(c, dados.versao.id, [dados.marca]));
  const gravadas = await comTransacao(banco, c => marcas.listarPorVersao(c, dados.versao.id));
  expect(hashMarcas(gravadas)).toBe(hashMarcas([dados.marca]));
  const primeiro = lote(dados.marca);
  await comTransacao(banco, c => marcas.aplicarLote(c, primeiro));
  const atuais = await comTransacao(banco, c => marcas.listarPorVersao(c, dados.versao.id));
  const segundo = lote(atuais[0]!);
  segundo.operacoes = [{ ordem: 0, marca_id: dados.marca.id, op: 'avaliar', antes: { avaliacao: 'confirmada' }, depois: { avaliacao: 'rejeitada' }, motivo: 'Reconsideração' }];
  await comTransacao(banco, c => marcas.aplicarLote(c, segundo));
  expect(await comTransacao(banco, c => marcas.aplicarLote(c, primeiro))).toEqual({ estado: 'ja_aplicado' });
  expect((await comTransacao(banco, c => marcas.listarPorVersao(c, dados.versao.id)))[0]?.avaliacao).toBe('rejeitada');
  expect(await quantidade(banco, 'revisao_marca')).toBe(2);
}));

test('consulta de planejamento representa V1, V2 e V3 sem fingir um contrato V1', async () => comBanco(async banco => {
  const dados = await preparar(banco);
  for (const schema of [1, 2, 3]) {
    await comTransacao(banco, async cliente => {
      await cliente.query('UPDATE execucao_leitura SET schema_versao=$2,prompts=$3 WHERE id=$1',
        [dados.execucao.id, schema, schema === 3 ? JSON.stringify({ analise: 'a', sintese: 's', revisao: 'r', plano: 'p' }) : null]);
      const resumo = await execucoes.obter(cliente, dados.execucao.id);
      expect(resumo).toEqual({ id: dados.execucao.id, versao_id: dados.versao.id, schema_versao: schema,
        tamanho_parte_tokens: 45000, plano_partes: dados.execucao.plano_partes });
      expect(await execucoes.listar(cliente, dados.versao.id)).toEqual([resumo]);
    });
  }
}));
