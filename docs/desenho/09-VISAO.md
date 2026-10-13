# Margem · visão do produto

25 de setembro de 2026. Registrado a partir das conversas de desenho com o GPT e com o Claude sobre o que o Margem deve ser no fim. Este texto é o **norte**: não decide contratos nem jobs. As decisões continuam em `03-DECISOES.md`, `06-F2.md` e `08-FIDELIDADE-DOCUMENTAL.md`; o desenho técnico do que vem a seguir é pedido em `docs/jobs/J25-SPEC.md`.

## 1. A imagem

> **Abrir um livro ao lado de um professor.** Ele lê junto com você, destaca, explica, para às vezes, liga uma parte a outra, resolve o exercício que você apontou, mostra o texto de outro jeito quando ajuda, e vai te conhecendo com o tempo.

Em uma frase: o Margem é um leitor em que o texto original permanece soberano e uma camada de compreensão acompanha a leitura — destacando, explicando, relacionando, resolvendo, visualizando e adaptando a ajuda ao modo de aprender do leitor.

Ele não é um leitor de PDF com chat, um app de anotações, um gerador de resumos nem um Zettelkasten. A IA não promove sozinha sugestões, artefatos ou interpretações a notas permanentes do leitor, e não finge que a leitura foi feita.

## 2. Princípios

1. **O texto é soberano.** O PDF original fica na frente (08) e é sempre a representação visual de referência. Extração, OCR e canônico são camadas invisíveis. Um dispositivo que não comporta a página (o e-ink, por exemplo) pode usar uma representação refluível derivada, desde que cada trecho mantenha o vínculo com a sua `AncoraV1`. Tudo o que a IA ou o leitor produzem se prende a trechos; nada flutua num histórico solto.
2. **Uma compreensão, várias experiências.** A IA constrói uma compreensão do capítulo, ancorada no texto: unidades, afirmações, conceitos, evidências, exemplos, objeções, dependências, dificuldades textuais, relações. Marcas, leitura guiada, braquetes, áudio e diagramas são **projeções** dessa compreensão, e não fontes independentes. A leitura guiada é linear; as relações não são; nenhuma das duas pode deformar a outra.
3. **Compreensão, pedagogia e apresentação são coisas separadas.** O modelo do capítulo diz *o que o texto faz*. O plano pedagógico diz *como acompanhar este leitor aqui*: o que observar, onde parar, o que explicar, que relação recuperar, em que sequência. A apresentação diz *como isso cabe neste dispositivo*: quantos parágrafos por tela, explicação ao lado ou na tela seguinte, como mostrar o braquete, como navegar. O dispositivo não decide a pedagogia: o mesmo trecho tem os mesmos passos no desktop, no e-ink e no áudio.
4. **A compreensão não depende do leitor.** O modelo pode dizer "a passagem depende de uma distinção que o autor não explicita"; não pode dizer "o leitor provavelmente não vai entender isto". O perfil do leitor entra no plano pedagógico e nas respostas, nunca na análise do texto.
5. **Local → global → local, sem resumo sobre resumo.** Primeiro se lê cada passagem com fidelidade ao texto. Depois as leituras locais se juntam numa síntese do capítulo, que continua vendo as citações originais que sustentam cada elemento. Por fim, a síntese volta às passagens: a hipótese do começo que só se revela decisiva quarenta páginas depois é promovida onde está. Toda compressão semântica preserva uma ponte para a evidência original, e nenhuma leitura global prematura dita o que as passagens significam.
6. **IA preparada, IA sob demanda.** O que se pode antecipar é preparado em segundo plano: marcas, estrutura, relações, plano pedagógico, comentários, áudio roteirizado. Avançar um passo nunca chama o modelo. A IA ao vivo entra quando o leitor sai do previsto: "não entendi", "explique com Keynes", "resolva este exercício", "gere uma imagem deste poema".
7. **Tudo auditável.** Do texto à marca, cada etapa fica guardada: o prompt exato, a resposta, a interpretação local, a síntese, cada operação de revisão com o seu motivo, a decisão de destacar, o plano. Revisões publicadas são imutáveis; o que muda, muda por operação registrada. Quando algo sai ruim, dá para ver em que estágio o erro nasceu.
8. **O leitor decide.** As relações que a IA percebe pertencem à análise e são versionadas com ela; as conexões do leitor pertencem ao espaço dele e só nascem quando ele cria ou adota uma. Sugestões da IA nascem sugeridas. Marcas se confirmam ou rejeitam. O perfil do leitor é explícito e editável; quando o Margem percebe um padrão, ele **pergunta** antes de mudar ("você costuma pedir exemplos depois de demonstrações; quer que eu passe a incluí-los?").
9. **Interface calma.** Sempre visíveis: a página, as marcas, a nota básica, a seleção e a navegação essencial. O leitor vê "Não preparado · Preparando… · Pronto · Falhou"; os estágios internos são do auditor. Sob demanda: braquetes (ocultos, relevantes ou todos), áudio, imagens, diagramas, exercícios, conexões externas, explicações estendidas. O resto das regras visuais continua em `07-UI-EDITORIAL.md`.

