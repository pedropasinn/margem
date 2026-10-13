import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { carregarRoteiro, criarExecutorFalso, roteiroValido } from './fake.js';
import type { Roteiro } from './fake.js';

const raiz = fileURLToPath(new URL('../../../', import.meta.url));
const schema = join(raiz, 'fixtures/codex/schema-teste.json');

let base = '';
let entrada = '';
let artefatos = '';

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'margem-teste-fake-'));
  entrada = join(base, 'entrada');
  artefatos = join(base, 'artefatos');
  await mkdir(entrada, { recursive: true });
  await writeFile(join(entrada, 'parte.txt'), 'texto\n');
});

afterAll(async () => { await rm(base, { recursive: true, force: true }); });

function pedido(prompt: string, prazoMs = 2_000, sinal?: AbortSignal) {
  return { diretorioEntrada: entrada, prompt, schema, prazoMs, sinal, diretorioArtefatos: artefatos };
}

test('roteiro de sucesso produz artefato validado contra o schema', async () => {
  const roteiro = await carregarRoteiro(join(raiz, 'fixtures/codex/roteiro-ok.json'));
  const executor = criarExecutorFalso(roteiro);
  const resultado = await executor(pedido('ler a parte 1'));
  expect(resultado.estado).toBe('ok');
  if (resultado.estado === 'ok') {
    expect(resultado.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(resultado.modelo).toBe('executor-falso');
    expect(existsSync(resultado.artefato)).toBe(true);
  }
});

test('o roteiro é determinístico: o mesmo prompt dá o mesmo hash de artefato', async () => {
  const roteiro = await carregarRoteiro(join(raiz, 'fixtures/codex/roteiro-ok.json'));
  const primeiro = await criarExecutorFalso(roteiro)(pedido('ler'));
  const segundo = await criarExecutorFalso(roteiro)(pedido('ler'));
  expect(primeiro.estado).toBe('ok');
  if (primeiro.estado === 'ok' && segundo.estado === 'ok') {
    expect(segundo.sha256).toBe(primeiro.sha256);
  }
});

test('escolhe o passo por hash do prompt', async () => {
  const roteiro: Roteiro = {
    versao: 1,
    passos: [
      { quando: { sha256_prompt: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }, tipo: 'auth' },
      { tipo: 'ok', conteudo: { marcas: [] } },
    ],
  };
  const executor = criarExecutorFalso(roteiro);
  // Hash da string vazia: casa com o primeiro passo.
  expect(await executor(pedido(''))).toMatchObject({ estado: 'falhou', codigo: 'auth' });
  expect((await executor(pedido('outro'))).estado).toBe('ok');
});

test('todos os modos de falha do roteiro, em ordem', async () => {
  const roteiro = await carregarRoteiro(join(raiz, 'fixtures/codex/roteiro-falhas.json'));
  const executor = criarExecutorFalso(roteiro);

  expect(await executor(pedido('1'))).toMatchObject({ estado: 'falhou', codigo: 'json_invalido' });
  expect(await executor(pedido('2'))).toMatchObject({ estado: 'falhou', codigo: 'schema' });
  expect(await executor(pedido('3', 30))).toMatchObject({ estado: 'falhou', codigo: 'timeout' });

  const adiado = await executor(pedido('4'));
  expect(adiado.estado).toBe('adiado');
  if (adiado.estado === 'adiado') {
    expect(adiado.codigo).toBe('cota');
    expect(adiado.not_before.toISOString()).toBe('2026-09-21T10:27:00.000Z');
  }

  expect(await executor(pedido('5'))).toMatchObject({ estado: 'falhou', codigo: 'auth' });
  expect(await executor(pedido('6'))).toMatchObject({ estado: 'falhou', codigo: 'processo' });

  const controlador = new AbortController();
  const promessa = executor(pedido('7', 5_000, controlador.signal));
  setTimeout(() => { controlador.abort(); }, 20);
  expect(await promessa).toMatchObject({ estado: 'falhou', codigo: 'cancelado' });

  for (const diretorio of executor.diretorios) expect(existsSync(diretorio)).toBe(false);
  expect(executor.diretorios).toHaveLength(7);
});

test('o executor falso recusa roteiro inválido', async () => {
  expect(roteiroValido({ versao: 2, passos: [] })).toBe(false);
  expect(roteiroValido({ versao: 1, passos: [{ tipo: 'ok' }] })).toBe(true);
  const caminho = join(base, 'roteiro-ruim.json');
  await writeFile(caminho, '{"versao":9}');
  await expect(carregarRoteiro(caminho)).rejects.toThrow('Roteiro inválido');
});
