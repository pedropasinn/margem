import { readFile, rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import type pg from 'pg';
import { hashMarcas, validarJobResult, type CanonicoV1, type LoteRevisaoV2, type MarcaV1 } from '@margem/contratos';
import {
  caminhoDoRoteiro, caminhoDoSchemaDoLeitor, canonicoDeTeste, comBanco, contadorDeIds, idTeste,
  textosDaRevisao, textosDoPrompt, VERSOES,
} from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import { carregarRoteiro, criarExecutorFalso } from '../executor/fake.js';
import * as documentos from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import * as marcasRepo from '../repos/marcas.js';
import {
  conferirDependencia, iniciarExecucao, montarDigest, processarJob, TIPO_LER_PARTE, TIPO_REVISAR,
  type ConfiguracaoDaLeitura,
} from './manipuladores.js';

const temporarios: string[] = [];

afterEach(async () => {
  for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true });
});

function livro(): CanonicoV1 {
  return canonicoDeTeste({
    titulo: 'Livro de teste',
    blocos: [
      { tipo: 'capitulo', texto: 'Capítulo um' },
      { tipo: 'paragrafo', texto: 'Uma tese central organiza o argumento do capítulo.' },
      { tipo: 'paragrafo', texto: 'Um conceito vale somente sob certas condições declaradas.' },
      { tipo: 'secao', texto: 'Segunda seção' },
      { tipo: 'paragrafo', texto: 'A justificativa aparece com uma evidência decisiva.' },
    ],
    secoes: [{ nivel: 1, inicio: 0, fim: 4 }, { nivel: 2, inicio: 3, fim: 4 }],
  });
}

async function configurar(banco: pg.Pool, roteiro: string): Promise<ConfiguracaoDaLeitura> {
  const diretorio = await mkdtemp(join(tmpdir(), 'margem-j06-artefatos-'));
  temporarios.push(diretorio);
  return {
    banco,
    executor: criarExecutorFalso(await carregarRoteiro(caminhoDoRoteiro(roteiro))),
    versoes: VERSOES,
    textos: textosDoPrompt(),
    caminhoSchemaLeitor: caminhoDoSchemaDoLeitor(),
    revisao: textosDaRevisao(),
    modelo: 'modelo-de-teste',
    esforco: 'alto',
    diretorioArtefatos: diretorio,
    prazoMs: 10_000,
    novoId: contadorDeIds('M'),
    agora: () => new Date('2026-09-20T12:00:00.000Z'),
  };
}

async function preparar(banco: pg.Pool, canonico = livro()) {
  return comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
    return documentos.criarVersao(cliente, documento.id, canonico);
  });
}

async function reservar(banco: pg.Pool, tipo: string) {
  const job = await jobsRepo.reservar(banco, 'teste-j06', [tipo]);
  if (!job?.lease_token) throw new Error(`Nenhum job ${tipo} reservável.`);
  return { job, token: job.lease_token };
}

test('iniciar_execucao cria a execução, o plano e um job por parte mais a revisão', async () => comBanco('leitura_inicio', async (banco) => {
  const versao = await preparar(banco);
  const config = await configurar(banco, 'leitor-ok');
  const inicio = await iniciarExecucao(config, versao.id);
  expect(inicio.partes).toHaveLength(1);
  expect(inicio.execucao).toMatchObject({
    versao_id: versao.id, metodo_versao: 'metodo@1', prompt_versao: 'leitor-de-parte@1',
    schema_versao: 1, tamanho_parte_tokens: 45_000, concorrencia: 4,
  });
  expect(inicio.execucao.plano_partes).toEqual(inicio.partes.map((parte) => parte.id));
  expect(inicio.jobs.map((job) => job.tipo)).toEqual([TIPO_LER_PARTE, TIPO_REVISAR]);
  // dedup_key da parte é o hash da entrada: reexecutar `iniciarExecucao` não duplica a fila.
  const jobDaParte = await comTransacao(banco, (cliente) => cliente.query<{ dedup_key: string }>(
    'SELECT dedup_key FROM job WHERE tipo=$1', [TIPO_LER_PARTE]));
  expect(jobDaParte.rows[0]?.dedup_key).toBe(`parte:${inicio.execucao.id}:${inicio.partes[0]?.hash_entrada}`);
}));