## 3. Camadas do produto

| Camada | O que contém | Estado em 25/09/2026 |
|---|---|---|
| 1 · Texto soberano | PDF original, canônico, âncoras, marcas desenhadas sobre a página, notas ancoradas | pronto (J22–J24) |
| 2 · Leitura assistida | marcas por modo e saliência, explicação de trecho, perguntas, **leitura guiada** com foco no parágrafo | marcas e perguntas prontas; leitura guiada por fazer |
| 3 · Relações e estrutura | modelo do capítulo, **braquetes** entre trechos, mapa do capítulo e do livro, conexões internas e externas | conexões manuais e sugeridas prontas; o resto por fazer |
| 4 · Outras expressões | **áudio** (narração, depois comentado), Mermaid, esquemas, **imagens generativas**, linha do tempo, quadro comparativo | por fazer |
| 5 · Trabalho do leitor | anotações, **exercícios resolvidos** em canvas próprio, fichamentos, perfil do leitor, depois flashcards e trilhas | anotações prontas; o resto por fazer |

## 4. As experiências

**Leitura livre.** O modo de hoje: o PDF, as marcas no nível de atenção escolhido, a margem de notas, seleção → anotar, perguntar, conectar.

**Leitura guiada.** O leitor passa para o lado e um parágrafo, ou um conjunto de parágrafos, vem ao centro; o resto da página escurece; ao lado, a explicação daquele passo e o que observar. É opcional: a leitura livre continua sendo o padrão. Os passos vêm prontos do plano pedagógico, então avançar é instantâneo.

**Braquetes.** Na lateral da página, uma chave liga dois ou mais trechos que se relacionam — retomada, contraste, definição e uso, premissa e conclusão, eco, desenvolvimento — com uma nota curta. Trechos distantes ganham um marcador que leva ao outro lado da ligação. A camada de relações tem três estados (ocultas, relevantes, todas) ou aparece pelo contexto; não fica toda acesa. Quando o leitor gosta de uma relação, ele a **adota**, e ela vira uma conexão dele, que persiste mesmo que a IA revise a análise.

**Professor em voz alta.** Primeiro, a narração do texto com o trecho acompanhando (sincronia por frase basta no começo). Depois, a narração intercalada com comentários: o professor para, explica, liga a outra parte, segue. A geração de voz roda fora do serviço (Colab, pelo que já existe no auto-colab) e volta como arquivo com marcas de tempo por trecho.

**Artefatos de leitura.** Uma imagem de um poema, o resumo visual de um capítulo em Mermaid, um mapa conceitual, uma linha do tempo. Cada artefato guarda os trechos que o originaram, o autor (leitor ou IA), o estado (rascunho, salvo, favorito) e o escopo (trecho, página, capítulo, documento). Fica associado ao texto se o leitor gostar; nunca o substitui.

