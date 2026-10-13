import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type pg from 'pg';
import { comTransacao } from './transacao.js';

const pasta = new URL('./migrations/', import.meta.url);
async function listar(ate?: string): Promise<string[]> {
  return (await readdir(pasta)).filter(nome => /^\d{4}_.+\.sql$/.test(nome)).sort()
    .filter(nome => ate === undefined || nome <= ate);
}

/**
 * Só lê: devolve as migrações do código que o banco ainda não tem. Recusa migração
 * alterada depois de aplicada, como `migrar`. Não cria a tabela `migracao`.
 */
export async function migracoesPendentes(banco: pg.Pool): Promise<string[]> {
  const existe = (await banco.query<{ tabela: string | null }>("SELECT to_regclass('migracao')::text AS tabela")).rows[0]?.tabela;
  const aplicadas = new Map<string, string>();
  if (existe) {
    for (const linha of (await banco.query<{ nome: string; sha256: string }>('SELECT nome, sha256 FROM migracao')).rows) {
      aplicadas.set(linha.nome, linha.sha256);
    }
  }
  const pendentes: string[] = [];
  for (const nome of await listar()) {
    const sha = aplicadas.get(nome);
    if (sha === undefined) { pendentes.push(nome); continue; }
    const hash = createHash('sha256').update(await readFile(new URL(nome, pasta), 'utf8'), 'utf8').digest('hex');
    if (sha !== hash) throw new Error(`Migração alterada depois de aplicada: ${nome}`);
  }
  return pendentes;
}

/** `ate` para numa migração (inclusiva); só os testes de migração com dados antigos o usam. */
export async function migrar(banco: pg.Pool, opcoes: { ate?: string } = {}): Promise<void> {
  const arquivos = await listar(opcoes.ate);
  await comTransacao(banco, async cliente => {
    await cliente.query('SELECT pg_advisory_xact_lock(3001)');
    await cliente.query(`CREATE TABLE IF NOT EXISTS migracao (
      nome text PRIMARY KEY, sha256 text NOT NULL, aplicada_em timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    for (const nome of arquivos) {
      const sql = await readFile(new URL(nome, pasta), 'utf8');
      const hash = createHash('sha256').update(sql, 'utf8').digest('hex');
      const existente = await cliente.query<{ sha256: string }>('SELECT sha256 FROM migracao WHERE nome = $1', [nome]);
      if (existente.rows[0]) {
        if (existente.rows[0].sha256 !== hash) throw new Error(`Migração alterada depois de aplicada: ${nome}`);
        continue;
      }
      await cliente.query(sql);
      await cliente.query('INSERT INTO migracao(nome,sha256) VALUES ($1,$2)', [nome, hash]);
    }
  });
}

/**
 * `MARGEM_MIGRAR_AO_SUBIR=0` (a prévia, que lê o banco de produção) não migra: só confere
 * e recusa subir se o código trouxer migração que o banco ainda não tem. Qualquer outro
 * valor, ou ausente, migra ao subir (o comportamento da produção).
 */
export async function prepararBanco(banco: pg.Pool, ambiente: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (ambiente.MARGEM_MIGRAR_AO_SUBIR !== '0') { await migrar(banco); return; }
  const pendentes = await migracoesPendentes(banco);
  if (pendentes.length > 0) {
    throw new Error(`MARGEM_MIGRAR_AO_SUBIR=0 e há migração pendente (${pendentes.join(', ')}): `
      + 'a API não sobe. Use um banco cópia para esta branch ou migre a produção de propósito.');
  }
}
