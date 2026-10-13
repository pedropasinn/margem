import type pg from 'pg';
import { comTransacao } from '../db/transacao.js';
/** Diário de publicação: o banco decide quais diretórios definitivos foram publicados. */
import { lstat, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Transacao } from '../db/transacao.js';
import { ehUlid, pastaDoDocumento, pastaDaVersao } from '../dados.js';

const DIARIO = 'publicacao.json';
export async function bloquearPublicacao(cliente: Transacao, documentoId: string): Promise<void> {
  await cliente.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 3055))', [documentoId]);
}

/** Deve rodar na mesma transação/lock de todas as publicações de canonização. */
export async function reconciliarCanonizacao(cliente: Transacao, documentoId: string): Promise<string[]> {
  await bloquearPublicacao(cliente, documentoId);
  let entradas;
  try { entradas = await readdir(pastaDoDocumento(documentoId), { withFileTypes: true }); }
  catch (erro) { if (ausente(erro)) return []; throw erro; }
  const removidas: string[] = [];
  for (const entrada of entradas) {
    if (!entrada.isDirectory() || !entrada.name.startsWith('versao-')) continue;
    const versaoId = entrada.name.slice(7);
    if (!ehUlid(versaoId)) continue;
    const pasta = pastaDaVersao(documentoId, versaoId);
    let diario: unknown;
    try {
      const caminho = join(pasta, DIARIO);
      const info = await lstat(caminho);
      if (!info.isFile() || info.size > 4096) continue; // diário fixo de três ULIDs, não conteúdo do livro
      diario = JSON.parse(await readFile(caminho, 'utf8'));
    } catch (erro) { if (ausente(erro) || erro instanceof SyntaxError) continue; throw erro; }
    if (!diario || typeof diario !== 'object' || !('documento_id' in diario) || !('versao_id' in diario)
      || !('job_id' in diario) || typeof diario.job_id !== 'string' || !ehUlid(diario.job_id)
      || diario.documento_id !== documentoId || diario.versao_id !== versaoId) continue;
    const publicada = await cliente.query('SELECT id FROM versao_texto WHERE id=$1', [versaoId]);
    if (publicada.rowCount) continue;
    // Só recolhe pastas reconhecidas pelo protocolo. Legado e diretórios desconhecidos ficam intactos.
    await rm(pasta, { recursive: true, force: true });
    removidas.push(versaoId);
  }
  return removidas;
}

export async function finalizarArquivos(origem: string, documentoId: string, versaoId: string, jobId: string): Promise<string> {
  const destino = pastaDaVersao(documentoId, versaoId);
  // Um destino existente nunca é apagado ou substituído por uma nova tentativa.
  try { await lstat(destino); throw new Error('Destino da versão já existe.'); }
  catch (erro) { if (!ausente(erro)) throw erro; }
  await writeFile(join(origem, DIARIO), JSON.stringify({ documento_id: documentoId, versao_id: versaoId, job_id: jobId }), { flag: 'wx', mode: 0o600 });
  await rename(origem, destino);
  return destino;
}
function ausente(erro: unknown): boolean {
  return erro instanceof Error && 'code' in erro && erro.code === 'ENOENT';
}

/** Na retomada do worker, recolhe publicações interrompidas, inclusive de jobs cancelados. */
export async function recuperarPublicacoes(banco: pg.Pool): Promise<void> {
  const documentos = await banco.query<{ id: string }>('SELECT id FROM documento ORDER BY id');
  for (const { id } of documentos.rows) await comTransacao(banco, c => reconciliarCanonizacao(c, id));
}