test('ler_parte publica marcas, recuperação, mapa da seção e evento do job', async () => comBanco('leitura_parte', async (banco) => {
  const versao = await preparar(banco);
  const config = await configurar(banco, 'leitor-ok');
  const inicio = await iniciarExecucao(config, versao.id);
  const { job, token } = await reservar(banco, TIPO_LER_PARTE);
  const resultado = await processarJob(config, job, token);
  expect(validarJobResult(resultado)).toBe(true);
  expect(resultado.estado).toBe('ok');

  const marcas = await comTransacao(banco, (cliente) => marcasRepo.listarPorVersao(cliente, versao.id));
  expect(marcas).toHaveLength(3);
  expect(marcas.map((marca) => marca.funcao).sort()).toEqual(['conceito', 'justificativa', 'tese']);
  for (const marca of marcas) {
    expect(marca).toMatchObject({ origem: 'parte', validade: 'resolvida', visivel: true, avaliacao: 'nao_avaliada' });
    expect(marca.execucao_id).toBe(inicio.execucao.id);
    expect(marca.job_id).toBe(job.id);
  }
  const conceito = marcas.find((marca) => marca.funcao === 'conceito');
  expect(conceito?.subfaixas).toHaveLength(1);

  const evento = await comTransacao(banco, (cliente) => cliente.query<{ detalhe: { caminho_recuperacao: string; marcas: number } }>(
    "SELECT detalhe FROM evento_job WHERE tipo='leitura_publicada'"));
  const caminho = evento.rows[0]?.detalhe.caminho_recuperacao ?? '';
  expect(evento.rows[0]?.detalhe.marcas).toBe(3);
  const artefato = JSON.parse(await readFile(caminho, 'utf8')) as {
    recuperacao: unknown[]; mapa_da_secao: unknown[]; resumo_da_parte: string; leitura_integral: boolean;
  };
  expect(artefato.recuperacao).toHaveLength(1);
  expect(artefato.mapa_da_secao).toHaveLength(1);
  expect(artefato.resumo_da_parte).toContain('tese do capítulo');
  expect(artefato.leitura_integral).toBe(true);

  const estado = await comTransacao(banco, (cliente) => cliente.query<{ estado: string }>('SELECT estado FROM parte'));
  expect(estado.rows[0]?.estado).toBe('ok');
  const jobFinal = await comTransacao(banco, (cliente) => jobsRepo.obter(cliente, job.id));
  expect(jobFinal?.estado).toBe('ok');
}));

test('cota do Codex adia o job com not_before e sem gravar marca', async () => comBanco('leitura_cota', async (banco) => {
  const versao = await preparar(banco);
  const config = await configurar(banco, 'leitor-cota');
  await iniciarExecucao(config, versao.id);
  const { job, token } = await reservar(banco, TIPO_LER_PARTE);
  const resultado = await processarJob(config, job, token);
  expect(validarJobResult(resultado)).toBe(true);
  expect(resultado.estado).toBe('adiado');
  expect(resultado.estado === 'adiado' && resultado.not_before).toBe('2026-09-21T10:27:00.000Z');
  const jobFinal = await comTransacao(banco, (cliente) => jobsRepo.obter(cliente, job.id));
  expect(jobFinal?.estado).toBe('adiado');
  expect(await comTransacao(banco, (cliente) => marcasRepo.listarPorVersao(cliente, versao.id))).toEqual([]);
}));

test('a revisão espera as partes: rede de segurança de 30 minutos enquanto faltar alguma', async () => comBanco('leitura_dep', async (banco) => {
  const versao = await preparar(banco);
  const config = await configurar(banco, 'leitor-ok');
  const inicio = await iniciarExecucao(config, versao.id);
  const pendente = await comTransacao(banco, (cliente) => conferirDependencia(cliente, inicio.execucao.id));
  expect(pendente).toEqual({ total: 1, pendentes: 1 });

  const { job, token } = await reservar(banco, TIPO_REVISAR);
  const adiado = await processarJob(config, job, token);
  expect(adiado.estado).toBe('adiado');
  expect(adiado.diagnosticos[0]).toMatchObject({ codigo: 'dependencia' });
  expect(adiado.estado === 'adiado' && adiado.not_before).toBe('2026-09-20T12:30:00.000Z');
  const depois = await comTransacao(banco, (cliente) => jobsRepo.obter(cliente, job.id));
  expect(depois?.estado).toBe('adiado');
  expect(depois?.not_before?.toISOString()).toBe('2026-09-20T12:30:00.000Z');

  const parte = await reservar(banco, TIPO_LER_PARTE);
  await processarJob(config, parte.job, parte.token);
  expect(await comTransacao(banco, (cliente) => conferirDependencia(cliente, inicio.execucao.id)))
    .toEqual({ total: 1, pendentes: 0 });
}));

