import { fileURLToPath } from 'node:url';
import { createRequire, isBuiltin } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vitest/config';

const daRaiz = (caminho: string): string => fileURLToPath(new URL(caminho, import.meta.url));

/**
 * Decodificadores wasm do PDF.js (JBIG2, JPEG 2000, ICC). Sem eles, páginas escaneadas em JBIG2
 * (AER, NBER antigos) saem em branco. O PDF.js busca `${wasmUrl}<arquivo>`, então os nomes ficam
 * fixos numa pasta com a versão do pacote (`/pdfjs-<versão>/wasm/`, a mesma que `PdfReader` monta com o `version` do pacote), servida no dev e copiada no build.
 */
function decodificadoresDoPdfjs(): Plugin {
  const pacote = createRequire(import.meta.url).resolve('pdfjs-dist/package.json');
  const versao = (JSON.parse(readFileSync(pacote, 'utf8')) as { version: string }).version;
  const origem = join(dirname(pacote), 'wasm');
  const prefixo = `pdfjs-${versao}/wasm/`;
  const arquivos = readdirSync(origem).filter((nome) => (nome.endsWith('.wasm') || nome.endsWith('.js')) && !nome.startsWith('quickjs'));
  return {
    name: 'decodificadores-do-pdfjs',
    configureServer(servidor) {
      servidor.middlewares.use((req, res, proximo) => {
        const nome = req.url?.startsWith(`/${prefixo}`) ? req.url.slice(prefixo.length + 1).split('?')[0] : undefined;
        if (nome === undefined || !arquivos.includes(nome)) { proximo(); return; }
        res.setHeader('Content-Type', nome.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8');
        res.end(readFileSync(join(origem, nome)));
      });
    },
    generateBundle() {
      for (const nome of arquivos) this.emitFile({ type: 'asset', fileName: `${prefixo}${nome}`, source: readFileSync(join(origem, nome)) });
    },
  };
}

export default defineConfig({
  plugins: [react(), decodificadoresDoPdfjs(), {
    name: 'recusar-modulos-node-no-leitor',
    enforce: 'pre',
    apply: 'build',
    resolveId(fonte, origem) {
      if (isBuiltin(fonte)) this.error(`Módulo exclusivo do Node no leitor: ${fonte} (importado por ${origem ?? 'entrada'}). Use uma entrada compartilhada sem dependências do servidor.`);
      return null;
    },
  }],
  // O leitor usa a fonte do núcleo e dos contratos direto da worktree: `node_modules` é
  // compartilhado com o checkout principal e resolveria para outra cópia dos mesmos pacotes.
  resolve: {
    alias: [
      { find: '@margem/core/audio', replacement: daRaiz('../core/src/audio.ts') },
      { find: '@margem/core/midia', replacement: daRaiz('../core/src/midia.ts') },
      { find: '@margem/core/segmentos', replacement: daRaiz('../core/src/segmentos.ts') },
      { find: '@margem/core/eink', replacement: daRaiz('../core/src/eink.ts') },
      { find: '@margem/core/fluxograma', replacement: daRaiz('../core/src/fluxograma.ts') },
      { find: '@margem/core/visita', replacement: daRaiz('../core/src/visita.ts') },
      { find: '@margem/core/leitura-comentada', replacement: daRaiz('../core/src/leitura-comentada.ts') },
      { find: '@margem/core/karaoke', replacement: daRaiz('../core/src/karaoke.ts') },
      { find: '@margem/core/youtube', replacement: daRaiz('../core/src/youtube.ts') },
      { find: '@margem/contratos/texto', replacement: daRaiz('../contratos/src/texto.ts') },
      { find: '@margem/contratos/sala', replacement: daRaiz('../contratos/src/sala.ts') },
      { find: '@margem/contratos/regras', replacement: daRaiz('../contratos/src/regras.ts') },
      { find: '@margem/contratos', replacement: daRaiz('../contratos/src/index.ts') },
    ],
  },
  // `/dev` e as rotas da biblioteca caem no mesmo index.html.
  appType: 'spa',
  // `npm run dev` na raiz sobe a API em 8730; o vite repassa /api para lá.
  server: {
    // `xfwd`: o Vite escuta em 0.0.0.0 e, com `changeOrigin`, todo pedido chegaria à API como loopback
    // (dono). O `X-Forwarded-For` leva o cliente real, e a API recusa escrita de quem não é loopback.
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.MARGEM_PORTA ?? '8730'}`, changeOrigin: true, xfwd: true } },
  },
  build: {
    chunkSizeWarningLimit: 500,
    // A API estática reconhece .js; o worker continua módulo, com MIME JavaScript.
    rollupOptions: { output: { assetFileNames: (arquivo) =>
      arquivo.names.some((nome) => nome.endsWith('.mjs')) ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]',
    } },
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 15_000,
  },
});
