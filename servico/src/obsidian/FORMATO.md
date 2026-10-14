# Exportação para o Obsidian: formato 2

Contrato das notas que o Margem escreve no cofre do Obsidian a partir da v0.1. O gerador é
`exportar-v2.ts` (função pura e determinística); o índice é `IndiceObsidianV2`
(`contratos/src/obsidian.ts`, `contratos/schemas/IndiceObsidianV2.schema.json`); a mescla com o que
já está no cofre é `core/src/obsidian.ts` (`@margem/core/obsidian`), usada pelo plugin e pelo app de
computador. O exemplo completo, gerado da entrada de `fixture-de-exemplo.ts`, está em
`__ouro__/exemplo-v2.md` (teste de ouro) e em `integracoes/obsidian/exemplo/Margem/`
(`npm run exemplo-obsidian`).

## Pastas

```
Margem/                                   pasta escolhida no cofre (padrão "Margem")
  <Documento>/                            uma por documento
    <Documento>.md                        nota-índice
    Grifos/<início da citação> · <id6>.md   com a nota do leitor e as dificuldades do grifo
    Anotações/<início do texto> · <id6>.md   só notas antigas soltas (ou de grifo não exportado)
    Perguntas/<início da pergunta> · <id6>.md
    Relações/<Família> — <origem> → <destino> · <id6>.md
    Flashcards/<início da frente> · <id6>.md
    Exercícios/Exercício <n> — <enunciado> · <id6>.md
  .margem/manifesto.json                  só no ZIP: o IndiceObsidianV2 das notas do ZIP
```

- `<Documento>` é o nome da nota da V1: o título sem `\ / : * ? " < > | # ^ [ ]` (dois-pontos viram
  ` -`), até 200 caracteres. Dois documentos com o mesmo nome: o mais antigo fica com ele, o outro
  ganha ` (<6 últimos do id>)`.
- O nome de uma nota de item são as primeiras palavras (até 60 caracteres, sem a marcação do
  Markdown), ` · ` e os 6 últimos caracteres do id em minúsculas. É determinístico e só depende do
  item, então os links `[[…]]` entre notas (até entre documentos) apontam certo sem consultar o cofre.
- Renomear ou mover uma nota no cofre é permitido: a reexportação acha a nota pelo `margem_id`, não
  pelo caminho.

## Modelo D (desde a migração 0032)

O grifo é o trecho com a cor e o rótulo de uma função **do modo do próprio grifo** (`modo` no
frontmatter; grifos de modos diferentes convivem no mesmo documento e cada um leva o rótulo e a cor
do seu). A **nota do leitor** é do grifo, uma por grifo, sem tipo: sai dentro da nota do grifo, na
seção `## Sua nota`, e não tem mais nota própria em `Anotações/`. O **comentário do Codex** continua
na nota do grifo, na seção `## Comentário do Codex`, separado da nota do leitor. A **dificuldade** é
um sinal à parte (`DificuldadeV1`), não etiqueta nem função.

- Os ids não mudam: a nota do grifo tem o `margem_id` da marca; a nota do leitor guarda o id da
  anotação e, na nota-índice, a linha dela (`- Sua nota: [[<Grifo>#Sua nota|…]] ^margem-<id>`)
  continua com o mesmo bloco `^margem-<id>` da V1.
- Uma anotação **solta** (sem grifo, de bancos antigos ou criada pela API) sai em `Anotações/` como
  **nota antiga** (`nota_antiga: true`, com o `anotacao_tipo` que tinha), só leitura no Margem. Se o
  grifo de uma nota não entra na exportação (rejeitado, ou `incluir` sem `grifo`), a nota também ganha
  nota própria em `Anotações/` (sem tipo), para nada se perder. As anotações fundidas pela 0032
  (`fundida_em`) não saem: o texto delas já está na nota do grifo.
- Quem sincronizou antes do modelo D tem, no cofre, as notas antigas de `Anotações/` das notas de
  grifo: a sincronização nunca apaga, então elas ficam onde estão, sem atualizar; o texto vale na
  nota do grifo.
- **Dificuldades**: saem os sinais com estado diferente de `descartada` (os do leitor e as decisões
  dele sobre os do Codex; uma sugestão do Codex ainda sem decisão mora no modelo do capítulo e não
  sai). As etiquetas de dificuldade antigas viraram sinais na 0032 e não saem mais como tag: a tag
  `margem/dificuldade/<categoria>` vem dos sinais ligados ao grifo (`margem/dificuldade` sem
  categoria). Etiquetas livres antigas continuam em `margem/etiqueta/<nome>`.

