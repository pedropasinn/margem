# Contratos da Margem (V1 e F2)

Os nove contratos novos de F1 usam JSON Schema 2020-12, com `$id` em `https://margem.local/contratos/<Nome>V1.schema.json`. O décimo preserva o legado. F2 (J12) acrescenta oito contratos, nas seções 11 a 17, e uma extensão compatível do `CanonicoV1` (a `estrofe`, registrada como **V1.1**). Os V1 não mudam de significado: onde F2 muda um significado, nasce um V2 ao lado, e o V1 continua válido, exportado com o mesmo nome e testado. Os arquivos em `contratos/schemas/` são a fonte da verdade estrutural; tipos manuais e validação semântica estão em `contratos/src/`. Importe as funções de `contratos/src/index.ts` no serviço Node. Este ponto de entrada usa `node:crypto` e lê os schemas locais, sem rede.

`validarCanonico`, `validarAncora`, `validarParte`, `validarMarcaGerada`, `validarMarca`, `validarLoteRevisao`, `validarJobResult`, `validarProgresso`, `validarExecucaoLeitura` e `validarMarcasLegado` recebem `unknown`, retornam predicados de tipo e expõem `.errors` (Ajv ou falha de invariante). Não removem campos, não convertem tipos e não alteram a entrada. `validadoresSchema` expõe os validadores Ajv compilados (dez de F1 e oito de F2, com chave igual ao nome do schema), **sem as invariantes adicionais**. Os de F2 são `validarModoDeLeitura`, `validarMarcaGeradaV2`, `validarMarcaV2`, `validarExecucaoLeituraV2`, `validarAnotacao`, `validarConversa`, `validarRespostaGerada` e `validarConexao`, com o mesmo comportamento.

Convenções congeladas:

- IDs novos são ULIDs maiúsculos de 26 caracteres Crockford; o primeiro fica entre `0` e `7`. São atribuídos pelo serviço. O modelo apenas ecoa `bloco_id` recebido.
- SHA-256 usa bytes UTF-8 e 64 dígitos hexadecimais minúsculos. Não há normalização Unicode. Surrogates isolados são recusados nos contratos novos.
- Intervalos são semiabertos, `[inicio, fim)`, em unidades UTF-16. Não podem cortar um par substituto. Não se proíbe cortar um grafema composto: isso exigiria outro contrato de seleção.
- `ordem` e revisões são inteiros seguros não negativos, sem obrigação de contiguidade; páginas, linhas, tentativas, tokens e concorrência são positivos. Datas são RFC 3339 com fuso.
- Campos desconhecidos são recusados, inclusive em objetos aninhados. A exceção declarada é `canonizacao.config`, cujas chaves são livres e cujos valores são JSON recursivo; seus schemas usam `patternProperties` com `additionalProperties: false`.
- Têm `versao: 1` o `CanonicoV1` e, em F2, os contratos de dado do leitor e de catálogo: `ModoDeLeituraV1`, `AnotacaoV1`, `ConversaV1` e `ConexaoV1`. `ExecucaoLeituraV1.schema_versao` é o inteiro `1`, e `ExecucaoLeituraV2.schema_versao` é `2`: é a versão do contrato de saída do modelo (`MarcaGeradaV1`/`V2`). Versões do método/prompt são strings não vazias. Os outros contratos (inclusive `MarcaV2`, `MarcaGeradaV2`, `ExecucaoLeituraV2` e `RespostaGeradaV1`) são versionados pelo nome/schema, e adicionar `versao` neles é erro.
- Slugs (id de modo, chave de função) são `^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$`, até 40 caracteres: minúsculas ASCII com `_`, como os enums já existentes. Cores são `#RRGGBB` em maiúsculas.
- Limites de texto em F2 são em unidades UTF-16, a mesma unidade dos offsets. O `maxLength` do Ajv conta code points; por isso o limite exato é conferido na invariante. Textos livres do leitor e da IA exigem pelo menos um caractere que não seja espaço.
- Datas são comparadas como instantes (`Date.parse`, precisão de milissegundo), nunca como strings: `12:05-03:00` é depois de `12:00Z`.
- Uma validação isolada não prova a existência de registros externos, a geração dos IDs pelo serviço ou a imutabilidade no banco. A publicação precisa conferir essas relações no snapshot correto.

---

## 1. CanonicoV1

Resultado da canonização: metadados da fonte, configuração, árvore de seções, blocos, assets e limitações. Exemplo mínimo completo: [valido-minimo.json](../contratos/casos/Canonico/valido-minimo.json). Há também exemplos com config, escapes e o conteúdo da fixture Unicode.

`validarCanonico(dado)` verifica o hash por padrão; `{ conferir_hash: false }` adia apenas essa comparação. Sempre verifica IDs únicos entre blocos/seções/assets, ordem crescente, referências, faixas e árvore. A lista de blocos não pode ser vazia; texto vazio é permitido (por exemplo, imagem sem texto). Cada bloco exige pelo menos uma origem.

**V1.1 — `estrofe`.** O enum de `blocos[].tipo` ganhou `estrofe`. Só nela o `texto` representa versos separados por `\n` (LF), um verso por linha. Nenhum verso pode ser vazio ou só de espaços (critério: o `\s` do JavaScript), não há LF no começo nem no fim e CR, U+2028 e U+2029 são recusados; uma estrofe de um verso só é válida. Nos outros tipos o V1 **nunca proibiu** `\n` (o caso `valido-escapes` tem LF e CR num parágrafo), e isso continua assim: a proibição de F2 não retroage. `faixasDosVersos(texto)` devolve as faixas UTF-16 de cada verso; `projetarRawText` mantém os LF internos. O tipo TS `Bloco['tipo']` ganhou o membro `'estrofe'` (alargamento compatível: `servico/` e `web/` compilam sem mudança, mas o `BlockRenderer` do leitor ainda não tem um caso para ele).

