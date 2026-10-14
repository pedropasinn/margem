# Desenvolvimento local

Este guia é para quem roda o Margem a partir do código, fora da imagem Docker da distribuição
(`distribuicao/`). Para instalar e usar, veja `distribuicao/README.md`.

## Banco

O PostgreSQL de desenvolvimento roda em container (`ops/postgres/compose.yml`). As credenciais
ficam num arquivo fora do repositório, por exemplo `~/.config/margem/postgres.env`:

```ini
POSTGRES_USER=margem
POSTGRES_PASSWORD=<uma senha local>
POSTGRES_DB=margem
MARGEM_PG_PORT=5435
DATABASE_URL=postgres://margem:<a mesma senha>@127.0.0.1:5435/margem
```

```sh
docker compose -f ops/postgres/compose.yml --env-file ~/.config/margem/postgres.env up -d
```

A API aplica as migrações de `servico/src/db/migrations` ao subir. Com `MARGEM_MIGRAR_AO_SUBIR=0`
ela só confere a tabela `migracao` e recusa subir se o código trouxer migração que o banco não tem
(útil para servir um branch contra um banco que não deve ser migrado). Os testes de integração
criam e apagam bancos `margem_test_*` temporários no mesmo servidor; nunca aponte a suíte para um
banco com dados que importam.

## Sessão de desenvolvimento

`npm run dev` na raiz sobe API, worker e Vite e configura as origens locais. As portas padrão são
8730 (API e interface compilada) e 5180 (Vite); `MARGEM_PORTA` e `MARGEM_PORTA_WEB` as trocam. Para
rodar ao lado de outra instância, use também outro banco (`DATABASE_URL`) e outra pasta de dados
(`MARGEM_DADOS`, padrão `~/dados/margem`). O worker processa a fila do banco configurado.

A API valida a origem das escritas. `MARGEM_ORIGENS` (lista separada por vírgulas) substitui as
origens padrão; inclua nela qualquer endereço extra pelo qual você abre a interface.

## Codex

As leituras reais chamam `codex exec` dentro de um `bwrap` (`servico/src/executor/confinamento.ts`).
Fora da imagem Docker, defina `MARGEM_CODEX_MOTOR` com o binário nativo (ELF) do Codex; o padrão é
o caminho da imagem (`/usr/local/lib/leitor/codex-motor`). Os testes nunca chamam o Codex: usam o
executor falso e determinístico (`servico/src/executor/fake.ts`).

## Recursos opcionais (`MARGEM_RECURSOS`)

Algumas partes do código dependem de infraestrutura que uma instalação comum não tem e ficam
desligadas por padrão. A arte (Quadros) faz parte da V0 e vem **ligada**; sem acervo em disco,
`/api/arte` mostra as duas obras de exemplo de `fixtures/arte` (`MARGEM_ARTE_FIXTURES=0` as tira) e a
tela Quadros oferece "Adicionar obra" (a pessoa envia as próprias imagens; J118).

Tudo é controlado por uma variável única, lida pela API, pelo worker, pelo portão e pelas ferramentas
de voz (`servico/src/recursos.ts`). Ela **acrescenta** ao padrão; `-nome` tira (por exemplo
`MARGEM_RECURSOS=-arte`, ou `MARGEM_ARTE=0`). `npm run dev` liga só o padrão, a menos que a variável
venha do shell.

| Recurso | Liga | Desligado |
|---|---|---|
| `arte` (padrão: ligado) | acervo de quadros (`/api/arte*`, `/quadros`) | com `-arte` ou `MARGEM_ARTE=0`: rotas 404; sem Quadros na navegação, no filtro e no Início |
| `noticias` | `/noticias`, `/api/noticias*` e os jobs de edição, narração e ilustração (experimental) | rotas 404 `recurso_desligado`; o worker nem reserva esses jobs |
| `audio-colab` | geração de voz por uma fábrica externa de jobs (experimental) | as ferramentas recusam; **tocar** áudio já publicado continua |
| `sala` | salas de teste para leitores convidados (`/api/salas*`, `/salas`, `npm run portao`) | rotas 404; sem "Salas de teste" |
| `horarium` | `POST /api/importar/horarium`: importa uma sessão de leitura no formato do Horarium | rota 404; a importação de marcas legadas (`importar-legado`) é genérica e continua |
| `eink` | tela `/eink/<documento>/<capítulo>`, botão "Ver no e-ink" e `GET /api/planos/:id/eink.epub` | EPUB 404; `/eink/…` volta ao Início |

`audio` vale como apelido de `audio-colab`.

## Verificações

```sh
npm run preflight
npm run typecheck
npm run lint
npm test
npm run test:ferramentas
motor/.venv/bin/pytest motor/tests
npm run build --workspace web
```

Os testes não usam rede. Materiais externos registrados em `fixtures/manifest.json` (corpus que não
pode ser redistribuído) ficam fora do repositório; quando ausentes, os testes que dependem deles são
pulados.
