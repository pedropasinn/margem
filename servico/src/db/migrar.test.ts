import { expect, test } from 'vitest';
import { comBancoDeTeste } from './conexao.js';
import { migracoesPendentes, migrar, prepararBanco } from './migrar.js';

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