A árvore é uma lista em pré-ordem. Raízes têm nível 1, filhos sobem um nível; irmãos não se cruzam, filhos cabem nos pais. `bloco_inicio`/`bloco_fim` são inclusivos e referenciam posições na lista. O início precisa ser um bloco `capitulo` ou `secao`, com `texto === titulo`; cada bloco de título deve iniciar uma seção. Isso impede que o título armazene também os filhos quando o título da seção é informado corretamente. Nenhuma validação consegue inferir a estrutura editorial verdadeira de metadados falsos.

Inline e fragmentos PDF respeitam o comprimento do bloco. `nota_ref` exige `ref` para um bloco `nota_rodape`; outros estilos não aceitam `ref`. Fragmentos PDF aceitam `inicio`/`fim` juntos ou nenhum; bbox é `[x0,y0,x1,y1]`, não negativa, com largura/altura positivas. Linhas de texto têm início ≤ fim. Assets referenciados devem existir; referências bidirecionais presentes devem concordar. Caminhos são localizadores, não autorização para acesso a arquivos: resolução sob a pasta de artefatos cabe ao serviço.

`hashEstrutural(blocos)` calcula SHA-256 de `JSON.stringify(blocos.map(b => [b.id, b.tipo, b.texto]))`. A ordem da lista é significativa. `ordem`, inline, origens e assets não entram no hash definido pelo SPEC. Não se reordena, normaliza ou modifica o texto. Esse hash não deve ser usado como hash de todo o manifesto.

`projetarRawText(blocos)` devolve `{ raw_text, offsets }`: junta os textos com **dois LF reais**, sem separador final, e mapeia cada ID para `{ inicio_utf16, fim_utf16 }` global. IDs repetidos são erro. A versão do texto permanece imutável por responsabilidade do serviço.

---

## 2. AncoraV1

Identifica uma citação numa versão e bloco. Exemplo mínimo: [valido-minimo.json](../contratos/casos/Ancora/valido-minimo.json), com emoji em `[3,5)`.

`validarAncora` exige `0 ≤ inicio < fim` e `fim - inicio === citacao.length` em UTF-16. Prefixo e sufixo podem ser vazios. `conferirAncora(bloco, ancora)` também confere identidade do bloco, limites, fronteiras UTF-16, igualdade literal da fatia e contexto imediatamente adjacente. Devolve booleano.

A função não resolve citações nem escolhe ocorrências. A versão não está no objeto `Bloco`; o chamador precisa conferir que o bloco pertence a `versao_id`. Uma citação igual em outro documento não prova essa identidade.

---

## 3. ParteV1

Entrada imutável de uma chamada de leitura. Exemplo mínimo: [valido-minimo.json](../contratos/casos/Parte/valido-minimo.json).

Exige responsáveis não vazios e listas sem duplicatas. Um bloco não pode ser responsável e contexto na mesma parte. Contexto compartilhado entre partes é permitido. `validarPartes(partes, execucao?, canonico?)` verifica IDs/ordens únicos, uma só execução, responsabilidade única entre partes; com execução, confere sua identidade e a lista de IDs ordenada; com canônico, confere existência de todos os blocos.

O hash de entrada é obrigatório; sua pré-imagem inclui a entrada imutável que o executor construirá e não é definida por J01. A função não exige que todos os blocos do documento sejam responsáveis: o plano pode representar apenas o recorte solicitado. A lista isolada não permite provar pertencimento à versão; isso cabe ao serviço.

---

## 4. MarcaGeradaV1

Saída do modelo, sem IDs de marca, offsets ou páginas. Exemplo mínimo: [valido-minimo.json](../contratos/casos/MarcaGerada/valido-minimo.json).

`comentario` é obrigatório, podendo ser `null`. `sublinhar` contém citações literais não vazias, sem duplicatas, presentes uma única vez dentro de `citacao` e sem sobreposição. Expressões ambíguas são recusadas, nunca ligadas automaticamente à primeira ocorrência.

`conferirMarcaGerada(bloco, marca)` exige exatamente uma ocorrência da citação com prefixo/sufixo compatíveis. O serviço resolverá offsets e atribuirá ID em outro job. Esta função apenas confere, sem produzir marca persistida.

---

## 5. MarcaV1

Marca persistida pelo serviço, com âncora, função, ênfases, comentário e estados independentes. Exemplo mínimo: [valido-minimo.json](../contratos/casos/Marca/valido-minimo.json).

**Subfaixas usam coordenadas do bloco**, iguais às da âncora, e não coordenadas relativas ao início da citação. Devem ficar contidas na âncora, ser não vazias, não cortar pares substitutos e não se sobrepor. Faixas adjacentes são permitidas. A lista pode vir fora de ordem; o validador não modifica a entrada.

`validarCamadaEditorial(marcas)` devolve pares `[idA, idB]` em conflito. Compara apenas marcas da mesma versão e bloco, com `funcao !== 'nenhuma'` e `validade === 'resolvida'`. Visibilidade e avaliação não eliminam conflitos. Entradas individualmente inválidas provocam erro; IDs únicos do conjunto são conferidos também em `aplicarLote`.

