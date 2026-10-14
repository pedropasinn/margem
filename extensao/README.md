# Margem · extensão de navegador

Manda a página aberta (artigo, post, notícia, e-mail aberto no navegador ou PDF) para a
biblioteca do Margem. Um código só para Chrome, Edge, Brave e Firefox (Manifest V3).

- **Ícone (popup)**: mostra título, autor, site, contagem de palavras e uma prévia; botões
  **Enviar para o Margem** e **Enviar e abrir**. Atalho: **Alt+Shift+M** (abre o popup).
- **Menu de contexto**: *Enviar página para o Margem* e, com texto selecionado, *Enviar seleção
  para o Margem*. O resultado aparece numa notificação (clique para abrir) e no selo do ícone.
- **PDF**: se a aba é um PDF, a extensão baixa o arquivo e envia o original (o Margem abre PDF
  como o original); não extrai texto.
- **Opções**: endereço do Margem (padrão `http://localhost:8730`, o da instalação no próprio
  computador; com o padrão, a extensão procura o Margem nas portas 8730 a 8739 por `GET /api/saude`
  e fica com a identificação que já conhece, mostrada na checagem da instalação do Margem), token opcional e **Testar conexão**. A página mostra também a origem da extensão,
  que o Margem precisa autorizar (abaixo).

A extensão não tem servidor próprio: ela fala só com o Margem que você instalou. Nada é
coletado nem enviado a terceiros.

## Como funciona

1. Ao clicar (ícone, atalho ou menu), o fundo injeta `conteudo.js` só naquela aba (`activeTab` +
   `scripting`; a extensão não pede acesso a todos os sites).
