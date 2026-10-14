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

test('Windows: o mínimo do sistema passa (sem ele nem o TLS sobe), com nomes em qualquer caixa; segredos não', () => {
  const origem = {
    Path: 'C:\\Windows\\System32', SYSTEMROOT: 'C:\\Windows', TEMP: 'C:\\T', USERPROFILE: 'C:\\Users\\u', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
    DATABASE_URL: 'postgres://u:senha@127.0.0.1:5435/margem', GITHUB_TOKEN: 'ghp_x', MARGEM_DADOS: 'C:\\dados',
  };
  const ambiente = ambienteSaneado(origem, 'win32');
  expect(ambiente).toEqual({ PATH: 'C:\\Windows\\System32', SystemRoot: 'C:\\Windows', TEMP: 'C:\\T', USERPROFILE: 'C:\\Users\\u', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' });
  expect(vazamentos(ambiente, 'win32')).toEqual([]);
  // As variáveis do Windows não passam no Linux; o TMPDIR passa no macOS.
  expect(ambienteSaneado({ SystemRoot: 'C:\\Windows', TMPDIR: '/t' }, 'linux')).toEqual({});
  expect(ambienteSaneado({ TMPDIR: '/var/folders/x' }, 'darwin')).toEqual({ TMPDIR: '/var/folders/x' });
});
