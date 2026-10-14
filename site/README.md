# Página comercial

Site do app Margem (margem.dev). React 18 + TypeScript + CSS com Vite, `package.json` e `package-lock.json` próprios, fora dos workspaces npm da raiz. O app (`web/`) não depende daqui; **o site depende do app**: as demonstrações da página inicial importam componentes, CSS e funções de `web/src` (alias `@app/…`), os contratos e o núcleo pelas fontes e o exportador do Obsidian (`@obsidian/exportar`). Os aliases saem dos `paths` do `tsconfig.json` (o `vite.config.ts` os lê). Por isso o build pede as dependências da raiz instaladas (`npm ci` na raiz e em `site/`); numa hospedagem, instale as duas antes de `npm run build` em `site/`.

O app é um **app de desktop no padrão do Obsidian** (instalador para Windows e Linux, com tudo dentro; macOS em breve), usa a conta do ChatGPT da pessoa pelo Codex e guarda a biblioteca numa pasta escolhida por ela. O site vende isso: botão de download que detecta o sistema, página de download com todos os formatos, documentação com cara de central de ajuda e novidades por versão.

## Páginas

Cada página é um `index.html` próprio, então qualquer hospedagem estática serve sem regra de reescrita.

| Caminho | Entrada | Conteúdo |
|---|---|---|
| `/` | `src/inicio.tsx` → `src/paginas/Inicio.tsx` | herói com o recorte interativo do leitor e o botão que detecta o sistema; aprofundar (captura real da seleção); outras formas de estudar (`#estudar`: abas com o app real); biblioteca (`#biblioteca`: formatos, lista completa, pasta local); download (`#baixar`) |
| `/download/` | `src/download.tsx` → `src/paginas/Download.tsx` | os três sistemas com todos os instaladores (`#windows`, `#macos`, `#linux`), depois de instalar, aviso de app sem assinatura, complementos |
| `/docs/` e `/docs/<pagina>/` | `src/docs.tsx` → `src/paginas/Docs.tsx` | central de ajuda; o texto de cada página está em `src/docs/paginas.tsx`, e o HTML diz qual é em `data-pagina` |
| `/novidades/` | `src/novidades.tsx` → `src/paginas/Novidades.tsx` | changelog por versão |
| `/privacidade/`, `/termos/` | `src/paginas/Legal.tsx` | **rascunhos marcados para revisão por advogado**, com trechos `[A definir: …]` |

Página nova da documentação: acrescente o objeto em `src/docs/paginas.tsx` e crie `docs/<slug>/index.html` (copie um vizinho e troque título, descrição, canonical e `data-pagina`). O `vite.config.ts` acha as pastas de `docs/` sozinho.

## Nome, domínio, versão e endereços: `src/config.ts`

Tudo o que muda quando o nome, o domínio ou o release mudarem está em **um arquivo**, `src/config.ts`: nome do produto, slogan, descrição, domínio, versão e data, licença (AGPL-3.0), URLs do repositório e do release, requisitos por sistema e a lista `INSTALADORES` com os **nomes fixos** dos arquivos do release (`Margem-Setup.exe`, `Margem-mac-arm64.dmg`, `Margem-mac-x64.dmg`, `Margem-linux-x86_64.AppImage`, `margem_amd64.deb`) e o tamanho aproximado de cada um. Os links são `…/releases/latest/download/<arquivo>`. As páginas, os `<title>`/Open Graph dos HTML (pelos marcadores `__NOME__`, `__SLOGAN__`, `__DESCRICAO__`, `__SITE_URL__`, trocados no build pelo `vite.config.ts`), a documentação e a imagem Open Graph leem daí.

Enquanto `publicado` for `false`, o site mostra "Download em preparação" e os botões dos instaladores ficam desativados (o botão do herói leva à página de download). No primeiro release: `publicado: true` e conferir os tamanhos e as pastas de configuração do app (`pastaDeConfiguracoes`, usadas em Desinstalar) com o J113.

Detecção do sistema (`src/componentes/Baixar.tsx`): Windows, macOS ou Linux pelo navegador; no macOS, Apple Silicon ou Intel pelo `userAgentData` (Chrome, Edge) ou pela placa do WebGL. Sem saber o processador, o botão oferece os dois `.dmg`. Enquanto um sistema estiver em `SISTEMAS_EM_BREVE` (`src/config.ts`; hoje, o macOS), o cartão dele mostra "Em breve" e o botão leva à página de download.

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