**Exercícios.** O leitor seleciona um exercício, abre um canvas próprio e pede a resolução. O modelo recebe o texto **e o recorte visual** do exercício na página (fórmulas, tabelas e diagramas sobrevivem melhor como imagem). A resolução, em passos e com notação matemática, fica salva como nota de trabalho ancorada ali.

**Perfil do leitor.** Um texto visível e editável: nível por área (economia, matemática, filosofia…) e preferências (explicações conceituais, conexões históricas, não explicar o básico, preservar a terminologia do autor). Entra no plano pedagógico e nas respostas, não na compreensão do texto. Mudá-lo refaz o plano, nunca a análise.

## 5. Dispositivos

O modelo do capítulo e o plano pedagógico são os mesmos em qualquer lugar; cada dispositivo só decide a **apresentação** do plano, de preferência sem nova chamada ao modelo.

```
TEXTO → ModeloDoCapitulo (o que o texto faz)
      → PlanoPedagogico (como acompanhar o leitor aqui)
      → apresentação: desktop | e-ink | áudio
```

- **Desktop:** um passo mantém três parágrafos na página e abre o comentário na margem.
- **E-ink (Xteink X4 Pro):** o mesmo passo vira uma tela de texto, numa representação refluível derivada do PDF, seguida de uma tela de explicação.
- **Áudio:** o mesmo passo vira narração e uma interrupção do professor.

## 6. Preparação e tempo

Não se prepara o livro inteiro de antemão. Prepara-se o capítulo aberto e, em segundo plano, o seguinte (mais tarde, com prioridades: o aberto, o artefato pedido, o próximo provável, o reprocessamento):

```
capítulo 3  ████████████████ pronto
capítulo 4  ██████████░░░░░░ preparando
capítulo 5  ██░░░░░░░░░░░░░░ na fila
```

Assim a experiência parece instantânea sem gastar horas do Codex com oitocentas páginas que talvez nunca sejam lidas.

## 7. Ordem proposta

1. **Qualidade e auditoria da análise.** Ver, por capítulo, o caminho texto → interpretação local → síntese → decisão de destacar. Um conjunto de capítulos de referência anotados pelo leitor (o que é essencial, o que não deveria ser marcado) para medir cobertura, e não só precisão, e comparar versões às cegas.
2. **Modelo semântico do capítulo** (local → síntese → revisão → local), o **plano pedagógico** e a **leitura guiada** no desktop como primeira apresentação. Preparação por capítulo com o seguinte em segundo plano.
3. **Braquetes** a partir das relações semânticas, com adoção como conexão; mapa do capítulo; notas tipadas.
4. **Exercícios** no canvas, com recorte visual; **perfil do leitor** explícito.
5. **Áudio**: narração sincronizada por trecho, depois comentada.
6. **Artefatos visuais**: Mermaid e esquemas, depois imagens generativas.
7. **Livro inteiro**: o mesmo padrão um nível acima (mapa do livro, conexões entre capítulos), e conexões com outros livros e com o Obsidian.

## 8. Em aberto

- Imagens generativas e voz exigem um motor fora do `codex exec`. A regra "IA só pelo Codex da conta ChatGPT" precisa de uma exceção explícita para o Colab, com o que pode e o que não pode sair da máquina local.
- Mermaid e qualquer SVG gerado a partir de texto do modelo precisam de renderização estrita: nada do modelo vai para `innerHTML` (AGENTS, regra 7).
- A representação refluível para o e-ink: de onde vem (o canônico, provavelmente) e como mantém o vínculo com as âncoras e com a página de referência. Nada a fazer agora; só não fechar essa porta.
- Quanto do perfil do leitor pode ser inferido, e com que confirmação.
