# Sistema de leitura e marcação para o Codex

Versão 1.0 · 20 de setembro de 2026

## 1. Finalidade

Ler integralmente um texto fornecido e produzir uma versão anotada que permita reconstruir seu argumento, localizar conceitos e condições, examinar justificativas e formular perguntas de estudo.

A entrega principal é um PDF com destaques seletivos, sublinhados e comentários em português numa margem lateral ampliada. Este documento define o método e pode ser anexado diretamente a uma conversa com o Codex. Não depende de acesso a conversas anteriores.

**Princípio central:** as cores mostram a estrutura do texto; os símbolos registram intervenções de leitura; as notas explicitam compreensão, dúvidas e relações.

As marcações devem orientar a leitura e a revisão. Não devem insinuar que o usuário já compreendeu o conteúdo ou que a leitura foi substituída pelo processamento do assistente.

## 2. Entrada e entrega padrão

### Entradas aceitas

- PDF com texto selecionável.
- PDF digitalizado, desde que seja possível ler as páginas e conferir o OCR.
- Texto colado, Markdown, TXT ou documento convertido com fidelidade.

### Entrega

Produzir `<nome-do-texto>_anotado.pdf`, como arquivo separado do original. Preservar o original sem alterações. Se o usuário pedir expressamente a atualização de uma versão anotada existente, atualizar essa versão.

Para um PDF de entrada, preservar texto, figuras, fórmulas, notas de rodapé, ordem e numeração impressa das páginas. Acrescentar espaço lateral para comentários. Para texto sem paginação, criar uma diagramação legível, preservando a ordem, os títulos e a redação recebida.

Incluir uma legenda compacta na primeira margem disponível. Não criar capa, resumo extenso, tradução integral, apresentação, quiz ou conjunto de notas permanentes sem solicitação.

**Padrões de trabalho:** comentários em português; texto-fonte em seu idioma original; seleção moderada; nenhuma cota obrigatória de grifos; nenhuma pesquisa externa necessária para a simples aplicação do método.

## 3. Legenda fixa das cores

| Cor | Função intelectual | Pergunta de seleção | Exemplos |
| --- | --- | --- | --- |
| Amarelo | Tese, conclusão ou resultado central | O que o autor está afirmando ou demonstrando? | Proposição principal, conclusão de uma seção, resultado de um argumento. |
| Verde | Conceito, definição, distinção, hipótese ou condição de validade | O que preciso entender ou assumir para acompanhar essa afirmação? | Definição técnica, domínio de aplicação, pressuposto, condição de identificação. |
| Azul | Justificativa, mecanismo, evidência ou exemplo decisivo | Por que aceitar a afirmação ou como ela funciona? | Passo explicativo, evidência relevante, contraexemplo, aplicação esclarecedora. |

A cor identifica a função, não a verdade, a qualidade ou o grau de concordância com a passagem. Uma tese destacada pode ser contestável. Um exemplo em azul não deve ser apresentado como evidência empírica se for apenas uma ilustração.

### Como resolver sobreposições

1. Definição estabelece significado: verde.
2. Mecanismo explica uma relação: azul.
3. Conclusão do mecanismo: amarelo.
4. Hipótese que limita uma conclusão: verde; sublinhar a restrição quando necessário.
5. Exemplo: azul somente quando acrescenta compreensão relevante.
6. Se uma frase tiver funções distintas, selecionar segmentos separados, desde que permaneçam inteligíveis.
7. Se a separação ficar artificial, escolher a função predominante. Não sobrepor duas cores.

Não acrescentar rosa ou roxo ao sistema básico. Dúvidas, objeções e conexões são registradas por símbolos e comentários.

## 4. Sublinhado e delimitação de argumentos

### Sublinhado

Destacar uma palavra, expressão ou restrição decisiva, como:

- “somente”, “não”, “em média”, “pode”, “sob essas hipóteses”;
- “necessário”, “suficiente”, “independente de”;
- quantificadores, exceções, domínio e condições de aplicação.

O sublinhado pode coexistir com uma cor: a cor identifica a função do trecho; o sublinhado chama atenção para uma qualificação interna. Não usá-lo apenas como um segundo nível genérico de importância.

### Colchete na margem

Usar opcionalmente para delimitar um argumento de várias linhas quando pintar todo o bloco prejudicaria a seleção. Acrescentar uma identificação curta, como “argumento” ou “mecanismo”. Não desenhar sobre o texto, figuras ou notas.

Não é obrigatório usar todos os recursos em cada texto.

## 5. Símbolos e comentários

