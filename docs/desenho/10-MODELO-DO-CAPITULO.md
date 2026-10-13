# Margem · modelo semântico do capítulo e pipeline de leitura

25 de setembro de 2026. Resposta ao `docs/jobs/J25-SPEC.md`, escrita sobre o código de `main` (`71143a0`) e sobre `09-VISAO.md`. Este documento é o desenho; a implementação segue em J26–J32 (§13), no mesmo PR, porque foi pedido o código depois de aprovar o desenho.

## 1. Resumo

```
CANONIZAR (existe)
   │
   ▼
ANALISAR_PASSAGENS  ── uma chamada por parte; só o texto da parte ─────────────► revisão r0 (união das análises locais)
   │                                                                                       │
   ▼                                                                                       ▼
SINTETIZAR_CAPITULO ── análises locais + pacote de evidências (+ texto, se couber) ─► lote de operações → revisão r1
   │
   ▼
REVISAR_CAPITULO    ── texto da janela + r1 inteira à vista ───────────────────────► lote de operações → revisão r2
   │                                                                                       │
   │                                                                     projeção de marcas (determinística, na mesma transação)
   ▼                                                                                       ▼
PLANEJAR_LEITURA    ── r2 + perfil do leitor ─────────────────────────────────────► PlanoPedagogico ─► apresentação (desktop | e-ink | áudio)
```

- **Três níveis**: `ModeloDoCapitulo` (o que o texto faz, sem leitor), `PlanoPedagogico` (como acompanhar o leitor, com perfil), `ApresentacaoDoPlano` (como cabe no dispositivo, determinística).
- **Revisões imutáveis**: r0, r1 e r2 são snapshots; cada passagem de uma para a outra é um lote de operações com `antes`, `depois`, `motivo` e `evidencia`.
- **Aliases**: o modelo só vê `B001` (blocos), `L01` (elementos), `R01` (relações), `D01` (dificuldades), `U1` (unidades) e cria referências locais `n1`; o serviço traduz tudo e gera os ULIDs.
- **Reaproveitamento**: a execução de compreensão é uma linha de `execucao_leitura` com `schema_versao = 3`. Com isso vêm de graça a camada (trigger `camada_da_execucao`), a proveniência (`registrarProveniencia`), o plano de partes (`planejarLeitura`) e as tabelas `parte` e `job`.

## 2. As sete exigências

| # | Exigência | Decisão |
|---|---|---|
| 1 | Compreensão → pedagogia → apresentação | **Adotada.** `ApresentacaoDoPlano` é uma função pura em `core/` (`apresentarPlano`). O desktop a calcula no navegador; e-ink e áudio pela API. Nenhuma chamada ao modelo na apresentação nesta fase; a reescrita oral do áudio fica registrada como exceção futura que só reescreve texto, nunca passos. |
| 2 | Dificuldade textual × dificuldade do leitor | **Adotada.** `DificuldadeTextualV1` tem um tipo fechado (§3). O resolvedor emite o diagnóstico `dificuldade_fala_do_leitor` quando a descrição menciona o leitor ("leitor", "Pedro", "você"), e a descarta. `apoios` só existem no plano. |
| 3 | Revisões imutáveis + operações | **Adotada.** Tabela `modelo_capitulo` com trigger de imutabilidade, `lote_modelo` com as operações. Acrescentei a operação `fundir`, indispensável porque duas partes podem ter visto o mesmo elemento. |
| 4 | Sem resumo sobre resumo | **Adotada.** A síntese recebe o esqueleto do capítulo (cada bloco com as primeiras palavras), o pacote de evidências (cada elemento com a citação que o sustenta) e, se couber, o texto inteiro. |
| 5 | Núcleo comum + papel do modo | **Adotada, com um ajuste**: o papel do modo é uma **chave de função do próprio modo** (`contratos/modos/*.json`) ou `null`. Não crio um segundo vocabulário: se um modo precisar de papéis mais finos (`premissa`), isso vira uma revisão do modo (`argumentativa@2`), versionada como dado. |
| 6 | `RelacaoSemantica` ≠ `ConexaoV1` | **Adotada.** Relação é da análise; adotar cria uma `ConexaoV1` do leitor (`autor: 'pedro'`, `aceita`) e registra a origem em `relacao_adotada`. A conexão sobrevive a qualquer revisão da IA. |
| 7 | Marcas como projeção | **Adotada.** A primeira projeção é determinística e roda na transação que publica r2; cada marca guarda de que elemento veio (`marca_elemento`). Uma etapa editorial com modelo fica prevista para quando a avaliação mostrar que a seleção determinística não basta. |

