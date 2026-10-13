import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { canonicoDeTeste } from '../../testes/apoio';
import { prepararManifestoDaVersao } from './canonizar';
import { sha256 } from '../executor/artefato';
test('manifesto inclui bytes de proveniência conferidos e recusa outra versão do conteúdo', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'margem-proveniencia-'));
  try {
    const c = canonicoDeTeste({ blocos: [{ tipo: 'paragrafo', texto: 'Texto de teste.' }] });
    await writeFile(join(pasta, 'canonico.json'), JSON.stringify(c));
    const p = { versao: 1, sha256_original: c.documento.sha256_original, hash_estrutural: c.hash_estrutural,
      extrator: { nome: 'PyMuPDF', versao: '1' }, observacoes: [], transformacoes: [] };
    const texto = JSON.stringify(p);
    await writeFile(join(pasta, 'proveniencia.json'), texto);
    await prepararManifestoDaVersao(pasta, '0'.repeat(26));
    const manifesto = JSON.parse(await readFile(join(pasta, 'manifesto.json'), 'utf8')) as { arquivos: unknown[] };
    expect(manifesto.arquivos).toContainEqual({ caminho: 'proveniencia.json', sha256: sha256(texto) });
    p.hash_estrutural = 'f'.repeat(64);
    await writeFile(join(pasta, 'proveniencia.json'), JSON.stringify(p));
    await expect(prepararManifestoDaVersao(pasta, '0'.repeat(26))).rejects.toThrow('não corresponde');
  } finally { await rm(pasta, { recursive: true, force: true }); }
});
