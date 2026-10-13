import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { contratoAudio, type AudioV1 } from '@margem/contratos';
import { ancoraDeSelecao, trechoNoInstante } from '@margem/core';
import { canonicoDeTeste, comBanco, idTeste } from '../../testes/apoio';
import { comTransacao } from '../db/transacao';
import * as documentos from '../repos/documentos';
import { prepararArquivoAudio, publicarAudio } from './publicacao';
import { criarApi } from '../http/app';
test('publicação recusa âncora incoerente, não publica em rollback, deduplica e serve busca no áudio', async () => comBanco('audio_j64', async banco => {
  const antes = process.env.MARGEM_DADOS;
  const pasta = await mkdtemp(join(tmpdir(), 'margem-audio-'));
  process.env.MARGEM_DADOS = pasta;
  try {
    const c = canonicoDeTeste({ blocos: [{ tipo: 'capitulo', texto: 'Capítulo' }, { tipo: 'paragrafo', texto: 'Olá 🧭. Outra frase.' }], secoes: [{ nivel: 1, inicio: 0, fim: 1 }] });
    const versao = await comTransacao(banco, async tx => {
      const d = await documentos.criar(tx, { ...c.documento, origem_caminho: 'teste.txt' });
      return documentos.criarVersao(tx, d.id, c);
    });
    const origem = join(pasta, 'teste.mp3');
    await writeFile(origem, 'bytes de áudio para testar armazenamento e HTTP');
    const hashes = await Promise.all([prepararArquivoAudio(origem), prepararArquivoAudio(origem)]);
    expect(hashes[0]).toBe(hashes[1]);
    const a: AudioV1 = { versao: 1, id: idTeste('A', 1), versao_id: versao.id, secao_id: c.secoes[0]!.id,
      titulo: 'Amostra', sha256_audio: hashes[0], voz_sha256: '0'.repeat(64), job_colab: 'job_abcdef', duracao_s: 3,
      trechos: [{ inicio_s: 0, fim_s: 2, ancora: ancoraDeSelecao({ ...c.blocos[1]!, versao_id: versao.id }, 0, 7) }] };
    const invalido = structuredClone(a); invalido.trechos[0]!.ancora.fim_utf16--;
    const r = contratoAudio.validarLocal(invalido);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros[0]!.caminho).toEqual(['trechos', 0, 'ancora', 'fim_utf16']);
    const fora = structuredClone(a); fora.trechos[0]!.ancora.prefixo = 'inventado';
    await expect(comTransacao(banco, tx => publicarAudio(tx, fora))).rejects.toThrow('incompatível');
    await expect(comTransacao(banco, async tx => { await publicarAudio(tx, a); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect((await banco.query('SELECT id FROM audio')).rowCount).toBe(0);
    const resultados = await Promise.all([a, { ...a, id: idTeste('A', 2) }].map(v => comTransacao(banco, tx => publicarAudio(tx, v))));
    expect(resultados[0]!.id).toBe(resultados[1]!.id);
    await expect(comTransacao(banco, tx => publicarAudio(tx, { ...a, titulo: 'Outro roteiro' }))).rejects.toThrow('outro roteiro');
    expect(trechoNoInstante(a, 1)?.ancora.citacao).toBe('Olá 🧭.');
    expect(trechoNoInstante(a, 2.5)).toBeNull();
    const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); } });
    const lista = await api.request(`/api/versoes/${versao.id}/capitulos/${a.secao_id}/audios`);
    expect((await lista.json() as { audios: AudioV1[] }).audios).toHaveLength(1);
    const url = `/api/audios/${resultados[0]!.id}/arquivo`;
    const trecho = await api.request(url, { headers: { Range: 'bytes=0-4' } });
    expect(trecho.status).toBe(206); expect(await trecho.text()).toBe('bytes');
    expect((await api.request(url, { headers: { Range: 'bytes=999-' } })).status).toBe(416);
    expect((await api.request(url, { headers: { 'If-None-Match': trecho.headers.get('etag')! } })).status).toBe(304);
  } finally {
    if (antes === undefined) delete process.env.MARGEM_DADOS; else process.env.MARGEM_DADOS = antes;
    await rm(pasta, { recursive: true, force: true });
  }
}));
