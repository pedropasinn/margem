import { defineConfig } from 'vitest/config';

/**
 * Usado por `npm test --workspace servico`. `@margem/core` não publica `exports`, e
 * `node_modules/@margem/*` aponta para a árvore principal: os apelidos garantem que a
 * worktree teste o seu próprio código.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@margem/contratos/texto': new URL('../contratos/src/texto.ts', import.meta.url).pathname,
      '@margem/contratos/regras': new URL('../contratos/src/regras.ts', import.meta.url).pathname,
      '@margem/contratos': new URL('../contratos/src/index.ts', import.meta.url).pathname,
      '@margem/core/segmentos': new URL('../core/src/segmentos.ts', import.meta.url).pathname,
      '@margem/core': new URL('../core/src/index.ts', import.meta.url).pathname,
    },
  },
  test: { name: 'servico', include: ['**/*.test.ts'], environment: 'node', testTimeout: 30_000 },
});