Duas divergências pequenas em relação ao esboço do SPEC:

- **Relações só entre elementos.** Todo elemento tem âncora; uma relação entre âncoras soltas criaria trechos no modelo sem papel nem centralidade. O braquete continua ligando trechos: os das âncoras dos elementos.
- **Confiança em três níveis** (`alta`, `media`, `baixa`), não número: o modelo não calibra probabilidades.

## 3. Contratos

Tudo em `contratos/src/tipos.ts` (seção "Compreensão", J28) com schemas em `contratos/schemas/`.

```ts
/** 1 = estrutural (sem isto o capítulo não se sustenta), 2 = importante, 3 = complementar.
 *  Mesma escala de `Saliencia`: 1 é o mais importante. Promover é ir de 3 para 1. */
export type Centralidade = 1 | 2 | 3;
export type NucleoDoElemento =
  | 'afirmacao' | 'conceito' | 'hipotese' | 'evidencia' | 'exemplo' | 'objecao' | 'passo' | 'elemento_textual';
export type TipoRelacaoSemantica =
  | 'suporta' | 'desenvolve' | 'pressupoe' | 'contrasta' | 'exemplifica' | 'retoma' | 'responde' | 'tensiona' | 'ecoa';
export type TipoDificuldadeTextual =
  | 'premissa_implicita' | 'mudanca_de_notacao' | 'sintaxe_complexa' | 'conceito_sem_definicao'
  | 'salto_argumentativo' | 'referencia_externa' | 'ambiguidade';
export type Confianca = 'alta' | 'media' | 'baixa';
export type EstagioDoModelo = 'analise_local' | 'sintese' | 'revisao';

export interface OrigemNoModelo { estagio: EstagioDoModelo; job_id: Id }
export interface NotaAnaliticaV1 { tipo: 'LEITURA' | 'INVESTIGAR' | 'OBJECAO' | 'TENSAO'; texto: string }

export interface ElementoSemanticoV1 {
  id: Id;                        // ULID do serviço; estável entre revisões
  nucleo: NucleoDoElemento;
  papel: ChaveFuncao | null;     // função do modo (ou null)
  ancoras: AncoraV1[];           // ≥ 1; a primeira é a principal
  enunciado: string;             // paráfrase fiel, voz do autor
  qualificadores: string[];      // literais dentro da âncora principal ("somente", "em média")
  centralidade: Centralidade;
  notas: NotaAnaliticaV1[];      // inferências do assistente, nunca do autor
  origem: OrigemNoModelo;
}
export interface RelacaoSemanticaV1 {
  id: Id; tipo: TipoRelacaoSemantica; origem_id: Id; destino_id: Id;
  explicacao: string; confianca: Confianca; retrospectiva: boolean; origem: OrigemNoModelo;
}
export interface DificuldadeTextualV1 {
  id: Id; tipo: TipoDificuldadeTextual; ancoras: AncoraV1[]; descricao: string; origem: OrigemNoModelo;
}
export interface UnidadeDeLeituraV1 { id: Id; bloco_inicio: Id; bloco_fim: Id; titulo: string; funcao_no_capitulo: string }
export interface MovimentoDoCapituloV1 { texto: string; etapas: { unidade_ids: Id[]; descricao: string }[] }

/** Uma revisão publicada: imutável. */
export interface ModeloDoCapituloV1 {
  versao: 1;
  id: Id;                        // id da revisão
  execucao_id: Id; versao_id: Id; secao_id: Id; modo: ReferenciaModo;
  revisao: number;               // 0 = união das análises locais, 1 = síntese, 2 = revisão global
  estagio: EstagioDoModelo;
  base_id: Id | null;            // revisão anterior
  lote_id: Id | null;            // lote que produziu esta revisão a partir da base
  movimento: MovimentoDoCapituloV1 | null;
  unidades: UnidadeDeLeituraV1[];
  elementos: ElementoSemanticoV1[];
  relacoes: RelacaoSemanticaV1[];
  dificuldades: DificuldadeTextualV1[];
  criada_em: string;
}

export type OperacaoDoModeloV1 = {
  ordem: number; motivo: string; evidencia: AncoraV1[];
} & (
  | { op: 'promover' | 'rebaixar'; alvo_id: Id; antes: { centralidade: Centralidade }; depois: { centralidade: Centralidade } }
  | { op: 'corrigir_papel'; alvo_id: Id; antes: { nucleo; papel }; depois: { nucleo; papel } }
  | { op: 'reescrever_enunciado'; alvo_id: Id; antes: { enunciado }; depois: { enunciado } }
  | { op: 'acrescentar_nota'; alvo_id: Id; antes: null; depois: NotaAnaliticaV1 }
  | { op: 'fundir'; alvo_id: Id; antes: { absorvidos: ElementoSemanticoV1[] }; depois: { ancoras: AncoraV1[] } }
  | { op: 'adicionar_elemento'; alvo_id: Id; antes: null; depois: ElementoSemanticoV1 }
  | { op: 'remover_elemento'; alvo_id: Id; antes: ElementoSemanticoV1; depois: null }
  | { op: 'criar_relacao'; alvo_id: Id; antes: null; depois: RelacaoSemanticaV1 }
  | { op: 'remover_relacao'; alvo_id: Id; antes: RelacaoSemanticaV1; depois: null }
  | { op: 'adicionar_dificuldade'; alvo_id: Id; antes: null; depois: DificuldadeTextualV1 }
  | { op: 'remover_dificuldade'; alvo_id: Id; antes: DificuldadeTextualV1; depois: null }
  | { op: 'definir_unidades'; antes: UnidadeDeLeituraV1[]; depois: UnidadeDeLeituraV1[] }
  | { op: 'definir_movimento'; antes: MovimentoDoCapituloV1 | null; depois: MovimentoDoCapituloV1 }
);
export interface LoteDoModeloV1 {
  versao: 1; id: Id; execucao_id: Id; secao_id: Id; estagio: 'sintese' | 'revisao';
  job_ids: Id[]; base_id: Id; resultado_id: Id; operacoes: OperacaoDoModeloV1[]; criado_em: string;
}

export interface PassoPedagogicoV1 {
  ordem: number; bloco_inicio: Id; bloco_fim: Id;
  foco: Id[];                    // elementos em destaque neste passo
  observar: string;
  explicacao: { curta: string; longa: string };
  relacoes: Id[];                // relações a recuperar
  parada: { tipo: 'pergunta' | 'pausa'; texto: string } | null;
}
export interface ApoioPedagogicoV1 { alvo_id: Id; tipo: 'explicar' | 'omitir' | 'exemplo' | 'recordar'; texto: string }
export interface PlanoPedagogicoV1 {
  versao: 1; id: Id; execucao_id: Id; secao_id: Id; modelo_id: Id; perfil_hash: string;
  passos: PassoPedagogicoV1[]; apoios: ApoioPedagogicoV1[]; job_id: Id; criado_em: string;
}

export type Dispositivo = 'desktop' | 'eink' | 'audio';
export interface TelaDaApresentacaoV1 {
  passo: number; tipo: 'texto' | 'explicacao' | 'narracao' | 'comentario';
  blocos: Id[]; texto: string | null;
}
export interface ApresentacaoDoPlanoV1 { versao: 1; plano_id: Id; dispositivo: Dispositivo; telas: TelaDaApresentacaoV1[] }

export interface PerfilDoLeitorV1 {
  versao: 1; revisao: number;
  areas: { nome: string; nivel: 'basico' | 'intermediario' | 'avancado' }[];
  preferencias: string[];
  observacoes: string;
  atualizado_em: string;
}
export interface ExecucaoCompreensaoV1 {
  id: Id; versao_id: Id; schema_versao: 3; modo: ReferenciaModo;
  prompts: { analise: string; sintese: string; revisao: string; plano: string };
  executor: { modelo: string; esforco: string };
  tamanho_parte_tokens: number; plano_partes: Id[]; criada_em: string;
}
```

