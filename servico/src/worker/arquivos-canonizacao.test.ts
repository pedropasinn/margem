import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { comBanco, canonicoDeTeste, idTeste } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import * as documentos from '../repos/documentos.js';
import { pastaDaCanonizacao, pastaDaTentativaDeCanonizacao, pastaDaVersao, pastaDoDocumento } from '../dados.js';
import { registrarOriginal } from '../http/ingestao.js';
import * as jobs from '../repos/jobs.js';
import { finalizarArquivos, reconciliarCanonizacao } from './arquivos-canonizacao.js';
const temporarios: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const p of temporarios.splice(0)) await rm(p, { recursive: true, force: true }); });

test('rollback depois do rename é reconciliado; commit, legado e outra tentativa são preservados', async () => comBanco('arquivos_j55', async banco => {
  const raiz = await mkdtemp(join(tmpdir(), 'margem-arquivos-')); temporarios.push(raiz); vi.stubEnv('MARGEM_DADOS', raiz);
  const canonico = canonicoDeTeste({ blocos: [{ tipo: 'paragrafo', texto: 'Livro.' }] });
  const doc = await comTransacao(banco, c => documentos.criar(c, { ...canonico.documento, origem_caminho: 'original.txt' }));
  const job = idTeste('J', 1);
  const origem = pastaDaTentativaDeCanonizacao(doc.id, job, idTeste('T', 1));
  const outra = pastaDaTentativaDeCanonizacao(doc.id, job, idTeste('T', 2));
  for (const pasta of [origem, outra]) { await mkdir(pasta, { recursive: true }); await writeFile(join(pasta, 'canonico.json'), JSON.stringify(canonico)); }
  let orfa = '';
  await expect(comTransacao(banco, async c => {
    await reconciliarCanonizacao(c, doc.id);
    const v = await documentos.criarVersao(c, doc.id, canonico); orfa = v.id;
    await finalizarArquivos(origem, doc.id, v.id, job);
    throw new Error('Interrupção após rename e antes do commit.');
  })).rejects.toThrow('Interrupção');
  expect(await readFile(join(pastaDaVersao(doc.id, orfa), 'canonico.json'), 'utf8')).toBe(JSON.stringify(canonico));
  expect(await comTransacao(banco, c => reconciliarCanonizacao(c, doc.id))).toEqual([orfa]);
  expect(await readFile(join(outra, 'canonico.json'), 'utf8')).toBe(JSON.stringify(canonico));
  const publicada = await comTransacao(banco, async c => {
    await reconciliarCanonizacao(c, doc.id);
    const v = await documentos.criarVersao(c, doc.id, canonico);
    await finalizarArquivos(outra, doc.id, v.id, job); return v;
  });
  const legado = pastaDaVersao(doc.id, idTeste('V', 4)); await mkdir(legado);
  expect(await comTransacao(banco, c => reconciliarCanonizacao(c, doc.id))).toEqual([]);
  expect(await readdir(pastaDoDocumento(doc.id))).toContain(`versao-${publicada.id}`);
  expect(await readdir(pastaDoDocumento(doc.id))).toContain(`versao-${idTeste('V', 4)}`);
  await expect(finalizarArquivos(legado, doc.id, publicada.id, job)).rejects.toThrow('já existe');
}));

test('reconciliação espera uma publicação em andamento e não apaga sua pasta antes do commit', async () => comBanco('arquivos_lock_j55', async banco => {
  const raiz = await mkdtemp(join(tmpdir(), 'margem-lock-')); temporarios.push(raiz); vi.stubEnv('MARGEM_DADOS', raiz);
  const canonico = canonicoDeTeste({ blocos: [{ tipo: 'paragrafo', texto: 'Livro.' }] });
  const doc = await comTransacao(banco, c => documentos.criar(c, { ...canonico.documento, origem_caminho: 'original.txt' }));
  const job = idTeste('J', 1), origem = pastaDaTentativaDeCanonizacao(doc.id, job, idTeste('T', 1));
  await mkdir(origem, { recursive: true }); await writeFile(join(origem, 'canonico.json'), JSON.stringify(canonico));
  let avisar!: (id: string) => void;
  let liberar!: () => void;
  const movida = new Promise<string>(resolver => { avisar = resolver; });
  const espera = new Promise<void>(resolver => { liberar = resolver; });
  const publicacao = comTransacao(banco, async c => {
    await reconciliarCanonizacao(c, doc.id);
    const v = await documentos.criarVersao(c, doc.id, canonico);
    await finalizarArquivos(origem, doc.id, v.id, job); avisar(v.id);
    await espera; return v;
  });
  const id = await movida;
  const recuperacao = comTransacao(banco, c => reconciliarCanonizacao(c, doc.id));
  try {
    await vi.waitFor(async () => {
      const esperando = await banco.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND wait_event='advisory'");
      expect(esperando.rowCount).toBeGreaterThan(0);
    });
    expect(await readFile(join(pastaDaVersao(doc.id, id), 'canonico.json'), 'utf8')).toBe(JSON.stringify(canonico));
  } finally { liberar(); await publicacao; }
  expect(await recuperacao).toEqual([]);
  expect(await readFile(join(pastaDaVersao(doc.id, id), 'canonico.json'), 'utf8')).toBe(JSON.stringify(canonico));
}));

