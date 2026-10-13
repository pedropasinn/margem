# Composição e publicação de contratos

A composição local reúne estrutura e invariantes. JSON Schema continua sendo a representação estrutural publicada para TypeScript e Python; a conferência contra documento e estado persistido pertence ao core e ao serviço. Esta migração não muda os schemas nem os dados existentes.

## Compor um contrato

`contratos/src/contrato.ts` oferece `folha`, `objeto`, `lista`, `referenciar`, `alternativas`, `discriminada` e `compilarContrato`. `composicoes.ts` monta os componentes e `validadores.ts` fornece Ajv e compatibilidade com os validadores booleanos antigos.

Exemplo simplificado, dentro do módulo:

```ts
const ancora = folha<AncoraV1>(schemaAncora, regrasLocaisDaAncora);
const marca = objeto<MarcaV2>(schemaMarca, {
  ancora: referenciar(ancora, schemaAncora.$id as string),
}, regrasPropriasDaMarca);
const contrato = compilarContrato<MarcaV2>(marca, conferirEstrutura);
const resultado = contrato.validarLocal(entrada);
if (resultado.ok) usarMarcaLocal(resultado.valor);
```

As regras próprias verificam somente invariantes do próprio objeto. O componente visita os filhos automaticamente e prefixa seus diagnósticos: `origem.ancora.fim_utf16`, por exemplo. Os caminhos são arrays de nomes e índices, sem ambiguidade de escaping. Algumas regras antigas ainda produzem um diagnóstico do objeto inteiro; sua granularidade pode melhorar separadamente.

Folhas e propriedades não compostas recusam `$ref` escondido na construção do componente. Para adicionar um contrato, compor cada referência com o componente correspondente, registrar seu compilador e testar que o schema resultante é igual ao publicado. Uma referência estrutural nova sem composição faz a construção falhar. Isso reduz omissões nos contratos migrados; não impede alguém de escrever um validador paralelo fora da API.

`oneOf` conserva a exclusividade estrutural do JSON Schema. `anyOf` exige ao menos um ramo estrutural e semanticamente válido. Quando há discriminador, ele escolhe diretamente o percurso semântico após a validação estrutural. O módulo não interpreta o grafo arbitrário de JSON Schema: Ajv faz a estrutura, a composição explícita faz as regras. Ramos não discriminados precisam de conferência estrutural adicional, com compiladores em cache; não há promessa de eliminar todo trabalho repetido em uniões ambíguas.

São 17 contratos compostos: `AncoraV1`, `MarcaV1`, `MarcaV2`, `ProgressoV1`, `AnotacaoV1`, `ConversaV1`, `ConexaoV1`, `LoteRevisaoV1`, `ModeloDoCapituloV1`, `LoteDoModeloV1`, `PlanoPedagogicoV1`, `ResolucaoV1`, `AudioV1`, `VisualV1`, `EsquemaDoCapituloV1`, `RoteiroGuiadoV1` e `LeituraComentadaV1`. Isso cobre todas as famílias atuais com referências a `AncoraV1`. Regras booleanas históricas continuam disponíveis para seus consumidores diretos; algumas repetem conferências de filhos por compatibilidade.

O teste de registro compara os 50 arquivos de schema com `NOMES_DOS_SCHEMAS` e `validadoresSchema`. Outro teste compara **todas** as composições com os schemas publicados. As oito famílias migradas em J96 também passam por mutações de cada âncora de seus casos válidos, conferindo o caminho exato do diagnóstico. Python continua consumindo os mesmos schemas; as regras semânticas compostas são executadas em TypeScript na fronteira do serviço.

`entrada.ts` percorre os dados antes de Ajv/Unicode/clone, sem recursão, recusando ciclos, acessores (inclusive não enumeráveis), protótipos personalizados e profundidade superior a 64. Aliases sem ciclo, objetos congelados e campos opcionais `undefined` permanecem aceitos para a estrutura decidir. Esse teto é uma proteção operacional da API em memória, não uma mudança nos schemas. Os limites mais específicos de bytes, itens e profundidade continuam em `servico/src/entrada-json.ts`, entregues em J55. Os validadores Ajv brutos e `MarcasLegadoV1` conservam seu comportamento anterior; não são a entrada recomendada para objetos desconhecidos.

