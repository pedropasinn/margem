/** S-01 · A chave local da instalação: criada uma vez na pasta de segredos do app (0600) e reaproveitada. */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { chaveDaInstalacao } from '../src/nucleo/chave-local.js';

const pastas: string[] = [];
afterEach(async () => { await Promise.all(pastas.splice(0).map((pasta) => rm(pasta, { recursive: true, force: true }))); });

it('gera 32 bytes em base64url na pasta de segredos, guarda em 0600 e devolve a mesma depois', async () => {
  const segredos = await mkdtemp(join(tmpdir(), 'margem-segredos-'));
  pastas.push(segredos);
  const [a, b] = await Promise.all([chaveDaInstalacao(segredos), chaveDaInstalacao(segredos)]);
  expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(b).toBe(a);
  expect(await chaveDaInstalacao(segredos)).toBe(a);
  expect((await readFile(join(segredos, 'chave-local'), 'utf8')).trim()).toBe(a);
  if (process.platform !== 'win32') expect((await stat(join(segredos, 'chave-local'))).mode & 0o777).toBe(0o600);
  // Arquivo estragado: uma chave nova (nunca uma curta).
  await writeFile(join(segredos, 'chave-local'), 'curta\n');
  const nova = await chaveDaInstalacao(segredos);
  expect(nova).not.toBe(a);
  expect(nova).toMatch(/^[A-Za-z0-9_-]{43}$/u);
});

