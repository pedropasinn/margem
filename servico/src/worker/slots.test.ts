import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { SLOTS_PADRAO, aguardarVaga, tomarVaga } from './slots.js';

let diretorio = '';

beforeEach(async () => { diretorio = await mkdtemp(join(tmpdir(), 'margem-slots-')); });
afterEach(async () => { await rm(diretorio, { recursive: true, force: true }); });

test('o padrão é de quatro vagas', () => {
  expect(SLOTS_PADRAO).toBe(4);
});

test('duas vagas atendem duas execuções e barram a terceira', async () => {
  const primeira = await tomarVaga({ slots: 2, diretorio });
  const segunda = await tomarVaga({ slots: 2, diretorio });
  const terceira = await tomarVaga({ slots: 2, diretorio });
  expect(primeira).toBeDefined();
  expect(segunda).toBeDefined();
  expect(terceira).toBeUndefined();
  expect(primeira?.indice).not.toBe(segunda?.indice);
  expect(await readdir(diretorio)).toHaveLength(2);

  await primeira?.devolver();
  const quarta = await tomarVaga({ slots: 2, diretorio });
  expect(quarta).toBeDefined();
  await segunda?.devolver();
  await quarta?.devolver();
  expect(await readdir(diretorio)).toHaveLength(0);
});

test('vaga de processo morto é recuperada; vaga de processo vivo não', async () => {
  // PID 1 está sempre vivo; um pid altíssimo, não.
  await writeFile(join(diretorio, 'slot-0'), JSON.stringify({ pid: 4_194_303, desde: new Date().toISOString() }));
  await writeFile(join(diretorio, 'slot-1'), JSON.stringify({ pid: 1, desde: new Date().toISOString() }));
  const vaga = await tomarVaga({ slots: 2, diretorio });
  expect(vaga?.indice).toBe(0);
  await vaga?.devolver();

  await writeFile(join(diretorio, 'slot-0'), JSON.stringify({ pid: 1 }));
  expect(await tomarVaga({ slots: 2, diretorio })).toBeUndefined();
});

test('arquivo de vaga ilegível conta como resto de escrita interrompida', async () => {
  await writeFile(join(diretorio, 'slot-0'), 'lixo');
  const vaga = await tomarVaga({ slots: 1, diretorio });
  expect(vaga?.indice).toBe(0);
  await vaga?.devolver();
});

test('aguardarVaga desiste quando o sinal aborta', async () => {
  const ocupada = await tomarVaga({ slots: 1, diretorio });
  expect(ocupada).toBeDefined();
  const controlador = new AbortController();
  setTimeout(() => { controlador.abort(); }, 30);
  expect(await aguardarVaga({ slots: 1, diretorio, intervaloMs: 5, sinal: controlador.signal })).toBeUndefined();
  await ocupada?.devolver();
});
