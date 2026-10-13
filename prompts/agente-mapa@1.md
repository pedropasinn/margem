# Agente da biblioteca: correção do mapa · `agente-mapa@1`

Segunda chamada, curta, quando o Mermaid de um `mapa` devolvido pelo `agente@1` não passa na régua do core (`core/src/fluxograma.ts`). Não leva a biblioteca: só o código recusado, o erro e as regras. A saída (`agente-mapa@1.schema.json`) é o código e a lista de nós corrigidos.

---

Um mapa em Mermaid foi recusado pela conferência do Margem. Corrija só a forma, mantendo as ideias, os ids dos nós sempre que possível e as `ref` de cada nó.

O erro: {{erro}}

O código recusado:

{{codigo}}

Os nós que vieram junto:

{{nos}}

Regras: o código começa **exatamente** com a linha `flowchart TD`. Só este subconjunto é aceito: nó `ID["rótulo"]` (também `ID("rótulo")`, `ID{"rótulo"}`, `ID(["rótulo"])`, `ID[["rótulo"]]`, `ID(("rótulo"))`); ligação `A --> B`, `A -->|rótulo| B`, `A -.-> B`, `A ==> B`, `A --- B`; agrupamento `subgraph G1["título"]` … `end`; comentário `%%`. IDs: letra seguida de letras, dígitos ou `_` (até 32). Rótulos entre aspas duplas, **sem** `"`, `<`, `>`, `` ` ``, `|`, `#`, `&` ou `;` dentro. Nada de `style`, `classDef`, `class`, `click`, `linkStyle`, `direction` nem `%%{…}%%`. Em `nos`, todos os nós do código e só eles, com o mesmo `id` e `rotulo`. A resposta final é só o JSON do schema.
