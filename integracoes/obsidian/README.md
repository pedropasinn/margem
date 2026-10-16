# Margem para o Obsidian

Plugin que traz para o cofre do Obsidian o que você faz no Margem: grifos, marcas que você confirmou ou comentou, anotações, perguntas e respostas, relações, flashcards e exercícios resolvidos. Cada documento vira uma **pasta**, com a nota do documento (o índice, capítulo a capítulo) e **uma nota por item**, cada uma com o trecho inteiro e um link de volta para ele no Margem.

Veja o exemplo gerado em [`exemplo/Margem/`](exemplo/Margem/). O contrato completo do formato está em [`servico/src/obsidian/FORMATO.md`](../../servico/src/obsidian/FORMATO.md).

## Como as notas são montadas

```
Margem/
  Meditações - um ensaio sobre a dúvida/
    Meditações - um ensaio sobre a dúvida.md     nota do documento (índice)
    Grifos/Tese — Toda certeza começa por uma suspeita · 000010.md
    Anotações/Parece Agostinho antes de Descartes… · 000010.md
    Perguntas/Essa objeção é a do círculo cartesiano… · 000010.md
    Relações/Pré-requisito — Dividir cada dificuldade em → Toda certeza… · 000020.md
    Flashcards/…   Exercícios/…
```

```markdown
---
margem_esquema: 2
margem_tipo: "grifo"
margem_id: "01KM…"
margem_documento: "[[Meditações - um ensaio sobre a dúvida]]"
capitulo: "I. Da dúvida"
pagina: "111"
funcao: "tese"
cor: "#E8B04B"
criado: 2026-09-20T10:00:00-03:00
tags:
  - "margem"
  - "margem/grifo"
  - "margem/tese"
---
%% margem:inicio %%
[[Meditações - um ensaio sobre a dúvida]] · I. Da dúvida · p. 111

> [!important] Tese · [abrir no Margem](https://…/ler/<doc>/<capítulo>?bloco=<bloco>)
> Toda certeza começa por uma suspeita
^trecho

Com o app de computador, o link de volta é `margem://abrir/ler/<doc>/<capítulo>?bloco=<bloco>`: o sistema o entrega ao app, que abre o trecho na janela dele (no navegador a biblioteca do app pede a chave e não abriria).

## Anotações
- [[Parece Agostinho antes de Descartes… · 000010|Impressão — Parece Agostinho…]]

