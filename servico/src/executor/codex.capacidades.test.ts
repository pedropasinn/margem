import { describe, expect, test } from 'vitest';
import { FLAGS_NECESSARIAS, detectarCapacidades, esquecerCapacidades } from './capacidades.js';

/**
 * Único teste que toca a CLI de verdade — e só `--version` e `--help`.
 * Nenhuma leitura é disparada. Pulado por padrão; exige MARGEM_TESTE_CLI=1.
 */
const autorizado = process.env.MARGEM_TESTE_CLI === '1';

describe.skipIf(!autorizado)('CLI real do Codex', () => {
  test('a versão instalada oferece todas as flags necessárias', async () => {
    esquecerCapacidades();
    const capacidades = await detectarCapacidades({ recarregar: true });
    expect(capacidades.versao).toMatch(/codex/i);
    expect(capacidades.faltando, `flags ausentes em ${capacidades.versao}`).toEqual([]);
    for (const flag of FLAGS_NECESSARIAS) expect(capacidades.flags[flag]).toBe(true);
  }, 60_000);
});

test('sem autorização explícita o executor nunca chama a CLI', () => {
  expect(autorizado || process.env.MARGEM_TESTE_CLI === undefined).toBe(true);
});