## Frontmatter

Todas as notas têm `margem_esquema: 2`, `margem_tipo` (`documento`, `grifo`, `anotacao`, `pergunta`,
`relacao`, `flashcard`, `exercicio`) e `margem_id` (o ULID do item; na nota-índice, o do documento).
As notas de item têm também:

| chave | o quê |
|---|---|
| `margem_documento` | `"[[<Documento>]]"`, link para a nota-índice |
| `documento`, `documento_id`, `autor`, `versao_id` | o documento (autor só se houver) |
| `capitulo`, `pagina` | capítulo de nível 1 e página (a impressa, ou a do PDF), quando houver |
| `bloco_id`, `posicao` | o bloco e `[início, fim]` em UTF-16 no texto do bloco |
| `margem_url` | volta ao trecho no Margem (`/ler/<doc>/<capítulo>?bloco=<bloco>`) |
| `criado`, `atualizado` | data e hora no fuso do leitor, com o deslocamento (`2026-09-20T10:00:00-03:00`) |
| `tags` | `margem`, `margem/<tipo>` e as do item |

Por tipo:

- **grifo**: `funcao`, `funcao_rotulo` e `cor` (a clara) da função no modo do grifo, `modo`
  (`filosofica@2`), `saliencia`, `autoria` (`leitor` | `ia`), `avaliacao`, `nota_do_leitor` (`true`
  quando há nota), `nota_revisada_pelo_codex`, `dificuldade` (as categorias dos sinais não descartados
  ligados ao grifo; `sem_categoria` quando o sinal não tem uma), `etiquetas` (só as livres). Tags:
  `margem/<função>`, `margem/ia`, `margem/dificuldade/<categoria>` (dos sinais) e as etiquetas livres
  em `margem/etiqueta/<nome>`. Sem tipo de anotação.
- **anotacao** (nota antiga solta, ou de grifo não exportado): `nota_antiga` e `anotacao_tipo` (só
  na antiga), `grifo` (link, se há grifo exportado com a mesma faixa), `fonte_titulo`, `fonte_url`,
  `fonte_pagina` (nas fontes antigas), `revisada_pelo_codex`, `etiquetas`. Tags `margem/anotacao` e
  `margem/nota_antiga`.
- **pergunta**: `estado` (`aberta` | `arquivada`), `grifo`, `anotacao` (links; a nota de um grifo é
  `[[<Grifo>#Sua nota]]`).
- **relacao**: `relacao` (a família, 6) e `relacao_rotulo`, `relacao_semantica` e
  `relacao_semantica_rotulo` (o tipo fino, 9, quando a relação veio da compreensão), `autoria`,
  `estado`, `origem` e `destino` (links para as notas dos grifos das pontas; sem grifo, a nota-índice
  do documento da ponta; nota externa, o caminho dela), `destino_tipo`, `justificativa`.
- **flashcard**: `autoria`; tag `flashcards` (o baralho do plugin Spaced Repetition).
- **exercicio**: `exercicio` (número), `capitulo_do_livro`, `secao_do_livro`, `conceitos`.
- **documento** (nota-índice): `titulo`, `autor`, `fonte`, `formato`, `margem_versao`, `margem_url`,
  `data`, `atualizado` (como na V1) e `contagens` (`grifos`, `notas` (grifos com nota do leitor),
  `anotacoes` (notas em `Anotações/`), `perguntas`, `relacoes`, `dificuldades`, `flashcards`,
  `exercicios`).

## Corpo

O corpo gerado fica entre `%% margem:inicio %%` e `%% margem:fim %%`. Reexportar troca só esse bloco
e as chaves que o Margem escreve no frontmatter (as `tags` são unidas); o que a pessoa escreveu fora
do bloco, e as chaves dela, ficam.

- **Trecho**: a linha de local (`[[<Documento>]] · <capítulo> · p. <página>`) e o callout com a
  citação **inteira**, escapada (é texto do livro, literal), com o link para a nota do grifo e para o
  Margem. O callout termina num bloco: `^trecho` nas notas de item; `^origem` e `^destino` nas de
  relação. `![[Nota#^trecho]]` embute só a citação.
