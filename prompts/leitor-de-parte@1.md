# Leitor de parte · `leitor-de-parte@1`

Prompt versionado da primeira passagem de leitura. O serviço monta um diretório por parte com `metodo.md`, `texto.md`, `sumario.md`, `schema.json` e, quando houver, `continuidade.md`, e entrega este texto como instrução.

---

Você vai aplicar o método de leitura e marcação a **uma parte** de um texto maior.

Leia primeiro `metodo.md` inteiro. Depois leia `sumario.md` (a estrutura do documento e onde esta parte se encaixa) e, se existir, `continuidade.md` (o que as partes anteriores deste mesmo capítulo já registraram). Por fim leia integralmente `texto.md`.

## Como o texto chega

`texto.md` traz o texto em **blocos numerados e delimitados**, no formato:

```
⟦b:01JBLOCOEXEMPLO0000000000⟧ [paragrafo]
Texto do bloco, exatamente como está no documento.
⟦/b⟧
```

- `⟦b:…⟧` é o **identificador do bloco**; `⟦/b⟧` fecha o bloco. Nenhum dos dois faz parte do texto.
- O texto do bloco é tudo o que está entre a linha de abertura e `⟦/b⟧`, inclusive quebras de linha internas.
- O rótulo entre colchetes é o tipo do bloco (`paragrafo`, `lista`, `citacao`, `codigo`, `equacao`, `tabela`, `nota_rodape`, `epigrafe`, `legenda`, `capitulo`, `secao`).
- Blocos marcados como **`[contexto]`** estão ali só para você entender a continuidade: **não marque neles**.
- Não há números de página, não há posições e não há coordenadas. Não invente nenhum.

## O que devolver

Responda **apenas** com o JSON do schema `schema.json`, com estes campos:

### `marcas`

Uma entrada por marca, com:

- `bloco_id`: o identificador **copiado literalmente** de um bloco desta parte que não seja de contexto. Nunca invente, nunca abrevie, nunca use o id de outro arquivo.
- `citacao`: trecho **copiado literalmente** do texto daquele bloco. Contíguo, **dentro de um único bloco**, sem as marcas `⟦b:…⟧` e `⟦/b⟧`, sem o rótulo de tipo, sem reticências, sem correções ortográficas, sem juntar partes separadas. Ligaturas, aspas curvas, hífens e espaços são copiados como estão.
- `prefixo` e `sufixo`: o texto imediatamente antes e depois da citação **dentro do mesmo bloco**, até cerca de 40 caracteres cada, copiados literalmente. Use-os sempre que a citação puder aparecer mais de uma vez no bloco; se a citação começa ou termina no limite do bloco, use `""`.
- `funcao`: `tese`, `conceito`, `justificativa` ou `nenhuma`.
- `sublinhar`: lista (possivelmente vazia) de expressões **literais contidas na citação**, cada uma ocorrendo **uma única vez** dentro dela e sem sobreposição entre si.
- `comentario`: `null`, ou `{ "tipo", "rotulo", "texto" }` conforme as vozes do método.

Duas marcas com cor (`funcao` diferente de `nenhuma`) **não podem se sobrepor** no mesmo bloco.

### `recuperacao`

Para cada seção substantiva coberta por esta parte: `secao_id` (identificador que aparece em `sumario.md`) e de 1 a 4 `perguntas` que permitam recuperar o argumento sem consultar o texto.

### `mapa_da_secao`

Para cada seção coberta: `secao_id`, `afirmacao_principal` (uma frase), `definicoes`, `condicoes` e `duvidas_de_extracao` (trechos que pareceram truncados, embaralhados ou ilegíveis). É o insumo da auditoria de cobertura, não um resumo do texto.

### `resumo_da_parte`

De 3 a 8 frases, em português, com o que a próxima parte do mesmo capítulo precisa saber para não repetir nem contradizer esta: tese em curso, definições já fixadas, condições já enunciadas e o ponto em que o argumento parou. Sem citações longas.

### `limites`

O que ficou sem cobertura ou apresentou problema na entrada (bloco truncado, tabela ilegível, fórmula corrompida). Lista vazia se não houver.

### `leitura_integral`

`true` somente se você leu todos os blocos responsáveis desta parte.

## Regras que não se negociam

1. A citação é a âncora no texto. **Se ela não for literal, a marca é descartada pelo serviço.**
2. Uma citação por marca, num único bloco. Nada de trechos atravessando blocos.
3. `sublinhar` são substrings literais da citação, não paráfrases.
4. Não invente identificadores de bloco ou de seção; só ecoe os que recebeu.
5. Não produza ids de marca, offsets, páginas, datas ou cores: isso é do serviço.
6. Seja seletivo: não há cota. É aceitável deixar blocos sem marca.
7. Preserve negações, hipóteses, exceções e qualificações nas citações.
8. Não atribua ao leitor opiniões, dúvidas ou leituras que ele não expressou.
9. Não use busca na web; ela está desligada. Sem fonte, formule uma questão aberta.
10. Leia cada seção inteira antes de decidir suas marcas. Não pare no planejamento: produza o JSON completo. Responda apenas com o JSON.
