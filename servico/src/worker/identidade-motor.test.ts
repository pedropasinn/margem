import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, vi } from 'vitest';
import { validarCanonico } from '@margem/contratos';
import { comBanco, idTeste } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import { sha256 } from '../executor/artefato.js';
import * as documentos from '../repos/documentos.js';
import { manipuladorCanonizar } from './canonizar.js';
import { FilaEmMemoria } from './fila.js';

test('resultado da canonização registra a identidade efetiva declarada pelo motor', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'margem-identidade-'));
  vi.stubEnv('MARGEM_DADOS', pasta);
  try {
    await comBanco('motor_j58', async banco => {
      const texto = '# Livro\n\nConteúdo sintético de teste.\n';
      const entrada = join(pasta, 'livro.md');
      await writeFile(entrada, texto);
      const documento = await comTransacao(banco, c => documentos.criar(c, {
        titulo: 'Livro', idioma: 'pt', formato: 'md', sha256_original: sha256(texto), origem_caminho: entrada,
      }));
      const job = new FilaEmMemoria().enfileirar({ tipo: 'canonizar', entrada: { documento_id: documento.id, dedup_key: `canonizar:${documento.id}` } });
      const manipulador = manipuladorCanonizar({ banco, raiz: fileURLToPath(new URL('../../../', import.meta.url)) });
      const resultado = await manipulador.executar({ job, lease_token: idTeste('T', 1), sinal: new AbortController().signal });
      expect(resultado.estado).toBe('ok');
      if (resultado.estado !== 'ok') throw new Error('Canonização falhou.');
      const canonico: unknown = JSON.parse(await readFile(resultado.artefato, 'utf8'));
      if (!validarCanonico(canonico)) throw new Error('Canônico inválido.');
      expect(resultado.modelo).toBe(canonico.canonizacao.motor);
      expect(resultado.modelo).toMatch(/^margem-ingest\/2; fonte-sha256\/[a-f0-9]{64}; PyMuPDF\//);
      expect(await readFile(entrada, 'utf8')).toBe(texto);
    });
  } finally {
    vi.unstubAllEnvs();
    await rm(pasta, { recursive: true, force: true });
  }
});
