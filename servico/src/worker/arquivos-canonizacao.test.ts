import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { comBanco, canonicoDeTeste, idTeste } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import * as documentos from '../repos/documentos.js';
import { pastaDaTentativaDeCanonizacao, pastaDaVersao, pastaDoDocumento } from '../dados.js';
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
