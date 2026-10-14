import { afterAll, expect, test } from 'vitest';
import { comBancoDeTeste, OCIOSA_MS, pool } from './conexao.js';

afterAll(async () => { await pool.end(); });

async function conferirRemocao(nome: string) {
  expect(nome).toMatch(/^margem_test_/);
  const resultado = await pool.query<{ quantidade: number }>(
    'SELECT count(*)::int AS quantidade FROM pg_database WHERE datname = $1', [nome],
  );
  expect(resultado.rows[0]?.quantidade).toBe(0);
}

test('cria banco isolado, executa select 1 e remove o banco', async () => {
  const nome = await comBancoDeTeste('conexao', async (banco) => {
    const resultado = await banco.query<{ valor: number; nome: string }>(
      'SELECT 1 AS valor, current_database() AS nome',
    );
    expect(resultado.rows[0]?.valor).toBe(1);
    return resultado.rows[0]?.nome ?? '';
  });
  await conferirRemocao(nome);
});

test('remove o banco mesmo quando a função falha', async () => {
  let nome = '';
  await expect(comBancoDeTeste('erro', async (banco) => {
    const resultado = await banco.query<{ nome: string }>('SELECT current_database() AS nome');
    nome = resultado.rows[0]?.nome ?? '';
    throw new Error('Falha intencional da função de teste.');
  })).rejects.toThrow('Falha intencional');
  await conferirRemocao(nome);
});

test('o pool do processo mantém conexões ociosas por minutos, não 10 s (V-W7: postgres.exe girando no Windows)', () => {
  expect(pool.options.idleTimeoutMillis).toBe(OCIOSA_MS);
  expect(OCIOSA_MS).toBeGreaterThanOrEqual(300_000);
  expect(pool.options.min).toBe(1);
});