| Símbolo | Uso | Comentário esperado |
| --- | --- | --- |
| ? | Dúvida, dificuldade, hipótese a examinar | Uma pergunta específica que possa orientar releitura ou investigação. |
| × | Objeção formulada | Identificação da premissa, inferência ou evidência problemática e explicação da objeção. |
| ↔ | Conexão sugerida | Nomear a outra ideia e explicar a relação. |
| → | Consequência ou síntese inferencial | Explicitar o que parece decorrer do argumento e suas condições. |

**Regras:**

- Não escrever apenas “importante”, “interessante” ou “atenção”.
- Preferir uma ideia por comentário, geralmente em uma a três frases.
- Usar `?` quando houver apenas estranhamento ou dúvida. Reservar `×` para uma objeção fundamentada.
- Não inventar problemas para preencher margens.
- Formular conexões concretas. “Lembra filosofia” é insuficiente; dizer qual problema filosófico e por quê.
- Não inventar notas do usuário, identificadores de Zettelkasten, leituras anteriores ou opiniões pessoais.
- Usar `→` para uma intervenção inferencial do assistente, não para confundi-la com uma conclusão explicitamente escrita pelo autor.

### Atribuição de voz

Usar rótulos curtos nos comentários:

- **AUTOR · DEFINIÇÃO / TESE / MECANISMO / CONDIÇÃO:** paráfrase fiel do texto.
- **→ LEITURA:** consequência ou interpretação proposta pelo assistente.
- **? INVESTIGAR / RECUPERAÇÃO:** pergunta sugerida ao leitor.
- **× OBJEÇÃO:** crítica fundamentada do assistente.
- **↔ CONEXÃO SUGERIDA:** relação proposta pelo assistente.

Inserir na legenda: “Os comentários são sugestões de leitura do assistente. As paráfrases do autor estão identificadas. Não representam opiniões atribuídas ao leitor.”

Escrever com palavras próprias não torna uma ideia do autor uma contribuição original do assistente ou do usuário.

## 6. Critérios de seleção

Antes de marcar, perguntar:

1. Este trecho é necessário para reconstruir o argumento, definir um conceito ou entender suas condições?
2. Ele oferece uma justificativa, evidência ou exemplo especialmente esclarecedor?
3. Esta marca será útil para reencontrar, reconstruir ou questionar a ideia?
4. Consigo selecionar menos texto sem perder o sentido?
5. Preservei as negações, hipóteses, exceções e qualificações necessárias?

Se nenhuma função estiver clara, não marcar.

### Densidade

Não estabelecer percentuais rígidos nem metas por página. Uma página introdutória pode ter um único destaque; uma passagem conceitualmente densa pode exigir vários. É aceitável deixar páginas sem marcas.

Se quase todo o parágrafo estiver colorido, reavaliar: selecionar a frase central, delimitar o bloco com colchete ou transferir a explicação para a margem. Preservar um argumento completo tem prioridade sobre tornar o grifo artificialmente curto.

Repetições meramente retóricas normalmente dispensam nova marca. Repetições que acrescentam uma condição, corrigem ou refinam uma ideia merecem atenção.

## 7. Procedimento de leitura

### Etapa A — Conferir a entrada

Identificar título, estrutura, idioma, total de páginas e legibilidade. Verificar páginas repetidas, ausências aparentes, anotações preexistentes, colunas, fórmulas e qualidade da extração.

Não apagar, reorganizar ou deduplicar páginas silenciosamente. Preservar repetições e sinalizá-las discretamente. Evitar duplicar destaques já existentes que correspondam ao método.

### Etapa B — Compreender antes de selecionar

Ler cada seção completa antes de decidir suas marcações. Identificar pergunta, tese, definições, hipóteses, etapas do argumento, evidências e limites. Conferir se a continuação modifica a interpretação inicial.

Em textos longos, trabalhar por seções com um registro de continuidade e revisar as escolhas ao avançar. Não afirmar leitura integral se houve páginas ou trechos inacessíveis.

### Etapa C — Elaborar as marcações

Selecionar passagens por compreensão do conteúdo. A busca por palavras serve para localizar uma seleção já decidida, nunca para substituir a leitura.

Associar cada seleção a uma função intelectual e a uma localização verificável. Produzir comentários somente quando acrescentarem explicação, pergunta, objeção ou conexão útil.

### Etapa D — Preparar a revisão

Ao final de uma seção substantiva ou do documento, incluir poucas perguntas que permitam recuperar o argumento sem consultar o texto. Exemplos:

- Qual afirmação foi defendida e como foi sustentada?
- Sob quais condições ela vale?
- Que diferença existe entre os dois conceitos apresentados?
- Consigo reconstruir o mecanismo ou oferecer um contraexemplo?

Não transformar toda página numa bateria de perguntas. Não incluir respostas longas que apenas repitam o texto.

