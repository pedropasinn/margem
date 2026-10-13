import { defineWorkspace } from 'vitest/config';

/** O pacote do workspace não publica `main`; o apelido aponta para a fonte dos contratos. */
const contratos = new URL('./contratos/src/index.ts', import.meta.url).pathname;
const regrasDosContratos = new URL('./contratos/src/regras.ts', import.meta.url).pathname;
const segmentosDoNucleo = new URL('./core/src/segmentos.ts', import.meta.url).pathname;
const nucleo = new URL('./core/src/index.ts', import.meta.url).pathname;

export default defineWorkspace(
  ['contratos', 'core', 'servico', 'web'].map((nome) => ({
    resolve: {
      alias: {
        '@margem/core/audio': new URL('./core/src/audio.ts', import.meta.url).pathname,
        '@margem/core/midia': new URL('./core/src/midia.ts', import.meta.url).pathname,
        '@margem/core/segmentos': segmentosDoNucleo,
        '@margem/core/eink': new URL('./core/src/eink.ts', import.meta.url).pathname,
        '@margem/core/fluxograma': new URL('./core/src/fluxograma.ts', import.meta.url).pathname,
        '@margem/core/visita': new URL('./core/src/visita.ts', import.meta.url).pathname,
        '@margem/core/leitura-comentada': new URL('./core/src/leitura-comentada.ts', import.meta.url).pathname,
        '@margem/core/karaoke': new URL('./core/src/karaoke.ts', import.meta.url).pathname,
        '@margem/core/youtube': new URL('./core/src/youtube.ts', import.meta.url).pathname,
        '@margem/core': nucleo,
        '@margem/contratos/texto': new URL('./contratos/src/texto.ts', import.meta.url).pathname,
        '@margem/contratos/sala': new URL('./contratos/src/sala.ts', import.meta.url).pathname,
        '@margem/contratos/regras': regrasDosContratos,
        '@margem/contratos': contratos,
      },
    },
    test: {
      name: nome,
      root: new URL(`./${nome}/`, import.meta.url).pathname,
      include: ['**/*.test.ts', '**/*.test.tsx'],
      environment: nome === 'web' ? 'jsdom' : 'node',
      testTimeout: nome === 'servico' ? 30_000 : 15_000,
    },
  })),
);
