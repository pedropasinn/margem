import type pg from 'pg';

// Só comTransacao produz este tipo: os repositórios nunca abrem/fecham a transação do chamador.
declare const transacao: unique symbol;
export type Transacao = pg.PoolClient & { readonly [transacao]: true };

export async function comTransacao<T>(banco: pg.Pool, fn: (cliente: Transacao) => Promise<T>): Promise<T> {
  const cliente = await banco.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente as Transacao);
    await cliente.query('COMMIT');
    return resultado;
  } catch (erro) {
    await cliente.query('ROLLBACK');
    throw erro;
  } finally {
    cliente.release();
  }
}
