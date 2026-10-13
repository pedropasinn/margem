/**
 * Execuções do Codex para os avisos da interface, contra o Postgres de teste (`margem_test_*`).
 * Os jobs mudam de estado pelo repositório da fila, como o worker faria; nenhum Codex roda.
 */
import { expect, test } from 'vitest';
import { ancoraDeSelecao } from '@margem/core';
import { validarExecucoesDoCodex, type ExecucoesDoCodexV1 } from '@margem/contratos';
import { canonicoDeTeste, comBanco, idTeste } from '../../testes/apoio';
import { comTransacao } from '../db/transacao';
import * as documentos from '../repos/documentos';
import * as anotacoes from '../repos/anotacoes';
import * as jobsRepo from '../repos/jobs';
import { TIPOS_DO_CODEX, mensagemDaExecucao, rotuloDaExecucao } from '../execucoes/ativas';
import { criarApi } from './app';

const HASH = 'a'.repeat(64);

async function preparar(banco: Parameters<Parameters<typeof comBanco>[1]>[0]) {
  const c = canonicoDeTeste({
    titulo: 'Mixtape',
    blocos: [
      { tipo: 'capitulo', texto: 'Abertura' }, { tipo: 'paragrafo', texto: 'Primeiro parágrafo.' },
      { tipo: 'capitulo', texto: 'O meio' }, { tipo: 'paragrafo', texto: 'Segundo parágrafo, no capítulo 2.' },
    ],
    secoes: [{ nivel: 1, inicio: 0, fim: 1 }, { nivel: 1, inicio: 2, fim: 3 }],
  });
  return comTransacao(banco, async (tx) => {
    const doc = await documentos.criar(tx, { ...c.documento, titulo: 'Mixtape', origem_caminho: 'mixtape.txt' });
    const versao = await documentos.criarVersao(tx, doc.id, c);
    const bloco = c.blocos[3]!;
    await anotacoes.criar(tx, { versao: 1, revisao_edicao: 1, id: idTeste('A', 1), tipo: 'nota', texto: 'Minha nota', versao_id: versao.id,
      ancora: ancoraDeSelecao({ ...bloco, versao_id: versao.id }, 0, 8),
      criada_em: '2026-10-01T00:00:00.000Z', atualizada_em: '2026-10-01T00:00:00.000Z' });
    const exec = idTeste('E', 1);
    const enfileirar = (tipo: string, dedup: string, prioridade = 50) =>
      jobsRepo.enfileirar(tx, { tipo, dedup_key: dedup, input_snapshot_hash: HASH, versao_id: versao.id, prioridade });
    const jobs = {
      sintetizar: await enfileirar('sintetizar_capitulo', `sintetizar:${exec}:${c.secoes[1]!.id}`, 90),
      revisar: await enfileirar('revisar_consistencia', `revisao:${exec}`),
      nota: await enfileirar('revisar_anotacao', `revisar_anotacao:${idTeste('A', 1)}:${idTeste('P', 1)}`, 80),
      resolver: await enfileirar('resolver_exercicio', `resolver:${idTeste('R', 1)}`, 70),
      canonizar: await enfileirar('canonizar', `canonizar:${doc.id}`, 100),
    };
    return { doc, versao, secoes: c.secoes, jobs };
  });
}

async function ativas(api: ReturnType<typeof criarApi>): Promise<ExecucoesDoCodexV1> {
  const resposta = await api.request('/api/execucoes/ativas');
  expect(resposta.status).toBe(200);
  expect(resposta.headers.get('cache-control')).toBe('no-store');
  const corpo: unknown = await resposta.json();
  expect(validarExecucoesDoCodex(corpo), JSON.stringify(validarExecucoesDoCodex.errors)).toBe(true);
  return corpo as ExecucoesDoCodexV1;
}

