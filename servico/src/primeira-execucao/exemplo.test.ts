/**
 * O exemplo congelado continua sendo o que o motor produz do mesmo original, e o original é o mesmo
 * dos primeiros passos do web. Roda o motor Python de verdade (sem rede).
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { raizDoRepositorio } from '../dados.js';
import { sha256Hex } from '../http/ingestao.js';
import { MARCAS_DO_EXEMPLO, canonicoDoExemplo, originalDoExemplo, resolverMarcasDoExemplo } from './exemplo.js';

test('o original é o mesmo do web e o canônico congelado é o do motor', async () => {
  const raiz = raizDoRepositorio();
  const original = await originalDoExemplo();
  expect(Buffer.from(original).equals(await readFile(join(raiz, 'web/src/onboarding/exemplo/um-apologo.md')))).toBe(true);
  const congelado = await canonicoDoExemplo();
  expect(congelado.documento.sha256_original).toBe(sha256Hex(original));

  const pasta = await mkdtemp(join(tmpdir(), 'margem-j103-motor-'));
  try {
    execFileSync(join(raiz, 'motor/.venv/bin/python'), ['-c', `
import sys
from pathlib import Path
from margem_motor.ingest import canonizar
canonizar(Path(sys.argv[1]), 'md', Path(sys.argv[2]), titulo='Um apólogo', autor='Machado de Assis', idioma='pt')
`, join(raiz, 'servico/src/primeira-execucao/exemplo/um-apologo.md'), join(pasta, 'versao')], { cwd: join(raiz, 'motor'), stdio: 'pipe' });
    const novo = JSON.parse(await readFile(join(pasta, 'versao/canonico.json'), 'utf8')) as typeof congelado;
    expect(novo.hash_estrutural).toBe(congelado.hash_estrutural);
    expect(novo.blocos).toEqual(congelado.blocos);
    expect(novo.secoes).toEqual(congelado.secoes);
    expect(novo.documento).toEqual(congelado.documento);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}, 60_000);

test('cada marca do exemplo cai num bloco só, com a citação literal', async () => {
  const canonico = await canonicoDoExemplo();
  let n = 0;
  const marcas = resolverMarcasDoExemplo(canonico, '0'.repeat(25) + 'V', '0'.repeat(25) + 'E', '2026-10-12T00:00:00.000Z',
    () => `0${String(++n).padStart(25, '0')}`);
  expect(marcas).toHaveLength(MARCAS_DO_EXEMPLO.length);
  for (const marca of marcas) {
    const bloco = canonico.blocos.find((b) => b.id === marca.ancora.bloco_id)!;
    expect(bloco.texto.slice(marca.ancora.inicio_utf16, marca.ancora.fim_utf16)).toBe(marca.ancora.citacao);
  }
  // Cada função do método aparece pelo menos uma vez: o exemplo mostra a paleta inteira.
  expect(new Set(marcas.map((m) => m.funcao))).toEqual(new Set(['tese', 'conceito', 'justificativa', 'nenhuma']));
});
