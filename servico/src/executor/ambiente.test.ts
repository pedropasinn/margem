import { afterEach, expect, test } from 'vitest';
import { VARIAVEIS_PERMITIDAS, ambienteSaneado, vazamentos } from './ambiente.js';

const injetadas = ['DATABASE_URL', 'PGPASSWORD', 'PGHOST', 'MARGEM_SLOTS', 'AWS_SECRET_ACCESS_KEY'];

afterEach(() => {
  for (const nome of injetadas) delete process.env[nome];
});

test('o ambiente do motor recebe só a lista de permissão', () => {
  process.env.DATABASE_URL = 'postgres://usuario:senha@127.0.0.1:5435/margem';
  process.env.PGPASSWORD = 'senha-do-postgres';
  process.env.PGHOST = '127.0.0.1';
  process.env.MARGEM_SLOTS = '4';
  process.env.AWS_SECRET_ACCESS_KEY = 'nunca';

  const ambiente = ambienteSaneado();

  expect(vazamentos(ambiente)).toEqual([]);
  for (const nome of injetadas) expect(ambiente).not.toHaveProperty(nome);
  const serializado = JSON.stringify(ambiente);
  expect(serializado).not.toContain('senha');
  expect(serializado).not.toContain('5435');
  expect(Object.keys(ambiente).every((nome) => (VARIAVEIS_PERMITIDAS as readonly string[]).includes(nome))).toBe(true);
});

test('variáveis permitidas passam; vazias são descartadas', () => {
  const ambiente = ambienteSaneado({ PATH: '/usr/bin', HOME: '/home/leitor', LANG: '', CODEX_HOME: '/home/leitor/.codex' });
  expect(ambiente).toEqual({ PATH: '/usr/bin', HOME: '/home/leitor', CODEX_HOME: '/home/leitor/.codex' });
});
