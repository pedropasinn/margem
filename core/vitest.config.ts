import { defineConfig } from 'vitest/config';

/** Usado por `npm test --workspace core`: o pacote dos contratos não publica `main`. */
export default defineConfig({
  resolve: {
    alias: {
      '@margem/contratos/texto': new URL('../contratos/src/texto.ts', import.meta.url).pathname,
      '@margem/contratos/regras': new URL('../contratos/src/regras.ts', import.meta.url).pathname,
      '@margem/contratos': new URL('../contratos/src/index.ts', import.meta.url).pathname,
    },
  },
  test: { name: 'core', include: ['**/*.test.ts'], environment: 'node', testTimeout: 15_000 },
});