### Etapa E — Diagramar e verificar

Aplicar cores, sublinhados e comentários. Renderizar o PDF, conferir visualmente e corrigir problemas antes de entregar. Ver os critérios técnicos e de aceitação abaixo.

## 8. Adaptação por tipo de conteúdo

### Matemática

Preservar hipóteses, domínio, quantificadores e distinção entre condição necessária e suficiente. Marcar definições em verde, resultados em amarelo e passos decisivos de demonstração ou contraexemplos em azul. Não pintar automaticamente uma demonstração inteira.

### Economia, estatística e inferência causal

Distinguir associação, mecanismo teórico, identificação e estimação. Dar atenção a condições de validade, população-alvo, variáveis omitidas e limites de interpretação quando o texto os desenvolver. Não converter uma hipótese do autor em fato estabelecido.

### Filosofia e ciências humanas

Distinguir tese defendida, posição de um interlocutor, objeção e resposta. Não atribuir ao autor uma posição que ele apresenta para refutar. Preservar distinções terminológicas e o contexto de citações.

### Texto técnico ou programação

Priorizar contratos, pressupostos, comportamento esperado, limitações e justificativas de decisões. Preservar a sintaxe do código; manter explicações na margem.

## 9. Exemplo de aplicação

Trecho ilustrativo:

> Se uma função é diferenciável em um ponto, então ela é contínua nesse ponto. A recíproca não é verdadeira.

| Elemento | Aplicação |
| --- | --- |
| “Se uma função é diferenciável em um ponto” | Verde: condição. |
| “então ela é contínua nesse ponto” | Amarelo: conclusão. |
| “A recíproca não é verdadeira” | Sublinhado: restrição decisiva. |
| Comentário `→ LEITURA` | Continuidade é necessária, mas não suficiente, para diferenciabilidade. |
| Comentário `? RECUPERAÇÃO` | Consigo demonstrar a implicação e apresentar uma função contínua que não seja diferenciável em um ponto? |

Se o texto trouxer um contraexemplo esclarecedor, marcá-lo em azul. Não acrescentar um contraexemplo ao corpo original como se estivesse na fonte.

## 10. Especificação visual do PDF

- Preservar a área original da página em sua escala, sem cortar ou cobrir conteúdo.
- Acrescentar uma margem direita para comentários, separada por linha fina cinza.
- Usar texto escuro, fundo branco e tipografia simples com suporte a acentos e símbolos.
- Comentários em tamanho legível, preferencialmente 9–10 pontos. Não reduzir excessivamente a fonte para forçar encaixe.
- Usar títulos discretos e espaçamento consistente entre comentários.
- Quando necessário, numerar a nota e colocar um pequeno marcador na margem correspondente ao trecho, sem invadir o texto.
- Se os comentários não couberem, condensar ou transferir o excedente para notas finais claramente referenciadas. Não ampliar indefinidamente a largura da página.
- Preservar a numeração impressa. Se necessário, distinguir “página do arquivo” e “página impressa”.
- Preferir destaques e sublinhados como anotações nativas de PDF, selecionáveis e removíveis. Os comentários laterais podem ser conteúdo estático; não prometer editabilidade completa nesse caso.
- Não depender de comentários escondidos em pop-ups: as principais notas devem ficar visíveis na página.

### Paleta de referência

| Uso | Cor-base | Opacidade inicial |
| --- | --- | --- |
| Amarelo | `#FFD926` | 30% |
| Verde | `#59D675` | 30% |
| Azul | `#52ABFF` | 30% |
| Sublinhado | `#33404D` | 80% |

Ajustar a aparência após renderização, mantendo as três categorias distinguíveis e o texto legível. A cor-base não equivale à cor final sobre fundo branco com transparência.

## 11. Orientação técnica para execução pelo Codex

Usar as habilidades de PDF e de arquivos disponíveis no ambiente. PyMuPDF pode servir para extração, localização e anotações; ReportLab pode servir para diagramar entradas sem paginação. Estas são opções, não dependências obrigatórias.

### Localização confiável

- Associar a seleção à página e aos quadriláteros de cada linha, evitando um grande retângulo sobre o parágrafo.
- Tratar ligaturas, hifenização e quebras de linha na busca sem modificar o conteúdo original.
- Se a mesma frase aparecer mais de uma vez, identificar a ocorrência pretendida por seu contexto.
- Conferir visualmente resultados de OCR, fórmulas, tabelas e páginas com colunas.
- Nunca pintar uma região aproximada apenas para compensar uma falha de localização.
- Se algum trecho não puder ser localizado com segurança, informar a limitação e não fingir que foi anotado.

