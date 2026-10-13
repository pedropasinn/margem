/**
 * J90 · Transcrição revisada vira versão nova do mesmo documento, com a mídia realinhada na mesma
 * transação. Motor Python de verdade (TXT), vídeo gerado pelo ffmpeg, sem Codex (a revisão chega pronta).
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type pg from 'pg';
import { expect, test } from 'vitest';
import { conferirAncora, type Id, type MidiaV1 } from '@margem/contratos';
import { comBanco } from '../../testes/apoio';
import { raizDoRepositorio } from '../dados';
import { criarApi } from '../http/app';
import { CABECALHO_MARGEM } from '../http/ambiente';
import { manipuladorCanonizar, TIPO_CANONIZAR } from '../worker/canonizar';
import { FilaPostgres } from '../worker/fila-postgres';
import { Worker } from '../worker/worker';
import { ancoraNoBloco, caminhoDaRevisao, manipuladorCanonizarRevisao, textoDaTranscricao, TIPO_CANONIZAR_REVISAO } from './revisao';

const executar = promisify(execFile);
const ESCRITA = { [CABECALHO_MARGEM]: '1' };
const JSON_ESCRITA = { ...ESCRITA, 'Content-Type': 'application/json' };

async function rodarWorker(banco: pg.Pool, vagas: string): Promise<void> {
  await new Worker({
    fila: new FilaPostgres(banco),
    manipuladores: {
      [TIPO_CANONIZAR]: manipuladorCanonizar({ banco, raiz: raizDoRepositorio(), prazoMs: 120_000 }),
      [TIPO_CANONIZAR_REVISAO]: manipuladorCanonizarRevisao({ banco, raiz: raizDoRepositorio(), prazoMs: 120_000 }),
    },
    diretorioSlots: vagas, slots: 1, intervaloMs: 5, maximoCiclos: 2,
  }).rodar();
}

function palavrasDe(paragrafos: string[], deslocamento = 0): { texto: string; inicio_s: number; fim_s: number }[] {
  return paragrafos.join(' ').split(/\s+/).map((texto, i) => ({ texto, inicio_s: deslocamento + i * 0.2, fim_s: deslocamento + i * 0.2 + 0.15 }));
}

test('transcrição revisada: versão nova, mídia realinhada, base intacta, idempotência e recusas', async () => comBanco('revisao_j90', async (banco) => {
  const antes = process.env.MARGEM_DADOS;
  const pasta = await mkdtemp(join(tmpdir(), 'margem-j90-'));
  process.env.MARGEM_DADOS = pasta;
  try {
    const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); } });
    const original = ['Os modelos de A avançam depressa.', 'A Antropic lançou outro modelo, open Waits, hoje.'];
    const formulario = new FormData();
    formulario.set('titulo', 'Vídeo de teste'); formulario.set('autor', 'Canal'); formulario.set('formato', 'txt');
    formulario.set('arquivo', new File([textoDaTranscricao(original)], 'v.txt', { type: 'text/plain' }));
    const { documento_id: documentoId } = await (await api.request('/api/documentos', { method: 'POST', headers: ESCRITA, body: formulario })).json() as { documento_id: Id };
    await rodarWorker(banco, join(pasta, 'vagas'));
    const detalhe = async () => await (await api.request(`/api/documentos/${documentoId}`)).json() as { versao_id: Id; versoes: { id: Id; numero: number }[] };
    const base = (await detalhe()).versao_id;

    const video = join(pasta, 'v.mp4');
    await executar('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=160x90:d=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
    const { sha256 } = await (await api.request('/api/midia/arquivos', { method: 'PUT', headers: { ...ESCRITA, 'Content-Type': 'video/mp4' }, body: await readFile(video) })).json() as { sha256: string };
    const palavras = palavrasDe(original);
    const publicada = await api.request(`/api/documentos/${documentoId}/midias`, { method: 'POST', headers: JSON_ESCRITA, body: JSON.stringify({
      sha256, titulo: 'Vídeo de teste', fonte: { url: 'https://www.youtube.com/watch?v=x' }, capitulos: [{ inicio_s: 0, titulo: 'Início' }],
      transcricao: { motor: 'whisper', idioma: 'pt', palavras } }) });
    expect(publicada.status).toBe(201);

    // O leitor estava no meio do vídeo: o ponto de leitura tem de passar para a versão revisada.
    const segundo = (await banco.query<{ id: Id; texto: string }>("SELECT id, texto FROM bloco WHERE versao_id=$1 AND tipo='paragrafo' ORDER BY ordem OFFSET 1 LIMIT 1", [base])).rows[0]!;
    const inicio = segundo.texto.indexOf('outro modelo');
    const ponto = { documento_id: documentoId, versao_id: base, revisao_esperada: 0, capitulos_concluidos: [], atualizado_em: '2026-09-29T12:00:00.000Z',
      ancora: { versao_id: base, bloco_id: segundo.id, inicio_utf16: inicio, fim_utf16: inicio + 12, citacao: 'outro modelo', prefixo: segundo.texto.slice(0, inicio), sufixo: segundo.texto.slice(inicio + 12) } };
    expect((await api.request(`/api/documentos/${documentoId}/progresso`, { method: 'PUT', headers: JSON_ESCRITA, body: JSON.stringify(ponto) })).status).toBe(200);

    // A revisão: "A" → "IA" e "Antropic" → "Anthropic" (1:1, mesmos tempos); "open Waits," → "open weights,".
    const revisados = ['Os modelos de IA avançam depressa.', 'A Anthropic lançou outro modelo, open weights, hoje.'];
    const corpo = { versao_base_id: base, paragrafos: revisados, resumo: { prompt: 'revisar-transcricao@1', aplicadas: 3 },
      transcricao: { motor: 'whisper + revisão', idioma: 'pt', palavras: palavras.map((p, i) => ({ ...p, texto: revisados.join(' ').split(' ')[i]! })) } };
    const url = `/api/documentos/${documentoId}/transcricoes-revisadas`;
    const enviar = (c: unknown) => api.request(url, { method: 'POST', headers: JSON_ESCRITA, body: JSON.stringify(c) });

    // Recusas antes de registrar: tokens ≠ palavras, texto igual ao atual, base que não é a última, campo estranho.
    expect((await enviar({ ...corpo, paragrafos: ['outra coisa'] })).status).toBe(400);
    const igual = await enviar({ ...corpo, paragrafos: original, transcricao: { ...corpo.transcricao, palavras } });
    expect(igual.status).toBe(409);
    expect((await igual.json() as { erro: string }).erro).toBe('sem_mudanca');
    expect((await enviar({ ...corpo, versao_base_id: documentoId })).status).toBe(409);
    expect((await enviar({ ...corpo, extra: 1 })).status).toBe(400);

    const registrada = await enviar(corpo);
    expect(registrada.status).toBe(202);
    const { job_id: jobId, sha256_texto: shaTexto } = await registrada.json() as { job_id: Id; sha256_texto: string };
    expect(await readFile(caminhoDaRevisao(documentoId, shaTexto), 'utf8')).toBe(textoDaTranscricao(revisados));
    const repetida = await enviar(corpo);
    expect(repetida.status).toBe(200);
    expect((await repetida.json() as { job_id: Id }).job_id).toBe(jobId);

    await rodarWorker(banco, join(pasta, 'vagas'));
    const depois = await detalhe();
    expect(depois.versoes).toHaveLength(2);
    expect(depois.versao_id).not.toBe(base);
    const { rows: [job] } = await banco.query<{ estado: string }>('SELECT estado FROM job WHERE id=$1', [jobId]);
    expect(job!.estado).toBe('ok');

    // Versão nova com o texto revisado e a mídia realinhada (mesmo arquivo); a base continua como era.
    const blocos = (await banco.query<{ texto: string }>("SELECT texto FROM bloco WHERE versao_id=$1 AND tipo='paragrafo' ORDER BY ordem", [depois.versao_id])).rows.map((b) => b.texto);
    expect(blocos).toEqual(revisados);
    const [nova] = (await (await api.request(`/api/versoes/${depois.versao_id}/midias`)).json() as { midias: MidiaV1[] }).midias;
    expect(nova!.sha256).toBe(sha256);
    expect(nova!.palavras).toHaveLength(palavras.length);
    expect(nova!.transcricao.motor).toBe('whisper + revisão');
    expect(nova!.capitulos).toEqual([{ inicio_s: 0, titulo: 'Início' }]);
    const ia = nova!.palavras[3]!;
    const textoIa = (await banco.query<{ texto: string }>('SELECT texto FROM bloco WHERE versao_id=$1 AND id=$2', [depois.versao_id, ia.bloco_id])).rows[0]!.texto;
    expect(textoIa.slice(ia.inicio_utf16, ia.fim_utf16)).toBe('IA');
    expect(ia.inicio_s).toBeCloseTo(palavras[3]!.inicio_s, 3);
    const [velha] = (await (await api.request(`/api/versoes/${base}/midias`)).json() as { midias: MidiaV1[] }).midias;
    expect(velha!.transcricao.motor).toBe('whisper');
    const eventos = await banco.query<{ detalhe: { alinhadas: number; progresso: string } }>("SELECT detalhe FROM evento_job WHERE job_id=$1 AND tipo='midia_realinhada'", [jobId]);
    expect(eventos.rows[0]!.detalhe).toMatchObject({ alinhadas: palavras.length, progresso: 'levado' });
    const { progresso } = await (await api.request(`/api/documentos/${documentoId}/progresso`)).json() as { progresso: { versao_id: Id; revisao: number; ancora: { citacao: string; bloco_id: Id } } };
    expect(progresso).toMatchObject({ versao_id: depois.versao_id, revisao: 2, ancora: { citacao: 'outro modelo' } });

    // Comparar versões (J65) funciona entre a base e a revisada: os dois parágrafos mudaram.
    const comparacao = await (await api.request(`/api/versoes/${base}/comparar/${depois.versao_id}`)).json() as { totais: { sem_par_antes: number; sem_par_depois: number } };
    expect(comparacao.totais).toMatchObject({ sem_par_antes: 2, sem_par_depois: 2 });

    // Com uma nota do leitor na versão atual, a próxima revisão é recusada (a nota não pode sumir da leitura)…
    const bloco = (await banco.query<{ id: Id; texto: string }>("SELECT id, texto FROM bloco WHERE versao_id=$1 AND tipo='paragrafo' ORDER BY ordem LIMIT 1", [depois.versao_id])).rows[0]!;
    const ancora = { versao_id: depois.versao_id, bloco_id: bloco.id, inicio_utf16: 0, fim_utf16: 3, citacao: bloco.texto.slice(0, 3), prefixo: '', sufixo: bloco.texto.slice(3, 35) };
    expect((await api.request('/api/anotacoes', { method: 'POST', headers: JSON_ESCRITA, body: JSON.stringify({ ancora, tipo: 'impressao', texto: 'nota' }) })).status).toBe(201);
    const outra = ['Os modelos de IA avançam depressa!', revisados[1]!];
    const segunda = { ...corpo, versao_base_id: depois.versao_id, paragrafos: outra, transcricao: { ...corpo.transcricao, palavras: corpo.transcricao.palavras.map((p, i) => ({ ...p, texto: outra.join(' ').split(' ')[i]! })) } };
    const recusada = await enviar(segunda);
    expect(recusada.status).toBe(409);
    const motivo = await recusada.json() as { erro: string; detalhe: string };
    expect(motivo.erro).toBe('versao_com_anotacoes');
    expect(motivo.detalhe).toContain('anotacoes: 1');
    // …a menos que o pedido aceite explicitamente deixá-la na versão anterior.
    expect((await enviar({ ...segunda, aceitar_anotacoes_na_versao_anterior: true })).status).toBe(202);
    await expect(banco.query('UPDATE revisao_transcricao SET resumo=$1', ['{}'])).rejects.toThrow();
  } finally {
    if (antes === undefined) delete process.env.MARGEM_DADOS; else process.env.MARGEM_DADOS = antes;
    await rm(pasta, { recursive: true, force: true });
  }
}), 120_000);

test('âncora do progresso na versão revisada: citação única, repetida ou sumida; sem partir par substituto', () => {
  const versao = '01M3QQ8RQQJG5XAFE30CZXF8FY';
  const bloco = { id: '01M3QQ8RQQJG5XAFE30CZXF8FZ', texto: '🧭 A Anthropic lançou, e a Anthropic 🧭 respondeu depois de muito tempo, com calma.' };
  const unica = ancoraNoBloco(versao, bloco, 'lançou');
  expect(unica.citacao).toBe('lançou');
  expect(conferirAncora(bloco, unica)).toBe(true);
  for (const citacao of ['Anthropic', 'Antropic', '']) {
    const inicio = ancoraNoBloco(versao, bloco, citacao);
    expect(inicio.inicio_utf16).toBe(0);
    expect(conferirAncora(bloco, inicio)).toBe(true);
  }
  const curto = { id: bloco.id, texto: 'x'.repeat(47) + '🧭 fim' };
  const partido = ancoraNoBloco(versao, curto, 'nada');
  expect(partido.fim_utf16).toBe(49);
  expect(conferirAncora(curto, partido)).toBe(true);
});
