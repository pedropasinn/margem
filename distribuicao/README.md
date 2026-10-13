# Instalação local

O app roda inteiro no seu computador, em containers Docker: banco (Postgres), API com a interface
web e um worker que prepara os livros e chama o **Codex com a sua própria conta ChatGPT**. Seus
livros, notas e marcas não saem da máquina; a única coisa que sai é o que o Codex envia à OpenAI
quando você pede uma leitura.

O nome do produto, do projeto no Docker e da imagem estão em [`produto.env`](produto.env) (e
repetidos como padrão no topo dos dois instaladores, para quando o script é baixado sozinho;
`tools/tests/distribuicao.test.mjs` confere que batem). Neste texto, `<projeto>` é o valor de
`PRODUTO_PROJETO` ali (hoje `margem`).

## Requisitos

| Sistema | O que instalar |
|---|---|
| Linux | Docker Engine 24+ com o plugin `docker compose` (v2) |
| macOS (Intel ou Apple Silicon) | Docker Desktop 4.30+ |
| Windows 10/11 | Docker Desktop 4.30+ (backend WSL2, o padrão). Use `instalar.ps1` no PowerShell, ou `instalar.sh` dentro do WSL2 |

- Uma conta ChatGPT com acesso ao Codex (Plus, Pro, Business, Edu ou Enterprise).
- 4 GB de RAM livres e uns 3 GB de disco para a imagem, mais o espaço dos seus livros.
- Construir a imagem a partir do código (enquanto ela não estiver publicada) precisa de internet
  e leva alguns minutos.

## Instalar

Do código-fonte (enquanto não há release), Linux, macOS ou WSL2:

```sh
./distribuicao/instalar.sh          # o mesmo que "instalar.sh iniciar"
<projeto> login                     # uma vez: entra na conta ChatGPT pelo Codex
```

Windows (PowerShell):

```powershell
.\distribuicao\instalar.ps1
<projeto> login
```

Do release (quando existir): baixe só o `instalar.sh` (ou `instalar.ps1`) e rode; ele baixa o
`compose.yml` de `PRODUTO_RELEASE` e a imagem de `PRODUTO_IMAGEM`.

Se o PowerShell recusar scripts baixados: `powershell -ExecutionPolicy Bypass -File .\instalar.ps1`.

O instalador:

1. confere se o Docker responde;
2. cria a pasta da instalação, `~/<projeto>` (Windows: `$HOME\<projeto>`; outra com
   `PASTA_INSTALACAO=...`), com `compose.yml`, uma cópia do instalador e o `.env`: projeto,
   imagem, porta e uma senha aleatória para o banco;
3. baixa a imagem ou, se ela ainda não estiver publicada, constrói a partir do código (e guarda o
   caminho do código em `CODIGO_FONTE`, para `atualizar` reconstruir);
4. sobe banco, API e worker, espera a API responder e aplica as migrações do banco;
5. cria o comando `<projeto>` (Linux/macOS: link em `~/.local/bin/<projeto>`; Windows:
   `<projeto>.cmd` em `%LOCALAPPDATA%\Microsoft\WindowsApps`), para rodar `<projeto> iniciar` de
   qualquer pasta — é o comando que a extensão do navegador sugere quando o servidor está fechado.
   `SEM_ATALHO=1` pula este passo;
6. abre `http://localhost:8730` no navegador (`SEM_NAVEGADOR=1` para não abrir).

Dentro da pasta da instalação, os comandos comuns do `docker compose` funcionam direto, porque o
`.env` ao lado do `compose.yml` traz o nome do projeto e a imagem: `docker compose ps`,
`docker compose logs`, `docker compose pull && docker compose up -d`.

### Login do Codex

`login` roda `codex login --device-auth` dentro do worker: o terminal mostra um endereço e um
código; abra o endereço, entre na sua conta ChatGPT e digite o código. O login fica num volume
Docker próprio (`<projeto>_codex`) e sobrevive a atualizações. O mesmo pode ser feito à mão:

```sh
cd ~/<projeto> && docker compose exec worker codex login --device-auth
```

Sem login, a biblioteca e o leitor funcionam; o que precisa do Codex (leituras, explicações,
visuais) falha com um aviso de autenticação.

## Usar no dia a dia

| Comando (`<projeto> …`, ou `instalar.sh …` / `instalar.ps1 …`) | O que faz |
|---|---|
| `iniciar` | sobe tudo (e instala na primeira vez) |
| `parar` | para os containers; os dados ficam |
| `estado` | mostra os serviços, o endereço e se o Codex está logado |
| `logs` | acompanha os registros (Ctrl+C sai) |
| `login` | login do Codex |
| `atualizar` | backup, imagem nova, sobe de novo |
| `backup [pasta]` | copia o banco e os arquivos |
| `restaurar <pasta>` | volta um backup |
| `desinstalar` | remove os containers (os dados ficam) |
| `desinstalar --apagar-dados` (`-ApagarDados` no PowerShell) | remove tudo, inclusive livros e login |
| `arte instalar [arquivo\|url] [--sha256 <hex>]` (`-Sha256` no PowerShell) | instala o acervo de quadros (ver abaixo) |

Os containers voltam sozinhos quando o Docker reinicia (`restart: unless-stopped`), até você rodar
`parar`.

## Configuração

Tudo no `.env` da pasta da instalação (formato `CHAVE=valor`, sem aspas). Depois de mudar, rode
`<projeto> iniciar` de novo para recriar os containers.

| Chave | Padrão | Para quê |
|---|---|---|
| `COMPOSE_PROJECT_NAME` | `<projeto>` | projeto no Docker (prefixo de containers e volumes) |
| `PRODUTO_IMAGEM` | de `produto.env` | imagem do app |
| `BANCO_SENHA` | gerada | senha do Postgres (não troque depois de instalado) |
| `PORTA` | `8730` | porta no seu computador; o app fica em `http://localhost:<PORTA>` |
| `MODELO` | `conta` | modelo do Codex; `conta` usa o padrão da sua conta |
| `SLOTS` | `2` | quantos trabalhos do worker correm ao mesmo tempo |
| `MARGEM_EXTENSOES` | a extensão do Chrome/Edge/Brave | origens da extensão do navegador autorizadas a enviar páginas |
| `MARGEM_RECURSOS` | vazio | deixe vazio. Os Quadros (`arte`) já vêm ligados; `-arte` os desliga. Os outros nomes de `servico/src/recursos.ts` são da instalação de desenvolvimento e não fazem parte da V0 |
| `CODIGO_FONTE` | o repositório, se instalado dele | de onde `atualizar` reconstrói a imagem enquanto não há imagem publicada |

A porta é publicada **só em 127.0.0.1**: outras máquinas da rede não alcançam o app. Não há login
no app; quem usa o computador é a dona da biblioteca. Não publique a porta em outra interface.

### Extensão do navegador

A instalação já autoriza a extensão para Chrome, Edge e Brave
(`chrome-extension://gbgnmhhgfmdgchhfhabdaneaehcamcma`). No **Firefox**, a origem tem um UUID que
muda a cada instalação: copie-a das Opções da extensão e acrescente ao `.env`, mantendo a do
Chrome se você também a usa:

```
MARGEM_EXTENSOES=chrome-extension://gbgnmhhgfmdgchhfhabdaneaehcamcma,moz-extension://<uuid-do-firefox>
```

Depois, `iniciar` de novo recria os containers com o valor novo. O servidor padrão da extensão é
`http://localhost:8730`; se você mudou `PORTA`, ajuste também nas Opções da extensão.

### Quadros (acervo de arte)

A área **Quadros** da Biblioteca mostra obras de arte em domínio público com análise guiada. O
acervo (cerca de 137 obras, 490 MB) é um pacote à parte, para a imagem não carregar meio gigabyte
que nem todo mundo quer. Sem ele, Quadros mostra duas obras de exemplo e explica como baixar.