| Campo | Valor | Significado |
| --- | --- | --- |
| validade | resolvida | Localização identificada; deve ser conferida no bloco da versão antes de publicar. |
| validade | ambigua | Mais de uma localização possível; nenhuma escolhida silenciosamente. |
| validade | orfa | Localização não encontrada; a âncora histórica permanece registrada. |
| avaliacao | nao_avaliada | Leitor ainda não julgou a marca. |
| avaliacao | confirmada | Leitor confirmou a anotação. |
| avaliacao | rejeitada | Leitor rejeitou a anotação; não significa âncora perdida. |
| visivel | true / false | Controla apresentação, independentemente dos dois estados anteriores. |

A validação isolada não conhece os registros de execução/job nem o texto externo da âncora. Use `conferirAncora` na versão correspondente.

---

## 6. LoteRevisaoV1

Revisão auditável e ordenada de um conjunto de marcas. Exemplo mínimo: [valido-minimo.json](../contratos/casos/LoteRevisao/valido-minimo.json); remoção completa em [valido-remover.json](../contratos/casos/LoteRevisao/valido-remover.json).

`antes`/`depois` são fechados por operação:

| Operação | Antes | Depois |
| --- | --- | --- |
| mudar_funcao | `{funcao}` | `{funcao}` |
| reescrever_comentario | `{comentario}` (pode ser null) | `{comentario}` não nulo |
| remover_comentario | `{comentario}` | `{comentario:null}` |
| editar_subfaixas | `{subfaixas}` | `{subfaixas}` |
| mudar_visibilidade | `{visivel}` | `{visivel}` |
| avaliar | `{avaliacao}` | `{avaliacao}` |
| remover | MarcaV1 completa | `{}` |

`hashMarcas(marcas)` ordena o conjunto por ID, serializa JSON compacto com chaves de objetos em ordem lexicográfica, mantém a ordem dos arrays internos e aplica SHA-256 UTF-8. Não usa a ordem das propriedades recebidas nem a ordem do conjunto como identidade.

`aplicarLote(marcas, lote)` é pura, devolve uma nova lista ordenada por ID e lança erro em divergência. Ordena operações por `ordem`, recusa ordens duplicadas, confere snapshot, referência, execução quando presente e cada `antes`, valida marcas produzidas e a camada editorial final. A entrada permanece intacta mesmo se a última operação falhar.

Na reaplicação, reverte as operações em cópia para reconstruir a base, verifica `snapshot_base`, reaplica e exige o mesmo estado final. Isso funciona após serialização e reinício, sem cache global, inclusive com múltiplas operações sobre uma marca removida. Estado parcialmente aplicado ou modificado por outra revisão é recusado. A função não é um registro durável de lotes aplicados: o serviço ainda deve persistir `lote.id` e publicar em transação para impedir reaplicações históricas após outras revisões ou ciclos de estado.

---

## 7. JobResultV1

Resultado de uma tentativa com concessão. Exemplo mínimo: [valido-minimo.json](../contratos/casos/JobResult/valido-minimo.json); adiamento em [valido-adiado.json](../contratos/casos/JobResult/valido-adiado.json).

| Estado | Significado | Regra |
| --- | --- | --- |
| ok | Tentativa produziu artefato publicável. | Exige artefato com caminho/hash; proíbe not_before. |
| falhou | Tentativa terminou sem artefato publicável. | Proíbe artefato e not_before. |
| adiado | Execução deve aguardar, inclusive por cota. | Exige not_before; proíbe artefato. |

`attempt` começa em 1, `duracao_ms` pode ser zero, `lease_token` é ULID atribuído pelo serviço. Diagnósticos podem ser vazios. `modelo` é opcional para jobs que não usam IA. O validador não lê o arquivo, não compara seu hash nem conhece o relógio/concessão no banco. Essas verificações pertencem à publicação, inclusive tentativa atual e token ainda válido. A data de adiamento pode estar no passado quando o resultado for relido.

---

## 8. ProgressoV1

Posição de leitura com revisão otimista e capítulos explicitamente concluídos. Exemplo mínimo: [valido-minimo.json](../contratos/casos/Progresso/valido-minimo.json).

`versao_id` precisa coincidir com a versão da âncora; capítulos não se repetem. `revisao_esperada` é não negativa. Ponto é representado por uma citação não vazia: um emoji exige duas unidades UTF-16, mesmo para retomada pontual.

`conferirProgresso(canonico, documentoId, versaoId, progresso)` confere as identidades do envelope do serviço, a citação e a existência dos capítulos de nível 1. O canônico não tem documento_id/versao_id próprios. A função não compara revisões persistidas; a escrita otimista cabe ao repositório.

---

## 9. ExecucaoLeituraV1

Identidade e configuração de uma leitura. Exemplo mínimo: [valido-minimo.json](../contratos/casos/ExecucaoLeitura/valido-minimo.json); execução sequencial em [valido-sequencial.json](../contratos/casos/ExecucaoLeitura/valido-sequencial.json).

`schema_versao` é `1`; método/prompt, modelo e esforço são strings não vazias. Não se fixa catálogo de modelos/esforços, sujeito a mudança. Tokens e concorrência são inteiros positivos. O valor padrão de quatro slots e o limite global são políticas do executor, não do schema.

