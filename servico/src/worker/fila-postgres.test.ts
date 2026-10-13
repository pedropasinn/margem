import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import type pg from 'pg';
import type { CanonicoV1 } from '@margem/contratos';
import {
  caminhoDoRoteiro, caminhoDoSchemaDoLeitor, canonicoDeTeste, comBanco, contadorDeIds,
  textosDaRevisao, textosDoPrompt, VERSOES,
} from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import { carregarRoteiro, criarExecutorFalso } from '../executor/fake.js';
import * as documentos from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import * as marcasRepo from '../repos/marcas.js';
import { iniciarExecucao, TIPO_LER_PARTE, TIPO_REVISAR, type ConfiguracaoDaLeitura } from '../leitura/manipuladores.js';
import { FilaPostgres } from './fila-postgres.js';
import { manipuladoresDaLeitura } from './manipuladores-leitura.js';
import { Worker } from './worker.js';

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
  const diretorio = await mkdtemp(join(tmpdir(), 'margem-j07-artefatos-'));
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

async function preparar(banco: pg.Pool): Promise<documentos.VersaoTexto> {
  const canonico = livro();
  return comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
    return documentos.criarVersao(cliente, documento.id, canonico);
  });
}

/** Diretório de vagas próprio: o protocolo do J05 é global por usuário. */
async function diretorioDeVagas(): Promise<string> {
  const diretorio = await mkdtemp(join(tmpdir(), 'margem-j07-vagas-'));
  temporarios.push(diretorio);
  return diretorio;
}

test('worker real com fila do Postgres processa ler_parte de ponta a ponta', async () => comBanco('fila_ponta', async (banco) => {
  const versao = await preparar(banco);
  const config = await configurar(banco, 'leitor-ok');
  const inicio = await iniciarExecucao(config, versao.id);

  const fila = new FilaPostgres(banco);
  const worker = new Worker({
    fila,
    manipuladores: manipuladoresDaLeitura(config),
    diretorioSlots: await diretorioDeVagas(),
    slots: 1,
    intervaloMs: 5,
    maximoCiclos: 4,
  });
  await worker.rodar();

  const marcas = await comTransacao(banco, (cliente) => marcasRepo.listarPorVersao(cliente, versao.id));
  expect(marcas).toHaveLength(3);
  expect(marcas.every((marca) => marca.execucao_id === inicio.execucao.id)).toBe(true);

  const jobDaParte = inicio.jobs.find((job) => job.tipo === TIPO_LER_PARTE);
  const estado = await comTransacao(banco, (cliente) => jobsRepo.obter(cliente, jobDaParte?.id ?? ''));
  expect(estado?.estado).toBe('ok');
  expect(estado?.output_artifact_hash).toMatch(/^[0-9a-f]{64}$/);

  // A revisão depende das partes: com a parte publicada, ela também roda e é adiada
  // ou aplicada, mas nunca deixa o job reservado com a concessão pendurada.
  const revisao = inicio.jobs.find((job) => job.tipo === TIPO_REVISAR);
  const jobRevisao = await comTransacao(banco, (cliente) => jobsRepo.obter(cliente, revisao?.id ?? ''));
  expect(jobRevisao?.estado).not.toBe('reservado');

  const parte = await comTransacao(banco, (cliente) => cliente.query<{
    estado: string; resumo_da_parte: string | null; recuperacao: unknown[]; leitura_integral: boolean | null;
  }>('SELECT estado, resumo_da_parte, recuperacao, leitura_integral FROM parte'));
  // Migração 0002: o que o J06 só sabia guardar em arquivo agora tem coluna.
  expect(parte.rows[0]?.estado).toBe('ok');
  expect(parte.rows[0]?.resumo_da_parte).toContain('tese do capítulo');
  expect(parte.rows[0]?.recuperacao).toHaveLength(1);
  expect(parte.rows[0]?.leitura_integral).toBe(true);
}));

test('worker morto depois de reservar não duplica publicação quando outro assume', async () => comBanco('fila_reinicio', async (banco) => {
  const versao = await preparar(banco);
  const config = await configurar(banco, 'leitor-ok');
  const inicio = await iniciarExecucao(config, versao.id);
  const jobDaParte = inicio.jobs.find((job) => job.tipo === TIPO_LER_PARTE);

  // Primeiro worker: reserva com concessão curtíssima e "morre" (nunca publica).
  const filaCurta = new FilaPostgres(banco, { concessaoMs: 1 });
  const reservadas = await filaCurta.reservar('worker-morto', [TIPO_LER_PARTE]);
  expect(reservadas).toHaveLength(1);
  const primeiroToken = reservadas[0]?.lease_token ?? '';

  // Segundo worker: a concessão vencida volta à fila e ele processa do começo.
  const fila = new FilaPostgres(banco);
  await new Promise((resolver) => setTimeout(resolver, 5));
  expect(await fila.expirarConcessoes()).toBe(1);
  // A volta tem 1 minuto de espera (backoff); o teste pula a espera.
  await banco.query('UPDATE job SET not_before = NULL WHERE estado = $1', ['fila']);
  const worker = new Worker({
    fila,
    manipuladores: manipuladoresDaLeitura(config),
    diretorioSlots: await diretorioDeVagas(),
    slots: 1,
    intervaloMs: 5,
    maximoCiclos: 3,
  });
  await worker.rodar();

  const marcas = await comTransacao(banco, (cliente) => marcasRepo.listarPorVersao(cliente, versao.id));
  expect(marcas).toHaveLength(3);

  // O token do worker morto não publica nada depois: a concessão é dele, não do job.
  await expect(jobsRepo.publicar(banco, jobDaParte?.id ?? '', primeiroToken, () => Promise.resolve(null)))
    .rejects.toThrow(jobsRepo.ConcessaoPerdida);
  const marcasDepois = await comTransacao(banco, (cliente) => marcasRepo.listarPorVersao(cliente, versao.id));
  expect(marcasDepois).toHaveLength(3);

  const publicados = await comTransacao(banco, (cliente) => cliente.query<{ total: number }>(
    "SELECT count(*)::int AS total FROM evento_job WHERE job_id=$1 AND tipo='publicado'", [jobDaParte?.id ?? '']));
  expect(publicados.rows[0]?.total).toBe(1);
}));