test('D-12: tentativas encerradas são recolhidas; a em curso e o desconhecido ficam', async () => comBanco('arquivos_d12', async banco => {
  const raiz = await mkdtemp(join(tmpdir(), 'margem-d12-')); temporarios.push(raiz); vi.stubEnv('MARGEM_DADOS', raiz);
  const canonico = canonicoDeTeste({ blocos: [{ tipo: 'paragrafo', texto: 'Livro.' }] });
  const doc = await comTransacao(banco, c => documentos.criar(c, { ...canonico.documento, origem_caminho: 'original.txt' }));
  const job = await comTransacao(banco, c => jobs.enfileirar(c, { tipo: 'canonizar', dedup_key: `canonizar:${doc.id}`, input_snapshot_hash: 'a'.repeat(64), documento_id: doc.id }));
  const reservado = (await jobs.reservar(banco, 'teste', ['canonizar']))!;
  const antiga = pastaDaTentativaDeCanonizacao(doc.id, job.id, idTeste('T', 1));
  const atual = pastaDaTentativaDeCanonizacao(doc.id, job.id, reservado.lease_token!);
  const estranha = join(pastaDaCanonizacao(doc.id, job.id), 'nao-e-tentativa');
  const deOutroJob = pastaDaTentativaDeCanonizacao(doc.id, idTeste('J', 9), idTeste('T', 2));
  for (const pasta of [antiga, atual, estranha, deOutroJob]) { await mkdir(pasta, { recursive: true }); await writeFile(join(pasta, 'canonico.json'), '{}'); }
  await comTransacao(banco, c => reconciliarCanonizacao(c, doc.id));
  const restantes = async () => (await readdir(pastaDaCanonizacao(doc.id, job.id))).sort();
  expect(await restantes()).toEqual(['nao-e-tentativa', `tentativa-${reservado.lease_token!}`]);
  // Job concluído: a tentativa que sobrou também sai; o nome desconhecido e o job que o banco não conhece, não.
  await banco.query("UPDATE job SET estado='ok', lease_token=NULL WHERE id=$1", [job.id]);
  await comTransacao(banco, c => reconciliarCanonizacao(c, doc.id));
  expect(await restantes()).toEqual(['nao-e-tentativa']);
  expect(await readdir(pastaDaCanonizacao(doc.id, idTeste('J', 9)))).toEqual([`tentativa-${idTeste('T', 2)}`]);
  // Só com tentativas, a pasta do job some inteira.
  await rm(estranha, { recursive: true });
  await mkdir(antiga, { recursive: true });
  await comTransacao(banco, c => reconciliarCanonizacao(c, doc.id));
  expect(await readdir(pastaDoDocumento(doc.id))).not.toContain(`canonizacao-${job.id}`);
}));

test('D-12: importação desfeita não deixa a pasta do original para trás', async () => comBanco('arquivos_d12_imp', async banco => {
  const raiz = await mkdtemp(join(tmpdir(), 'margem-d12-imp-')); temporarios.push(raiz); vi.stubEnv('MARGEM_DADOS', raiz);
  await mkdir(join(raiz, 'outra-pasta'));
  let criado = '';
  await expect(registrarOriginal(banco, {
    titulo: 'Livro', formato: 'txt', bytes: new TextEncoder().encode('Texto.'), paginas: null, poesia: false,
    antesDeConfirmar: (id) => { criado = id; return Promise.reject(new Error('falha antes do commit')); },
  })).rejects.toThrow('falha antes do commit');
  expect(criado).not.toBe('');
  expect(await readdir(raiz)).toEqual(['outra-pasta']);
  expect((await banco.query('SELECT 1 FROM documento')).rowCount).toBe(0);
}));
