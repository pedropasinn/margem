# Página comercial

Site do app (nome provisório "Margem"; o nome final ainda não foi decidido). Projeto **independente** do resto do repositório: React 18 + TypeScript + CSS com Vite, `package.json` e `package-lock.json` próprios, fora dos workspaces npm da raiz. Nada aqui é importado pelo app (`web/`), e o app não depende daqui.

O app é **instalado no computador da pessoa** (Docker em Linux, macOS e Windows), usa a conta do ChatGPT dela pelo Codex e guarda a biblioteca localmente. O site vende isso: download por sistema, documentação com cara de central de ajuda e novidades por versão.

## Páginas

Cada página é um `index.html` próprio, então qualquer hospedagem estática serve sem regra de reescrita.

| Caminho | Entrada | Conteúdo |
|---|---|---|
| `/` | `src/inicio.tsx` → `src/paginas/Inicio.tsx` | herói com captura real do app, seções de uma ideia, download por sistema (`#baixar`, `#baixar-linux` …) |
| `/docs/` e `/docs/<pagina>/` | `src/docs.tsx` → `src/paginas/Docs.tsx` | central de ajuda; o texto de cada página está em `src/docs/paginas.tsx`, e o HTML diz qual é em `data-pagina` |
| `/novidades/` | `src/novidades.tsx` → `src/paginas/Novidades.tsx` | changelog por versão |
| `/privacidade/`, `/termos/` | `src/paginas/Legal.tsx` | **rascunhos marcados para revisão por advogado**, com trechos `[A definir: …]` |

Página nova da documentação: acrescente o objeto em `src/docs/paginas.tsx` e crie `docs/<slug>/index.html` (copie um vizinho e troque título, descrição, canonical e `data-pagina`). O `vite.config.ts` acha as pastas de `docs/` sozinho.

## Nome, domínio, versão e endereços: `src/config.ts`

Tudo o que muda quando o nome, o domínio ou o release mudarem está em **um arquivo**, `src/config.ts`: nome do produto, slogan, descrição, domínio, versão e data, licença (AGPL-3.0), URLs do repositório, do release e dos instaladores (`instalar.sh`, `instalar.ps1`), pasta de instalação, porta local e nomes dos serviços do `compose.yml`. As páginas, os `<title>`/Open Graph dos HTML (pelos marcadores `__NOME__`, `__SLOGAN__`, `__DESCRICAO__`, `__SITE_URL__`, trocados no build pelo `vite.config.ts`), a documentação e a imagem Open Graph leem daí.

Valores entre `<…>` são provisórios. Enquanto as URLs tiverem `<`, a seção de download mostra "Download em preparação". Antes de publicar, confira pasta, porta e serviços com o empacotamento (J100).

## Rodar

```sh
cd site
npm install          # só na primeira vez
npm run dev          # http://localhost:5201 (com recarga)
npm run build        # typecheck (tsc -b) + build em site/dist
npm run preview      # serve o build em http://localhost:5201
npm run capturar     # depois do build: todas as páginas em site/capturas (claro/escuro, 1680/390) e public/og.png
```

`VITE_SITE_URL` no build tem precedência sobre o domínio do config, para as URLs absolutas de `og:image`, `og:url` e `canonical`. Sem nenhum dos dois, ficam relativas.

## Capturas do app real

As imagens em `public/app/` são o app de verdade (`web/dist`), com a API simulada no Playwright (sem serviço, banco ou Codex; nada toca a porta 8730) e "Um apólogo", de Machado de Assis (domínio público), canonizado pelo motor. Para refazer, com as dependências da raiz instaladas e o `web/` compilado:

```sh
npm run build --workspace web
cd web && node ../site/scripts/capturar-app.mjs    # MOTOR_PYTHON=… se motor/.venv não existir nesta cópia
```

## Publicar (decisão de produto; nada foi publicado)

É um site estático: publicar é enviar `site/dist` (Vercel com *Root Directory* `site`, Netlify, Cloudflare Pages, GitHub Pages). Antes: preencher `src/config.ts`, revisar `/privacidade/` e `/termos/` com advogado e decidir o domínio.

## Onde mexer

- Textos da página inicial: `src/paginas/Inicio.tsx`. Documentação: `src/docs/paginas.tsx`. Novidades: lista `VERSOES` em `src/paginas/Novidades.tsx`.
- Demonstração interativa: `src/componentes/Demonstracao.tsx`, `src/demo/texto.ts`, `src/demo/tracos.ts`.
- Identidade: `src/estilos/tokens.css` (copiados dos tokens do app). Duas famílias, Source Serif 4 e Figtree, pelo Google Fonts. Claro e escuro pelo sistema. Nenhum componente usa `border-left` ou faixa lateral: destaque é fundo, borda completa ou selo.
