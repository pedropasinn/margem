# Margem · decisões depois da revisão do GPT-6 Pro

20 de setembro de 2026. Fecha a rodada de desenho: `DESENHO-APLICACAO-LEITOR.md` (v0.1) + `_entrada/Balcao/L01-entrega.md` (crítica) → este documento (o que fica valendo). O desenho v0.1 permanece como registro; onde este texto divergir dele, vale este.

## 1. Leitura da crítica

A crítica acerta o alvo: o risco maior não é a escolha de banco ou de leitor, é uma revisão, reimportação ou retomada ligar uma anotação ao trecho errado sem que isso apareça. As três correções estruturais (versões imutáveis do texto, âncoras locais ao bloco, jobs com publicação idempotente) são aceitas na íntegra e viram contrato antes de qualquer implementação paralela. O recorte de F1 também é aceito: leitor corrido com marcas confiáveis e retomada, sem explicações, EPUB, paginação, cobertura nem embeddings.

Aceito sem ressalva:

- Blocos são a fonte canônica; `raw_text` é projeção determinística. Âncora = `{versaoId, blocoId, inicioUtf16, fimUtf16, citacao, prefixo, sufixo}` com a invariante `bloco.texto.slice(inicio, fim) === citacao`. O modelo devolve bloco + citação; o serviço resolve offsets.
- Fila durável no Postgres: `FOR UPDATE SKIP LOCKED`, concessão com `lease_token`, publicação em transação única, execução repetida tolerada e publicação duplicada proibida. Nada de `codex exec resume` como retomada: a parte é reexecutada a partir de uma entrada imutável.
- Executor Codex com perfil restrito: diretório de entrada isolado por job, `web_search="disabled"`, sem MCP, sem credenciais do banco no ambiente. `--sandbox read-only` não basta.
- Dois processos (API e worker) do mesmo projeto; só o Node escreve no banco; Python devolve manifesto/artefato por JSON.
- Disponibilidade do texto separada do estado de processamento; SSE notifica, banco é a verdade.
- `execucao_de_leitura` registrando versão do texto, plano de partes, versões de método/prompt/schema e modelo.
- Âncora perdida (`resolvida | ambigua | orfa`) é coisa diferente de marca rejeitada. Não sobreposição vale só para a camada das cores editoriais.
- Estados da marca separados: validade da âncora, visibilidade, avaliação humana (`nao_avaliada | confirmada | rejeitada`).
- Registros de revisão com operação, antes/depois, autor e lote, aplicados em ordem e idempotentes, no lugar do `historico[]` solto.
- Página original acessível em F1 para figuras, equações e tabelas, com a limitação registrada; nada de apresentar extração incompleta como texto integral.
- Testes de integração em Postgres real; sem SQLite.
- Explicar com contexto em camadas (núcleo, dependências explícitas, busca no documento, orientação derivada identificada como IA, manifesto com `contexto_snapshot`), prompt e schema de pontos tipados com apoios. Fica para F2, mas o contrato já nasce assim.
- Cobertura como auditoria seletiva orientada a risco (5 a 10% dos tokens), alimentada por um mapa compacto por seção produzido na primeira passagem. Fica para F4.
- Repositório novo `~/repo/margem/` desde já; o pipeline de `estudos/leitura-marcada/` vira referência de comparação e fonte dos módulos trazidos com origem registrada.
- Corrido em F1, inclusive no celular; colunas depois, sobre o mesmo renderizador.
- Adaptador legado isolado para o formato atual (`m01`, página do PDF, sublinhados como texto) e para a sessão do Horarium; a exportação declara perdas.

## 2. Onde discordo ou ajusto

| Ponto do GPT-6 | Decisão | Motivo |
| --- | --- | --- |
| Partes de 8 a 16 mil tokens | Padrão **capítulo inteiro até ~45 mil tokens** de texto-fonte; acima disso, cortar em fronteira de seção. Tamanho é parâmetro da `execucao_de_leitura`, para comparar. | No Mixtape, capítulos de 30 a 50 mil tokens foram lidos em 8 a 13 min com marcas bem localizadas e poucas funções trocadas; partes menores multiplicam chamadas (a cota da conta é o limite real) e as fronteiras, que são justamente onde a leitura perde contexto. A hipótese dele fica registrada para um teste A/B na mesma obra. |
| Dois slots de concorrência, teto quatro | Padrão **quatro**, com limite global compartilhado entre projetos no mesmo computador. | Quatro filas rodaram sem incidente; o gargalo da máquina é a soma de jobs Codex de todos os projetos, então o limite tem de ser global, não da Margem. |
| Sequencial dentro do capítulo | Aceito, com uma adição: quando o capítulo cabe numa parte só (o caso comum), não há sequência a manter; o registro de continuidade só entra quando há corte. | Evita gerar resumos para nada. |
| "Servidor pessoal local" em vez de "local-first" | Aceito o termo. Acrescento: a aplicação precisa abrir o texto e as marcas já carregadas mesmo com o worker parado, e o navegador guarda a última posição localmente até conseguir gravar. | É o que o leitor vai sentir no celular via Tailscale com a rede ruim da guest. |
| Backup e restauração em F1 | Aceito, mas simples: `pg_dump` diário + rsync da pasta de arquivos, com um teste de restauração no J10. | Sem isso, o primeiro livro lido de verdade fica preso a uma instância. |
| J10 exige celular real | Aceito, com o harness Playwright em 412×915 como gate automático e o celular real como conferência do leitor, não como bloqueio do job. | O Codex não tem o aparelho. |