2. Na página, o [Readability](https://github.com/mozilla/readability) acha o artigo; o
   [Turndown](https://github.com/mixmark-io/turndown) converte para Markdown no dialeto que o motor
   do Margem lê: títulos, listas, citações, ênfase, código. O motor não tem links, imagens nem
   tabelas, então: link vira só texto e o endereço vai para a seção final **Links da página**;
   imagem vira `[Imagem: alt]` (endereço na mesma lista); chamada de nota vira `[1]`; tabela vira
   uma linha por registro. Autor, site e data de publicação vêm do Readability, de `meta`/Open
   Graph e de JSON-LD.
3. O **fundo** (não o script na página) envia para `POST /api/importacoes/web` (contrato
   `ImportacaoWebV1`), com o cabeçalho `X-Margem`. O servidor escreve o frontmatter
   (`titulo`, `autor`, `site`, `url_origem`, `publicado_em`, `capturado_em`, `trecho`,
   `importado_por`) no `original.md` e segue o mesmo caminho do upload de Markdown. PDF vai por
   `POST /api/documentos` (formato `pdf`).

## Instalar (sem loja)

A extensão ainda não está nas lojas. Pacotes: `margem-chrome.zip` e `margem-firefox.zip`
(gerados com `npm run empacotar` dentro de `extensao/`, em `extensao/dist/`).

**Chrome / Edge / Brave**

1. Descompacte `margem-chrome.zip` numa pasta que vai ficar no computador (apagar a pasta
   desinstala a extensão).
2. Abra `chrome://extensions` (Edge: `edge://extensions`; Brave: `brave://extensions`).
3. Ligue o **Modo do desenvolvedor** → **Carregar sem compactação** → escolha a pasta.
4. Fixe o ícone na barra. Em **Opções**, confira o endereço (`http://localhost:8730`) e clique
   **Testar conexão**.
5. Outro atalho de teclado: `chrome://extensions/shortcuts`.

**Firefox** (128 ou mais novo)

1. `about:debugging#/runtime/this-firefox` → **Carregar extensão temporária…** → escolha o
   `margem-firefox.zip` (ou o `manifest.json` da pasta descompactada). Temporária: some quando o
   Firefox fecha, e é preciso carregar de novo.
2. Se o Firefox perguntar, permita o acesso a `localhost` (é onde o Margem responde).
3. Copie a origem `moz-extension://…` mostrada nas **Opções** para `MARGEM_EXTENSOES` (abaixo) e
   reinicie o Margem. A origem muda a cada carga temporária.
4. Para ficar instalada de vez, a extensão precisa ser assinada pela Mozilla (ver *Publicar nas
   lojas*); no Firefox Developer Edition/Nightly dá para desligar a exigência com
   `xpinstall.signatures.required=false` em `about:config` e instalar o zip.

PDFs locais (`file://`) exigem, no Chrome, ligar *Permitir acesso a URLs de arquivo* nos detalhes
da extensão.

## Autorizar a extensão no Margem

O Margem só responde à extensão se a origem dela estiver em `MARGEM_EXTENSOES`, na configuração
do Margem (lista separada por vírgulas, sem curinga; pode ser a origem inteira ou só o id/UUID):

```
MARGEM_EXTENSOES=chrome-extension://gbgnmhhgfmdgchhfhabdaneaehcamcma,moz-extension://<uuid-do-firefox>
```

- **Chrome/Edge/Brave**: carregada sem compactação, a origem é sempre
  `chrome-extension://gbgnmhhgfmdgchhfhabdaneaehcamcma` (a chave pública em `chave-publica.txt` vai
  no manifesto e fixa o id), igual nos três navegadores. A instalação padrão do Margem já traz
  essa origem autorizada.
- **Firefox**: a origem usa um UUID interno que muda a cada instalação. Copie-a das **Opções** da
  extensão (ou de `about:debugging` → *Este Firefox* → *UUID interno*).
- Na instalação com Docker, a variável fica no arquivo de configuração do Margem (o `.env` ao
  lado do `compose.yml`); depois de mudar, `docker compose up -d` recria o serviço com o valor novo.

Com a origem na lista, a extensão pode usar **só** `GET/POST /api/importacoes/web` e
`POST /api/documentos`; qualquer outra rota responde 403 `rota_fora_da_extensao`.

**Token**: hoje o Margem só exige que `X-Margem` venha preenchido. Se você puser um token nas
opções, ele vai em `X-Margem` e em `Authorization: Bearer`.

## Permissões

| Permissão | Para quê |
|---|---|
| `activeTab`, `scripting` | ler a aba aberta só quando você clica (ícone, atalho ou menu) |
| `contextMenus` | itens *Enviar página/seleção para o Margem* |
| `storage` | endereço do Margem e token, só neste navegador |
| `notifications` | resultado do envio pelo menu de contexto |
| `host_permissions`: `http://localhost/*`, `http://127.0.0.1/*` | falar com o Margem local (qualquer porta) |
| `optional_host_permissions`: `http://*/*`, `https://*/*` | **declaração** apenas; nada é concedido na instalação |

A extensão não pede acesso a todos os sites. Se você configurar um endereço fora de `localhost`
(por exemplo, o Margem em outro computador da sua rede), a página de opções pede, ao salvar ou
testar, permissão só para aquele host. Recusar não impede o uso: aí o navegador aplica CORS e o
Margem precisa ter a origem da extensão em `MARGEM_EXTENSOES`, como sempre.

Com a permissão de host, o navegador não aplica CORS aos pedidos da extensão; por isso ela sabe
distinguir os dois problemas mais comuns:

- **Margem fechado** (conexão recusada): *"Abra o Margem: rode `margem iniciar` (ou
  `docker compose up -d` na pasta da instalação) e tente de novo."*
- **Origem não autorizada** (403 `origem_recusada`): *"O Margem está aberto, mas não autorizou
  esta extensão. Copie a origem mostrada nas opções…"*

Sem a permissão de host, as duas falhas parecem iguais para a extensão, e a mensagem cita as duas
causas.

## Atualizar

Carregue a versão nova por cima (Chrome: substitua os arquivos da pasta e clique em *Recarregar*
em `chrome://extensions`). O endereço e o token salvos nas opções são mantidos: o padrão
`http://localhost:8730` só vale quando não há nada salvo.

## Desenvolver

```
cd extensao
npm install          # só aqui; fora dos workspaces da raiz
npm run typecheck
npm test             # extração com fixtures reais (notícia, blog, Wikipédia) + ponte com o motor
npm run build        # dist/chrome e dist/firefox
npm run empacotar    # + dist/margem-chrome.zip e dist/margem-firefox.zip
npm run e2e          # Chromium com a extensão, API+worker próprios na 8753, banco margem_test_* descartável
npx web-ext lint --source-dir dist/firefox
```

Os ícones saem de `web/public/icone-512.png` com `python3 scripts/icones.py` (Pillow). O visual
do popup usa `web/src/ui/tokens.css` e a Figtree, copiados no build (claro/escuro pelo sistema).

## Publicar nas lojas (ainda não feito)

O que será preciso, quando for a hora:

**Chrome Web Store** (Edge Add-ons aceita o mesmo pacote, com conta própria)

- Conta de desenvolvedor (taxa única) e verificação de identidade/e-mail do publicador.
- Pacote **sem** o campo `key` no manifesto: a loja atribui o id dela. A instalação padrão do
  Margem passa a autorizar também esse id em `MARGEM_EXTENSOES`.
- Justificativa de cada permissão (tabela acima), inclusive `host_permissions` para localhost e
  por que `optional_host_permissions` é ampla (o endereço é escolhido pela pessoa e pedido em
  tempo de execução, um host por vez).
- Política de privacidade publicada num endereço público (os dados vão só para o Margem que a
  pessoa configurou) e o formulário de práticas de dados da loja.
- Ícones 128 px, capturas de tela 1280×800, descrição curta e longa, categoria.

**AMO (Firefox)**

- Conta em addons.mozilla.org; *Submit a New Add-on* com `margem-firefox.zip`. Pode ser
  *unlisted* (só assinatura, distribuição própria) ou listada.
- `gecko.id` definitivo: `extensao@margem.dev` (do domínio do produto; não muda depois da primeira
  submissão).
- `data_collection_permissions` já declara que nada é coletado (ignorado antes do Firefox 140).
- O código vai sem minificação; se pedirem fonte, enviar a pasta `extensao/` com este README. O
  `web-ext lint` aponta dois `innerHTML` dentro do Readability (no documento clonado, que não é
  inserido na página).

Comum às duas: licença definida, endereço de suporte e página da extensão no site do Margem.
