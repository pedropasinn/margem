# Margem para o Obsidian

Plugin que traz para o cofre do Obsidian o que você faz no Margem: grifos, marcas que você confirmou ou comentou, notas, perguntas e respostas e conexões. Cada documento vira uma nota, com uma seção por capítulo; cada trecho vira um callout com a citação, a função da marca (tese, objeção…) como tipo do callout e como tag, e um link de volta para o trecho no Margem.

Veja um exemplo de nota gerada em [`exemplo/`](exemplo/).

## Como a nota é montada

```markdown
---
titulo: "Meditações: um ensaio sobre a dúvida"
autor: "René Descartes"
margem_id: "01KD…"
tags:
  - margem
---
%% margem:inicio %%
# Meditações…
## I. Da dúvida
> [!important] Tese · p. 111 · [abrir no Margem](https://…/ler/<doc>/<capítulo>?bloco=<bloco>)
> Toda certeza começa por uma suspeita
>
> #margem/tese #margem/ia

^margem-01km…

**Impressão.** Parece Agostinho antes de Descartes… ^margem-01kn…

> [!question]- Essa objeção é a do círculo cartesiano?
> **Pergunta:** …
> **Resposta:** …
%% margem:fim %%
```

- **O bloco do Margem** fica entre `%% margem:inicio %%` e `%% margem:fim %%` (comentários do Obsidian, invisíveis na leitura). A sincronização troca só esse trecho. **Escreva fora dele**, antes ou depois: o que estiver ali continua. O que for escrito dentro é substituído na próxima sincronização.
- **Frontmatter**: `titulo`, `autor`, `fonte`, `formato`, `margem_id`, `margem_versao`, `margem_url`, `data` e `atualizado` são do Margem e são atualizados; as suas chaves (aliases, status, o que for) ficam; `tags` soma as suas às do Margem.
- **Links para trechos**: cada trecho, nota e pergunta tem um bloco estável `^margem-<id>`. Do seu Zettelkasten, `[[Meditações - um ensaio sobre a dúvida#^margem-01km…]]` aponta para o trecho e continua valendo nas próximas sincronizações.
- **Tags**: `#margem/<função>` (tese, conceito, objecao, imagem…), `#margem/ia` nas marcas da leitura do Codex (os seus grifos não levam), `#margem/dificuldade/<tipo>` nas etiquetas "?".
- **Conexões** aceitas viram lista: com uma nota do cofre, wikilink; com outro trecho do mesmo documento, link para o bloco; com outro documento, wikilink para a nota dele.
- A nota é achada pelo `margem_id`: pode renomear e mover para outra pasta.
- Nada é apagado. Um documento arquivado no Margem deixa a nota no cofre como está.
- Marcadores quebrados (você apagou um deles, ou duplicou): a nota não é tocada e o aviso diz quantas ficaram de fora; o console do Obsidian (Ctrl+Shift+I) diz quais.

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
   gh release create obsidian-0.1.0 main.js manifest.json --title "Margem para Obsidian 0.1.0" --notes "Primeira versão."
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
| Pasta | Onde as notas novas são criadas (padrão `Margem`). |
| Marcas da leitura | Desligado: só os seus grifos e as marcas da IA que você confirmou, mudou, etiquetou ou comentou. Ligado: também as marcas visíveis (não rejeitadas) da leitura que o Margem abre por padrão. |
| Documentos sem notas | Cria nota também para documentos em que você não fez nada. |
| Sincronizar ao abrir / a cada N minutos | Sincronização automática, silenciosa quando nada mudou. |
| Esquecer o estado | Faz a próxima sincronização baixar tudo de novo. |

Comando: **Margem: Sincronizar** (também no ícone de livro na barra lateral).

## Como o plugin fala com o Margem

Só leitura, por `requestUrl` do Obsidian (sem CORS):

- `GET /api/obsidian/indice?marcas=…&base=<servidor>` — `IndiceObsidianV1` (`contratos/schemas/IndiceObsidianV1.schema.json`): um item por documento, com o `sha256` da nota. O plugin guarda o hash de cada documento e só baixa o que mudou.
- `GET /api/documentos/<id>/obsidian.md?marcas=…&base=<servidor>` — a nota.

Cabeçalhos: `X-Margem: 1` (o cabeçalho de mesma origem da API; ela só o exige nas escritas, e o plugin não escreve) e, se houver token, `Authorization`.

O Margem só atende pelos hosts aceitos (`127.0.0.1`, `localhost` e o nome em `MARGEM_TAILSCALE_HOST`). Se o servidor recusar a origem do pedido (`403 origem_recusada`), acrescente a origem do Obsidian (`app://obsidian.md`, ou `capacitor://localhost` no celular) a `MARGEM_ORIGENS` no ambiente da API, junto com as origens padrão.

## Desenvolvimento

```sh
npm install        # só dentro desta pasta: o plugin não é workspace da raiz
npm test           # vitest: mescla dos blocos e sincronização
npm run typecheck
npm run dev        # esbuild em modo observação (main.js com sourcemap)
npm run build      # main.js final
```

A mescla (`src/mesclar.ts`) e a sincronização (`src/sincronizar.ts`) não dependem do Obsidian; `src/main.ts` só liga as duas ao cofre e às configurações. Os marcadores `%% margem:inicio %%`/`%% margem:fim %%` repetem os de `servico/src/obsidian/exportar.ts`. O exemplo em `exemplo/` é regenerado na raiz do Margem com `npm run exemplo-obsidian`, e um teste do serviço confere que ele bate com o exportador.
