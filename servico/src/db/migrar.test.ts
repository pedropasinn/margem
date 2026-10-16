import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { servirMigrando } from '../http/migrando.js';
import { comBancoDeTeste } from './conexao.js';
import { BancoMaisNovo, migracoesPendentes, migrar, prepararBanco } from './migrar.js';

const contar = async (banco: Parameters<typeof migrar>[0]): Promise<number> =>
  (await banco.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_tables WHERE tablename='migracao'")).rows[0]!.n;

test('MARGEM_MIGRAR_AO_SUBIR=0 não migra e recusa subir com migração pendente', async () => comBancoDeTeste('migrar_ao_subir', async (banco) => {
  // Banco vazio: tudo pendente, e só conferir não cria nada.
  const todas = await migracoesPendentes(banco);
  expect(todas.length).toBeGreaterThan(1);
  await expect(prepararBanco(banco, { MARGEM_MIGRAR_AO_SUBIR: '0' })).rejects.toThrow(/migração pendente/);
  expect(await contar(banco)).toBe(0);

  // Banco atrás do código (uma branch com migração nova): recusa e cita a pendente.
  await migrar(banco, { ate: todas.at(-2) });
  expect(await migracoesPendentes(banco)).toEqual([todas.at(-1)]);
  await expect(prepararBanco(banco, { MARGEM_MIGRAR_AO_SUBIR: '0' })).rejects.toThrow(todas.at(-1));
  expect(await migracoesPendentes(banco)).toEqual([todas.at(-1)]);

  // Padrão (variável ausente): migra, como a produção sempre fez; depois disso `0` sobe.
  await prepararBanco(banco, {});
  expect(await migracoesPendentes(banco)).toEqual([]);
  await expect(prepararBanco(banco, { MARGEM_MIGRAR_AO_SUBIR: '0' })).resolves.toBeUndefined();

  // Migração alterada depois de aplicada também é recusada só de conferir.
  await banco.query("UPDATE migracao SET sha256='x' WHERE nome=$1", [todas[0]]);
  await expect(migracoesPendentes(banco)).rejects.toThrow(/alterada/);
}));

async function pastaDeMigracoes(arquivos: Record<string, string>): Promise<URL> {
  const pasta = await mkdtemp(join(tmpdir(), 'margem-migracoes-'));
  for (const [nome, sql] of Object.entries(arquivos)) await writeFile(join(pasta, nome), sql);
  return pathToFileURL(`${pasta}/`);
}

test('D-02: migração demorada passa do prazo de 5 s do pool e falha no meio desfaz tudo', async () => comBancoDeTeste('migrar_prazo', async (banco) => {
  const lenta = await pastaDeMigracoes({
    '0001_tabela.sql': 'CREATE TABLE t (n int);',
    '0002_lenta.sql': 'SELECT pg_sleep(5.5); INSERT INTO t VALUES (1);',
  });
  await migrar(banco, { pasta: lenta });
  expect((await banco.query<{ n: number }>('SELECT count(*)::int AS n FROM t')).rows[0]!.n).toBe(1);
  expect(await migracoesPendentes(banco, { pasta: lenta })).toEqual([]);

  // A terceira escreve e quebra: nem a escrita nem o registro ficam.
  await writeFile(new URL('0003_quebra.sql', lenta), 'INSERT INTO t VALUES (2); SELECT 1/0;');
  await expect(migrar(banco, { pasta: lenta })).rejects.toThrow(/division by zero/);
  expect((await banco.query<{ n: number }>('SELECT count(*)::int AS n FROM t')).rows[0]!.n).toBe(1);
  expect(await migracoesPendentes(banco, { pasta: lenta })).toEqual(['0003_quebra.sql']);
}), 30_000);

test('D-07: banco com migração desconhecida (downgrade) é recusado antes de escrever', async () => comBancoDeTeste('migrar_downgrade', async (banco) => {
  await migrar(banco);
  await banco.query("INSERT INTO migracao(nome, sha256) VALUES ('9999_futura.sql', 'x')");
  const avisos: string[][] = [];
  await expect(migracoesPendentes(banco)).rejects.toBeInstanceOf(BancoMaisNovo);
  await expect(migrar(banco)).rejects.toThrow(/versão mais nova do Margem \(migração 9999_futura\.sql\)/);
  await expect(prepararBanco(banco, {}, { aoMigrar: (p) => { avisos.push([...p]); } })).rejects.toBeInstanceOf(BancoMaisNovo);
  await expect(prepararBanco(banco, { MARGEM_MIGRAR_AO_SUBIR: '0' })).rejects.toBeInstanceOf(BancoMaisNovo);
  expect(avisos).toEqual([]);
}));

test('D-02: prepararBanco avisa antes de migrar, e só quando há pendente', async () => comBancoDeTeste('migrar_aviso', async (banco) => {
  const todas = await migracoesPendentes(banco);
  await migrar(banco, { ate: todas.at(-2) });
  const avisos: string[][] = [];
  await prepararBanco(banco, {}, { aoMigrar: async (p) => { avisos.push([...p]); expect(await migracoesPendentes(banco)).toEqual([...p]); } });
  expect(avisos).toEqual([[todas.at(-1)]]);
  await prepararBanco(banco, {}, { aoMigrar: (p) => { avisos.push([...p]); } });
  expect(avisos).toHaveLength(1);
}));

test('D-02: enquanto migra, /api/saude responde 503 migrando com a identificação', async () => {
  const servidor = await servirMigrando({ endereco: '127.0.0.1', porta: 0, pendentes: ['0037_x.sql'], ambiente: { MARGEM_APP_DESKTOP: '1' } });
  try {
    const saude = await fetch(`http://127.0.0.1:${String(servidor.porta)}/api/saude`);
    expect(saude.status).toBe(503);
    expect(await saude.json()).toMatchObject({ ok: false, estado: 'migrando', migracoes: 1, servico: 'margem', app_de_computador: true });
    const outra = await fetch(`http://127.0.0.1:${String(servidor.porta)}/api/documentos`);
    expect(outra.status).toBe(503);
    expect(await outra.json()).toMatchObject({ erro: 'migrando' });
  } finally {
    await servidor.fechar();
  }
});
