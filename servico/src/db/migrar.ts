import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type pg from 'pg';

const pasta = new URL('./migrations/', import.meta.url);
async function listar(ate?: string, origem: URL = pasta): Promise<string[]> {
  return (await readdir(origem)).filter(nome => /^\d{4}_.+\.sql$/.test(nome)).sort()
    .filter(nome => ate === undefined || nome <= ate);
}

/**
 * Prazo de cada consulta da migração (D-02). O pool comum corta qualquer consulta em 5 s
 * (`conexao.ts`); uma migração que transforma dados numa biblioteca grande, ou num HD lento,
 * passa disso, e a atualização nunca abria. `MARGEM_PRAZO_MIGRACAO_MS` sobrepõe.
 */
export const PRAZO_MIGRACAO_MS = 3_600_000;
function prazoDaMigracao(ambiente: NodeJS.ProcessEnv): number {
  const valor = Number.parseInt(ambiente.MARGEM_PRAZO_MIGRACAO_MS ?? '', 10);
  return Number.isSafeInteger(valor) && valor > 0 ? valor : PRAZO_MIGRACAO_MS;
}

/**
 * O banco tem migração que este executável não conhece (D-07): foi aberto por uma versão mais
 * nova do Margem e esta, mais antiga, não pode escrever nele.
 */
export class BancoMaisNovo extends Error {
  constructor(readonly desconhecidas: readonly string[]) {
    super(`Esta biblioteca foi aberta por uma versão mais nova do Margem (migração ${desconhecidas.join(', ')}) `
      + 'e esta versão não pode usá-la. Instale a versão mais recente do Margem ou restaure a cópia de '
      + 'segurança feita antes da atualização.');
    this.name = 'BancoMaisNovo';
  }
}
function conferirConhecidas(aplicadas: Iterable<string>, conhecidas: readonly string[]): void {
  const doCodigo = new Set(conhecidas);
  const desconhecidas = [...aplicadas].filter(nome => !doCodigo.has(nome)).sort();
  if (desconhecidas.length > 0) throw new BancoMaisNovo(desconhecidas);
}

/**
 * Só lê: devolve as migrações do código que o banco ainda não tem (lista vazia: nada a migrar, nem
 * cópia de segurança a fazer). Recusa, como `migrar`, migração alterada depois de aplicada e banco
 * com migração desconhecida (`BancoMaisNovo`). Não cria a tabela `migracao` nem escreve nada.
 */
export async function migracoesPendentes(banco: pg.Pool | pg.ClientBase, opcoes: { pasta?: URL } = {}): Promise<string[]> {
  const origem = opcoes.pasta ?? pasta;
  const existe = (await banco.query<{ tabela: string | null }>("SELECT to_regclass('migracao')::text AS tabela")).rows[0]?.tabela;
  const aplicadas = new Map<string, string>();
  if (existe) {
    for (const linha of (await banco.query<{ nome: string; sha256: string }>('SELECT nome, sha256 FROM migracao')).rows) {
      aplicadas.set(linha.nome, linha.sha256);
    }
  }
  const conhecidas = await listar(undefined, origem);
  conferirConhecidas(aplicadas.keys(), conhecidas);
  const pendentes: string[] = [];
  for (const nome of conhecidas) {
    const sha = aplicadas.get(nome);
    if (sha === undefined) { pendentes.push(nome); continue; }
    const hash = createHash('sha256').update(await readFile(new URL(nome, origem), 'utf8'), 'utf8').digest('hex');
    if (sha !== hash) throw new Error(`Migração alterada depois de aplicada: ${nome}`);
  }
  return pendentes;
}

/**
 * Aplica as pendentes numa transação única, com lock. `ate` para numa migração (inclusiva); só os
 * testes de migração com dados antigos o usam, como `pasta` (outra pasta de migrações).
 * Cada consulta tem o prazo da migração (D-02), não os 5 s do pool.
 */
export async function migrar(banco: pg.Pool, opcoes: { ate?: string; pasta?: URL; ambiente?: NodeJS.ProcessEnv } = {}): Promise<void> {
  const origem = opcoes.pasta ?? pasta;
  const conhecidas = await listar(undefined, origem);
  const arquivos = conhecidas.filter(nome => opcoes.ate === undefined || nome <= opcoes.ate);
  const prazo = prazoDaMigracao(opcoes.ambiente ?? process.env);
  const cliente = await banco.connect();
  let quebrado = false;
  const consultar = <L extends pg.QueryResultRow>(text: string, values: unknown[] = []) => {
    const config: pg.QueryConfig & { query_timeout: number } = { text, values, query_timeout: prazo };
    return cliente.query<L>(config);
  };
  try {
    await consultar('BEGIN');
    try {
      await consultar('SELECT pg_advisory_xact_lock(3001)');
      await consultar(`CREATE TABLE IF NOT EXISTS migracao (
        nome text PRIMARY KEY, sha256 text NOT NULL, aplicada_em timestamptz NOT NULL DEFAULT clock_timestamp()
      )`);
      conferirConhecidas((await consultar<{ nome: string }>('SELECT nome FROM migracao')).rows.map(l => l.nome), conhecidas);
      for (const nome of arquivos) {
        const sql = await readFile(new URL(nome, origem), 'utf8');
        const hash = createHash('sha256').update(sql, 'utf8').digest('hex');
        const existente = await consultar<{ sha256: string }>('SELECT sha256 FROM migracao WHERE nome = $1', [nome]);
        if (existente.rows[0]) {
          if (existente.rows[0].sha256 !== hash) throw new Error(`Migração alterada depois de aplicada: ${nome}`);
          continue;
        }
        await consultar(sql);
        await consultar('INSERT INTO migracao(nome,sha256) VALUES ($1,$2)', [nome, hash]);
      }
      await consultar('COMMIT');
    } catch (erro) {
      // Sem ROLLBACK (conexão caída ou presa no prazo), a conexão não volta ao pool.
      await consultar('ROLLBACK').catch(() => { quebrado = true; });
      throw erro;
    }
  } finally {
    cliente.release(quebrado);
  }
}

/**
 * `MARGEM_MIGRAR_AO_SUBIR=0` (a prévia, que lê o banco de produção) não migra: só confere
 * e recusa subir se o código trouxer migração que o banco ainda não tem. Qualquer outro
 * valor, ou ausente, migra ao subir (o comportamento da produção).
 *
 * Os dois caminhos recusam, antes de qualquer escrita, o banco com migração que este executável
 * não conhece (`BancoMaisNovo`, D-07). `aoMigrar` é chamado antes de aplicar as pendentes, só quando
 * há alguma: a API anuncia ali que está migrando (D-02).
 */
export async function prepararBanco(banco: pg.Pool, ambiente: NodeJS.ProcessEnv = process.env,
  opcoes: { aoMigrar?: (pendentes: readonly string[]) => Promise<void> | void } = {}): Promise<void> {
  const pendentes = await migracoesPendentes(banco);
  if (ambiente.MARGEM_MIGRAR_AO_SUBIR !== '0') {
    if (pendentes.length === 0) return;
    await opcoes.aoMigrar?.(pendentes);
    await migrar(banco, { ambiente });
    return;
  }
  if (pendentes.length > 0) {
    throw new Error(`MARGEM_MIGRAR_AO_SUBIR=0 e há migração pendente (${pendentes.join(', ')}): `
      + 'a API não sobe. Use um banco cópia para esta branch ou migre a produção de propósito.');
  }
}
