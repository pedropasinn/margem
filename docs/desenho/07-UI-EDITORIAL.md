# Margem · UI editorial

> As rodadas antigas citadas aqui foram removidas do checkout em 25/09/2026. As referências visuais continuam acessíveis pelo [histórico de capturas](../ui-revisao/HISTORICO.md), no commit preservado.


> **A UI existente (capturas em `docs/ui-revisao/antes/`) é o cânone visual. Este documento autoriza reorganizar a composição e corrigir primitives; não autoriza substituir a identidade visual.**
>
> Não queríamos trocar a UI antiga por uma "UI editorial". Queríamos que a UI antiga se comportasse melhor como leitor editorial. (Correção de rumo, 24/09/2026, depois da rodada 1 do J20; ver a seção final.)

24 de setembro de 2026. Direção de UI/UX trazida, a partir de uma avaliação das telas depois do J18 (feita com o ChatGPT e aprovada). Onde este texto divergir da regra 7 de `AGENTS.md` ou de `06-F2.md` em matéria de composição visual, vale este. As capturas do estado avaliado estão em `docs/ui-revisao/antes/`.

## Diagnóstico

A implementação funcional está correta, mas parece uma aplicação interna em desenvolvimento. O Margem precisa parecer um **leitor editorial acabado**, com a interface desaparecendo durante a leitura.

- No leitor há cinco camadas horizontais antes do texto: casca → `Capítulo / Filtros / Camada / Atenção / Primeiro eu` → legenda de cores → `Aparência` → "Um caminho para a sua leitura". Parece um painel administrativo com um texto embaixo.
- Componentes destoam: `select` nativo, checkbox nativo em "Primeiro eu", `Reenfileirar` com cara de botão do navegador, `input type=file` nativo em Adicionar, `Cancelar` como link sublinhado perdido, botões com contorno + sombra inferior (quase neumórficos), raios e bordas parecidos mas não sistemáticos, retângulos com borda dentro de retângulos com borda.
- Infraestrutura aparece como conteúdo: `gpt-5.6-sol · high`, `revisar_consistencia`, `falhou · processo`, `reenfileirar`. Isso vai para um painel Diagnóstico.
- Na biblioteca sobra espaço sem função: o "Continuar lendo" é enorme para pouca informação, "Marcas na biblioteca" ocupa um card inteiro e a lista repete informação. No detalhe, o título fica dentro de um megacard vazio. Não é preciso "cardificar" tudo.

## Princípio

**TEXTO > MARCAS > NOTAS > CONTROLES > NAVEGAÇÃO.** Hoje a ordem está praticamente invertida.

## Leitor (prioridade absoluta)

- **Geometria (obrigatória).** **O texto fica centralizado na viewport**: o eixo da coluna de leitura (680–740 px) coincide com o centro da janela no computador, com `textLeft = 50vw − readingWidth/2`. A margem de notas (300–340 px) começa 40–64 px à direita do texto e **não participa** do cálculo que o centraliza. A rail de capítulos é overlay recolhível, ausente com um capítulo só, e **também não desloca o texto**: abrir capítulos não move o livro. Numa viewport de 1680 px com texto de 700 px, o texto vai de ~490 a ~1190, com ou sem margem visível. Para poesia curta, o leitor é quase livre de chrome.
- **Barra de leitura** numa linha só: `‹ Documento · Capítulo · Camada ▾ · Atenção ●●●○ · Aa · •••`. Filtros, origem, visibilidade, "Primeiro eu" e o restante vão para `•••`, e `Aa` abre só a aparência. Somem da tela principal o botão "Filtros", a legenda permanente das seis categorias, o botão textual "Aparência" e o select grande de Atenção. A legenda aparece compacta quando há marcas (`● Imagem ● Ritmo ● Voz ● Forma +2`) e fica acessível em "Marcas". "Um caminho para a sua leitura" não é uma camada fixa antes do texto.
- **Atenção 0–3** é um controle de quatro estados discretos (pontos ou segmentos), e não um `<select>`. **"Primeiro eu"** vira switch discreto, ou fica dentro de `•••`.
- **Margem sem cards**: número, categoria e texto, sem caixa, fundo nem borda. A cor aparece só no número, num pequeno marcador e talvez na categoria. O cabeçalho é `① IMAGEM` (nome da função do modo), no lugar de `1 → LEITURA`. A anotação do leitor é `P  HIPÓTESE`. Texto da nota em 14–15 px, com entrelinha ~1,5.
- **Posição das notas**: cada nota começa na altura do seu trecho, com `noteY = max(anchorY, fim_da_anterior + gap)` e **gap de 20–24 px**. Passar o mouse na nota intensifica o marca-texto correspondente e atenua levemente os outros; passar no marca-texto intensifica a nota. O clique abre o fio, as fontes, as conexões etc.
- **Seleção** abre um toolbar pequeno e contextual (como o do Medium ou do Notion) com `Anotar · Perguntar · Conectar`, e não uma janela.
- **Perguntar** não transforma a margem em chat. Uma conversa curta expande a nota do trecho na margem; uma conversa longa abre um **drawer** que não muda a largura nem a posição do texto.
- **Aparência (`Aa`)** é um popover de 320–360 px com tema (claro, escuro, sépia), tamanho (A− ━━●━━ A+), entrelinha (compacta, normal, ampla), largura (estreita, média, ampla), estilo das marcas (marca-texto, sublinhado, margem) e intensidade. As cores semânticas do método **não** entram aqui.
- **Filtros** ficam num popover de ~280 px: segmented `[ Todas | Confirmadas | Ocultas ]`, origem (select estilizado) e tipos (checkboxes do sistema).

