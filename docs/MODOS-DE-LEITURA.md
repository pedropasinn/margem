# Modos de leitura por tipo de texto

## Como se usa (v0.1)

Na página do documento, **Analisar** (o botão principal; antes "Preparar leitura") abre uma janela com o que o Margem pode criar de uma vez: **Grifos e relações** (a compreensão: grifos, relações, dificuldades, síntese e roteiro de leitura), **Flashcards**, **Mapa do capítulo**, **Fluxograma**, **Texto das páginas escaneadas** (PDF sem texto) e **Resolver os exercícios**. Narração em lote, marcadores do PDF e imagens para grifos aparecem como "em breve" (ainda sem job próprio). Num livro, a compreensão começa pelo primeiro capítulo (com o seguinte em segundo plano) e os outros vêm quando você os abre, ou todos de uma vez com **Todos os capítulos agora**; flashcards, mapa e fluxograma de cada capítulo são pedidos quando ele fica pronto. Clicar de novo não cobra outra leitura; depois de uma falha, o botão vira **Tentar de novo** e devolve à fila só o que falhou. A página mostra o andamento de cada item.

Em **Configurações → Ao importar**, a pessoa define o padrão: o que vem marcado na janela e o que o Margem cria sozinho quando um arquivo entra (grifos e relações, por padrão; vídeo e áudio seguem o próprio caminho, e um PDF escaneado espera a transcrição).

Ninguém escolhe família nem modo. Depois da importação, o Codex reconhece o **tipo de texto** (job `identificar_tipo`, prompt `identificar-tipo@1`, esforço `low`) a partir do título, do sumário, de sinais contados (versos, equações, diálogos, cabeçalhos de e-mail) e de amostras curtas. O tipo aparece só como informação discreta ("Lido como conto"); quem quiser corrigir usa **mudar**, dentro da janela. A escolha da pessoa grava `origem: escolhido` e nenhuma detecção a substitui. Se a leitura for pedida antes de o tipo ser reconhecido, ela espera e começa sozinha. As Notícias entram como notícia.

O tipo detectado é o **tipo padrão do documento**. O modo usado fica gravado em cada execução e em cada revisão do modelo do capítulo (`execucao_leitura.modo_id/modo_revisao`, `ModeloDoCapituloV1.modo`), para que no futuro cada seção possa ser lida no modo que lhe convier; hoje a preparação usa o modo do tipo padrão para todos os capítulos.

As leituras antigas continuam no serviço para ferramentas e testes, fora da interface: a F1 (`POST /api/documentos/:id/leituras` sem modo, só grifos argumentativos e `revisar_consistencia`) e a V2 (`leitor-de-parte@4`, grifos num modo). Nenhuma delas gera relações.

O tipo decide o **modo** da leitura (detalhe interno: vários tipos podem usar o mesmo modo). Trocar o tipo depois pede uma leitura nova, no modo do tipo novo.

As leituras antigas continuam no serviço para ferramentas e testes, fora da interface: a F1 (`POST /api/documentos/:id/leituras` sem modo, só grifos argumentativos e `revisar_consistencia`) e a V2 (`leitor-de-parte@4`, grifos num modo). Nenhuma delas gera relações.

## Tipos de texto

A taxonomia está em `contratos/tipos-de-texto.json` (validada contra o catálogo de modos por `contratos/src/tipos-de-texto.ts`) e é servida em `GET /api/tipos-de-texto`; a interface só lê. São 13 grupos e 33 tipos. O tipo padrão, para quando nada foi reconhecido, é **Outro ou não sei** (`geral@1`).

