# Contribuir com o Margem

Obrigado pelo interesse. O Margem é um projeto pequeno; contribuições focadas e com testes são as
mais fáceis de aceitar.

## Antes de começar

- Para defeitos e ideias, abra um item em <https://github.com/pedropasinn/margem/issues>.
- Para código, abra antes um item descrevendo a mudança, principalmente se ela mexe em contratos
  (`contratos/`), migrações (`servico/src/db/migrations`) ou prompts (`prompts/`).
- Leia `AGENTS.md` (regras do projeto, valem para pessoas e para agentes de código) e
  `docs/desenho/03-DECISOES.md`.

## Acordo de contribuição (CLA)

No primeiro pull request, o [CLA Assistant](https://cla-assistant.io/) pede que você aceite o
[acordo de contribuição](CLA.md). Ele é uma licença não exclusiva: você continua dono do que
escreveu, e o projeto pode distribuir a sua contribuição sob a AGPL-3.0 e também sob outras
licenças, inclusive comerciais. Sem o acordo assinado o pull request não é mesclado.

## Ambiente

Node >= 22.12 (`nvm use`), Python >= 3.12 e Docker (para o PostgreSQL de desenvolvimento).

```sh
npm ci
python3 -m venv motor/.venv && motor/.venv/bin/pip install -r motor/requirements-dev.txt
docker compose -f ops/postgres/compose.yml --env-file ~/.config/margem/postgres.env up -d
```

O arquivo de ambiente e as outras variáveis estão em `ops/desenvolvimento-local.md`.

## Testes

```sh
npm run typecheck
npm run lint
npm test                        # vitest; os testes de banco criam e apagam bancos margem_test_*
npm run test:ferramentas
motor/.venv/bin/pytest motor/tests
npm run build --workspace web
```

- Os testes não usam rede e nunca chamam o Codex de verdade: use o executor falso
  (`servico/src/executor/fake.ts`) e os roteiros de `fixtures/codex/`.
- Alguns testes dependem de um corpus que não pode ser redistribuído; sem ele, aparecem como
  pulados (`fixtures/manifest.json`).
- Testes de navegador (`web/tests/*.spec.ts`) usam o Playwright: `npx playwright install chromium`.

## Pull requests

- Uma mudança por pull request, com testes que falham sem ela.
- Contratos, schemas e prompts são versionados: não altere uma versão publicada; crie a próxima.
- Migrações são só de avanço; nunca edite uma migração já existente.
- Não inclua livros, artigos, imagens ou áudios protegidos por direitos autorais, nem dados pessoais.
- Nomes e mensagens de commit em português.
