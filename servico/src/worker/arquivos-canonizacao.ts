import type pg from 'pg';
import { comTransacao } from '../db/transacao.js';
/** Diário de publicação: o banco decide quais diretórios definitivos foram publicados. */
import { lstat, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { renomearComRetentativa } from '../plataforma/disco.js';
import { join } from 'node:path';
import type { Transacao } from '../db/transacao.js';
import { ehUlid, pastaDaCanonizacao, pastaDoDocumento, pastaDaVersao } from '../dados.js';

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
    if (entrada.isDirectory() && entrada.name.startsWith('canonizacao-')) await recolherTentativas(cliente, documentoId, entrada.name.slice(12));
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

/**
 * Pastas de tentativas encerradas (D-12): cada tentativa escreve em `canonizacao-<job>/tentativa-<concessão>`,
 * e uma interrompida (worker morto, concessão vencida, job concluído por outra) ficava para sempre. Só
 * recolhe o que o protocolo reconhece, de job que existe no banco e cuja concessão atual não é aquela; a
 * tentativa em curso, nomes desconhecidos e jobs que o banco não conhece ficam intactos.
 */
async function recolherTentativas(cliente: Transacao, documentoId: string, jobId: string): Promise<void> {
  if (!ehUlid(jobId)) return;
  const pasta = pastaDaCanonizacao(documentoId, jobId);
  let nomes: string[];
  // A lista vem antes da leitura do job: uma tentativa que começar depois tem concessão nova e não está nela.
  try { nomes = (await readdir(pasta, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name); }
  catch (erro) { if (ausente(erro)) return; throw erro; }
  const job = (await cliente.query<{ estado: string; lease_token: string | null }>(
    'SELECT estado, lease_token FROM job WHERE id=$1', [jobId])).rows[0];
  if (!job) return;
  let restantes = nomes.length;
  for (const nome of nomes) {
    const token = nome.startsWith('tentativa-') ? nome.slice(10) : '';
    if (!ehUlid(token) || (job.estado === 'reservado' && job.lease_token === token)) continue;
    await rm(join(pasta, nome), { recursive: true, force: true });
    restantes -= 1;
  }
  if (restantes === 0) await rmdir(pasta).catch(() => undefined);
}

export async function finalizarArquivos(origem: string, documentoId: string, versaoId: string, jobId: string): Promise<string> {
  const destino = pastaDaVersao(documentoId, versaoId);
  // Um destino existente nunca é apagado ou substituído por uma nova tentativa.
  try { await lstat(destino); throw new Error('Destino da versão já existe.'); }
  catch (erro) { if (!ausente(erro)) throw erro; }
  await writeFile(join(origem, DIARIO), JSON.stringify({ documento_id: documentoId, versao_id: versaoId, job_id: jobId }), { flag: 'wx', mode: 0o600 });
  await renomearComRetentativa(origem, destino);
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
