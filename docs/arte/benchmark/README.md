# Benchmark de arte

Duas obras, uma tentativa de modelo e uma de projeção por obra: quatro chamadas reais via executor existente, modelo reportado `gpt-6-astra`, sem treinamento. Pesquisa e identidade fornecidas em dossiê curado. Os modelos automáticos estão aqui; os exemplos da interface são os de `fixtures/arte`, revisados separadamente.

| Critério | Gate automático | Revisão desta sessão |
|---|---|---|
| Identidade, autor/data/técnica | Identidade preservada pelo serviço; referências válidas | Conferida com dossiê, não descoberta autônoma |
| Fontes | IDs só do catálogo curado | Qualidade depende da pesquisa anterior; texto da evidência precisa de revisão |
| Fato versus interpretação | Tipo explícito e fonte obrigatória para documentação | Distinção preservada nos dois ensaios |
| Intenção | Desconhecimento não pode ter confiança alta | Não atribuem uma intenção não documentada |
| Observação e âncora | Região existente, hash correto, limites geométricos | Regiões plausíveis; algumas largas, sem IoU rotulado por especialista |
| Tese única | Tese e apoios obrigatórios | Uma relação visual por roteiro |
| Gancho | Não automatizado | Observacional, sem promessa enganosa; pouco marcante |
| Frase e imagem | Região referida em cena e nas afirmações | Compatíveis na inspeção; centro em cena não prova objeto inteiro |
| Densidade | Tempo mínimo a 2,5 palavras/s | Ressalvas e repetição ainda pesam |
| Fechamento | Não automatizado | Retorna ao todo, mas acrescenta pouco à tese |
| Duração | 20–60 s; continuidade | Educação: 41,75 s após cálculo; Tolo: 47,3 s |
| Transferência | Não medida | Duas obras não demonstram generalização |

`*.curta-bruta.json` conserva o texto/tempos do executor. `*.curta.json` usa tempos calculados no core; nenhum texto foi reescrito nesse ajuste. A primeira saída de Educação tinha `fala_apressada`; Tolo não tinha falha temporal. `resultados.json` registra modelos, tempos de execução, hashes e juízos.

A avaliação editorial foi feita pelo próprio Codex autor do experimento, não por painel humano independente. Os testes offline revalidam os artefatos, introduzem casos inválidos e exercitam as duas etapas com executor falso. Não confundem acerto estrutural com verdade ou qualidade literária. Repetir o gerador produz nova amostra, não resultado determinístico idêntico.