## Relações
- ← [[Pré-requisito — Dividir cada dificuldade em → Toda certeza… · 000020|Pré-requisito: «Dividir cada dificuldade…»]]
%% margem:fim %%
```

- **O bloco do Margem** fica entre `%% margem:inicio %%` e `%% margem:fim %%` (comentários do Obsidian, invisíveis na leitura). A sincronização troca só esse trecho. **Escreva fora dele**, antes ou depois: o que estiver ali continua. O que for escrito dentro é substituído na próxima sincronização.
- **Frontmatter**: as chaves do Margem (`margem_*`, documento, autor, capítulo, página, posição, função, modo, cor, datas…) são atualizadas; as suas chaves ficam; `tags` soma as suas às do Margem.
- **Relações**: cada uma é uma nota com os dois trechos inteiros, o porquê e links para as notas das duas pontas (`origem` e `destino` nas propriedades). Cada grifo lista as relações em que é origem (→) ou destino (←).
- **O texto que você escreveu no Margem** chega como Markdown (ênfase, links, listas).
- **Links para trechos**: a nota do documento tem o mesmo nome e os mesmos blocos `^margem-<id>` da versão anterior do plugin, agora apontando para a nota de cada item. `[[Meditações - um ensaio sobre a dúvida#^margem-01km…]]` continua valendo. Na nota do item, `![[<nota>#^trecho]]` embute só a citação.
- **Tags**: `#margem/<tipo>`, `#margem/<função>`, `#margem/ia` nas marcas da leitura do Codex, `#margem/dificuldade/<tipo>` nas sete etiquetas de dificuldade e `#margem/etiqueta/<nome>` nas suas etiquetas. Os flashcards levam `#flashcards` e seguem o formato do plugin Spaced Repetition.
- Cada nota é achada pelo `margem_id`: pode renomear e mover para outra pasta, sem gerar cópia.
- Nada é apagado. Um item que sai do Margem deixa a nota no cofre como está.
- Marcadores quebrados (você apagou um deles, ou duplicou): a nota não é tocada e o aviso diz quantas ficaram de fora; o console do Obsidian (Ctrl+Shift+I) diz quais.
- **Da versão anterior (uma nota por documento)**: a primeira sincronização acha a nota antiga pelo `margem_id`, troca o bloco dela pelo índice novo (o que você escreveu fora do bloco fica, e ela continua onde estava) e cria as notas dos itens na pasta do documento.

## Instalação

### Manual

1. Construa o plugin (precisa de Node 22):
   ```sh
   cd integracoes/obsidian
   npm install
   npm run build
   ```
2. Copie `main.js` e `manifest.json` para `<cofre>/.obsidian/plugins/margem/`. Ou, com o caminho do cofre:
   ```sh
   npm run instalar -- ~/Documentos/Zettel
   ```
3. No Obsidian: **Configurações → Plugins da comunidade**, desligue o modo restrito se estiver ligado, recarregue a lista e ative **Margem**.

### Via BRAT

O [BRAT](https://github.com/TfTHacker/obsidian42-brat) instala plugins a partir de um repositório do GitHub com uma *release* que tenha `main.js` e `manifest.json` anexados.

1. Gere a release (a tag é a versão do `manifest.json`):
   ```sh
   cd integracoes/obsidian && npm run build
   gh release create obsidian-0.2.0 main.js manifest.json --title "Margem para Obsidian 0.2.0" --notes "Uma nota por item."
   ```
   O BRAT procura `manifest.json` na raiz do repositório e na release; como o plugin mora em `integracoes/obsidian/`, anexe sempre os dois arquivos à release. Para o repositório privado, configure um token do GitHub no BRAT (Settings → BRAT → GitHub personal access token).
2. No Obsidian, instale o BRAT, rode **BRAT: Add a beta plugin for testing** e informe `pedropasinn/margem`.
3. Ative **Margem** nos plugins da comunidade.

Ao publicar versão nova: suba `version` em `manifest.json` e `package.json`, acrescente a linha em `versions.json` (`"<versão>": "<minAppVersion>"`) e crie a release com a tag nova.

## Configurações

| Campo | O que é |
| --- | --- |
| Servidor | O endereço do Margem, como você abre no navegador: `http://127.0.0.1:8730` no próprio computador ou o endereço remoto que você configurou (por exemplo, `https://<máquina>.<tailnet>.ts.net` pelo Tailscale). Os links de volta usam este endereço. |
| Token | Reservado para o beta (tokens por usuário, em planejamento). Hoje o servidor pessoal não pede token; deixe vazio. Quando preenchido, vai em `Authorization: Bearer <token>`. |
| Pasta | Onde as pastas dos documentos são criadas (padrão `Margem`). |
| Marcas da leitura | Desligado: só os seus grifos e as marcas da IA que você confirmou, mudou, etiquetou ou comentou. Ligado: também as marcas visíveis (não rejeitadas) da leitura que o Margem abre por padrão. |
| Documentos sem notas | Cria a nota do documento também quando você não fez nada nele. |
| Sincronizar ao abrir / a cada N minutos | Sincronização automática, silenciosa quando nada mudou. |
| Esquecer o estado | Faz a próxima sincronização baixar tudo de novo. |

Comando: **Margem: Sincronizar** (também no ícone de livro na barra lateral).

## Como o plugin fala com o Margem

Só leitura, por `requestUrl` do Obsidian (sem CORS):

- `GET /api/obsidian/v2/indice?marcas=…&base=<servidor>` — `IndiceObsidianV2` (`contratos/schemas/IndiceObsidianV2.schema.json`): uma entrada por nota, com o caminho e o `sha256`. O plugin guarda o hash de cada nota e só baixa os documentos que têm alguma nota mudada.
- `GET /api/obsidian/v2/documentos/<id>?marcas=…&base=<servidor>` — as notas de um documento, com o conteúdo.

Cabeçalhos: `X-Margem: 1` (o cabeçalho de mesma origem da API; ela só o exige nas escritas, e o plugin não escreve) e, se houver token, `Authorization`.

O Margem só atende pelos hosts aceitos (`127.0.0.1`, `localhost` e o nome em `MARGEM_TAILSCALE_HOST`). Se o servidor recusar a origem do pedido (`403 origem_recusada`), acrescente a origem do Obsidian (`app://obsidian.md`, ou `capacitor://localhost` no celular) a `MARGEM_ORIGENS` no ambiente da API, junto com as origens padrão.

## Desenvolvimento

```sh
npm install        # só dentro desta pasta: o plugin não é workspace da raiz
npm test           # vitest: o cliente da API (a mescla e a sincronização são testadas em core/)
npm run typecheck
npm run dev        # esbuild em modo observação (main.js com sourcemap)
npm run build      # main.js final
```

A mescla e a sincronização moram em `core/src/obsidian.ts` (`@margem/core/obsidian`), sem dependência do Obsidian, e são as mesmas que o app de computador usa em **Exportar para o Obsidian…**; `src/sincronizar.ts` só monta o cliente HTTP, e `src/main.ts` liga tudo ao cofre e às configurações (o esbuild embute o módulo do `core` no `main.js`). O exemplo em `exemplo/` é regenerado na raiz do Margem com `npm run exemplo-obsidian`, e os testes do serviço conferem que ele bate com o exportador.
