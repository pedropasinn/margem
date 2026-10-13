import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { EdicaoDeNoticiasV1, EditorialDeNoticiasV1 } from '@margem/contratos';
import { validarCanonico, hashEstrutural } from '@margem/contratos';
import { comBanco } from '../../testes/apoio.js';
import { criarApi } from '../http/app.js';
import { criarExecutorFalso } from '../executor/fake.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { Worker } from '../worker/worker.js';
import { conferirEdicao, conferirNarracao, hash } from './validar.js';
import { hubNoticias, pedirEdicao, registro, relogioNoticias } from './repositorio.js';
import { pedirCapa, TIPO_CAPA_NOTICIAS } from './capas.js';
import { comTransacao } from '../db/transacao.js';
import { manipuladoresDasNoticias } from './pipeline.js';
import { guardarNaBiblioteca, textoDaEdicao } from './biblioteca.js';

let dados = '';
beforeEach(async () => { dados = await mkdtemp(join(tmpdir(), 'margem-noticias-teste-')); process.env.MARGEM_DADOS = dados; });
afterEach(async () => { delete process.env.MARGEM_DADOS; await rm(dados, { recursive: true, force: true }); });
const texto = 'A biblioteca ganhou um extrator com localização das citações. O resultado ainda não foi avaliado em português.';
const fonte = { url: 'https://simonwillison.net/exemplo', titulo: 'Exemplo sintético', publicada_em: '2026-10-05T09:00:00Z', texto, sha256: hash(texto), acesso: 'pagina' as const };
const editorial: EditorialDeNoticiasV1 = { titulo: 'Documento de teste', abertura: 'Uma mudança para avaliar.', roteiro: 'O extrator localiza citações. Falta avaliar o português.', noticias: [
  { titulo: 'Citações localizadas', resumo: 'Um extrator localiza citações.', importancia: 'Pode servir ao Margem.', projeto: 'Margem', natureza: 'novidade', limite: 'Português não avaliado.', evidencias: [{ fonte_url: fonte.url, citacao: 'O resultado ainda não foi avaliado em português.' }] },
] };
const coleta = { fontes: [fonte], cobertura: [{ nome: 'Fonte de teste', url: 'https://simonwillison.net/atom/everything/', estado: 'ok' as const, candidatos: 1, lidos: 1, limite: '' }] };
const edicao = (): EdicaoDeNoticiasV1 => structuredClone({ ...editorial, ...coleta, versao: 1, foco: 'ia_aplicada', corte_em: '2026-10-05T10:00:00Z' });

test('contrato recusa campos extras, fonte adulterada, citações inventadas e roteiro excessivo', () => {
  expect(conferirEdicao(edicao()).noticias).toHaveLength(1);
  expect(() => conferirEdicao({ ...edicao(), extra: true })).toThrow();
  const alterada = edicao(); alterada.fontes[0]!.texto += 'alterado';
  expect(() => conferirEdicao(alterada)).toThrow('alterada');
  const inventada = edicao(); inventada.noticias[0]!.evidencias[0]!.citacao = 'Invenção.';
  expect(() => conferirEdicao(inventada)).toThrow('Evidência');
  expect(() => conferirEdicao({ ...edicao(), roteiro: 'a '.repeat(601) })).toThrow('600');
  const antiga = edicao(); antiga.fontes[0]!.publicada_em = '2025-10-01T00:00:00Z';
  expect(conferirEdicao(antiga).noticias[0]!.natureza).toBe('repertorio');
});

test('narração tem vínculo ao roteiro e teto estrito; relógio usa São Paulo', () => {
  expect(() => conferirNarracao('a', hash('b'), 299)).toThrow('roteiro');
  for (const s of [0, NaN, Infinity, 300.01]) expect(() => conferirNarracao('a', hash('a'), s)).toThrow('cinco');
  expect(() => conferirNarracao('a', hash('a'), 300)).not.toThrow();
  expect(relogioNoticias(new Date('2026-10-05T02:59:00Z'))).toEqual({ dia: '2026-10-04', hora: 23 });
});

