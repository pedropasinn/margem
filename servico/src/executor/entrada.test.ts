import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { ARQUIVO_PROMPT, PONTEIRO_DO_PROMPT, TETO_PROMPT_POR_ARGUMENTO, prepararEntrada } from './entrada.js';

test('prompt curto vai por argumento; acima do teto vai para prompt.md e o argumento só aponta', async () => {
  const raiz = await mkdtemp(join(tmpdir(), 'margem-j19-entrada-'));
  try {
    const curto = await prepararEntrada(join(raiz, 'a'), 'Leia os versos.', { type: 'object' });
    expect(curto).toMatchObject({ prompt: 'Leia os versos.', emArquivo: false });
    expect(await readdir(curto.diretorioEntrada)).toEqual([]);
    expect(JSON.parse(await readFile(curto.schema, 'utf8'))).toEqual({ type: 'object' });

    const longo = 'é'.repeat(TETO_PROMPT_POR_ARGUMENTO / 2 + 1);
    const grande = await prepararEntrada(join(raiz, 'b'), longo, {});
    expect(grande).toMatchObject({ prompt: PONTEIRO_DO_PROMPT, emArquivo: true });
    expect(await readFile(join(grande.diretorioEntrada, ARQUIVO_PROMPT), 'utf8')).toBe(longo);
    // O schema fica fora do diretório de entrada: o executor copia a entrada inteira para o `-C`.
    expect(await readdir(grande.diretorioEntrada)).toEqual([ARQUIVO_PROMPT]);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});