`plano_partes` é não vazio, ordenado e sem IDs duplicados. `validarPartes` confere a relação entre plano, partes e blocos. O schema não prova que a versão existe nem que as versões de prompts são artefatos disponíveis.

---

## 10. MarcasLegadoV1

Cópia **byte a byte** de `docs/desenho/05-marcas-legado.schema.json`, isolada para o adaptador de J06. Exemplo mínimo: [valido-minimo.json](../contratos/casos/MarcasLegado/valido-minimo.json).

Preserva IDs livres (`m01`), páginas inteiras, citações e sublinhados textuais. Não adiciona `$id`, `$schema`, versão, mínimos de página, validação semântica ou novas regras para citações. O Ajv recebe a chave de registro externamente; o arquivo permanece intacto.

O adaptador futuro deve resolver bloco/citação, atribuir ULIDs, declarar perdas e produzir diagnósticos de ambiguidades. Validar o legado não certifica localizações, páginas positivas, IDs únicos ou compatibilidade com o canônico.

---

## 11. ModoDeLeituraV1

O conjunto de funções com que a IA lê. Arquivos em `contratos/modos/<id>@<revisao>.json`; `lerModosDeLeitura()` lê, valida e confere que o nome do arquivo coincide com `id` e `revisao`; `obterModo({ id, revisao })` devolve um modo ou lança. `MODO_F1` é `argumentativa@1`. Exemplo mínimo: [valido-minimo.json](../contratos/casos/ModoDeLeitura/valido-minimo.json).

| Modo | Funções |
| --- | --- |
| `argumentativa@1` | `tese`, `conceito`, `justificativa` (o método de F1: amarelo `#FFD926`, verde `#59D675`, azul `#52ABFF` e as perguntas da seção 3 do método) |
| `literaria@1` | `imagem`, `som_e_ritmo`, `voz`, `virada`, `forma`, `intertexto` |
| `filosofica@1` | `tese`, `conceito`, `distincao`, `argumento`, `objecao`, `consequencia` |
| `economica@1` | `hipotese`, `mecanismo`, `evidencia`, `identificacao`, `resultado`, `limitacao` |
| `matematica@1` | `definicao`, `enunciado`, `passo_nao_trivial`, `tecnica`, `dependencia` |

Regras do schema: 2 a 6 funções; `nenhuma` não é chave; `pergunta` termina em `?`; `comentarios` é subconjunto não vazio e sem repetição de `AUTOR`, `LEITURA`, `INVESTIGAR`, `OBJECAO`, `CONEXAO`, `TENSAO`, `PREREQUISITO`; `0 < alvo ≤ 0,5` por nível. Invariantes: chaves, rótulos e cores (por tema) únicos no modo e `alvo["1"] ≤ alvo["2"] ≤ alvo["3"]`.

`alvo_por_nivel[n]` é a fração aproximada do texto dos blocos responsáveis (em unidades UTF-16) coberta por marcas de saliência ≤ n. É orientação para o prompt, não cota: o método continua sem percentual obrigatório. O contrato não confere cobertura.

**Legibilidade.** `contrasteDoMarcaTexto(cor, tema, opacidade = 0,35)` compõe a cor sobre o fundo do tema em sRGB e mede o contraste WCAG com o texto. `TEMAS_DE_REFERENCIA` copia `web/src/ui/tokens.css`: claro `#FFFFFF`/`#000000`, escuro `#141414`/`#FFFFFF`. `conferirLegibilidadeModo(modo, opacidade?)` exige ≥ 4,5:1 nos dois temas e é aplicada a todo arquivo de `contratos/modos/` (por `lerModosDeLeitura` e em teste). **Achado:** com texto preto ou branco puro, a 35% nenhuma cor fica abaixo de 4,5:1: os piores casos são o preto no claro (8,6:1) e o branco no escuro (5,7:1). A régua só passa a recusar se a opacidade real do traço for maior: a 50%, o amarelo do método no tema escuro cai para 4,46:1. Ela não substitui o teste visual do `Marcador`. A validação do schema não inclui a régua, porque os temas pertencem à interface.

## 12. MarcaGeradaV2

Saída do modelo numa execução V2. Igual à V1, com `funcao` = chave do modo ou `nenhuma` (slug), `saliencia` 1 (essencial), 2 (importante) ou 3 (complementar), obrigatória também quando `funcao = nenhuma`, e `comentario.tipo` no conjunto ampliado. Continua sem ids, offsets ou páginas; as regras de `sublinhar` são as da V1. Exemplo: [valido-comentario.json](../contratos/casos/MarcaGeradaV2/valido-comentario.json).

O schema não conhece o modo. `conferirMarcaNoModo(marca, modo)` exige função do modo (ou `nenhuma`) e tipo de comentário em `modo.comentarios`. `conferirMarcaGeradaNaExecucao(marca, execucao, modo)` acrescenta: o modo é o da execução e `saliencia ≤ nivel_de_atencao_alvo`. `conferirMarcaGeradaV2(bloco, marca)` repete a regra da V1: uma única ocorrência compatível.

## 13. MarcaV2

A `MarcaV1` com `funcao` (slug), `saliencia`, `camada_id` (ULID) e `modo: { id, revisao }`; o comentário usa o conjunto ampliado. Exemplo: [valido-minimo.json](../contratos/casos/MarcaV2/valido-minimo.json); importação sem execução em [valido-importacao.json](../contratos/casos/MarcaV2/valido-importacao.json).

