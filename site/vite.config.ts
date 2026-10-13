import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { CONFIG } from './src/config';

const raiz = import.meta.dirname;

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
  server: { port: 5201, strictPort: true },
  preview: { port: 5201, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        inicio: resolve(raiz, 'index.html'),
        privacidade: resolve(raiz, 'privacidade/index.html'),
        termos: resolve(raiz, 'termos/index.html'),
        novidades: resolve(raiz, 'novidades/index.html'),
        docs: resolve(raiz, 'docs/index.html'),
        ...Object.fromEntries(paginasDeDocs),
      },
    },
  },
});