Dois pontos que a crítica não trata e entram no contrato:

- **Cota do Codex** como estado de primeira classe do job (`adiado` com `not_before` lido do "usage limit"), e um único cão de guarda para todos os jobs Codex da máquina. Hoje isso é cron por projeto.
- **Método para o leitor**: o `SISTEMA-DE-LEITURA-E-MARCACAO-CODEX.md` fala em produzir PDF. O prompt de leitura recebe uma versão derivada (`prompts/metodo-leitor.md`) só com seleção, cores, sublinhado, símbolos, vozes e critérios; a parte de diagramação e verificação de PDF fica com o exportador. A versão do método entra na `execucao_de_leitura`.

## 3. Contratos a congelar (J01)

```
CanonicoV1     versao {id, hash_estrutural, motor, config}, secoes (árvore: id, nivel, titulo, bloco_inicio..fim),
               blocos [{id, ordem, tipo, texto, inline[] (itálico/código/nota), origens[] ({pagina_pdf, impressa, bbox}|{arquivo, xpath}|{linhas})}],
               assets [{id, tipo, caminho, hash, bloco_id?}], limites[]
ParteV1        {id, execucao_id, ordem, blocos_responsaveis[], blocos_contexto[], continuidade_anterior?, hash_entrada}
MarcaGeradaV1  {bloco_id, citacao, prefixo, sufixo, funcao, sublinhar[] (texto literal dentro da citação), comentario? {tipo, rotulo, texto}}
               + o serviço resolve → MarcaV1 {id, ancora, funcao, subfaixas[], comentario, origem, validade, visivel, avaliacao}
LoteRevisaoV1  {id, snapshot_base, operacoes[] ({marca_id, op, antes, depois, motivo}), autor, motivo_do_lote}
JobResultV1    {job_id, attempt, lease_token, artefato {caminho, hash}, diagnosticos[], modelo, duracao}
ProgressoV1    {versao_id, ancora, revisao_esperada, capitulos_concluidos[]}
ExecucaoLeituraV1 {id, versao_id, metodo_versao, prompt_versao, schema_versao, modelo, tamanho_parte, concorrencia, plano_partes[]}
```

Regras fixas: offsets em unidades UTF-16 relativos ao texto do bloco; SHA-256 dos bytes UTF-8; IDs ULID gerados pelo serviço (o modelo nunca cria id); campos desconhecidos são recusados; toda versão de texto é imutável.

## 4. F1 em jobs

A lista J00–J10 do GPT-6 é adotada como está, com estas adaptações à nossa operação:

- Repositório `~/repo/margem/` com `web/`, `servico/`, `motor/`, `contratos/`, `core/`, `fixtures/`, `docs/jobs/`. Worktrees em `~/repo/margem-wt/<job>`, removidas ao mesclar (máx. 6 vivas).
- Cada job tem `docs/jobs/Jnn-SPEC.md` e entrega `Jnn-RESULTADO.md`. Executor: Codex (`gpt-6-astra`, esforço alto), lançado por `systemd-run --user`, um `codex exec` por job, com o cão de guarda. Revisão cruzada do Claude em J01, J02, J05 e J06 (contratos, âncoras, executor, prompts), que são os pontos onde um erro contamina tudo.
- Fixtures: o Mixtape (`estudos/fontes-causal/mixtape-limpo.pdf`, 584 páginas) e seus 11 JSONs de marcas revisadas como corpus legado; um Markdown curto com Unicode difícil (emoji, combinantes, ligaturas) e um TXT colado; um PDF pequeno sintético com figura, equação e parágrafo que atravessa página.
- Executor falso do Codex em todos os testes; a chamada real só no J10, numa parte pequena.
- J00 e J01 rodam em série; J02, J03, J04, J05 em paralelo (4 slots); depois J06 e J08; depois J07; depois J09; J10 fecha.

Critério de F1 pronta, adotado do GPT-6: dá para ler, confiar na localização das marcas e retomar a leitura mesmo quando o processamento falha.

## 5. Pendências de decisão

1. Nome definitivo do repositório (`margem` é provisório).
2. Postgres local na máquina: instalar instância própria ou usar a que já serve outros projetos, com banco e papel `margem`.
3. Autorizar a abertura do repositório e o lançamento de J00 e J01 (os dois consomem pouca cota; os demais só depois dos contratos congelados).