```
margem arte instalar                         # baixa o pacote publicado e instala
margem arte instalar ~/Downloads/acervo-de-quadros-<versão>.tar.gz --sha256 <hash>
margem arte instalar https://…/acervo-de-quadros-<versão>.tar.gz
```

Um arquivo do seu computador é copiado para dentro do container, conferido e apagado depois. O
instalador confere o manifesto, o SHA-256 de cada arquivo e a licença de cada obra antes de mover
qualquer coisa, e rodar de novo não muda nada. As obras ficam no volume de dados
(`MARGEM_ARTE_DIR=/dados/arte/obras`), entram no `backup` e sobrevivem ao `atualizar`. Os créditos e
as licenças de cada imagem vão junto (`/dados/arte/obras/.pacote/CREDITOS.md`) e aparecem em cada
quadro. Recarregue a página depois de instalar.

### Ferramentas que vêm na imagem

| Ferramenta | Para quê |
|---|---|
| `codex` (`@openai/codex`, versão em `CODEX_VERSION` no `Dockerfile`) | leituras pela sua conta ChatGPT |
| `yt-dlp` 2026.8.19 (`tools/midia/yt-dlp.txt`, com as dependências fixadas; usa o Node da imagem para os desafios de JavaScript do YouTube) | importar um vídeo do YouTube: título, legendas do próprio vídeo e o áudio para a sincronia. O vídeo toca pelo player oficial do YouTube; nunca é baixado |
| `ffmpeg`/`ffprobe` (Debian bookworm) | sondar vídeo e áudio próprios, áudio do YouTube, miniaturas e imagens dos quadros |
| PyMuPDF e numpy (`motor/requirements.txt`) | preparar PDF (o EPUB é lido pelo próprio motor); camada de texto de PDF escaneado |
| fontes DejaVu | rótulos nas imagens geradas dos quadros |

Fora da imagem: a transcrição local de áudio (`MARGEM_TRANSCRITOR`, opcional; sem ela, um vídeo do
YouTube sem legendas entra "sem transcrição" e toca assim mesmo) e o `tectonic` (PDF dos
exercícios em LaTeX; sem ele, a tela avisa que o LaTeX não está disponível).

## Backup e restauração

`backup` grava em `~/<projeto>/backups/<data>/` (ou na pasta indicada):

- `banco.dump`: o banco inteiro (`pg_dump -Fc`);
- `dados.tar`: originais, versões canonizadas, imagens, artefatos e o acervo de quadros.

O login do Codex **não** entra no backup; depois de restaurar em outro computador, faça `login`.
`atualizar` faz um backup antes de trocar a imagem.

Para voltar um backup: `restaurar <pasta>` (pede confirmação; substitui o banco e os arquivos atuais).

## Atualizar

`atualizar` faz backup, baixa a imagem nova (ou reconstrói a partir do código, se a imagem não
estiver publicada: atualize o código antes com `git pull`), baixa o Postgres novo da mesma versão
maior e sobe tudo. As migrações do banco rodam sozinhas quando a API sobe.

## Desinstalar

- `desinstalar`: remove containers e rede; os volumes `<projeto>_banco`, `<projeto>_dados` e
  `<projeto>_codex` ficam, e `iniciar` volta com tudo.
- `desinstalar --apagar-dados`: remove também os volumes e tira a senha do banco do `.env` (a
  próxima instalação gera outra). Não tem volta; faça `backup` antes se quiser guardar algo.
- A pasta `~/<projeto>` (configuração, backups, cópia do instalador) fica; apague-a à mão.
- A imagem continua no Docker; para liberar o espaço: `docker image rm <imagem>` (a de
  `PRODUTO_IMAGEM`) e `docker image rm postgres:18-alpine`.
- Apague o atalho `~/.local/bin/<projeto>` (ou `<projeto>.cmd` no Windows).