test('revisão de consistência aplica o lote, preenche o antes e ignora marca inexistente',
  async () => comBanco('leitura_revisao', async (banco) => {
    const versao = await preparar(banco);
    const leitura = await configurar(banco, 'leitor-ok');
    const inicio = await iniciarExecucao(leitura, versao.id);
    const parte = await reservar(banco, TIPO_LER_PARTE);
    await processarJob(leitura, parte.job, parte.token);
    const antes = await comTransacao(banco, (cliente) => marcasRepo.listarPorVersao(cliente, versao.id));
    // O contador de ids é pinado pelo teste: execução, parte e as três marcas nesta ordem.
    expect(antes.map((marca) => marca.id)).toEqual([idTeste('M', 3), idTeste('M', 4), idTeste('M', 5)]);

    const revisao = { ...leitura, executor: (await configurar(banco, 'revisao-ok')).executor, novoId: contadorDeIds('M', 6) };
    const { job, token } = await reservar(banco, TIPO_REVISAR);
    const resultado = await processarJob(revisao, job, token);
    expect(validarJobResult(resultado)).toBe(true);
    expect(resultado.estado).toBe('ok');
    expect(resultado.diagnosticos[0]?.codigo).toBe('lote_aplicado');

    const depois = await comTransacao(banco, (cliente) => marcasRepo.listarPorVersao(cliente, versao.id));
    expect(depois.find((marca) => marca.id === idTeste('M', 3))?.funcao).toBe('conceito');
    expect(depois.find((marca) => marca.id === idTeste('M', 4))?.comentario).toBeNull();
    const editada = depois.find((marca) => marca.id === idTeste('M', 5));
    const bloco = versao.canonico.blocos.find((item) => item.id === editada?.ancora.bloco_id);
    expect(editada?.subfaixas).toHaveLength(1);
    expect(bloco?.texto.slice(editada?.subfaixas[0]?.inicio_utf16, editada?.subfaixas[0]?.fim_utf16)).toBe('decisiva');

    const trilha = await comTransacao(banco, (cliente) => cliente.query<{ op: string; antes: Record<string, unknown> }>(
      'SELECT op, antes FROM revisao_marca ORDER BY ordem'));
    expect(trilha.rows.map((linha) => linha.op)).toEqual(['mudar_funcao', 'remover_comentario', 'editar_subfaixas']);
    // O `antes` é do serviço, não do modelo: o estado anterior real está registrado.
    expect(trilha.rows[0]?.antes).toEqual({ funcao: 'tese' });

    const artefato = JSON.parse(await readFile(
      join(leitura.diretorioArtefatos ?? '', `execucao-${inicio.execucao.id}`, 'revisao-consistencia.json'), 'utf8')) as {
        estado: string; ignoradas: { motivo: string }[]; lote: LoteRevisaoV2;
      };
    expect(artefato.estado).toBe('aplicado');
    expect(artefato.ignoradas).toEqual([{ marca_id: idTeste('M', 99), motivo: 'marca_inexistente' }]);
    expect(artefato.lote.autor).toBe('codex');
    expect(artefato.lote.snapshot_base).toBe(hashMarcas(antes));
  }));

test('o mesmo lote aplicado duas vezes não muda mais nada', async () => comBanco('leitura_idem', async (banco) => {
  const versao = await preparar(banco);
  const leitura = await configurar(banco, 'leitor-ok');
  await iniciarExecucao(leitura, versao.id);
  const parte = await reservar(banco, TIPO_LER_PARTE);
  await processarJob(leitura, parte.job, parte.token);
  const revisao = { ...leitura, executor: (await configurar(banco, 'revisao-ok')).executor, novoId: contadorDeIds('M', 6) };
  const primeira = await reservar(banco, TIPO_REVISAR);
  await processarJob(revisao, primeira.job, primeira.token);
  const estado = await comTransacao(banco, (cliente) => marcasRepo.listarPorVersao(cliente, versao.id));
  const repetido = await comTransacao(banco, async (cliente) => {
    const lotes = await cliente.query<{ lote: LoteRevisaoV2 }>(
      "SELECT jsonb_build_object('id',id,'execucao_id',execucao_id,'snapshot_base',snapshot_base,'autor',autor,'motivo_do_lote',motivo,'operacoes',operacoes) AS lote FROM lote_revisao");
    const guardado = lotes.rows[0]?.lote;
    if (!guardado) throw new Error('Lote não persistido.');
    return marcasRepo.aplicarLote(cliente, guardado);
  });
  expect(repetido).toEqual({ estado: 'ja_aplicado' });
  expect(await comTransacao(banco, (cliente) => marcasRepo.listarPorVersao(cliente, versao.id))).toEqual(estado);
}));