O que é imutável: revisões do modelo, lotes, planos, execuções, perfis (cada edição é uma revisão nova). O que muda: só os estados de job e a `avaliacao`/`visivel` das marcas projetadas, como hoje.

## 4. Saídas do modelo e aliases

O modelo nunca vê um ULID do modelo semântico nem cria identidade. O serviço monta, para cada prompt, uma tabela de aliases e a guarda na auditoria (`aliases.json`):

| Alias | O quê | Escopo |
|---|---|---|
| `B001`… | blocos da entrada | o prompt |
| `L01`… | elementos da revisão de base | o prompt |
| `R01`… | relações da revisão de base | o prompt |
| `D01`… | dificuldades | o prompt |
| `U1`… | unidades | o prompt |
| `n1`… | itens **novos** da resposta | a resposta |

Regras do resolvedor (`core/src/aliases.ts`, puro): todo alias citado existe na tabela; cada `n*` é declarado uma única vez e só referenciado na mesma resposta; blocos citados pertencem à janela; um alias desconhecido vira diagnóstico e descarta **só a operação**, nunca o lote. Os blocos passam a ser `B001` também no texto (`⟦b:B001⟧ [paragrafo]`): economiza cerca de 22 caracteres por abertura e dispensa o `enum` de 250 ULIDs de hoje.