Editorial, edição e capa de notícias usam o registro central e a mesma proteção de entrada/Unicode. Regras de roteiro, fontes, hashes, evidências e classificação continuam no serviço de notícias. Validação estrutural da edição sozinha não autoriza publicação.


## Garantias e publicação

A API `validarLocal(unknown)` retorna `ResultadoContrato<Local<T>>`: cópia própria, congelada recursivamente, com tipo nominal. O wrapper booleano continua sem clone para consumidores existentes, mas não confere a garantia nominal de `Local<T>`.

O fluxo do agregado é:

1. Contratos verificam estrutura e invariantes locais do modelo e lote.
2. O serviço carrega execução, canônico e revisão-base dentro da transação.
3. `resolverReferenciasDoModelo` verifica execução, modo, capítulo e blocos, devolvendo `ModeloReferenciado`.
4. `conferirModeloNoCanonico` confere citações/contextos e partição das unidades, devolvendo `ModeloConferido`.
5. `conferirEvolucaoDoModelo` verifica base, evidências e reaplica o lote; o resultado deve coincidir com o modelo recebido.
6. `publicarModeloDoCapitulo` grava modelo e lote na transação do chamador. A publicação só está concluída depois do commit.

Um lock transacional por execução/capítulo serializa publicações. A revisão-base deve ser a vigente sob esse lock. A escrita bruta do agregado é privada; os antigos `gravarModelo` e `gravarLote` públicos foram removidos. Eventos e validação do lease continuam a cargo do publicador de jobs, na mesma transação. A preparação inicial também usa a entrada central. Não há tipo `Publicado` antes do commit nem nova camada de tipos para cada etapa sem benefício concreto.

A conferência local não resolve referências no banco. As garantias contextuais são relativas ao canônico e à base carregados; não devem ser armazenadas como certificado reutilizável de autorização futura. O core é puro. O serviço carrega dependências, adquire locks e conduz a transação. O repositório conserva consultas, sem expor escrita que contorne a fronteira do agregado.

## Execuções e identidade de perfil

`execucoes.obter/listar` devolvem `ExecucaoParaPlanejamento`: id, versão documental, discriminador 1/2/3, tamanho de parte e plano. Os leitores não recebem mais uma execução V2/V3 tipada falsamente como V1. Operações específicas de leitura recusam V3; contratos completos continuam disponíveis por suas APIs próprias.

A receita `perfil-plano@2` projeta áreas, preferências e observações, com ordem fixa de propriedades e trim das observações, conforme o conteúdo do prompt. Perfil ausente e perfil inteiramente vazio têm a mesma identidade. Um campo vazio não apaga conteúdo dos demais. Revisão/data não alteram a identidade; ordem das listas, grafia e Unicode são preservados.

Hashes históricos continuam resolvíveis. As consultas reconhecem aliases e a gravação de plano, serializada pelo modelo, retorna o plano existente quando o conteúdo do perfil é equivalente. Eventos usam o ID efetivamente persistido. Nenhum hash ou plano histórico é reescrito. Por enquanto a descoberta de aliases percorre revisões de perfil: adequado ao acervo pessoal atual, mas deve ganhar um índice/projeção persistida se o volume crescer.

## Fora desta mudança

Não implementar um interpretador semântico genérico de `$ref`, migrar todos os contratos simultaneamente ou reescrever esquemas/tipos Python. Limites de entrada do serviço e recuperação de filesystem + SQL foram entregues em J55; J96 complementa a proteção da API pública em memória. O clone congelado e as verificações de resultado adicionam trabalho proporcional ao agregado; não foi estabelecido um benchmark de desempenho para os maiores documentos.