test('operação do codex sobre marca já avaliada pelo leitor é recusada por inteiro',
  async () => comBanco('leitura_humana', async (banco) => {
    const versao = await preparar(banco);
    const leitura = await configurar(banco, 'leitor-ok');
    const inicio = await iniciarExecucao(leitura, versao.id);
    const parte = await reservar(banco, TIPO_LER_PARTE);
    await processarJob(leitura, parte.job, parte.token);
    const antes = await comTransacao(banco, (cliente) => marcasRepo.listarPorVersao(cliente, versao.id));
    const alvo = antes.find((marca) => marca.id === idTeste('M', 3));
    if (!alvo) throw new Error('Marca de teste ausente.');

    const decisao: LoteRevisaoV2 = {
      id: idTeste('K', 1), execucao_id: inicio.execucao.id, snapshot_base: hashMarcas(antes), autor: 'leitor',
      motivo_do_lote: 'Conferência do leitor',
      operacoes: [{ ordem: 0, marca_id: alvo.id, op: 'avaliar', antes: { avaliacao: 'nao_avaliada' }, depois: { avaliacao: 'confirmada' }, motivo: 'Confirmada na leitura' }],
    };
    expect(await comTransacao(banco, (cliente) => marcasRepo.aplicarLote(cliente, decisao))).toEqual({ estado: 'aplicado' });
    const humanas: MarcaV1[] = await comTransacao(banco, (cliente) => marcasRepo.listarPorVersao(cliente, versao.id));

    const revisao = { ...leitura, executor: (await configurar(banco, 'revisao-humana')).executor, novoId: contadorDeIds('M', 6) };
    const { job, token } = await reservar(banco, TIPO_REVISAR);
    const resultado = await processarJob(revisao, job, token);
    expect(resultado.estado).toBe('ok');
    expect(resultado.diagnosticos[0]?.codigo).toBe('lote_recusado');
    expect(resultado.diagnosticos[0]?.mensagem).toContain(alvo.id);
    expect(await comTransacao(banco, (cliente) => marcasRepo.listarPorVersao(cliente, versao.id))).toEqual(humanas);
    const recusa = await comTransacao(banco, (cliente) => cliente.query('SELECT id FROM lote_recusado'));
    expect(recusa.rowCount).toBe(1);
  }));

test('o digest leva id, função, citação e sublinhado, e nenhuma página ou offset', () => {
  const canonico = livro();
  const marca: MarcaV1 = {
    id: idTeste('M', 1),
    ancora: {
      versao_id: idTeste('V', 1), bloco_id: idTeste('B', 2), citacao: 'Um conceito vale somente sob certas condições declaradas.',
      prefixo: '', sufixo: '', inicio_utf16: 0, fim_utf16: 57,
    },
    funcao: 'conceito', subfaixas: [{ inicio_utf16: 17, fim_utf16: 24 }],
    comentario: { tipo: 'AUTOR', rotulo: 'AUTOR · CONDIÇÃO', texto: 'Depende das condições.' },
    origem: 'parte', validade: 'resolvida', visivel: true, avaliacao: 'nao_avaliada',
    criada_em: '2026-09-20T12:00:00.000Z',
  };
  const digest = montarDigest(canonico, [marca]);
  expect(digest).toContain(idTeste('M', 1));
  expect(digest).toContain('**conceito**');
  expect(digest).toContain('sublinhar: ["somente"]');
  expect(digest).toContain('AUTOR · CONDIÇÃO');
  expect(digest).toContain('## Capítulo um');
  expect(digest.toLowerCase()).not.toMatch(/utf16|offset|p[áa]gina/);
});