Saídas (schemas em `prompts/*.schema.json`):

- **`analisar-passagens@1`** — `{ elementos: [{ ref: 'n1', nucleo, papel, citacoes: [{ bloco, citacao, prefixo, sufixo }], enunciado, qualificadores, centralidade, notas }], relacoes: [{ origem: 'n1', destino: 'n3', tipo, explicacao, confianca }], dificuldades: [{ tipo, citacoes, descricao }], resumo_da_parte, limites, leitura_integral }`.
- **`sintetizar-capitulo@1`** — `{ movimento: { texto, etapas: [{ unidades: ['U1'], descricao }] }, unidades: [{ ref: 'U1', inicio: 'B001', titulo, funcao_no_capitulo }], operacoes: [...] }`. As unidades dão só o bloco de início; o serviço deriva o fim (a próxima começa onde esta acaba), e com isso as unidades sempre particionam o capítulo.
- **`revisar-capitulo@1`** — `{ operacoes: [...], observacoes: [] }`.
- Operações nas duas: `{ op: 'promover', alvo: 'L04', para: 1, motivo, evidencia: ['L17', 'L21'] }`, `corrigir_papel`, `reescrever_enunciado`, `acrescentar_nota`, `fundir { alvo, absorvidos }`, `adicionar_elemento { ref, … como na análise }`, `remover_elemento`, `criar_relacao { ref, origem, destino, tipo, explicacao, confianca, retrospectiva }`, `remover_relacao`, `adicionar_dificuldade`, `remover_dificuldade`. A `evidencia` do modelo é uma lista de aliases; o serviço a converte nas âncoras dos elementos citados.
- **`planejar-leitura@1`** — `{ passos: [{ inicio: 'B001', foco: ['L04'], observar, explicacao: { curta, longa }, relacoes: ['R03'], parada }], apoios: [{ alvo: 'L04', tipo, texto }] }`. Passos também só dão o início: particionam o capítulo em ordem.