**Camada.** Cada execução de leitura é uma camada, e cada lote de importação também. Invariante: se `execucao_id` existe, `camada_id === execucao_id`. Sem execução, `camada_id` é o id do lote de importação, atribuído pelo serviço. `conferirMarcaV2NaExecucao(marca, execucao)` confere camada, execução, versão e modo.

**Regra da camada editorial V2.** `validarCamadaEditorialV2(marcas)` devolve `[{ camada_id, pares: [[idA, idB], …] }]`, só para as camadas com conflito, em ordem de `camada_id`. Conflito é sobreposição no mesmo bloco, na mesma camada, entre marcas com `funcao ≠ nenhuma` e `validade = resolvida`; visibilidade e avaliação não liberam o intervalo, como na V1. Camadas diferentes podem sobrepor-se. Marca inválida, id repetido e camada que mistura versões ou modos lançam erro. A `validarCamadaEditorial` da V1 continua com o significado antigo: versão inteira, sem camadas.

**Conversão.** `marcaV1ParaV2(marca, camada_id?)` gera modo `argumentativa@1`, saliência 2 e camada = `execucao_id`. Sem `execucao_id`, a camada é obrigatória; se for informada e diferente da execução, a função recusa. `marcaV2ParaV1(marca)` é a inversa exata e recusa o que a V1 não representa: outro modo, saliência ≠ 2, função fora de `tese|conceito|justificativa|nenhuma` ou comentário `TENSAO`/`PREREQUISITO`. Sem `execucao_id`, a camada se perde na volta. O round-trip é testado com os casos V1. `hashMarcas` aceita marcas V1 ou V2; não se misturam versões num mesmo conjunto.

## 14. ExecucaoLeituraV2

A `ExecucaoLeituraV1` com `modo`, `nivel_de_atencao_alvo` (1 a 3: a saliência máxima que a execução produz) e `executor: { modelo, esforco, cli_versao? }`, gravado por quem executou (pendência 8 do F1). Os campos soltos `modelo` **e `esforco`** da V1 não existem na V2: ambos passaram para `executor`, sem duplicata que possa divergir. `schema_versao` é `2`. Exemplo: [valido-minimo.json](../contratos/casos/ExecucaoLeituraV2/valido-minimo.json). `validarPartes(partes, execucao, canonico)` aceita execução V1 ou V2.

## 15. AnotacaoV1

A anotação do leitor, ancorada no trecho. Exemplo: [valido-minimo.json](../contratos/casos/Anotacao/valido-minimo.json); fonte em [valido-fonte.json](../contratos/casos/Anotacao/valido-fonte.json).

`tipo`: `impressao`, `observacao`, `hipotese`, `duvida`, `fonte` ou `nota`. `fonte` é obrigatória quando `tipo = fonte` e **proibida nos outros tipos** (recusa hoje, pode afrouxar depois sem quebrar). `fonte.url` é `http(s)`; `fonte.pagina` é texto curto (aceita `xii` ou `23–25`). Invariantes: a âncora segue a `AncoraV1` e tem a mesma `versao_id` da anotação; `texto` tem de 1 a 8000 unidades UTF-16, com algum caractere visível; `criada_em ≤ atualizada_em`. `marca_id` não é conferido aqui (referência externa).

## 16. ConversaV1 e RespostaGeradaV1

`ConversaV1` é o fio ancorado no trecho. A mensagem do leitor é `{ id, autor: pedro, texto, criada_em }` e não aceita `citacoes`, `contexto` nem `execucao`. A mensagem da IA exige `citacoes` (lista de `AncoraV1`, que pode ser vazia) e aceita `contexto: { snapshot_hash, blocos }` e `execucao: { modelo, esforco }`. Exemplo com resposta: [valido-resposta.json](../contratos/casos/Conversa/valido-resposta.json).

Invariantes: a primeira mensagem é do leitor; ids de mensagem únicos; `criada_em` não decresce ao longo da lista, e a conversa não é posterior à primeira mensagem; a âncora e cada citação têm a `versao_id` da conversa; com `contexto`, toda citação aponta para um bloco do contexto. Não se exige alternância leitor/IA. Limites: 8000 unidades UTF-16 para o leitor e 20000 para a IA. `estado`: `aberta` ou `arquivada`.

`RespostaGeradaV1` é o que o modelo devolve: `texto`, `pontos` (até 20; `tipo` `explicacao|estrutura|objecao|conexao|pergunta`; cada ponto que não é `pergunta` exige ao menos um apoio, e são até 10 apoios distintos) e `sugestoes_de_conexao` (até 10, com as relações da `ConexaoV1`). Não há ids, offsets nem prefixo/sufixo. Por isso, uma citação repetida no bloco é sempre ambígua. `localizarCitacao(bloco, citacao, prefixo?, sufixo?)` devolve `unica` com a faixa, `ambigua` com a contagem ou `ausente`, e nunca escolhe a primeira ocorrência. `diagnosticarRespostaGerada(resposta, blocos)` devolve `{ caminho, codigo }` para `bloco_fora_do_contexto`, `citacao_ausente` e `citacao_ambigua`.

## 17. ConexaoV1

Ligação tipada entre um trecho de origem e um destino: `trecho` (outra âncora, do mesmo ou de outro livro), `documento` ou `nota_externa` (`caminho` relativo ao cofre, `titulo`). Exemplos: [valido-sugerida.json](../contratos/casos/Conexao/valido-sugerida.json), [valido-pedro.json](../contratos/casos/Conexao/valido-pedro.json).