### Verificação mínima

1. Reabrir o PDF gerado e confirmar que todas as páginas esperadas estão presentes.
2. Comparar o conteúdo original com a área preservada, quando a extração permitir.
3. Conferir as coordenadas e a contagem das anotações efetivamente aplicadas.
4. Verificar se toda nota cabe em sua área e se não há texto cortado, caracteres ausentes ou sobreposição.
5. Renderizar as páginas alteradas e inspecionar visualmente; dar atenção especial às mais densas, às figuras e às fórmulas.
6. Corrigir qualquer falha antes de disponibilizar o arquivo.

Não alegar validação que não foi realizada.

## 12. Fidelidade, limites e fontes externas

Trabalhar a partir do documento fornecido. Não inventar citações, números, autores, páginas ou evidências. Não corrigir silenciosamente o texto-fonte.

Se houver uma possível inconsistência, registrá-la como pergunta ou objeção com grau de certeza adequado. Distinguir o que está explícito do que é interpretação.

Quando uma crítica depender de uma informação externa incerta ou atual, verificá-la em fonte adequada e identificá-la no comentário; se isso não for possível, formular uma questão aberta. Não transformar a anotação numa pesquisa paralela sem necessidade.

Se houver páginas ilegíveis ou ausentes, indicar exatamente a parte não coberta. Nunca declarar o documento integralmente anotado quando a cobertura for parcial.

## 13. Relação com o Zettelkasten

O destaque localiza uma passagem. Uma nota de literatura registra a compreensão de uma fonte. Uma nota permanente formula uma ideia reutilizável, com contexto suficiente, condições e relações explícitas.

Não transformar automaticamente cada destaque em nota permanente. Não criar arquivos adicionais por padrão.

Se o usuário solicitar candidatos a notas, fornecer para cada um: título que expresse uma ideia, formulação em palavras próprias, fonte e localização, condições relevantes e conexão sugerida. Separar claramente paráfrase, inferência e crítica. Não inventar conexões com um acervo que não foi fornecido.

## 14. Critérios de aceitação

A entrega está pronta quando:

- [ ] A leitura cobre todo o material legível, com eventuais limites declarados.
- [ ] As três cores conservam o mesmo significado do início ao fim.
- [ ] Os trechos selecionados preservam condições e ressalvas essenciais.
- [ ] Os comentários acrescentam valor e distinguem a voz do autor da intervenção do assistente.
- [ ] Não há preenchimento artificial de páginas ou uso obrigatório de todos os símbolos.
- [ ] Texto, figuras, fórmulas e paginação originais foram preservados.
- [ ] Páginas repetidas ou problemas da entrada foram tratados explicitamente.
- [ ] O PDF foi reaberto, renderizado e conferido.
- [ ] O arquivo final foi salvo e disponibilizado ao usuário.

## 15. Prompt reutilizável

Anexe este Markdown e o texto que deseja estudar. Depois envie:

```text
Leia integralmente o documento anexado e aplique o método definido em
SISTEMA-DE-LEITURA-E-MARCACAO-CODEX.md.

Produza um PDF anotado, como arquivo separado do original, com:
- amarelo para teses e resultados;
- verde para conceitos, definições, hipóteses e condições;
- azul para justificativas, mecanismos, evidências e exemplos decisivos;
- sublinhado para restrições e palavras decisivas;
- comentários breves em português numa margem lateral ampliada;
- símbolos ?, ×, ↔ e → somente quando tiverem função concreta;
- legenda e poucas perguntas de recuperação ao final de seções relevantes.

Leia cada seção antes de selecionar os trechos. Seja seletivo, preserve
qualificações e diferencie o que o autor diz das suas intervenções de leitura.
Não atribua a mim opiniões, dúvidas ou conhecimentos que eu não expressei.

Preserve o conteúdo, as figuras, as fórmulas e a ordem das páginas.
Não remova páginas repetidas sem pedido. Não crie notas permanentes nem
outros materiais adicionais por padrão.

Execute a produção do arquivo, confira a fidelidade e a legibilidade por
renderização e entregue o PDF pronto. Se houver uma limitação real,
informe exatamente a parte afetada. Não pare apenas no planejamento.
```

### Ajustes opcionais que o leitor pode acrescentar

```text
Objetivo da leitura: [prova / compreensão conceitual / aplicação / discussão].
Conhecimento prévio: [iniciante / intermediário / avançado].
Ênfase: [argumentos / hipóteses / demonstrações / aplicações].
Trecho solicitado: [documento inteiro ou páginas/seções específicas].
```

Esses ajustes são opcionais. Na ausência deles, executar com os padrões deste documento sem exigir um formulário de configuração.