test('revista vira texto canônico compatível com o leitor', () => {
  const t = textoDaEdicao(edicao());
  expect(validarCanonico({ versao: 1, documento: { titulo: 'Teste', idioma: 'pt-BR', formato: 'txt', sha256_original: hash(t.original) }, canonizacao: { motor: 'teste', gerado_em: '2026-10-05T10:00:00Z' }, blocos: t.blocos, secoes: t.secoes, hash_estrutural: hashEstrutural(t.blocos), assets: [], limites: [] })).toBe(true);
});

test.each(['2026-10-05T10:00:00Z', '2026-10-06T10:00:00Z'])('agenda, fila, revisão, áudio e importação idempotente no Postgres (criada em %s)', async criadaEm => comBanco('noticias_fluxo', async banco => {
  expect(await pedirEdicao(banco, new Date('2026-10-05T09:59:00Z'), true)).toBeNull();
  const ids = await Promise.all([pedirEdicao(banco, new Date('2026-10-05T10:00:00Z'), true), pedirEdicao(banco, new Date('2026-10-05T10:00:00Z'), true)]);
  expect(ids[0]).toBe(ids[1]); const id = ids[0]!;
  // criado_em vem do relógio do Postgres; fixar a fixture cobre edição diária e retrospectiva em qualquer data.
  await banco.query('UPDATE noticia_edicao SET criado_em=$2 WHERE id=$1', [id, criadaEm]);
  const falso = criarExecutorFalso({ versao: 1, passos: [
    { quando: { ordem: 1 }, tipo: 'ok', conteudo: editorial },
    { quando: { ordem: 2 }, tipo: 'ok', conteudo: { aprovada: true, problemas: [] } },
  ] });
  const manipuladores = manipuladoresDasNoticias({ banco, executor: falso, modelo: 'falso', esforco: 'low', coletar: () => Promise.resolve(structuredClone(coleta)),
    narrar: async (_r, saida) => { await writeFile(saida, 'audio-sintetico-de-teste'); return 120; } });
  const rodar = async () => new Worker({ fila: new FilaPostgres(banco), manipuladores, slots: 1, diretorioSlots: join(dados, 'slots'), maximoCiclos: 1, intervaloMs: 5, heartbeatMs: 60_000 }).rodar();
  await rodar();
  expect((await registro(banco, id)).conteudo?.titulo).toBe(criadaEm.startsWith('2026-10-06') ? `Retrospectiva — ${editorial.titulo}` : editorial.titulo);
  await rodar();
  const hub = await hubNoticias(banco);
  expect(hub.edicoes[0]!.audio?.duracao_s).toBe(120);
  const docs = await Promise.all([guardarNaBiblioteca(banco, id), guardarNaBiblioteca(banco, id)]);
  expect(docs[0]).toBe(docs[1]);
  expect((await banco.query('SELECT id FROM documento')).rows).toHaveLength(1);
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); }, recursos: new Set(['noticias'] as const) });
  expect((await api.request('/api/noticias')).status).toBe(200);
  expect((await api.request(`/api/noticias/${id}/audio`, { headers: { Range: 'bytes=0-4' } })).status).toBe(206);
  expect((await api.request('/api/noticias/agenda', { method: 'PUT', headers: { 'X-Margem': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ ativa: false, hora: 7, extra: true }) })).status).toBe(400);
}));

test('revisão recusada não publica revista nem áudio', async () => comBanco('noticias_revisao', async banco => {
  const id = (await pedirEdicao(banco, new Date('2026-10-05T10:00:00Z')))!;
  await banco.query('UPDATE noticia_edicao SET criado_em=corte_em WHERE id=$1', [id]);
  const executor = criarExecutorFalso({ versao: 1, passos: [
    { quando: { ordem: 1 }, tipo: 'ok', conteudo: editorial },
    { quando: { ordem: 2 }, tipo: 'ok', conteudo: { aprovada: false, problemas: ['Afirmação sem suporte.'] } },
  ] });
  await new Worker({ fila: new FilaPostgres(banco), manipuladores: manipuladoresDasNoticias({ banco, executor, modelo: 'falso', esforco: 'low', coletar: () => Promise.resolve(structuredClone(coleta)) }), slots: 1, diretorioSlots: join(dados, 'slots'), maximoCiclos: 1 }).rodar();
  expect((await registro(banco, id)).conteudo).toBeNull();
  expect((await hubNoticias(banco)).edicoes[0]!.estado).toBe('falhou');
}));