`caminho` é relativo, com segmentos não vazios, sem `.` ou `..`, sem `/` ou `~` no começo, sem barra invertida nem caracteres de controle, e termina em `.md`. O contrato não resolve o caminho no disco: confinar ao cofre continua a cargo do serviço.

Regras: autor `pedro` ⇒ `estado = aceita` e `decidida_em = criada_em`; `decidida_em` existe se e só se `estado ≠ sugerida` e não é anterior a `criada_em`; origem e destino `trecho` não podem ser o mesmo intervalo (mesma versão, bloco, início e fim). Intervalos que só se sobrepõem são permitidos. `decidirConexao(conexao, estado, decidida_em)` é a única transição: só uma sugestão da IA vira `aceita` ou `rejeitada`, e a decisão é final nesta versão.

## Tabela de estados de F2

| Campo | Valor | Significado |
| --- | --- | --- |
| camada_id | ULID | Execução de leitura (igual a `execucao_id`) ou lote de importação. A não sobreposição vale dentro dela. |
| saliencia | 1 | Essencial: aparece a partir do nível de atenção 1. |
| saliencia | 2 | Importante: aparece a partir do nível 2. Toda marca V1 convertida recebe 2. |
| saliencia | 3 | Complementar: aparece só no nível 3. |
| nível de atenção (leitor) | 0 | Texto puro, sem marcas. Preferência de leitura, não campo de contrato. |
| nivel_de_atencao_alvo | 1–3 | Saliência máxima que a execução produz. |
| conexao.estado | sugerida | Proposta da IA ainda não decidida; sem `decidida_em`. |
| conexao.estado | aceita | O leitor aceitou a sugestão, ou criou a conexão (nasce aceita). |
| conexao.estado | rejeitada | O leitor recusou a sugestão da IA; o registro permanece. |
| conversa.estado | aberta / arquivada | Fio ativo ou guardado; não apaga mensagens. |

## Casos e ponte Python

Cada pasta de contrato tem pelo menos dois casos válidos e quatro inválidos (as de F2 estão em `casos/ModoDeLeitura`, `MarcaGeradaV2`, `MarcaV2`, `ExecucaoLeituraV2`, `Anotacao`, `Conversa`, `RespostaGerada` e `Conexao`; o `Canonico` ganhou `valido-estrofe` e seis `invalido-estrofe-*`). Os casos invalidam campos desconhecidos, versões incompatíveis e restrições aplicáveis ao formato. Contratos sem `versao` recusam esse campo; o legado não tem intervalos/referências verificáveis, então seus negativos usam página fracionária e enum inválido. Referências entre documentos são testadas com as funções de contexto, pois um JSON isolado não contém o universo de IDs.

`contratos/src/ponte.test.ts` gera o canônico Unicode e os valores de `contratos/casos/esperados.json` pelo lado TS. Para atualizar deliberadamente: `GERAR_ESPERADOS=1 ./node_modules/.bin/vitest run --project contratos src/ponte.test.ts`. Em execução normal o teste apenas compara os arquivos gravados; não os atualiza.

`motor/margem_motor/contratos.py` implementa a mesma pré-imagem do hash (`json.dumps(..., ensure_ascii=False, separators=(',', ':'))`), projeção e `len(texto.encode('utf-16-le')) // 2`. Os testes Python leem todos os mesmos canônicos válidos e comparam hashes, comprimentos e offsets, incluindo emoji, combinantes, ligaturas, escapes, texto vazio e separadores Unicode. Em V1.1, `esperados.json` ganhou `versos_utf16` (faixas por verso das estrofes), e a ponte ganhou `versos_validos` e `faixas_dos_versos`, com o `\s` do JavaScript escrito por extenso (o `\s` do Python difere em U+001C–U+001F, U+0085 e U+FEFF). A estrofe de teste tem acento precomposto e combinante, travessão, emoji e um verso de mais de 120 unidades. Somente a função de fixture normaliza CRLF/CR para LF; hash e projeção preservam exatamente os textos recebidos.

## 18. GeometriaV1

Arquivo derivado por versão PDF, com `versao: 1`, `versao_id`, `fonte: pdf_texto|ocr`, `motor`,
`paginas` e `palavras`. Uma palavra contém `bloco_id`, offsets UTF-16 no texto **final**,
`pagina` e `quad` (oito coordenadas: superior esquerdo, superior direito, inferior direito,
inferior esquerdo). Coordenadas em pontos PDF, origem superior esquerda, no CropBox sem
rotação; largura/altura também sem rotação. A rotação da página é aplicada pelo renderizador.

`validarGeometria` recusa campos desconhecidos, páginas duplicadas ou ausentes, intervalos
vazios/sobrepostos/fora de ordem por bloco e quads fora da página (tolerância de 1 pt).
`conferirGeometria(geometria, canonico)` acrescenta referências a blocos com origem PDF na
página indicada, fronteiras UTF-16 válidas e trechos sem espaços nas pontas. A versão não
existe dentro do canônico: o serviço confere `versao_id` contra seu envelope.

Uma ligatura desfeita cobre todas as letras normalizadas. Uma palavra hifenizada entre
linhas/páginas tem uma entrada por pedaço com intervalos contíguos, sem sobreposição.
A ingestão preserva origens por linha; o derivador aceita também origens históricas agrupadas
por página. Lacunas de alinhamento viram `geometria_nao_alinhada` em `canonico.limites` na
nova ingestão; no CLI de derivação são diagnósticos em stderr, pois o canônico é imutável e
`GeometriaV1` não admite campos adicionais. O serviço substitui a versão sentinela
`00000000000000000000000000` da ingestão pela identidade atribuída na publicação.

