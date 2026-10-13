# Margem

Um leitor que marca o que o texto faz. O Margem lê com você: marca a tese, o argumento, a
objeção e a definição, deixa uma nota curta na margem de cada marca e guarda as suas próprias
anotações, perguntas e conexões presas ao trecho de onde saíram. O texto continua no centro; o
PDF aparece como foi publicado.

O Margem é **instalado no seu computador**. A biblioteca (arquivos, banco, marcas e notas) fica
com você, e as leituras usam a **sua conta do ChatGPT** pelo [Codex](https://github.com/openai/codex),
sem chave de API e sem servidor nosso no meio.

Site e documentação: <https://margem.dev>.

## O que ele faz

- **Biblioteca**: PDF, EPUB, Markdown, TXT e texto colado; vários arquivos de uma vez. PDF
  escaneado transcrito página por página. Vídeos do YouTube pelo link, com as legendas do próprio
  vídeo e o player oficial do YouTube. Vídeo e áudio próprios com transcrição em JSON.
- **Leitura**: modos de leitura (argumentativo, filosófico, econômico, literário, matemático,
  jornalístico, jurídico e outros), marcas por função em marca-texto ou sublinhado, quatro
  níveis de atenção, retomada no mesmo parágrafo.
- **Trabalho sobre o texto**: grifar, anotar, perguntar ao texto (a resposta cita os parágrafos em
  que se apoia) e conectar trechos, do mesmo documento ou de outro.
- **Quadros**: obras de arte em domínio público com análise guiada; o acervo é um pacote à parte.
- **Integrações**: extensão de navegador (Chrome, Edge, Brave, Firefox), plugin do Obsidian e
  narração opcional com a sua chave da ElevenLabs.

## Instalar

Requisitos: Docker (Docker Desktop no macOS e no Windows; Docker Engine com Compose no Linux) e
uma conta do ChatGPT num plano que inclua o Codex.

```sh
# Linux e macOS
curl -fsSL https://github.com/pedropasinn/margem/releases/latest/download/instalar.sh -o instalar.sh
bash instalar.sh
margem login        # entra na sua conta do ChatGPT pelo código de dispositivo
```

No Windows, `instalar.ps1` no PowerShell. Depois, abra <http://localhost:8730>.

Ainda não há release publicado. Até lá, instale a partir deste repositório: `distribuicao/instalar.sh`
(ou `instalar.ps1`) constrói a imagem localmente. Tudo sobre a instalação, o comando `margem`
(`iniciar`, `parar`, `estado`, `login`, `atualizar`, `backup`, `restaurar`, `logs`,
`desinstalar`, `arte instalar`), a configuração e o que roda em cada container está em
[`distribuicao/README.md`](distribuicao/README.md).

## Como funciona

A interface React fala com uma API Node (Hono). A API guarda documentos e enfileira trabalhos no
PostgreSQL. Um worker separado roda o motor Python, que prepara o texto e a geometria dos
documentos, e chama `codex exec` para as leituras e respostas que você pede. Só o serviço grava no
banco; o motor e o modelo devolvem dados que o serviço valida. O modelo devolve o bloco e a citação
literal, e o serviço resolve onde ela está no texto: citação ambígua vira aviso, nunca escolha
silenciosa.

| Pasta | Responsabilidade |
| --- | --- |
| `web/` | Biblioteca, leitor de PDF e de texto, componentes e testes visuais |
| `servico/` | API, PostgreSQL, fila, worker, executor do Codex e consultas |
| `motor/` | Extração de texto, estrutura e geometria (Python) |
| `core/` | Regras puras de âncoras, texto, segmentos e geometria |
| `contratos/` | Schemas JSON versionados, tipos, validações e modos de leitura |
| `prompts/` | Instruções e formatos versionados das leituras e respostas |
| `distribuicao/` | `compose.yml` e instaladores da instalação local |
| `extensao/` | Extensão de navegador |
| `integracoes/` | Plugin do Obsidian |
| `site/` | Site e documentação |
| [`fixtures/`](fixtures/README.md) | Dados de teste compartilhados |
| [`tests/`](tests/README.md) | Cenários de ponta a ponta entre API, worker, motor e navegador |
| `tools/` | Ferramentas de desenvolvimento e importação |

As regras do projeto (contratos primeiro, quem escreve no banco, interface) estão em
[`AGENTS.md`](AGENTS.md); as decisões de arquitetura, em [`docs/desenho/03-DECISOES.md`](docs/desenho/03-DECISOES.md).

## Desenvolver localmente

Node >= 22.12 (`.nvmrc`: `nvm use`), Python >= 3.12 e Docker para o PostgreSQL.

```sh
npm ci
python3 -m venv motor/.venv && motor/.venv/bin/pip install -r motor/requirements.txt
# PostgreSQL em container, na porta 5435; DATABASE_URL em ~/.config/margem/postgres.env
docker compose -f ops/postgres/compose.yml --env-file ~/.config/margem/postgres.env up -d
npm run dev          # API em 8730, worker e Vite em http://localhost:5180
```

Detalhes do motor em [`motor/README.md`](motor/README.md). Para rodar ao lado de outra instância,
use `MARGEM_PORTA`, `MARGEM_PORTA_WEB`, outro banco e outra pasta de dados (`MARGEM_DADOS`). A API
aplica as migrações de `servico/src/db/migrations` ao subir.

Verificações (sem rede; os testes usam um executor do Codex falso e bancos de teste criados e
apagados por eles):

```sh
npm run preflight
npm run typecheck
npm run lint
npm test
npm run test:ferramentas
motor/.venv/bin/pytest motor/tests
npm run build --workspace web
```

Não troque o executor falso pelo real nos testes.

## Contribuir

Relate problemas e proponha melhorias em <https://github.com/pedropasinn/margem/issues>. Para mandar
código, abra antes um item descrevendo a mudança, faça mudanças pequenas com testes e rode as
verificações acima. No primeiro pull request, o CLA Assistant pede que você assine o acordo de
contribuição (CLA): ele permite que o projeto continue podendo oferecer outras licenças, inclusive
comerciais, sem tirar de ninguém os direitos da AGPL. Não anexe livros nem textos protegidos por
direitos autorais.

## Licença

[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only). Se você modificar o Margem e
oferecê-lo a outras pessoas pela rede, a AGPL pede que o código-fonte modificado fique disponível a
elas.
