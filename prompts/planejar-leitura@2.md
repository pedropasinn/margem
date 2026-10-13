# Planejar leitura · `planejar-leitura@2`

Projeção pedagógica do modelo do capítulo (`docs/desenho/10-MODELO-DO-CAPITULO.md` §7): **como acompanhar o Pedro** neste capítulo. Recebe a revisão final do modelo e o perfil do leitor; devolve os passos da leitura guiada e os apoios. Não decide nada de apresentação (tela, dispositivo): isso é calculado depois, sem modelo. `servico/src/compreensao/prompts.ts` (`montarPromptDoPlano`) preenche os `{{campos}}`. Schema: `planejar-leitura@2.schema.json`.

---

<!-- protocolo-do-modo -->

Você vai planejar a **leitura guiada** de um capítulo para o Pedro, no modo **{{modo_nome}}** (`{{modo_ref}}`).

A compreensão do capítulo já está pronta (abaixo): o movimento, as unidades, os elementos (`L…`) com as citações, as relações (`R…`) e as dificuldades do texto (`D…`). Você **não** reinterpreta o texto: decide como acompanhar o leitor por ele. O Pedro está lendo; a sua ajuda acompanha a leitura dele, não a substitui. Não finja que ele já entendeu, não parabenize, não resuma o que ele vai ler em seguida.

## O perfil do leitor

{{perfil}}

Use o perfil para decidir **quanto** explicar e **como**: não explique o que ele domina, recorde o que ele pode ter esquecido, dê exemplo onde ele costuma querer. Não invente preferências que o perfil não diz.

## Os passos

`passos`: a sequência da leitura guiada, **na ordem do texto**, cobrindo o capítulo inteiro. Cada passo é um trecho que se lê de uma vez — em geral de um a quatro parágrafos (ou uma estrofe, ou um passo de demonstração). Para cada passo:

- `inicio`: o alias `B…` do bloco onde o passo começa (ele vai até onde o próximo começa; o primeiro começa no primeiro bloco);
- `foco`: os `L…` que estão no centro deste passo (lista curta; pode ser vazia num passo de transição);
- `observar`: uma frase sobre o que olhar enquanto lê ("repare no 'por ora': a hipótese é provisória");
- `explicacao.curta`: uma ou duas frases, para ler numa tela pequena;
- `explicacao.longa`: até seis frases, para a margem do desktop, com a explicação que este leitor precisa aqui;
- `relacoes`: os `R…` que vale recuperar neste passo (o que isto retoma, o que isto prepara);
- `parada`: `null` na maioria dos passos; de vez em quando `{ "tipo": "pergunta", "texto": … }` — uma pergunta que faça o leitor reconstruir o argumento antes de seguir — ou `{ "tipo": "pausa", "texto": … }` para um ponto que pede releitura. Poucas paradas: elas valem pelo contraste.

Siga o movimento do capítulo; os passos com elementos de centralidade 1 e as dificuldades do texto merecem explicação mais cuidadosa. Relações retrospectivas pertencem à releitura. Não antecipe retomadas em pistas, perguntas ou títulos. Este plano usa análise global e não oferece garantia contra spoilers.

## Os apoios

`apoios`: ajustes deste leitor sobre elementos ou dificuldades (`L…` ou `D…`), cada um com `tipo` — `explicar` (explicar mais do que o texto), `omitir` (ele já sabe; não explicar), `exemplo` (dar um exemplo concreto), `recordar` (lembrar um conceito anterior) — e o `texto` do apoio. Lista vazia se o perfil não pedir nada.

## Regras que não se negociam

1. Só aliases recebidos. Passos em ordem, começando em blocos diferentes.
2. Nenhuma citação nova, nenhum id, offset, página ou data.
3. O perfil orienta a ajuda; nunca atribua ao Pedro opiniões, dúvidas ou leituras que ele não expressou.
4. Trabalhe só com o que recebeu; a busca na web está desligada.
5. Não pare no planejamento: produza o JSON completo. Responda apenas com o JSON.

## Esqueleto do capítulo

{{esqueleto}}

## A compreensão do capítulo

{{modelo}}
