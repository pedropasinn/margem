import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { lerUrlBanco } from './configuracao.js';

function criarPool(url: URL): pg.Pool {
  return new pg.Pool({
    connectionString: url.toString(),
    connectionTimeoutMillis: 3_000,
    query_timeout: 5_000,
    max: 4,
  });
}

// O Pool só abre conexões quando usado. Quem o utiliza deve encerrá-lo com end().
export const pool = criarPool(lerUrlBanco());
// Uma conexão ociosa que cai (Postgres reiniciado, 57P01) emite `error` no pool; sem ouvinte, o
// evento não tratado derruba a API e o worker no meio dos jobs. O pool descarta a conexão sozinho.
pool.on('error', (erro: Error & { code?: string }) => {
  console.error(JSON.stringify({ evento: 'pool_conexao_caiu', codigo: erro.code ?? null }));
});

export async function comBancoDeTeste<T>(
  nome: string,
  fn: (banco: pg.Pool) => Promise<T>,
): Promise<T> {
  // Prefixo (12) + nome (18) + separador (1) + UUID (32) cabem nos 63 bytes do Postgres.
  if (!/^[a-z][a-z0-9_]{0,17}$/.test(nome)) {
    throw new Error('Nome de teste inválido: use até 18 letras minúsculas, números ou sublinhados.');
  }
  const nomeBanco = `margem_test_${nome}_${randomUUID().replaceAll('-', '')}`;
  const url = lerUrlBanco();
  url.pathname = '/postgres';
  const administracao = criarPool(url);
  let banco: pg.Pool | undefined;
  let criado = false;
  try {
    // Identificador composto exclusivamente de caracteres validados e UUID local.
    await administracao.query(`CREATE DATABASE "${nomeBanco}"`);
    criado = true;
    url.pathname = `/${nomeBanco}`;
    banco = criarPool(url);
    // Conexões que `fn` deixou abertas são derrubadas pelo DROP … WITH (FORCE); sem este
    // ouvinte, o erro 57P01 chega ao pool como evento não tratado e derruba o processo.
    banco.on('error', () => undefined);
    return await fn(banco);
  } finally {
    try {
      if (banco) await banco.end();
    } finally {
      try {
        if (criado) await administracao.query(`DROP DATABASE "${nomeBanco}" WITH (FORCE)`);
      } finally {
        await administracao.end();
      }
    }
  }
}
