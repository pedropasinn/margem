Você vai ler e marcar **uma parte** de um texto maior no modo de leitura **Engenharia de software** (`engenharia_software@1`).

Leitura de livros didáticos de engenharia de software: distinguir conceitos, decisões de projeto e mecanismos. Preservar condições, contexto e trade-offs das recomendações; não transformar heurísticas em leis universais. Relacionar processos, requisitos, arquitetura, testes e manutenção. Usar código como exemplo técnico, sem executá-lo. Não inventar o conteúdo de diagramas ausentes nem atribuir ao leitor conhecimentos não informados.

Leia a parte inteira antes de decidir qualquer marca. As marcas orientam a leitura e a revisão do Pedro; elas não substituem a leitura dele nem insinuam que ele já entendeu o texto.

## Funções deste modo

Cada marca com cor tem exatamente uma função. A função diz o papel do trecho no texto, não a sua verdade, qualidade ou concordância com ele.

- `tese` — **Decisão ou princípio**. Que decisão, princípio ou recomendação o autor defende, e em quais condições? Princípios, recomendações e conclusões sobre projeto, processo e qualidade; preservar limites e trade-offs.
- `conceito` — **Conceito**. Que conceito, responsabilidade, contrato ou distinção preciso entender? Definições e distinções técnicas, responsabilidades, pressupostos e condições de validade.
- `justificativa` — **Mecanismo ou exemplo**. Como funciona, por que funciona e que exemplo ou evidência sustenta a decisão? Mecanismos, passos, exemplos de código e contraexemplos que explicam ou justificam uma escolha.
- `nenhuma`: sem cor. Só ancora um comentário (código, equação ou passagem que não pede cor).

Não use outra chave de função, nem as de outros modos. Se nenhuma função estiver clara, não marque.

Duas marcas com cor (`funcao` diferente de `nenhuma`) **nunca se sobrepõem** no mesmo bloco. Se uma frase tem duas funções, selecione segmentos separados que continuem inteligíveis; se a separação ficar artificial, escolha a função predominante.

## Saliência e nível de atenção

Toda marca, inclusive as de `funcao: "nenhuma"`, tem `saliencia`:

- `1` — sem isto não se entende a passagem;
- `2` — importante;
- `3` — útil numa leitura detida.

O Pedro escolhe no leitor quanto quer ver: o nível 1 mostra só as marcas de saliência 1; o nível 2, as de 1 e 2; o nível 3, todas. Esta execução tem **nível de atenção alvo 2**: produza apenas marcas de saliência de 1 a 2.

Ordem de grandeza, não cota: no nível 1, cerca de 4% do texto dos blocos a marcar coberto por marcas de saliência 1; no nível 2, cerca de 10% coberto por marcas de saliência até 2. Um bloco introdutório pode ficar sem marca; uma passagem densa pode pedir várias. Seja mais exigente com a saliência 1 do que com as outras: se tudo é essencial, nada é.

## Comentários

`comentario` é `null` ou `{ "tipo", "rotulo", "texto" }`, com `tipo` entre os permitidos neste modo:

- `AUTOR`: paráfrase fiel do texto, sem acrescentar nada. Rótulo `AUTOR · <o quê>` (por exemplo `AUTOR · DEFINIÇÃO`, `AUTOR · TESE`, `AUTOR · IMAGEM`).
- `LEITURA`: consequência ou síntese inferencial sua, com as condições de que depende; nunca conclusão do autor. Rótulo `→ LEITURA`.
- `INVESTIGAR`: dúvida, dificuldade ou hipótese a examinar, com uma pergunta específica que oriente a releitura. Rótulo `? INVESTIGAR`.
- `OBJECAO`: objeção fundamentada: qual premissa, inferência ou evidência é problemática e por quê. Rótulo `× OBJEÇÃO`.
- `CONEXAO`: relação com outra ideia deste texto: dizer qual e por quê. Rótulo `↔ CONEXÃO SUGERIDA`.

Uma ideia por comentário, em geral de uma a três frases, em português. Não escreva só "importante", "interessante" ou "atenção". Não invente problemas para preencher a margem. `LEITURA` é inferência sua e nunca conclusão do autor; `AUTOR` é paráfrase fiel do texto. Não atribua ao Pedro opiniões, dúvidas ou leituras que ele não expressou, nem invente notas, leituras anteriores ou identificadores de um acervo que você não recebeu.

[…]

## Texto desta parte

⟦b:01K5J17T000000000000000001⟧ [contexto · secao]
Círculo vicioso
⟦/b⟧

⟦b:01K5J17T000000000000000002⟧ [estrofe]
Bailando no ar, gemia inquieto vaga-lume:
— “Quem me dera que fosse aquela loira estrela,
⟦/b⟧

