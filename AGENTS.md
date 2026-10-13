# Margem · regras para agentes de código

Margem é um leitor de textos marcados: ingestão (PDF, EPUB, Markdown, TXT, texto colado, vídeos),
marcação por Codex, leitor web com notas na margem e retomada de leitura. Roda instalado no
computador de quem lê: Postgres em container, motor de IA só pelo `codex exec` da conta ChatGPT da
pessoa. Nada de chave de API do modelo.

**Fidelidade documental** (`docs/desenho/08-FIDELIDADE-DOCUMENTAL.md`): quando o documento tem
representação visual própria (PDF), o leitor mostra o original, e extração, OCR e canônico são
camadas semânticas invisíveis.

Leia antes de mudar algo grande: `docs/desenho/03-DECISOES.md` (o que vale), o método de marcação
em `docs/desenho/04-METODO-DE-MARCACAO.md` e os contratos em `docs/CONTRATOS.md`.

## Estrutura

```
contratos/     schemas JSON versionados (fonte da verdade) + tipos TS + casos válidos/inválidos
core/          núcleo puro em TS: âncoras, texto canônico, segmentos (sem React, sem banco)
servico/       Node 22 + Hono: API, repositórios Postgres, fila, worker, executor Codex
motor/         Python 3.12 (venv em motor/.venv): ingestão → CanonicoV1; geometria; exportação
web/           React 18 + TypeScript + Vite + CSS: biblioteca e leitor
prompts/       prompts versionados (as versões antigas ficam: entram no hash das execuções)
fixtures/      corpus de teste com manifesto de hashes (nunca segredos)
distribuicao/  compose.yml e instaladores da instalação local
tools/         preflight, capturas, utilitários
ops/           Postgres de desenvolvimento, backup e restauração
```

## Regras que não se negociam

1. **Contratos primeiro.** `contratos/` é dono dos schemas. Offsets em unidades UTF-16 relativos ao
   texto do bloco; hashes SHA-256 dos bytes UTF-8; IDs ULID gerados pelo serviço (o modelo nunca cria
   id); campos desconhecidos são recusados; versões de texto, de schema e de prompt são imutáveis
   (mudança = versão nova).
2. **Só o serviço Node escreve no Postgres.** Python devolve JSON e artefatos; o worker publica em
   transação única com `lease_token` válido. Execução repetida é tolerada; publicação duplicada, não.
3. **O modelo devolve bloco + citação literal; o serviço resolve offsets.** Citação ambígua ou
   ausente vira diagnóstico visível, nunca escolha silenciosa da primeira ocorrência.
4. **Sem rede** em build e testes.
5. **Executor Codex falso e determinístico nos testes** (`servico/src/executor/fake.ts`). Nenhum
   teste dispara leituras reais.
6. **Segredos fora do repositório** (por exemplo `~/.config/margem/postgres.env` com a
   `DATABASE_URL`). Nunca copiar para fixtures ou logs. Testes de integração criam e apagam bancos
   `margem_test_*` próprios.
7. **Interface**: o texto nunca recebe `background`, peso nem fonte trocada por causa de uma marca;
   função se desenha pela camada SVG do componente `Marcador`; composição, tamanhos e larguras do
   leitor conforme `docs/desenho/07-UI-EDITORIAL.md`; sem faixa ou borda grossa à esquerda; no máximo
   duas famílias tipográficas. Nada do modelo vai para `innerHTML`.
8. **Nomes em português** no código, nos schemas e nos commits (exceto termos técnicos
   consagrados). Sem `any`. Mensagens de commit curtas, uma por área.
9. **Direitos autorais**: não adicione livros, artigos ou imagens protegidos como fixtures. Use textos
   em domínio público, sob licença livre (com atribuição registrada) ou escritos para o teste.

## Comandos

```
npm run preflight          # ferramentas, versões, Postgres, fixtures
npm run typecheck          # tsc -b em todos os workspaces
npm run lint
npm test                   # vitest em todos os workspaces
npm run test:ferramentas
motor/.venv/bin/pytest motor/tests
```

Configuração do ambiente local em `ops/desenvolvimento-local.md`.