| Grupo | Tipo | Exemplos | Modo |
|---|---|---|---|
| Literatura | Conto | Machado de Assis, Tchékhov, Borges | `ficcao_narrativa@1` |
|  | Romance ou novela | capítulo de romance, novela, narrativa longa | `ficcao_narrativa@1` |
|  | Poesia | poema, soneto, livro de poemas | `literaria@2` |
|  | Teatro | peça, cena, diálogo dramático | `dramaturgia@1` |
|  | Crônica | Rubem Braga, Fernando Sabino, crônica de jornal | `ensaio_cronica@1` |
|  | Crítica literária ou resenha | resenha de livro, ensaio crítico sobre uma obra | `critica_literaria@1` |
| Filosofia | Tratado ou argumento filosófico | Descartes, Kant, filosofia analítica | `filosofica@2` |
|  | Diálogo filosófico | Platão, Berkeley, diálogos | `filosofica_dialogica@1` |
|  | Clássico com comentário | Aristóteles comentado, tradução com notas | `filosofica_comentada@2` |
| Religião e espiritualidade | Escritura e exegese | Bíblia, comentário bíblico, lectio divina | `escritura@1` |
|  | Documento da Igreja | encíclica, catecismo, concílio, exortação | `magisterio@1` |
|  | Teologia, patrística e escolástica | Santo Agostinho, Santo Tomás, manual de teologia | `teologica@1` |
|  | Leitura espiritual e vida de santo | Imitação de Cristo, São Josemaria, biografia de santo | `espiritual@1` |
| Economia | Artigo ou livro empírico | paper com dados, avaliação de política, econometria aplicada | `economica@2` |
|  | Teoria e modelo formal | modelo de equilíbrio, microeconomia teórica | `economia_formal@1` |
|  | Relatório de política econômica | relatório do FMI, nota técnica, relatório de inflação | `relatorio_institucional@1` |
|  | Comunicado de banco central | comunicado ou ata do Copom, discurso de banqueiro central | `comunicacao_monetaria@1` |
| Matemática e estatística | Matemática | livro-texto, demonstração, notas de aula de cálculo ou álgebra | `matematica@2` |
|  | Estatística e probabilidade | inferência, probabilidade, regressão, métodos | `estatistica@1` |
| Computação | Livro técnico de computação | engenharia de software, banco de dados, sistemas, programação | `computacao@1` |
|  | Artigo de computação | paper de algoritmo, sistema ou aprendizado de máquina | `artigo_cientifico@1` |
| Ciência | Artigo científico | psicologia, medicina, biologia, física, ciências sociais | `artigo_cientifico@1` |
| História | História e narrativa histórica | livro de história, biografia histórica | `historia@1` |
|  | Fonte histórica | documento de época, carta antiga, crônica medieval | `historia@1` |
| Notícias e opinião | Notícia ou reportagem | jornal, agência, reportagem | `jornalistica_factual@1` |
|  | Análise jornalística | análise, explicador, coluna de análise | `jornalistica_analitica@1` |
|  | Ensaio ou opinião | Chesterton, Lewis, artigo de opinião, newsletter, Substack | `opinativa@1` |
| Correspondência | E-mail | e-mail de trabalho, troca de mensagens | `correspondencia@1` |
|  | Carta | carta pessoal, epistolário | `correspondencia@1` |
| Estudo | Livro didático ou manual | apostila, manual, livro-texto de qualquer área | `didatico@1` |
| Direito | Lei ou norma | lei, decreto, regulamento | `normativa_juridica@1` |
|  | Decisão judicial | acórdão, sentença, voto | `decisao_judicial@1` |
| Outro | Outro ou não sei | texto argumentativo em geral | `geral@1` |

## Modos

Modos novos da v0.1 (J131), cada um com seis funções, protocolo de gênero em `prompts/generos/` e as cores já aprovadas pela régua de contraste:

| Modo | Versão | Funções |
|---|---|---|
| Escritura e exegese | `escritura@1` | narrativa, palavra, imagem, eco, ensino, resposta |
| Documento da Igreja | `magisterio@1` | ensinamento, fundamento, distincao, juizo, orientacao, autoridade |
| Teologia, patrística e escolástica | `teologica@1` | questao, tese, autoridade, razao, objecao, resposta |
| Leitura espiritual | `espiritual@1` | verdade, conselho, imagem, exemplo, obstaculo, oracao |
| Estatística e probabilidade | `estatistica@1` | definicao, suposicao, resultado, metodo, interpretacao, exemplo |
| Computação | `computacao@1` | conceito, problema, solucao, compromisso, pratica, exemplo |
| Artigo científico | `artigo_cientifico@1` | pergunta, hipotese, metodo, resultado, interpretacao, limitacao |
| História | `historia@1` | acontecimento, agente, fonte, causa, interpretacao, consequencia |
| Correspondência | `correspondencia@1` | pedido, compromisso, prazo, decisao, informacao, tom |
| Livro didático e manual | `didatico@1` | objetivo, definicao, explicacao, exemplo, procedimento, cuidado |
| Geral | `geral@1` | tese, conceito, justificativa, exemplo, objecao, consequencia |