As imagens `grifo`, `pdf`, `video` e `notas` de `public/app/` (claro e escuro) saem do roteiro das capturas do README, `servico/src/ferramentas/capturar-readme.ts`, com o app de verdade num banco de teste descartável (veja o README da raiz). As outras imagens de `public/app/` são o app de verdade (`web/dist`), com a API simulada no Playwright (sem serviço, banco ou Codex; nada toca a porta 8730) e "Um apólogo", de Machado de Assis (domínio público), canonizado pelo motor. Para refazer, com as dependências da raiz instaladas e o `web/` compilado:

```sh
npm run build --workspace web
cd web && node ../site/scripts/capturar-app.mjs    # MOTOR_PYTHON=… se motor/.venv não existir nesta cópia
```

## Publicar (decisão de produto; nada foi publicado)

É um site estático, mas o build precisa do repositório inteiro (as demonstrações importam componentes de `web/`). Publicar na Vercel (projeto `margem-site`, domínio margem.dev): `bash site/scripts/publicar.sh` (produção) ou `--previa`. O script faz o build aqui (`vercel build`) e envia o resultado pronto (`vercel deploy --prebuilt`); `vercel deploy` direto de `site/` falha, porque `web/` não sobe junto. Antes: preencher `src/config.ts`, revisar `/privacidade/` e `/termos/` com advogado e decidir o domínio.

## Onde mexer

- Textos da página inicial: `src/paginas/Inicio.tsx`. Documentação: `src/docs/paginas.tsx`. Novidades: lista `VERSOES` em `src/paginas/Novidades.tsx`.
- Recorte do leitor no herói: `src/componentes/Demonstracao.tsx`, alimentado por `src/demo/recorte.ts` (blocos, marcas e relações no formato do app). O desenho vem do app, copiado em `src/app/`: `tracos.ts` é cópia literal de `web/src/ui/marcador/tracos.ts` (confira com `node scripts/conferir-copias.mjs`) e `marcador.ts` reúne os padrões do leitor (grifo, régua, intensidade .3, pesos por saliência, cores do modo filosófico, braquetes), cada um com o arquivo de origem anotado. Mudou o visual no app, copie de novo.
- Outras formas de estudar (`src/componentes/OutrasFormas.tsx`): abas que carregam sob demanda (quando a seção se aproxima) o app de verdade, numa moldura `.app-embutido` (`src/estilos/app-embutido.css`: com `transform`, o `position: fixed` do app fica preso à moldura):
  - `src/demos/DemoDoQuadro.tsx`: `QuadroAberto` (`web/src/quadros/`) com a obra de exemplo do repositório (`fixtures/arte/educacao.*.json`; imagem reduzida em `public/demo/educacao.jpg`, de `web/public/arte/educacao.jpg`);
  - `src/demos/DemoDoExercicio.tsx`: `SessaoDeResolucao` com `fontes` injetadas (`src/demo/exercicio.ts`, questão original; o print é `public/demo/questao.png`, refeito por `node scripts/gerar-print-da-questao.mjs`);
  - `src/demos/DemoDoObsidian.tsx`: a saída de `exportarParaObsidian` (`servico/src/obsidian/exportar.ts`) para o recorte do herói (`src/demo/obsidian.ts`).
- Formatos e privacidade: `src/componentes/Biblioteca.tsx` (cada formato conferido no código, com a origem anotada) e os ícones em `src/componentes/IconeDeFormato.tsx`.
- Medir a página inicial: `npm run build && node scripts/medir-inicio.mjs` (altura em 1680 e 390, JS e CSS da abertura). `CAPTURAR_SO=inicio npm run capturar` refaz só a inicial e as demonstrações em uso.
- Identidade: `src/estilos/tokens.css` (copiados dos tokens do app). Duas famílias, Source Serif 4 e Figtree, pelo Google Fonts. Claro e escuro pelo sistema. Nenhum componente usa `border-left` ou faixa lateral: destaque é fundo, borda completa ou selo.