- **grifo**: o trecho e as seções `Sua nota` (o texto do leitor **como Markdown**; `*(revista pelo
  Codex)*` quando foi), `Comentário do Codex`, `Dificuldades` (categoria, de quem é — marcada por
  você, sugerida pelo Codex, do Codex confirmada por você —, a descrição do Codex e o trecho quando
  não é o do grifo), `Perguntas`, `Relações` (→ quando o grifo é a origem, ← quando é o destino,
  inclusive de outro documento) e `Notas antigas` (soltas, com a mesma faixa).
- **anotacao**: o trecho e, na antiga, `**Nota antiga** · <tipo>.` e o texto **como Markdown** (nas
  fontes, a referência); na de grifo não exportado, `## Sua nota` e o texto.
- **pergunta**: o trecho e as mensagens, em `### Pergunta` e `### Resposta`, como Markdown; os trechos
  citados pela resposta, com link para o grifo quando há.
- **relacao**: a linha-resumo (`**Tensão** (responde): [[origem]] → [[destino]]`), `## Origem` com o
  trecho inteiro, `## Por quê` com a justificativa e `## Destino` com o outro trecho inteiro (ou o
  documento, ou a nota externa).
- **flashcard**: o trecho e o cartão de várias linhas do Spaced Repetition (frente, `?`, verso).
- **exercicio**: enunciado, itens (estratégia, passos com o cálculo em `$$…$$`, resposta,
  verificação) e as perguntas sobre a resolução.
- **documento** (nota-índice): título, autor e, por capítulo, uma linha por trecho, na ordem do
  texto, com o link para a nota do grifo e **o mesmo bloco `^margem-<id>` da nota V1**; embaixo, a
  nota do leitor (`Sua nota`, link para a seção do grifo), as notas antigas e as perguntas daquele
  trecho (cada uma com o seu `^margem-<id>` da V1) e as relações. Assim `[[<Documento>#^margem-…]]`
  escrito para a V1 continua caindo no lugar certo. No fim, as relações que chegam de outros
  documentos sem trecho marcado aqui, as `Dificuldades` (todas as não descartadas, na ordem do texto,
  com o trecho citado e o link para o grifo ou para o Margem), os flashcards e os exercícios.

### O texto do leitor

O que a pessoa escreveu (notas, perguntas, justificativas, cartões) sai como Markdown: ênfase,
links, listas e títulos valem. Só é escapado o que quebraria a nota: `%%` (abriria um comentário que
engole o fim do bloco do Margem), um `^id` no fim de uma linha (criaria um bloco que disputa com os
do Margem), um `<!--` sem fim e uma cerca de código aberta (é fechada no fim do texto).

## Índice e reexportação

`GET /api/obsidian/v2/indice` devolve um `IndiceObsidianV2`: por nota, `id`, `tipo`, `documento_id`,
`caminho` (relativo à pasta da exportação), `sha256` dos bytes da nota e `atualizado_em`.
`GET /api/obsidian/v2/documentos/:id` devolve as notas de um documento, com o conteúdo.
`GET /api/obsidian/v2/exportacao.zip` devolve a árvore inteira (ou só a de um documento, com
`documento=<id>`) com o manifesto. Parâmetros: `marcas=minhas|todas`, `todos=1`, `base=<url>` e
`incluir=grifo,anotacao,pergunta,relacao,flashcard,exercicio`.

A sincronização (plugin e app de computador, `sincronizarV2` em `@margem/core/obsidian`):

1. acha cada nota pelo `margem_id` do frontmatter (renomear e mover não duplicam), depois pelo
   caminho guardado, depois pelo caminho do índice;
2. pula a nota cujo `sha256` não mudou desde a última vez;
3. cria a que não existe e, na que existe, troca só o bloco gerenciado e as chaves do Margem;
4. nunca apaga: um item que saiu do Margem deixa a nota onde está.

Da V1 para a V2: a nota V1 do documento tem o mesmo `margem_id` e o mesmo nome da nota-índice; a
primeira sincronização a encontra (pelo id), troca o bloco gerenciado pelo índice novo, acrescenta
`margem_esquema: 2` e cria as notas dos itens. O que a pessoa escreveu fora do bloco fica. Se a nota
V1 estava na raiz da pasta, ela continua lá (a sincronização não move arquivos); as notas dos itens
vão para a pasta do documento.