test('lista as execuções do Codex com rótulo, seção, rota e estados', async () => comBanco('execucoes_ativas', async (banco) => {
  const { doc, secoes, jobs } = await preparar(banco);
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); } });

  let lista = await ativas(api);
  // A canonização é do motor Python, não do Codex.
  expect(lista.execucoes.map((e) => e.id)).not.toContain(jobs.canonizar.id);
  expect(lista.execucoes).toHaveLength(4);
  expect(lista.execucoes.every((e) => e.estado === 'na_fila' && e.fim === null)).toBe(true);
  const sintetizar = lista.execucoes.find((e) => e.id === jobs.sintetizar.id)!;
  expect(sintetizar).toMatchObject({
    rotulo: 'Resumindo o capítulo 2 de Mixtape', documento: { id: doc.id, titulo: 'Mixtape' },
    secao: { id: secoes[1]!.id, titulo: 'O meio', numero: 2 }, rota: `/ler/${doc.id}/${secoes[1]!.id}`,
  });
  // A nota está num bloco do capítulo 2: a seção sai do bloco da anotação.
  expect(lista.execucoes.find((e) => e.id === jobs.nota.id)).toMatchObject({
    rotulo: 'Revisando sua nota', secao: { numero: 2 }, rota: `/ler/${doc.id}/${secoes[1]!.id}`,
  });
  expect(lista.execucoes.find((e) => e.id === jobs.revisar.id)).toMatchObject({
    rotulo: 'Revisando as marcas de Mixtape', secao: null, rota: `/ler/${doc.id}`,
  });

  // Rodando: a de maior prioridade sai primeiro e passa a encabeçar a lista.
  const reservado = await jobsRepo.reservar(banco, 'teste', [...TIPOS_DO_CODEX]);
  expect(reservado?.id).toBe(jobs.sintetizar.id);
  lista = await ativas(api);
  expect(lista.execucoes[0]).toMatchObject({ id: jobs.sintetizar.id, estado: 'rodando', fim: null });

  await jobsRepo.publicar(banco, reservado!.id, reservado!.lease_token!, () => Promise.resolve(undefined));
  const nota = (await jobsRepo.reservar(banco, 'teste', [...TIPOS_DO_CODEX]))!;
  expect(nota.id).toBe(jobs.nota.id);
  await jobsRepo.falhar(banco, nota.id, nota.lease_token!, 'timeout', []);
  await jobsRepo.cancelar(banco, jobs.resolver.id);

  lista = await ativas(api);
  // Falha, depois a concluída, depois a fila; o cancelado some.
  expect(lista.execucoes.map((e) => [e.id, e.estado])).toEqual([
    [jobs.nota.id, 'falhou'], [jobs.sintetizar.id, 'concluida'], [jobs.revisar.id, 'na_fila'],
  ]);
  expect(lista.execucoes[0]).toMatchObject({ mensagem: 'O Codex demorou demais e parou.' });
  expect(lista.execucoes[1]!.fim).not.toBeNull();
  expect(Date.parse(lista.execucoes[1]!.fim!)).toBeGreaterThanOrEqual(Date.parse(lista.execucoes[1]!.inicio));

  // Fora da janela de terminadas, a execução sai da lista.
  await banco.query(`UPDATE job SET atualizado_em = clock_timestamp() - interval '10 minutes' WHERE id=$1`, [jobs.sintetizar.id]);
  lista = await ativas(api);
  expect(lista.execucoes.map((e) => e.id)).not.toContain(jobs.sintetizar.id);
  expect(lista.omitidas).toBe(0);
}));

test('o SSE manda a lista ao abrir e de novo quando ela muda', async () => comBanco('execucoes_sse', async (banco) => {
  const { jobs } = await preparar(banco);
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); }, intervaloEventosMs: 40 });
  const parar = new AbortController();
  const resposta = await api.request('/api/execucoes/eventos', { signal: parar.signal });
  expect(resposta.status).toBe(200);
  expect(resposta.headers.get('content-type')).toContain('text/event-stream');
  const leitor: ReadableStreamDefaultReader<Uint8Array> = resposta.body!.getReader();
  const decodificador = new TextDecoder();
  let acumulado = '';
  async function proximaLista(): Promise<ExecucoesDoCodexV1> {
    for (;;) {
      const fim = acumulado.indexOf('\n\n');
      if (fim >= 0) {
        const bloco = acumulado.slice(0, fim);
        acumulado = acumulado.slice(fim + 2);
        if (!bloco.includes('event: execucoes')) continue; // comentário de manutenção
        const dados = bloco.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
        return JSON.parse(dados) as ExecucoesDoCodexV1;
      }
      const { value, done } = await leitor.read();
      if (done) throw new Error('Fluxo terminou.');
      acumulado += decodificador.decode(value, { stream: true });
    }
  }
  try {
    const primeira = await proximaLista();
    expect(primeira.execucoes.every((e) => e.estado === 'na_fila')).toBe(true);
    const job = (await jobsRepo.reservar(banco, 'teste', [...TIPOS_DO_CODEX]))!;
    const segunda = await proximaLista();
    expect(segunda.execucoes[0]).toMatchObject({ id: job.id, estado: 'rodando' });
    expect(job.id).toBe(jobs.sintetizar.id);
  } finally {
    parar.abort();
    await leitor.cancel().catch(() => undefined);
  }
}));

test('rótulos e mensagens sem documento nem seção', () => {
  const base = { id: idTeste('J', 1), estado: 'reservado' as const, error_code: null, inicio: '2026-10-01T00:00:00.000Z', fim: null,
    documento_id: null, documento_titulo: null, secao_id: null, secao_titulo: null, secao_numero: null };
  expect(rotuloDaExecucao({ ...base, tipo: 'ler_parte' })).toBe('Lendo o texto');
  expect(rotuloDaExecucao({ ...base, tipo: 'responder' })).toBe('Respondendo à sua pergunta');
  expect(rotuloDaExecucao({ ...base, tipo: 'gerar_esquema', documento_titulo: 'Um título longo demais '.repeat(5), secao_titulo: 'Notas', secao_id: idTeste('S', 1) }))
    .toBe('Montando o mapa de “Notas”');
  expect(rotuloDaExecucao({ ...base, tipo: 'ler_parte', documento_titulo: 'x'.repeat(80) })).toMatch(/^Lendo x+…$/);
  expect(mensagemDaExecucao({ estado: 'adiado', error_code: 'cota' })).toMatch(/^A cota do Codex da sua conta acabou por agora\./);
  expect(mensagemDaExecucao({ estado: 'falhou', error_code: 'algo_novo' })).toBe('O Codex não conseguiu terminar.');
  expect(mensagemDaExecucao({ estado: 'ok', error_code: null })).toBeNull();
});