## Biblioteca

"Bom dia, <nome>" não domina a viewport, e as estatísticas agregadas de marcas saem da primeira viewport. **Continuar lendo** é uma superfície arredondada da família anterior, mais baixa (~180–220 px), com eyebrow, formato, título, autor, capítulo, barra de progresso (≤ 700–800 px) e `Continuar →` num único bloco. Abaixo, `Biblioteca` com `Buscar` e `Arquivados`, e a lista numerada com título, autor · marcas, `Ler →` e filetes entre os itens, menos cardificada que a original, mas da mesma família.

## Detalhe do documento

Uma superfície de cabeçalho da família anterior, mais compacta que o megacard: formato e estado no topo, título, autor, `1 capítulo · 3 marcas · Markdown` e as ações `[Abrir →] [✧ Preparar leitura] •••` numa só composição, usando a largura da página. Abaixo, **Capítulos** (superfície com a lista numerada) e **Leituras** (`Literária · 24/09`). Modelo, esforço, worker, jobs, `revisar_consistencia`, erros, `Reenfileirar`/`Cancelar` e os limites da canonização vão para `••• → Diagnóstico` (painel ou drawer).

## Adicionar

Não há `input type=file` nativo. Um **dropzone** próprio ("Solte o arquivo aqui ou escolher", com `PDF · EPUB · MD · TXT`). O formato é **inferido** pela extensão. A escolha principal é `[ Arquivo ] [ Colar texto ]`. Título e autor podem vir preenchidos e são editáveis. "É poesia" vira "Tipo do texto: Automático ▾ (Prosa, Poesia…)". A faixa de páginas aparece só para PDF.

## Sistema

- **Tokens** de superfície (`--bg`, `--surface-1`, `--surface-2`), borda (`--border-subtle`, `--border-strong`), texto (`--text-primary`, `--text-secondary`, `--text-tertiary`), raio (`--radius-sm` 6, `--radius-md` 10, `--radius-lg` 16) e espaço (`--space-1` a `--space-7`: 4, 8, 12, 16, 24, 32, 48), nos três temas.
- **Primitives** únicas: `Button`, `IconButton`, `Select`, `Input`, `Switch`/`Checkbox`, `SegmentedControl`, `Popover`, `Drawer`. Nada de `<button>` estilizado ad hoc em cada página.
- **Botões da família original.** Preserve o caráter dos botões anteriores (pílula, peso, presença) e normalize estados, tamanhos e variantes. Os tokens de raio, borda, sombra e espaço são **derivados da UI anterior**, não inventados de novo.
- **Tipografia.** A serifa é exclusiva do conteúdo e a sans, da interface. Interface em sans de 13–15 px, peso 450–600. Prosa em serifa de **20–22 px**, entrelinha ~1,6 e **62–72 caracteres por linha**. Título do poema em serifa de 26–30 px. Nota marginal em sans de 14 px, entrelinha 1,45–1,55.
- **Estrutura por superfícies, não por caixas indiscriminadas.** Os cards e as superfícies arredondadas fazem parte da identidade existente e ficam. Saem só os aninhamentos e os containers que não expressam agrupamento semântico. Nunca transforme uma página numa sequência plana só para reduzir o número de cards.

## Ordem de prioridade

Reader → notas/margem → barra de leitura → primitives de formulário → Adicionar → detalhe do documento → Biblioteca.

## Processo exigido