Âncoras: citação resolvida pelo `localizarCitacao` de sempre. Elemento sem nenhuma âncora resolvida **é descartado** com diagnóstico (princípio 1 do 09: nada flutua), e relações que dependiam dele caem junto, também com diagnóstico. Tudo fica no `diagnosticos.json` da auditoria.

## 5. Pipeline

| Job | Entrada | Saída publicada | `dedup_key` |
|---|---|---|---|
| `analisar_passagens` | blocos responsáveis e de contexto da parte, continuidade das partes anteriores do mesmo capítulo (como hoje) | `analise_local` (JSON validado e resolvido) | `analisar:<execucao>:<hash_entrada>` |
| `sintetizar_capitulo` | esqueleto + pacote de evidências + texto se couber | r0 e r1, `lote_modelo` da síntese | `sintetizar:<execucao>:<secao>` |
| `revisar_capitulo` | por janela: texto da janela + r1 inteira | lote parcial; a última janela publica r2 e projeta as marcas | `revisar:<execucao>:<secao>:<janela>` |
| `planejar_leitura` | r2 + perfil do leitor + modo | `plano_pedagogico` | `planejar:<execucao>:<secao>:<modelo_id>:<perfil_hash>` |

Dependências: cada publicação enfileira a etapa seguinte na mesma transação (sem `not_before` longo): a última parte do capítulo enfileira a síntese; a síntese enfileira as janelas de revisão; a última janela publica r2 e enfileira o plano. Repetição é tolerada pelo `dedup_key` único.

Tamanhos (em tokens estimados pela régua de `partes.ts`): a síntese leva o texto inteiro do capítulo quando `texto + r0 ≤ 90 000`; senão só esqueleto e evidências. A revisão usa uma janela única (o capítulo) quando `texto + r1 ≤ 90 000`; senão uma janela por parte, e cada janela só pode operar em elementos ancorados nela (ou em relações que tocam neles). Capítulo cujo pacote nem assim cabe (acima de ~300 páginas) fica fora desta fase, com o diagnóstico `capitulo_grande_demais`; a hierarquia seção → capítulo é o passo seguinte.

Falhas: um job que falha para a cadeia do capítulo; `POST /api/jobs/:id/reenfileirar` (existe) retoma dali. Refazer: um prompt de análise novo pede uma execução nova (camada nova). Um perfil novo só gera um plano novo (a chave do plano tem o hash do perfil). Um dispositivo novo não gera nada: a apresentação é calculada.

```
canônico ─► execução ─► análise local ─► r0 ─► r1 ─► r2 ─┬─► marcas (camada da execução)
                                                          └─► plano (por perfil) ─► apresentação (por dispositivo)
```

## 6. O caso "Admitamos inicialmente que…"

```
ANÁLISE LOCAL (parte 1)   L07 · hipotese · papel conceito · centralidade 3
                          “Admitamos inicialmente que os preços são rígidos” — “só para fixar ideias”
SÍNTESE (r1)              criar_relacao n1: L19 (conclusão, parte 2) pressupoe L07 · retrospectiva
                          motivo: a demonstração da parte 2 usa a rigidez de preços em três passos
REVISÃO (r2)              promover L07: 3 → 1
                          motivo: L19, L21 e L29 dependem dela; o autor a apresenta como provisória
                          evidencia: âncoras de L19, L21, L29
PROJEÇÃO                  a marca de L07 passa a ter saliência 1 e aparece no nível de atenção 1
```

O auditor mostra exatamente essa sequência para a marca (§8).

## 7. Projeções