Modos da expansão J97 (L02–L05):

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

Cada modo tem seis funções e seis cores distintas. Perfis como verso livre/fixo, texto filosófico analítico/dialógico, estudo econômico causal/descritivo/preditivo, historiografia/fonte primária e e-mail/carta são instruções condicionais ao conteúdo dentro do protocolo.

Todos os modos estão **em avaliação** (`estado` no contrato). Os testes verificam contratos e execução, não ganho de qualidade editorial.

## Execução e compatibilidade

- `leitor-de-parte@3` e `analisar-passagens@2`, `sintetizar-capitulo@2`, `revisar-capitulo@2`, `planejar-leitura@3` incorporam os protocolos de `prompts/generos/` (`comum@1` e `verso@1` valem para todos). Todo modo da taxonomia tem protocolo (teste em `servico/src/leitura/generos.test.ts`).
- O conteúdo incorporado entra no hash da entrada. Os prompts históricos ficam intactos; a retomada usa a versão gravada na execução.
- Voz, condições, negação, quantificadores e limites de acesso são orientações comuns. Versos e quebras literais ficam protegidos também fora do modo de poesia. Transcrições não autorizam inventar imagens, entonação ou tempos.
- Citações continuam literais; o serviço resolve offsets UTF-16. Ambiguidade vira diagnóstico.
- Ficção e dramaturgia consideram o capítulo inteiro. A página avisa que a leitura pode antecipar acontecimentos; ainda não há horizonte antisspoiler.

## Origem e escolhas

As fontes são as propostas L02…L05 e as revisões `REVISAO-L02…L05.md`, material de trabalho que não acompanha o código. As taxonomias originais excediam o limite de funções e não foram copiadas integralmente. A integração segue cinco modos literários, dois de economia, quatro de filosofia/matemática e sete da primeira onda de não acadêmicos.

Foram adiados conforme as revisões: modalidades visuais/sonoras, mapas tipados, relações adicionais e demais ciências específicas. O classificador automático e os modos de religião, estatística, computação, artigo científico, história, correspondência e didático entraram na v0.1 (J131, abaixo). Os modos de engenharia (`engenharia_software@1`, `engenharia_dados@1`) ficam no catálogo para leituras antigas; leituras novas de computação usam `computacao@1`.

Hashes SHA-256 das revisões consultadas:

- `REVISAO-L02.md`: `d658dfeaf60ff9b9a05692d4063c60dc654a1f83cc3dcc750b40ae4b35afe85f`
- `REVISAO-L03.md`: `6c98bf04a58d0bca8ae11842104d35ea64cd3d62f6a8c0fd9e6744bbbde0c33b`
- `REVISAO-L04.md`: `221e9cefa4593950de4f2794ff7b5ff8d5656d35f3d8c825a265d46e6b9c66dd`
- `REVISAO-L05.md`: `dcc29f228f98151b55c2bb9bcb2c873c8c0e8295d11dea7dc38008a1bc70da9d`

## Avaliação ainda necessária

A próxima bancada deve comparar os modos especializados aos atuais, com pelo menos dois documentos reais por modo, trechos distratores, uma referência revisada por leitores e avaliação cega. Medir fidelidade da voz, preservação das condições, recorte, saliência, acerto de função e notas úteis, além do custo e duração. Incluir verso repetido, interlocutor adversário, hipótese econômica, voto vencido, exceção legal em outro parágrafo e prova apenas citada. Guardar os resultados antes de retirar o aviso de avaliação.

A detecção do tipo também pede bancada real: doze documentos, um por grupo de leitura previsto, com a meta de acertar pelo menos dez; o resultado deve ser anotado aqui. Ela não foi feita no J131 (sem chamadas reais ao Codex nos testes).

Os testes determinísticos do J97 cobrem os 29 protocolos (os 18 do J97 e os 11 da v0.1) nas cinco etapas, funções recusadas, citação repetida/desambiguação, projeção e um fluxo de economia empírica até o plano publicado. Não substituem essa bancada e não disparam IA real.