## Como funciona

| Serviço | Imagem | Faz |
|---|---|---|
| `postgres` | `postgres:18-alpine` | banco; sem porta publicada, só a rede interna do compose |
| `app` | a do produto | API e interface web na porta `PORTA` (a mesma dentro e fora, publicada só em `127.0.0.1`); aplica as migrações |
| `worker` | a mesma | fila: prepara documentos (motor Python), chama o Codex |

Volumes: `banco` (Postgres), `dados` (livros e artefatos, `MARGEM_DADOS=/dados`) e `codex`
(`CODEX_HOME`, o login). Todos os processos rodam como usuário sem privilégios (`app`, uid 10001).

O Codex roda **confinado**: cada execução enxerga só a pasta da tarefa e uma cópia temporária do
login, dentro de um `bwrap`; o sandbox do próprio Codex roda dentro dele, em modo só leitura. Para
o `bwrap` criar namespaces dentro do container, o serviço `worker` (e só ele) roda com
`seccomp=unconfined`, `apparmor=unconfined` e `systempaths=unconfined`, ainda sem root.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| "O Docker está instalado mas não responde" | abra o Docker Desktop (ou `sudo systemctl start docker`) e espere ficar pronto |
| "a API não ficou pronta" | `logs`; em máquinas lentas, `ESPERA=600 ./instalar.sh iniciar` |
| porta 8730 ocupada | `PORTA=8731` no `.env` (e nas opções da extensão), depois `iniciar` |
| leituras falham com autenticação | `login` de novo; `estado` mostra se o Codex está logado |
| Linux: "permission denied" no socket do Docker | adicione seu usuário ao grupo `docker` ou use Docker Desktop |
| Windows/WSL: `instalar.sh` com `\r` nos erros | finais de linha convertidos; o `.gitattributes` do repositório fixa LF, mas um arquivo copiado à mão pode vir com CRLF: use `instalar.ps1` ou `dos2unix instalar.sh` |

## Licença

O código é distribuído sob a **GNU Affero General Public License v3.0** (AGPL-3.0-only); veja
[`LICENSE`](../LICENSE) na raiz do repositório. A imagem carrega o mesmo texto em `/app/LICENSE` e
o rótulo `org.opencontainers.image.licenses=AGPL-3.0-only`. Se você modificar o app e oferecê-lo a
outras pessoas pela rede, a AGPL pede que o código-fonte modificado fique disponível a elas.

## Para quem publica a imagem

A imagem não tem segredos e já traz os rótulos OCI. Para publicar (ainda não feito):

```sh
docker build \
  --build-arg TITULO=margem --build-arg VERSAO=<versão> \
  --build-arg REVISAO="$(git rev-parse HEAD)" --build-arg CRIADO_EM="$(date -u +%FT%TZ)" \
  --build-arg FONTE=https://github.com/pedropasinn/margem \
  -t ghcr.io/pedropasinn/margem:<versão> -t ghcr.io/pedropasinn/margem:latest .
docker push --all-tags ghcr.io/pedropasinn/margem
```

Multiplataforma (Apple Silicon e Windows ARM): `docker buildx build --platform linux/amd64,linux/arm64 … --push`.
Endereços definitivos (conta pessoal `pedropasinn`): repositório
`https://github.com/pedropasinn/margem`, imagem `ghcr.io/pedropasinn/margem`, releases em
`https://github.com/pedropasinn/margem/releases` com os assets `instalar.sh`, `instalar.ps1`,
`compose.yml` e o pacote do acervo de quadros (`acervo-de-quadros-<versão>.tar.gz`, na tag
`acervo-<versão>`). Estão em `produto.env` (com os padrões repetidos nos instaladores), em
`site/src/config.ts` e em `servico/src/arte/pacote-publicado.ts`. Ao publicar: `publicado: true` no
`config.ts` do site e no `pacote-publicado.ts`.
