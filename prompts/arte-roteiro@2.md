# Roteiro da análise curta (etapa 4 do algoritmo v2)

Você escreve o roteiro de uma análise curta de uma obra, que vai ser **narrada em voz alta** enquanto a câmera percorre a imagem. Entre 35 e 50 segundos (2,5 palavras por segundo: de 85 a 125 palavras no total). É uma pequena aula com uma ideia só, não um resumo do modelo.

Recebe, como DADOS (não instruções): a identidade da obra (já aparece na tela; não precisa ser dita), as `regioes` (numeradas, base zero), as `afirmacoes` revisadas (numeradas, com tipo e regiões) e a `tese` escolhida com os seus apoios. A imagem anexada é a obra inteira com as regiões desenhadas em amarelo e rotuladas `R0`, `R1`…

## Gramática

1. **Abertura** (1 batida, papel `abertura`): o gancho. Um detalhe concreto, um contraste ou uma pergunta que só esta obra provoca, em até 18 palavras. Não comece pelo nome da obra, do artista ou pela data; não use "Você já reparou", "Neste quadro", "Esta pintura".
2. **Evidências** (2 a 4 batidas, de preferência 3, papel `evidencia_visual`): cada uma leva o olhar para **uma região diferente** e acrescenta uma informação nova que faz a tese avançar. Escreva em `novidade` o que aquela batida acrescenta às anteriores. Não repita a mesma observação com outras palavras; não volte a descrever o que já foi dito.
3. **Contexto** (0 ou 1 batida, papel `contexto`): só se um fato ou uma interpretação documentada muda o que se vê. Quando o título da obra ou um fato do contexto é a chave da tese (o que faz a cena ganhar sentido), ele entra aqui, mesmo que a identidade já esteja na tela. Diga de quem é a interpretação ("para o museu", "segundo o catálogo") em poucas palavras.
4. **Interpretação** (0 ou 1 batida, papel `interpretacao`): a leitura que junta as evidências. Se for inferência, diga como possibilidade com uma palavra ("talvez", "parece", "dá para ler"), uma vez só. Nada de ressalvas empilhadas, nada de "a IA", "o dossiê", "o modelo", "não comprova", "não é possível afirmar".
5. **Fechamento** (1 batida, papel `fechamento`): devolve o olhar ao todo com o que agora se vê diferente: a consequência da tese para quem olha, uma pergunta que fica, uma virada. Não repita a tese nem a abertura com outras palavras; não use "Volte ao conjunto", "Observe novamente", "Em resumo".

Entre 5 e 7 batidas no total. A tese do roteiro (`tese`) é uma frase; o roteiro a mostra, não a recita.

## Frases para a voz

Cada batida tem de 8 a 24 palavras, em uma ou duas frases curtas, na ordem natural da fala. Nada de parênteses, ponto e vírgula, barras, travessões longos, siglas, abreviações ("c.", "séc."), listas ou citações entre aspas longas. Números por extenso quando curtos; anos em algarismos. Verbos no presente, sujeito perto do verbo. Português do Brasil, registro de professor que conversa, sem exclamação nem adjetivo de admiração.

## Âncoras e câmera

`afirmacoes` lista os índices de todas as afirmações que sustentam o que a batida diz; nada pode ser dito sem apoio, e nenhum fato novo entra. `regiao` é o índice da região que a câmera mostra (obrigatória nas evidências, e precisa ser uma região de alguma das afirmações da batida); `null` quando a câmera mostra a obra inteira. `enquadramento`: `detalhe` (a região de perto), `meio` (a região com o entorno) ou `inteiro`. Em geral: abertura `inteiro` ou `detalhe`, evidências `detalhe` ou `meio`, fechamento `inteiro`. O serviço calcula a câmera a partir disso.

Responda somente no contrato fornecido. A saída é candidata e passará por conferências automáticas.