**Marcas** (`servico/src/compreensao/projecao.ts`, pura): para cada elemento de r2, em ordem de centralidade e de posição:
- `papel` que é função do modo → marca com essa função; `papel` nulo mas com nota → marca `nenhuma` com comentário; sem papel nem nota → sem marca;
- `saliencia = centralidade`; âncora = a principal; sublinhados = `qualificadores` resolvidos pelo `resolverSubfaixas`;
- comentário = a primeira nota cujo tipo o modo aceita (`LEITURA`, `INVESTIGAR`…), senão o enunciado como `AUTOR · <PAPEL>`;
- duas marcas coloridas não se sobrepõem na camada (regra de hoje): a de maior centralidade fica, a outra vira diagnóstico `sobreposicao_na_projecao`;
- a cobertura por nível é medida e registrada contra o `alvo_por_nivel` do modo, sem cortar nada nesta fase.

Cada marca projetada tem `origem = 'projecao'` e uma linha em `marca_elemento (marca_id, elemento_id, modelo_id, regra)`.

**Relações → braquetes.** `GET /api/compreensoes/:id/capitulos/:secao/relacoes?filtro=relevantes|todas`. Relevante = as duas pontas com centralidade ≤ 2 e confiança diferente de `baixa`, **ou** retrospectiva. `POST /api/relacoes/:id/adotar` cria a `ConexaoV1` do leitor com a âncora principal de cada ponta e mapeia o tipo: `suporta`→`desenvolve`, `desenvolve`→`desenvolve`, `pressupoe`→`prerequisito`, `contrasta`→`contraste`, `exemplifica`→`exemplo`, `retoma`→`semelhanca`, `responde`→`tensao`, `tensiona`→`tensao`, `ecoa`→`semelhanca`. O tipo original fica em `relacao_adotada`. Se uma revisão posterior da IA não tiver mais a relação, a conexão continua; a relação some só da camada de relações.

**Plano pedagógico.** Gerado pelo modelo sobre r2 e o perfil. O serviço valida aliases, particiona os passos a partir dos inícios e publica.

**Apresentação** (`core/src/apresentacao.ts`, pura): `desktop` = uma tela por passo (texto em foco + explicação longa na margem); `eink` = por passo, telas de texto com no máximo N caracteres (padrão 1 800, quebra em fronteira de bloco) seguidas de uma tela com a explicação curta e o "observar"; `audio` = por passo, `narracao` dos blocos e `comentario` com a explicação curta e a parada. A representação refluível do e-ink vem do canônico e referencia blocos, nunca coordenadas do PDF.

## 8. Auditoria

Cada chamada ao modelo, de qualquer tipo de job (inclusive os atuais `ler_parte`, `revisar_consistencia` e `responder`), grava em `<base>/auditoria/jobs/<job_id>/tentativa-<n>/`:

```
prompt.txt              o prompt exato (se foi para prompt.md, o conteúdo dele)
entrada/                os outros arquivos da entrada (digest.md, metodo.md…)
schema.json             o schema entregue
resposta.bruta.json     a resposta conferida pelo schema
resultado.json          estado, código, modelo, esforço, duração
metadados.json          modelo e esforço pedidos, versão do prompt, commit, sha256 do prompt, horário
aliases.json            tabela de aliases (pipeline nova)
resposta.validada.json  o que sobrou depois do resolvedor
diagnosticos.json       descartes e avisos
```

`<base>` é `MARGEM_ARTEFATOS` ou `~/.cache/margem`. Um `AsyncLocalStorage` aberto pelo `Worker` por tentativa leva `job_id`, tipo e tentativa até o executor e a publicação, sem mudar a assinatura dos manipuladores. O prompt contém só instruções e texto do documento; stderr continua fora (pode conter credencial). Permissões 0700/0600 como os artefatos de hoje.

