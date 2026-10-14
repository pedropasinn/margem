import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { CONFIG } from './src/config';

const raiz = import.meta.dirname;
const doRepositorio = (caminho: string): string => resolve(raiz, '..', caminho);
const caminhosDoTsconfig = (JSON.parse(readFileSync(resolve(raiz, 'tsconfig.json'), 'utf8')) as { compilerOptions: { paths: Record<string, string[]> } }).compilerOptions.paths;

// Páginas estáticas: cada uma é um index.html próprio e funciona em qualquer hospedagem estática,
// sem regra de reescrita. As da documentação são achadas em docs/<pagina>/index.html.
const paginasDeDocs = readdirSync(resolve(raiz, 'docs'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => [`docs-${d.name}`, resolve(raiz, 'docs', d.name, 'index.html')] as const);

// Endereço público, para as URLs absolutas do Open Graph: VITE_SITE_URL no build, senão o domínio
// do config. Enquanto o domínio for provisório (`<…>`), as URLs ficam relativas.
const dominio = CONFIG.dominio;
const enderecoDoSite = (process.env['VITE_SITE_URL'] ?? dominio).replace(/\/$/, '');

// Nome e textos de marca entram nos HTML pelo config: trocar o nome é editar src/config.ts.
const substituicoes: Record<string, string> = {
  __SITE_URL__: enderecoDoSite,
  __NOME__: CONFIG.nome,
  __SLOGAN__: CONFIG.slogan,
  __DESCRICAO__: CONFIG.descricao,
};

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'marca-e-endereco',
      transformIndexHtml: (html) => Object.entries(substituicoes).reduce((h, [chave, valor]) => h.replaceAll(chave, valor), html),
    },
  ],
  // As demonstrações usam o próprio app: componentes, CSS e funções de `web/src` (por `@app/…`), os
  // contratos e o núcleo pelas fontes (como o `web/vite.config.ts`) e o exportador do Obsidian do
  // serviço. Um React só (o do site), mesmo para os arquivos de fora desta pasta.
  resolve: {
    // Os mesmos `paths` do tsconfig.json, do mais específico para o mais geral.
    alias: Object.entries(caminhosDoTsconfig)
      .sort(([a], [b]) => b.length - a.length)
      .map(([chave, [alvo]]) => (chave.endsWith('/*')
        ? { find: new RegExp(`^${chave.slice(0, -1).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`), replacement: `${resolve(raiz, alvo!.slice(0, -1))}/` }
        : { find: new RegExp(`^${chave.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`), replacement: resolve(raiz, alvo!) })),
    dedupe: ['react', 'react-dom'],
  },
  server: { port: 5201, strictPort: true, fs: { allow: [doRepositorio('.')] } },
  preview: { port: 5201, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        inicio: resolve(raiz, 'index.html'),
        privacidade: resolve(raiz, 'privacidade/index.html'),
        termos: resolve(raiz, 'termos/index.html'),
        novidades: resolve(raiz, 'novidades/index.html'),
        download: resolve(raiz, 'download/index.html'),
        docs: resolve(raiz, 'docs/index.html'),
        ...Object.fromEntries(paginasDeDocs),
      },
    },
  },
});
