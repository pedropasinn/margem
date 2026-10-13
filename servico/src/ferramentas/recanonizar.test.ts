import { expect, test } from 'vitest';
import { canonicoDeTeste, comBanco } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import * as documentos from '../repos/documentos.js';
import { TIPO_CANONIZAR } from '../worker/canonizar.js';
import { enfileirarRecanonizacao } from './recanonizar.js';

test('recanonizar enfileira uma canonização nova por rótulo, sem repetir', async () =>
  comBanco('recanonizar', async (banco) => {
    const canonico = canonicoDeTeste({ titulo: 'Paper', blocos: [{ tipo: 'paragrafo', texto: 'Um parágrafo.' }] });
    const versao = await comTransacao(banco, async (cliente) => {
      const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
      return documentos.criarVersao(cliente, documento.id, canonico);
    });
    const primeiro = await comTransacao(banco, (cliente) => enfileirarRecanonizacao(cliente, versao.documento_id, 'papers-2026-10'));
    expect(primeiro).toMatchObject({ tipo: TIPO_CANONIZAR, documento_id: versao.documento_id, estado: 'fila',
      dedup_key: `canonizar:${versao.documento_id}:papers-2026-10` });
    const repetido = await comTransacao(banco, (cliente) => enfileirarRecanonizacao(cliente, versao.documento_id, 'papers-2026-10'));
    expect(repetido.id).toBe(primeiro.id);
    const outro = await comTransacao(banco, (cliente) => enfileirarRecanonizacao(cliente, versao.documento_id, 'outra'));
    expect(outro.id).not.toBe(primeiro.id);
    await expect(comTransacao(banco, (cliente) => enfileirarRecanonizacao(cliente, versao.documento_id, 'com espaço'))).rejects.toThrow('Rótulo');
  }));