O core expõe `quadsDaAncora`, `ancoraDaSelecao` e `paginasDoCapitulo`. Seleção usa retângulos
`{x,y,largura,altura}` e `ReadonlyMap<Id, BlocoDeVersao>` (bloco com `versao_id`). Seleciona
palavras pelo centro, apara ao primeiro bloco e limita o contexto a 32 unidades UTF-16.
O round-trip é exato para âncoras em fronteiras de palavras dentro de uma página; recortes
parciais são interpolados na ida e quantizados a palavras na seleção, conforme a regra do
centro. Seleções por página não reconstroem sozinhas uma âncora que cruza páginas.

## 19. ImportacaoWebV1

Corpo de `POST /api/importacoes/web`, enviado pela extensão do navegador (`extensao/`). Sem
`versao` (versionado pelo nome). Campos: `markdown` (obrigatório, 1 a 8.000.000 caracteres, ao
menos um não-espaço), `titulo` (obrigatório), `autor` e `site` — os três como linha única de até
500 caracteres, sem CR/LF/U+2028/U+2029 e com algum não-espaço —, `url_origem` (obrigatório,
`http`/`https`, sem espaços, até 4096), `publicado_em` (RFC 3339 com fuso **ou** só a data
`AAAA-MM-DD`), `capturado_em` (RFC 3339) e `trecho` (booleano: só a seleção).

Invariante além do schema (`regrasImportacaoWeb`): o `markdown` não pode começar com uma linha
`---`, porque o motor a leria como abertura de frontmatter. O frontmatter do `original.md` é do
serviço: ele o monta dos campos validados (`titulo`, `autor`, `site`, `url_origem`,
`publicado_em`, `capturado_em` — o do servidor quando ausente —, `trecho: sim`,
`importado_por: extensao`), uma linha `chave: valor` cada, como o motor lê, e segue o fluxo do
upload de Markdown (documento `md`, job de canonização). Casos em
`contratos/casos/ImportacaoWeb` (três válidos, nove inválidos); `validarImportacaoWeb`.

## 20. IndiceObsidianV1

Resposta de `GET /api/obsidian/indice` (exportação para o Obsidian): `versao: 1`, `url_base`
(o endereço do Margem nos links de volta, http(s), sem barra no fim), `marcas: minhas|todas` e
`documentos`. Cada documento tem `documento_id`, `versao_id` (a versão exportada, a mais recente),
`titulo`, `arquivo` (nome da nota no cofre: sem pasta, sem `\ / : * ? " < > | # ^ [ ]`, terminado
em `.md`), `sha256` (dos bytes UTF-8 da nota gerada), `itens` (trechos exportados) e
`atualizado_em`. `validarIndiceObsidian` recusa campos desconhecidos, documento repetido e dois
documentos com o mesmo arquivo (sem distinguir maiúsculas). Casos em `casos/IndiceObsidian/`.

A nota em si (`GET /api/documentos/:id/obsidian.md`) é Markdown, não JSON: o formato está
descrito em `servico/src/obsidian/exportar.ts` e em `integracoes/obsidian/README.md`. A
exportação é determinística: a mesma entrada produz os mesmos bytes (e o mesmo `sha256`).

## 21. ExecucoesDoCodexV1

Projeção de leitura da fila para os avisos da interface (`GET /api/execucoes/ativas` e o SSE `GET /api/execucoes/eventos`, evento `execucoes`). Montada só pelo serviço (`servico/src/execucoes/ativas.ts`) a partir de `job`, `evento_job`, `documento` e `secao`; o leitor só a mostra. Casos em [contratos/casos/ExecucoesDoCodex](../contratos/casos/ExecucoesDoCodex/).

`{ versao: 1, gerado_em, execucoes: [...] (até 50), omitidas }`. Cada execução: `id` (do job), `tipo` (slug), `rotulo` (português, até 160), `estado` (`na_fila` | `rodando` | `concluida` | `falhou`), `inicio`, `fim`, `documento` `{id, titulo}` ou `null`, `secao` `{id, titulo, numero}` ou `null` (`numero` só para seção de nível 1), `rota` (caminho do leitor começando por uma `/` só, ou `null`) e `mensagem` (curta, ou `null`). Invariantes: `fim` é `null` exatamente nos estados ativos e nunca antes de `inicio`; `mensagem` só em `falhou` ou `na_fila` (espera da cota); ids únicos. Ficam de fora a canonização (não é o Codex) e os cancelados; terminadas permanecem cinco minutos.

## 22. Sala de teste: FormularioDaSalaV1, RespostaDaSalaV1, ComentarioDaSalaV1 e SalaDeTesteV1

Sala de teste do beta (`docs/beta/SALA-DE-TESTE.md`): alguns documentos da biblioteca abertos a testadores por senha, servidos pelo portão (`servico/src/sala/portao.ts`). Tipos, regras e o modelo pronto em `contratos/src/sala.ts` (também exportado como `@margem/contratos/sala`, sem dependências de Node, para a web). Casos em `contratos/casos/{FormularioDaSala,RespostaDaSala,ComentarioDaSala,SalaDeTeste}/`. Tabelas na migração `0018_salas_de_teste.sql`.

