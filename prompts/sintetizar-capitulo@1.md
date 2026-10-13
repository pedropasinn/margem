# Sintetizar capítulo · `sintetizar-capitulo@1`

Segunda etapa da compreensão do capítulo (`docs/desenho/10-MODELO-DO-CAPITULO.md`). Uma chamada por capítulo, depois que todas as partes foram analisadas. Recebe o esqueleto do capítulo, a revisão r0 (a união das análises locais, com a citação de cada elemento: o pacote de evidências) e, se couber, o texto inteiro. Devolve o movimento, as unidades de leitura e um lote de operações que leva r0 a r1. `servico/src/compreensao/prompts.ts` (`montarPromptDeSintese`) preenche os `{{campos}}`. Schema: `sintetizar-capitulo@1.schema.json`.

---

Você vai sintetizar a compreensão de **um capítulo inteiro** no modo **{{modo_nome}}** (`{{modo_ref}}`).

{{modo_descricao}}

Leitores diferentes analisaram o capítulo parte por parte, cada um vendo só a sua parte. Você recebe o que eles registraram (os elementos `L…`, as relações `R…` e as dificuldades `D…`), cada elemento com a citação literal que o sustenta, e o esqueleto do capítulo em ordem. {{sobre_o_texto}}

Sua tarefa é olhar o conjunto **pela primeira vez inteiro** e dizer o que só se vê assim. Não reescreva as análises: corrija-as com operações precisas, cada uma com motivo.

## 1. O movimento

`movimento.texto`: de 3 a 8 frases com o que o capítulo faz do começo ao fim — a pergunta, o percurso, onde chega. Fiel ao texto: é o movimento do autor, não a sua opinião. `movimento.etapas`: a sequência de etapas, cada uma com as unidades (`U…`) que a compõem e uma frase.

## 2. As unidades de leitura

`unidades`: trechos contíguos que se leem como um todo (uma seção, um argumento, uma demonstração, um grupo de estrofes). Para cada uma: `ref` (`U1`, `U2`…), `inicio` (o alias `B…` do bloco onde ela começa), `titulo` curto e `funcao_no_capitulo` em uma frase. Dê só o início: cada unidade vai até onde a próxima começa, e a primeira começa no primeiro bloco. Em geral, de 3 a 12 unidades por capítulo.

## 3. As operações

Cada operação tem `motivo` (uma frase concreta) e `evidencia` (os `L…` cujas citações a sustentam; lista vazia só quando o motivo é a própria redação do elemento).

- `fundir` — `alvo` absorve `absorvidos`: o mesmo elemento registrado por duas partes, ou duas vezes na mesma. As citações se juntam; as relações passam para o alvo.
- `promover` / `rebaixar` — `alvo` e `para` (a nova centralidade). A centralidade agora é **no capítulo**: `1` — sem isto o capítulo não se sustenta; `2` — importante; `3` — complementar. Promova o que o resto do capítulo revela decisivo (a hipótese "provisória" de que tudo depende, a definição que volta em cada passo); rebaixe o que parecia central na parte e é só exemplo ou preparação no conjunto.
- `corrigir_papel` — `alvo`, `nucleo` e `papel`: papéis inconsistentes entre partes (a mesma coisa chamada de tese numa parte e de conceito noutra), ou um núcleo que a visão do conjunto corrige.
- `reescrever_enunciado` — `alvo` e `enunciado`: só quando o enunciado local está errado à luz do capítulo.
- `acrescentar_nota` — `alvo`, `tipo` (`LEITURA`, `INVESTIGAR`, `OBJECAO`, `TENSAO`) e `texto`: uma inferência que só o conjunto permite.
- `criar_relacao` — `ref` (`n1`, `n2`… novos, cada um uma vez), `origem`, `destino` (`L…` ou um `n…` criado nesta resposta), `tipo`, `explicacao`, `confianca` e `retrospectiva`. `retrospectiva: true` quando a relação só aparece lendo o fim: o trecho do começo que o fim revela decisivo. As relações entre partes diferentes são justamente o que os leitores locais não podiam ver.
- `remover_relacao` — `alvo` (`R…`): relação errada ou vazia.
- `remover_elemento` — `alvo`: elemento trivial, redundante ou errado. Seja econômico.
- `adicionar_elemento` — `ref` (`n…`) e os mesmos campos da análise local (`nucleo`, `papel`, `citacoes`, `enunciado`, `qualificadores`, `centralidade`, `notas`), para algo essencial que nenhuma parte registrou. Citações literais, com os aliases `B…` do capítulo. {{sobre_adicionar}}
- `adicionar_dificuldade` / `remover_dificuldade` — dificuldades do **texto** (nunca do leitor), como na análise local.

Os tipos de relação, os núcleos, os papéis e as dificuldades são os mesmos da análise local:

- núcleos: `afirmacao`, `conceito`, `hipotese`, `evidencia`, `exemplo`, `objecao`, `passo`, `elemento_textual`;
- relações: `suporta`, `desenvolve`, `pressupoe`, `contrasta`, `exemplifica`, `retoma`, `responde`, `tensiona`, `ecoa`;
- papéis do modo:

{{funcoes}}
- `null`: nenhum papel serve.

## Regras que não se negociam

1. Só use os aliases que recebeu (`B…`, `L…`, `R…`, `D…`) e os `n…` que você mesmo criar nesta resposta. Alias desconhecido derruba a operação.
2. Uma operação por necessidade real; nada de operação sem efeito.
3. Não produza ids, offsets, páginas nem datas.
4. Nenhuma frase sobre o leitor: descreva o texto.
5. Trabalhe só com o que recebeu; a busca na web está desligada.
6. Não pare no planejamento: produza o JSON completo. Responda apenas com o JSON.

## Esqueleto do capítulo

Cada linha: alias do bloco, tipo e o começo do texto.

{{esqueleto}}

## O que as partes registraram (revisão r0)

{{modelo}}

{{texto}}