Etapas: (1) inventário e auditoria; (2) tokens e primitives; (3) shell do leitor; (4) margem e anotações; (5) popovers e toolbar de seleção; (6) biblioteca; (7) detalhe; (8) adicionar; (9) responsividade; (10) screenshots e revisão visual. **Antes de considerar terminado**, gerar screenshots nas mesmas dimensões das capturas de `docs/ui-revisao/antes/` e fazer uma revisão comparativa, procurando controles browser-default, alinhamentos quebrados, excesso de bordas, whitespace acidental, estilos divergentes, texto fora do centro e notas mal alinhadas. Passar nos testes não basta: **uma segunda rodada de correções visuais** depois de olhar as capturas faz parte do trabalho.

## Correção de rumo (24/09/2026, depois da rodada 1 do J20)

A rodada 1 limpou em alguns pontos, mas **trocou a linguagem visual do Margem**: a biblioteca virou uma lista plana, com espaço morto, barra de progresso atravessando a página e "Continuar" isolado no extremo; o detalhe virou uma coluna estreita à esquerda com meia tela vazia; os botões ficaram genéricos; os selects continuam inaceitáveis; e o texto do leitor ficou 188 px à esquerda do centro (medido em 1440 e 1680 px). A reação foi excessiva: de card demais passou-se a estrutura visual de menos.

Critérios que valem a partir daqui:
1. Não alterar a identidade visual global (header, botões, containers, superfícies) só porque outra solução parece mais "editorial". Reaproveite ou reconstrua fielmente os primitives anteriores.
2. Cards continuam existindo. Saem só as caixas redundantes aninhadas.
3. Restaurar o caráter dos botões anteriores, com estados e variantes normalizados.
4. **Biblioteca.** "Continuar lendo" volta a ser uma superfície delimitada e coesa, mais baixa que a original (~180–220 px). Título, autor, capítulo, progresso (≤ 700–800 px) e ação formam **um bloco**. Continua sem "Bom dia, <nome>" dominante e sem estatísticas de marcas na primeira viewport. A lista abaixo fica menos cardificada, com filetes, `Buscar` e `Arquivados`.
5. **Detalhe.** Nada de coluna estreita perdida. Uma superfície de cabeçalho, mais compacta que a antiga, reúne título, autor, estado, metadados e ações. Capítulos e Leituras vêm abaixo, em superfícies próprias.
6. **Leitor.** Vale a geometria obrigatória da seção "Leitor", com o texto centrado na viewport.
7. A margem acompanha o texto: 300–340 px, começando 40–64 px depois dele, com as notas ancoradas nos trechos.
8. A barra do leitor fica compacta sem mudar de família visual: uma barra coerente e desenhada, e não uma sucessão de controles soltos.
9. **Um único primitive `Select`**, com todas as ocorrências migradas: altura consistente, mesmo fundo dos inputs, borda e raio do sistema, padding correto, texto centrado na vertical, chevron próprio, estados hover/focus/open/disabled, menu no mesmo tema, largura previsível, clipping e `z-index`/portal corretos, nada de aparência nativa. Confira que `appearance: none` não deixa o controle sem affordance nem com padding errado.
10. O mesmo para Checkbox, Switch, Input, seletor de arquivo e menus: nenhum componente com aparência browser-default.
11. Não mudar globalmente tokens de raio, borda, sombra ou espaço sem compará-los com os valores da UI anterior.
12. "Menos cards", "flat" e "editorial" não são objetivos em si. Os objetivos são legibilidade, foco, hierarquia, consistência e preservação da identidade.

Perguntas da revisão final: Ainda parece claramente a mesma aplicação das capturas anteriores? Os componentes têm a mesma família visual? O texto está geometricamente centralizado? As notas parecem margem do texto, e não coluna que empurra o texto? Algum controle parece HTML/browser-default? Há regiões enormes de espaço morto sem intenção? As ações relacionadas parecem pertencer ao mesmo bloco?

## Ajustes depois da mesclagem (24/09/2026, tarde)

- Com um texto aberto, a casca (header e barra inferior) some; a barra de leitura se divide nos extremos da página: `‹ Documento · ☰ Capítulos · Capítulo n` à esquerda e `Atenção · Aa · •••` à direita, a 24 px das bordas. A camada e a legenda das funções moram em `•••`.
- Sai o botão "Marcar capítulo como lido"; avançar pelo "Próximo capítulo" marca o atual. Anterior e próximo são dois cartões com o título do capítulo.
- **Largura do texto: 850 px por padrão** (Estreita 720, Média 850, Ampla 960, escalados pelo tamanho), ainda centrada na viewport; isso dá ~85 caracteres por linha em 22 px e substitui a faixa de 62–72. A margem de notas usa o espaço que sobra à direita (220–340 px, a 40 px do texto e a 24 px da borda) e passa para a folha abaixo de 1418 px.
- A barra de leitura não tem mais filete nem base cinza embaixo; só a linha de progresso.