- **FormularioDaSalaV1** `{ versao: 1, geral: Pergunta[1..30], por_documento: Pergunta[0..15] }`. Pergunta: `id` (`^[a-z][a-z0-9_]{0,39}$`), `tipo` (`escala` 1–5 | `escolha` única | `texto_curto` até 300 | `texto_longo` até 5000), `enunciado` (linha única até 300), `ajuda?`, `obrigatoria`, `opcoes?` (2 a 10 linhas), `rotulos?` `{minimo, maximo}`. Regras (`regrasFormularioDaSala`): ids únicos em cada lista; `opcoes` existe exatamente na escolha e sem repetição (sem distinguir maiúsculas); `rotulos` só na escala. `FORMULARIO_PADRAO_DA_SALA` é o modelo pronto (primeira impressão, as marcas ajudaram, o que confundiu, o que faltou, usaria de novo, comentário livre).
- **RespostaDaSalaV1** `{ versao: 1, estado: rascunho|enviada, geral, por_documento: {<documento ULID>: {...}}, atualizada_em, enviada_em }`; cada valor é inteiro 1–5 ou texto até 5000. Regras: `enviada_em` existe exatamente quando `estado = enviada` e nunca depois de `atualizada_em`. A coerência com o formulário é `conferirRespostas(formulario, documentos, respostas, final)`: pergunta e documento conhecidos, tipo certo, opção existente, limites de texto; no envio (`final`), as obrigatórias gerais e por documento. Depois de enviada, cada gravação é um reenvio e as obrigatórias seguem exigidas.
- **ComentarioDaSalaV1** `{ id, sala_id, testador_id, documento_id, versao_id, bloco_id, inicio_utf16, fim_utf16, citacao (1..2000), texto (1..4000), criado_em }`. Regra: `fim - inicio = citacao.length` (UTF-16) e texto com algum não-espaço. O serviço resolve o intervalo (regra 3 do AGENTS): vale o do cliente se a fatia do bloco for a citação; senão, a ocorrência única; ausente ou ambígua é 422 (`citacao_ausente`, `citacao_ambigua`).
- **SalaDeTesteV1** `{ versao: 1, id, slug (^[a-z0-9][a-z0-9-]{4,62}[a-z0-9]$), titulo, boas_vindas (até 4000), documentos (1..20 ULID, sem repetição), ativa, expira_em, formulario: FormularioDaSalaV1, criada_em, atualizada_em }`. Nunca carrega a senha: o banco guarda só `senha_hash` (`scrypt$N$r$p$sal$hash`), que nenhuma resposta devolve.

## 23. Autor `leitor`: ConversaV2, ConexaoV2, ResolucaoV2 e LoteRevisaoV2 (J101)

O Margem passa a ser instalado por outras pessoas, e o autor humano deixa de se chamar `pedro`. Trocar um valor de enum muda o que o contrato aceita, então segue a regra das outras versões (como `MarcaV1`/`MarcaV2`): **versão nova ao lado, a antiga intacta**. Cada V2 é a V1 com o `$id` novo, `versao: 2` (nas três que têm `versao`; o `LoteRevisaoV2` continua versionado só pelo nome) e `leitor` no lugar de `pedro` — o teste `leitor.test.ts` confere que o schema V2 difere da V1 só nisso.

- `ConversaV2`: mensagem do leitor `{ id, autor: leitor, texto, criada_em }` (`MensagemDoLeitorV2`); a da IA é a mesma da V1.
- `ConexaoV2`: `autor` é `ia` ou `leitor`; conexão do `leitor` nasce `aceita` com `decidida_em = criada_em`.
- `ResolucaoV2`: as perguntas são do `leitor` (`MensagemDaResolucaoDoLeitorV2`), alternando com a IA.
- `LoteRevisaoV2`: `autor` é `codex`, `claude` ou `leitor`.

Validadores: `validarConversaV2`, `validarConexaoV2`, `validarResolucaoV2`, `validarLoteRevisaoV2` (e `contrato*V2`). As regras semânticas são as mesmas e aceitam as duas versões. **Leitura das V1**: `lerConversa`, `lerConexao`, `lerResolucao` e `lerLoteRevisao` recebem `unknown`, aceitam V1 ou V2 e devolvem a V2 (ou `null`); `conversaV1ParaV2`, `conexaoV1ParaV2`, `resolucaoV1ParaV2` e `loteRevisaoV1ParaV2` são as conversões puras. Não há volta V2 → V1: nada novo grava V1. `aplicarLote` aceita lote V1 ou V2; `decidirConexao` devolve a mesma versão que recebe.

Banco: a migração `0025_leitor.sql` troca `pedro` por `leitor` em `mensagem.autor`, `conexao.autor`, `lote_revisao.autor`, `camada.tipo` (a camada dos grifos; índice `camada_do_leitor`) e `agente_mensagem.autor`, refaz as CHECK com o valor novo e converte as sessões `ResolucaoV1` de `resolucao.dados` para V2. O serviço só emite V2; o repositório de resoluções ainda lê como V2 uma V1 que apareça. `MensagemDoAgenteV1.autor` (tipo só de API, sem schema) passou a `leitor | agente`.

Casos: `casos/ConversaV2`, `ConexaoV2`, `ResolucaoV2` e `LoteRevisaoV2` são os da V1 com `leitor`, mais `invalido-autor-pedro` em cada um; o `invalido-versao` das V2 traz `versao: 1`.