test('áudio acima do teto falha sem retirar a revista publicada', async () => comBanco('noticias_teto', async banco => {
  const id = (await pedirEdicao(banco, new Date('2026-10-05T10:00:00Z')))!;
  await banco.query('UPDATE noticia_edicao SET criado_em=corte_em WHERE id=$1', [id]);
  const executor = criarExecutorFalso({ versao: 1, passos: [
    { quando: { ordem: 1 }, tipo: 'ok', conteudo: editorial },
    { quando: { ordem: 2 }, tipo: 'ok', conteudo: { aprovada: true, problemas: [] } },
  ] });
  const manipuladores = manipuladoresDasNoticias({ banco, executor, modelo: 'falso', esforco: 'low',
    coletar: () => Promise.resolve(structuredClone(coleta)), narrar: () => Promise.resolve(301) });
  for (let i = 0; i < 2; i++) await new Worker({ fila: new FilaPostgres(banco), manipuladores, slots: 1, diretorioSlots: join(dados, 'slots'), maximoCiclos: 1 }).rodar();
  expect((await registro(banco, id)).conteudo?.titulo).toBe(editorial.titulo);
  const e = (await hubNoticias(banco)).edicoes[0]!;
  expect(e.estado_audio).toBe('falhou'); expect(e.audio).toBeNull(); expect(e.estado).toBe('ok');
}));


test('capa automática é única, tem PNG próprio e permite nova tentativa sem alterar revista', async () => comBanco('noticias_capa', async banco => {
  const id = (await pedirEdicao(banco, new Date('2026-10-05T10:00:00Z')))!;
  await banco.query('UPDATE noticia_edicao SET criado_em=corte_em WHERE id=$1', [id]);
  const falso = criarExecutorFalso({ versao: 1, passos: [
    { tipo: 'ok', conteudo: editorial }, { tipo: 'ok', conteudo: { aprovada: true, problemas: [] } },
    { tipo: 'ok', conteudo: { descricao: 'Papéis recortados em uma mesa de pesquisa.' }, imagens: 0 },
    { tipo: 'ok', conteudo: { descricao: 'Papéis recortados em uma mesa de pesquisa.' }, imagens: 1 },
  ] });
  const manipuladores = manipuladoresDasNoticias({ banco, executor: falso, modelo: 'falso', esforco: 'low', coletar: () => Promise.resolve(structuredClone(coleta)), narrar: async (_r, saida) => { await writeFile(saida, 'audio'); return 120; } });
  const rodar = () => new Worker({ fila: new FilaPostgres(banco), manipuladores, slots: 1, diretorioSlots: join(dados, 'slots'), maximoCiclos: 1, intervaloMs: 5, heartbeatMs: 60_000 }).rodar();
  await rodar(); // publica texto e agenda áudio e capa
  const jobs = await Promise.all([comTransacao(banco, c => pedirCapa(c, id)), comTransacao(banco, c => pedirCapa(c, id))]);
  expect(jobs[0]?.id).toBe(jobs[1]?.id);
  expect((await banco.query('SELECT id FROM job WHERE tipo=$1', [TIPO_CAPA_NOTICIAS])).rowCount).toBe(1);
  await rodar(); // áudio
  await rodar(); // imagem ausente
  let h = await hubNoticias(banco);
  expect(h.edicoes[0]?.estado_capa).toBe('falhou');
  expect(h.edicoes[0]?.conteudo).not.toBeNull();
  expect(h.edicoes[0]?.audio).not.toBeNull();
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); }, recursos: new Set(['noticias'] as const) });
  expect((await api.request(`/api/noticias/${id}/capa`, { method: 'POST', headers: { 'X-Margem': '1' } })).status).toBe(202);
  await rodar();
  h = await hubNoticias(banco);
  expect(h.edicoes[0]?.capa?.descricao).toBe('Papéis recortados em uma mesa de pesquisa.');
  const imagem = await api.request(`/api/noticias/${id}/capa`);
  expect(imagem.status).toBe(200); expect(imagem.headers.get('content-type')).toBe('image/png');
  expect((await imagem.arrayBuffer()).byteLength).toBe(h.edicoes[0]?.capa?.bytes);
  expect((await api.request(`/api/noticias/${id}/capa`, { headers: { 'If-None-Match': imagem.headers.get('etag')! } })).status).toBe(304);
  expect(await comTransacao(banco, c => pedirCapa(c, id))).toBeNull();
}));
