Você vai ler e marcar **uma parte** de um texto maior no modo de leitura **Literária** (`literaria@1`).

Leitura de poema e prosa literária: como o texto produz sentido pela imagem, pelo som, pela voz, pelas viradas, pela forma e pelo diálogo com outros textos. Marcar o que sustenta uma interpretação, não enfeitar cada verso.

Leia a parte inteira antes de decidir qualquer marca. As marcas orientam a leitura e a revisão do Pedro; elas não substituem a leitura dele nem insinuam que ele já entendeu o texto.

## Funções deste modo

Cada marca com cor tem exatamente uma função. A função diz o papel do trecho no texto, não a sua verdade, qualidade ou concordância com ele.

- `imagem` — **Imagem**. Que imagem ou figura concreta este trecho constrói? Imagem sensorial, metáfora, comparação ou figura que carrega sentido.
- `som_e_ritmo` — **Som e ritmo**. Que efeito de som ou de ritmo sustenta o sentido aqui? Aliteração, assonância, cadência, pausa ou repetição sonora com efeito observável.
- `voz` — **Voz**. Quem fala aqui, para quem e em que tom? Eu lírico, narrador, interlocutor, mudança de pessoa ou de registro.
- `virada` — **Virada**. Onde o texto muda de direção? Volta, contraste, ironia ou revelação que reorganiza o que veio antes.
- `forma` — **Forma**. Que escolha formal pesa neste trecho? Estrofe, metro, rima, enjambement, quebra de linha ou disposição na página.
- `intertexto` — **Intertexto**. A que outro texto ou tradição este trecho responde? Alusão, citação, paródia ou forma herdada, identificável no próprio texto.
- `nenhuma`: sem cor. Só ancora um comentário (código, equação ou passagem que não pede cor).

Não use outra chave de função, nem as de outros modos. Se nenhuma função estiver clara, não marque.

Duas marcas com cor (`funcao` diferente de `nenhuma`) **nunca se sobrepõem** no mesmo bloco. Se uma frase tem duas funções, selecione segmentos separados que continuem inteligíveis; se a separação ficar artificial, escolha a função predominante.

## Saliência e nível de atenção

Toda marca, inclusive as de `funcao: "nenhuma"`, tem `saliencia`:

- `1` — sem isto não se entende a passagem;
- `2` — importante;
- `3` — útil numa leitura detida.

O Pedro escolhe no leitor quanto quer ver: o nível 1 mostra só as marcas de saliência 1; o nível 2, as de 1 e 2; o nível 3, todas. Esta execução tem **nível de atenção alvo 2**: produza apenas marcas de saliência de 1 a 2.

Ordem de grandeza, não cota: no nível 1, cerca de 8% do texto dos blocos a marcar coberto por marcas de saliência 1; no nível 2, cerca de 18% coberto por marcas de saliência até 2. Um bloco introdutório pode ficar sem marca; uma passagem densa pode pedir várias. Seja mais exigente com a saliência 1 do que com as outras: se tudo é essencial, nada é.

## Comentários

`comentario` é `null` ou `{ "tipo", "rotulo", "texto" }`, com `tipo` entre os permitidos neste modo:

- `AUTOR`: paráfrase fiel do texto, sem acrescentar nada. Rótulo `AUTOR · <o quê>` (por exemplo `AUTOR · DEFINIÇÃO`, `AUTOR · TESE`, `AUTOR · IMAGEM`).
- `LEITURA`: consequência ou síntese inferencial sua, com as condições de que depende; nunca conclusão do autor. Rótulo `→ LEITURA`.
- `INVESTIGAR`: dúvida, dificuldade ou hipótese a examinar, com uma pergunta específica que oriente a releitura. Rótulo `? INVESTIGAR`.
- `CONEXAO`: relação com outra ideia deste texto: dizer qual e por quê. Rótulo `↔ CONEXÃO SUGERIDA`.
- `TENSAO`: dois trechos, duas imagens ou duas exigências que puxam em direções diferentes sem que o texto resolva. Rótulo `TENSÃO`.

Uma ideia por comentário, em geral de uma a três frases, em português. Não escreva só "importante", "interessante" ou "atenção". Não invente problemas para preencher a margem. `LEITURA` é inferência sua e nunca conclusão do autor; `AUTOR` é paráfrase fiel do texto. Não atribua ao Pedro opiniões, dúvidas ou leituras que ele não expressou, nem invente notas, leituras anteriores ou identificadores de um acervo que você não recebeu.

## Verso

Blocos `[estrofe]` guardam um verso por linha, separados por quebra de linha. Neles:

- A citação fica **dentro de uma única estrofe** e copia as quebras de linha exatamente como estão: se o trecho atravessa versos, a citação contém o `\n` entre eles (no JSON, `\n`). Não troque a quebra por espaço, barra (`/`) ou travessão, e não junte versos de estrofes diferentes.
- `virada`: marque o verso (ou o par de versos) onde o poema muda de direção, e não a estrofe inteira. No soneto, procure a volta entre os quartetos e os tercetos e o fecho do último terceto.
- `som_e_ritmo`: marque pela linha o verso em que o efeito sonoro acontece e use `sublinhar` para as sílabas ou palavras que o produzem (a aliteração, a rima interna). Diga no comentário qual é o efeito e o que ele faz ao sentido.
- `forma` e enjambement: marque a passagem de um verso ao seguinte com a quebra de linha dentro da citação, do fim do primeiro verso ao começo do segundo, e explique no comentário o que o corte suspende ou revela.
- Não comente métrica que você não conferiu sílaba a sílaba; na dúvida, `INVESTIGAR`.

[…]

## Texto desta parte

⟦b:01K5J17T000000000000000001⟧ [contexto · secao]
Círculo vicioso
⟦/b⟧

⟦b:01K5J17T000000000000000002⟧ [estrofe]
Bailando no ar, gemia inquieto vaga-lume:
— “Quem me dera que fosse aquela loira estrela,
⟦/b⟧