O auditor (`npm run auditar -- …`, texto puro):
- `--job <id>` / `--parte <id>`: metadados, prompt (inteiro ou `--resumo`), resposta, diagnósticos e eventos;
- `--marca <id>`: o job que a criou; se projetada, a história do elemento: análise local → operações da síntese e da revisão → projeção;
- `--capitulo <execucao> <secao>`: estado, jobs, revisões, lotes com contagem por operação.

## 9. Estados, prioridade e prefetch

Estados internos, **derivados** dos jobs do capítulo (sem tabela de estado que possa divergir): `nao_preparado`, `na_fila`, `analisando`, `sintetizando`, `revisando`, `projetando`, `pronto`, `parcial`, `falhou`. Na interface: `nao_preparado` → *Não preparado*; `na_fila` a `projetando` → *Preparando…*; `pronto` e `parcial` → *Pronto* (parcial com um aviso discreto: alguma parte declarou leitura incompleta); `falhou` → *Falhou*. A projeção roda na transação de r2, então `projetando` é o intervalo entre r2 e o plano.

Prioridade: `job.prioridade smallint DEFAULT 50`; `reservar` ordena por `prioridade DESC, criado_em, id`. Preparar um capítulo (`POST /api/compreensoes/:id/capitulos/:secao/preparar`) enfileira as partes com prioridade 100 (ou sobe as já enfileiradas) e, com `prefetch`, o capítulo seguinte com 50. A tabela `preparacao_capitulo (execucao_id, secao_id, prioridade, pedida_em)` guarda o pedido; as etapas seguintes herdam a prioridade dali. Futuro, sem scheduler: artefato pedido 90, próximo provável 50, reprocessamento 20.

## 10. Perfil do leitor

Tabela `perfil_leitor` só de acréscimo (cada edição é uma revisão); `GET/PUT /api/perfil`. O hash (`sha256` do JSON canônico de áreas, preferências e observações) entra na chave do plano. O perfil vai para `planejar-leitura` e para o `responder`; o schema dos prompts de análise, síntese e revisão não tem campo para ele, e um teste garante que o texto do perfil nunca aparece nesses prompts. Propostas de mudança (`perfil_proposta`, sugerida → aceita/rejeitada) ficam para quando houver dados; o contrato já prevê o estado.

## 11. Custo e tempo

Medições reais (J10, J19): uma parte pequena leva de 27 a 91 s com `high`. Para um capítulo típico do Mixtape (~50 páginas, ~35 mil tokens, 1–2 partes), a estimativa, **a medir**:

| Etapa | Chamadas | Duração estimada |
|---|---|---|
| analisar | 1–2 | 3–8 min cada |
| sintetizar | 1 | 3–6 min |
| revisar | 1 (janela única) | 3–6 min |
| planejar | 1 | 1–3 min (esforço `medium` basta) |
| **total** | **4–5** | **10–25 min** |

Ler 50 páginas leva horas; o prefetch do capítulo seguinte cobre com folga. Esforço proposto: `high` em análise, síntese e revisão; `medium` no plano (`MARGEM_ESFORCO_PLANO`).

## 12. Avaliação

**Referência** (`avaliacao/referencias/<nome>.md`, escrita pelo leitor, citações literais):

```
# Referência · Mixtape cap. 3 · argumentativa
documento: <id do documento>
secao: <id da seção>

## Essenciais
- A · tese · “Conditioning on a collider opens a backdoor path”
- F · hipotese · “Admitamos inicialmente que”

## Relações
- A -> K · desenvolve

## Retrospectivas
- F

## Dificuldades textuais
- H · premissa_implicita · “…”

## Não deveria marcar
- C · “…”
```

Cada citação é resolvida pelo mesmo resolvedor (prefixo opcional entre colchetes para desambiguar). Um item de referência casa com uma marca ou elemento quando as âncoras se sobrepõem em pelo menos metade da menor, no mesmo bloco.

