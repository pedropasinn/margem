# Modos de leitura por tipo de texto

A expansão J97 integra a consolidação das entregas L02–L05 e suas revisões. São 18 modos novos ou revisados, 21 opções atuais e 26 versões no catálogo. Argumentativa e os dois modos de engenharia continuam disponíveis. As versões antigas permanecem para reproduzir e retomar leituras existentes.

No documento, abra **Preparar leitura**, escolha **Família do texto**, depois **Modo de leitura**. A descrição explica o foco. A compreensão por capítulo e a preparação de marcas recebem a mesma escolha. Não há detecção automática do gênero.

Os novos modos estão **em avaliação**. Os testes verificam contratos e execução, não ganho de qualidade editorial. As revisões pedem uma bancada comparativa com documentos reais; essa etapa permanece pendente e impede chamar os modos de validados empiricamente. A disponibilização experimental é uma divergência explícita da recomendação de só instalar após essa bancada.

| Modo | Versão atual | Funções |
|---|---|---|
| Comunicação de política monetária | `comunicacao_monetaria@1` | decisao, diagnostico, projecao, risco, orientacao, deliberacao |
| Crítica e resenha literária | `critica_literaria@1` | tese_critica, evidencia_textual, procedimento, conceito_criterio, interlocucao, juizo |
| Decisão judicial e acórdão | `decisao_judicial@1` | questao, fato_processual, fundamento, dispositivo, precedente, divergencia |
| Dramaturgia | `dramaturgia@1` | acao_verbal, rubrica, distribuicao_saber, virada_cenica, voz, motivo_cenico |
| Economia formal | `economia_formal@1` | ambiente, hipotese, equilibrio, proposicao, derivacao, interpretacao |
| Economia empírica | `economica@2` | conceito, hipotese, identificacao, resultado, mecanismo, limitacao |
| Ensaio e crônica | `ensaio_cronica@1` | cena, problema, ideia_provisoria, deslocamento, contraponto, linguagem |
| Ficção narrativa | `ficcao_narrativa@1` | evento, voz, focalizacao, tempo, personagem, composicao |
| Filosofia argumentativa | `filosofica@2` | tese, conceito, distincao, premissa, objecao, caso |
| Filosofia comentada | `filosofica_comentada@2` | tese, conceito, distincao, interpretacao, objecao, argumento |
| Diálogo filosófico | `filosofica_dialogica@1` | problema, posicao, definicao_proposta, assentimento, refutacao, aporia |
| Análise jornalística | `jornalistica_analitica@1` | questao, interpretacao, base_factual, mecanismo, cenario, limite |
| Jornalismo factual | `jornalistica_factual@1` | acontecimento, atribuicao, apuracao, contexto, incerteza, cena |
| Poesia | `literaria@2` | imagem, som_e_ritmo, voz, virada, forma, intertexto |
| Matemática e demonstrações | `matematica@2` | definicao, hipotese, enunciado, passo, exemplo, tecnica |
| Lei e texto normativo jurídico | `normativa_juridica@1` | comando, incidencia, definicao, excecao, efeito, vigencia |
| Opinião e ensaio de ideias | `opinativa@1` | tese, razao, criterio, objecao, resposta, proposta |
| Relatório institucional e nota de política | `relatorio_institucional@1` | problema, achado, base, recomendacao, implementacao, limite |

Cada modo tem seis funções e seis cores distintas. Perfis como verso livre/fixo, texto filosófico analítico/dialógico e estudo econômico causal/descritivo/preditivo são instruções condicionais ao conteúdo. Não existe um perfil automaticamente classificado e persistido.

## Execução e compatibilidade

- `leitor-de-parte@3` e `analisar-passagens@2`, `sintetizar-capitulo@2`, `revisar-capitulo@2`, `planejar-leitura@2` incorporam os protocolos de `prompts/generos/`.
- O conteúdo incorporado entra no hash da entrada. Os prompts históricos ficam intactos; a retomada usa a versão gravada na execução.
- Voz, condições, negação, quantificadores e limites de acesso são orientações comuns. Versos e quebras literais ficam protegidos também fora do modo de poesia. Transcrições não autorizam inventar imagens, entonação ou tempos.
- Citações continuam literais; o serviço resolve offsets UTF-16. Ambiguidade vira diagnóstico. Nenhum schema persistido ou migração foi alterado.
- Ficção e dramaturgia consideram o capítulo inteiro. A tela explica a possibilidade de antecipar acontecimentos; ainda não há horizonte antisspoiler.

## Origem e escolhas

As fontes locais são `_entrada/Balcao/L02…L05` e `REVISAO-L02…L05.md`, no checkout principal. As taxonomias originais excediam o limite de funções e não foram copiadas integralmente. A integração segue cinco modos literários, dois de economia, quatro de filosofia/matemática e sete da primeira onda de não acadêmicos.

Foram adiados conforme as revisões: modalidades visuais/sonoras, mapas tipados, relações adicionais, classificador automático, demais ciências específicas e segunda onda de modos técnicos/jurídicos/didáticos. Os modos existentes de engenharia não foram substituídos.

Hashes SHA-256 das revisões consultadas:

- `REVISAO-L02.md`: `d658dfeaf60ff9b9a05692d4063c60dc654a1f83cc3dcc750b40ae4b35afe85f`
- `REVISAO-L03.md`: `6c98bf04a58d0bca8ae11842104d35ea64cd3d62f6a8c0fd9e6744bbbde0c33b`
- `REVISAO-L04.md`: `221e9cefa4593950de4f2794ff7b5ff8d5656d35f3d8c825a265d46e6b9c66dd`
- `REVISAO-L05.md`: `dcc29f228f98151b55c2bb9bcb2c873c8c0e8295d11dea7dc38008a1bc70da9d`

## Avaliação ainda necessária

A próxima bancada deve comparar os modos especializados aos atuais, com pelo menos dois documentos reais por modo, trechos distratores, uma referência revisada por leitores e avaliação cega. Medir fidelidade da voz, preservação das condições, recorte, saliência, acerto de função e notas úteis, além do custo e duração. Incluir verso repetido, interlocutor adversário, hipótese econômica, voto vencido, exceção legal em outro parágrafo e prova apenas citada. Guardar os resultados antes de retirar o aviso de avaliação.

Os testes determinísticos do J97 cobrem os 18 protocolos nas cinco etapas, funções recusadas, citação repetida/desambiguação, projeção e um fluxo de economia empírica até o plano publicado. Não substituem essa bancada e não disparam IA real.
