// Empacota src/main.ts em main.js (CommonJS, como o Obsidian carrega plugins).
// `node esbuild.config.mjs producao` gera o arquivo final; sem argumento, observa e reconstrói.
import esbuild from 'esbuild';
import { builtinModules } from 'node:module';

const producao = process.argv[2] === 'producao';
const contexto = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtinModules],
  format: 'cjs',
  target: 'es2020',
  platform: 'browser',
  logLevel: 'info',
  sourcemap: producao ? false : 'inline',
  treeShaking: true,
  minify: producao,
  legalComments: 'none',
  outfile: 'main.js',
});
if (producao) {
  await contexto.rebuild();
  await contexto.dispose();
} else {
  await contexto.watch();
}