**Métricas** (`servico/src/avaliacao/`, puras): cobertura dos essenciais (entre as marcas de saliência ≤ 2, e entre os elementos de centralidade ≤ 2); falsos positivos (marcas sobre "não deveria marcar"); precisão pelos vereditos do leitor (`confirmada`/(`confirmada`+`rejeitada`)); relações corretas (a relação da referência existe em qualquer direção); retrospectivas capturadas (o item está com centralidade 1 em r2 e não estava em r0); âncoras resolvidas; mudanças úteis da revisão (operações de r1→r2 sobre itens da referência); estabilidade em três execuções (Jaccard médio e mínimo das âncoras de saliência ≤ 2); custo (chamadas e duração).

**Comparação cega**: `npm run avaliar -- cega --camadas A,B` sorteia os rótulos ("Leitura 1", "Leitura 2"), grava o sorteio fora da vista (`~/.cache/margem/avaliacao/cega-<id>.json`) e põe os rótulos em `camada.rotulo`; o leitor mostra só o rótulo. `avaliar -- escolher <id> 1 "comentário"` registra a escolha; `avaliar -- revelar <id>` mostra qual era qual.

A referência também mede a V2 atual: é a linha de base contra a qual a pipeline nova precisa ganhar.

## 13. Integração, migração e divisão em jobs

Mantém-se: F1 (só para importação legada), V2 (leitura rápida de uma passagem), `parte`, `job`, `execucao_leitura`, `camada`, `marca`, executores, resolvedor de citações, SSE. Muda: `execucao_leitura.schema_versao` aceita 3; `marca.origem` aceita `projecao`; `parte` ganha `secao_id` e as colunas da análise local; `job` ganha `prioridade`; `camada` ganha `rotulo`.

Migrações: `0006_auditoria_fila.sql` (prioridade), `0007_compreensao.sql` (execução V3, `analise_local`, `modelo_capitulo` imutável, `lote_modelo`, `preparacao_capitulo`, `marca_elemento`, `plano_pedagogico`, `perfil_leitor`, `relacao_adotada`, `camada.rotulo`).

| Job | Escopo | Depende de |
|---|---|---|
| J26 | auditoria por chamada e o auditor, **para a V2 de hoje** | — |
| J27 | prioridade na fila | — |
| J28 | contratos da compreensão, aliases e aplicação de operações em `core/` | — |
| J29 | pipeline analisar → sintetizar → revisar, prompts, migração, projeção de marcas | J26–J28 |
| J30 | plano pedagógico, perfil do leitor, apresentação, rotas | J29 |
| J31 | leitor: leitura guiada, braquetes, adoção, estado de preparação | J30 |
| J32 | avaliação: referência, métricas, comparação cega | J28 |

Nesta entrega os sete saem juntos, em commits separados por área.

## 14. Decisões pendentes

1. **Papéis = funções atuais do modo** (recomendado) ou ampliar os modos já (`argumentativa@2` com premissa, objeção…). A avaliação dirá onde falta.
2. **Blocos como `B001` nos prompts novos** (recomendado): menos tokens, sem teto de 250 blocos.
3. **Elemento sem âncora é descartado** (recomendado), com diagnóstico.
4. **Relações relevantes** = pontas com centralidade ≤ 2 e confiança não baixa, ou retrospectivas (recomendado); ajustar depois de ver na tela.
5. **Projeção determinística primeiro** (recomendado); etapa editorial com modelo só se a avaliação pedir.
6. **V2 continua como "leitura rápida"** até a compreensão ganhar dela na referência (recomendado).
7. **Terceiro texto da referência**: não há capítulo de economia no corpus. Proposta: o capítulo 4 do Mixtape (resultados potenciais) no modo econômica, até você trazer um livro de economia que esteja lendo.
8. **Um perfil global** (recomendado) em vez de um por documento.
9. **Guardar toda a auditoria** (recomendado): um prompt de parte tem ~200 KB; um livro inteiro fica abaixo de 50 MB.
10. **Esforço**: `high` em análise, síntese e revisão, `medium` no plano (recomendado).
