# Persistência J03

`migrar(pool)` aplica os SQLs numerados numa transação, sob lock de migração. A tabela `migracao` guarda nome e SHA-256; mudar um SQL aplicado é erro. Uma instalação nova e migradores concorrentes usam a mesma função.

Os repositórios recebem `Transacao`, produzido exclusivamente pelo callback de `comTransacao(pool, fn)`. Não capture erros dentro desse callback para depois confirmar escritas parciais. Não passe um client com `BEGIN` manual nem abra transação aninhada. Leituras também aceitam esse client. O pool da aplicação vem de `db/conexao.ts`; a configuração continua exclusivamente em `db/configuracao.ts`.

```ts
await comTransacao(pool, async cliente => {
  const documento = await documentos.criar(cliente, {
    ...canonico.documento, origem_caminho: caminho,
  });
  const versao = await documentos.criarVersao(cliente, documento.id, canonico);
  // Criar execução e todas as partes neste mesmo callback quando houver um plano.
  return versao;
});
```

`execucoes.criar(cliente, execucaoV1)` recebe os IDs atribuídos pelo planejador do serviço. `partes.criar(cliente, execucaoId, partesV1)` valida e grava o plano completo. Não gera IDs por inferência nem consulta o core. O idioma do canônico escolhe `portuguese` para pt/pt-BR, `english` para en/en-US e `simple` para demais idiomas (os nomes das configurações também são aceitos). A configuração é gravada em cada bloco para permitir a coluna gerada e o índice GIN.

`marcas.publicarMarcas(cliente, versaoId, marcasV1)` recebe marcas já resolvidas. Confere contratos, âncoras resolvidas, pertencimento à versão/execução/job e camada editorial, incluindo marcas já persistidas. A versão é travada durante a operação para serializar publicações e lotes concorrentes. `ConflitoEditorial.pares` contém os IDs em conflito. Para saída de worker, chamar dentro de `jobs.publicar`:

```ts
await jobs.publicar(pool, job.id, token, async cliente => {
  await marcas.publicarMarcas(cliente, versaoId, marcasResolvidas);
  // Outras escritas do mesmo resultado usam este cliente.
}, hashDoArtefato);
```

`reservar`, `heartbeat`, `publicar`, `falhar`, `cancelar` e `expirarConcessoes` recebem o pool e abrem transações curtas próprias. `enfileirar` recebe `Transacao` para compor com criação do documento/plano. Nenhuma transação permanece aberta enquanto o executor trabalha. O TTL padrão é 60.000 ms, ajustável na reserva e no heartbeat. Tentativas começam em 1; expiração e adiamento avançam a tentativa uma vez. Cancelamento é imediato e revoga a concessão. Heartbeat, falha e publicação exigem token vigente; a publicação confere a concessão novamente após o callback. O hash de artefato pode ser persistido com o evento; verificar conteúdo/caminho do arquivo pertence ao chamador.

`marcas.aplicarLote(cliente, loteV1)` retorna `aplicado`, `ja_aplicado` ou `recusado`. Snapshot divergente e operações inválidas lançam erro. A reaplicação de ID já publicado nunca altera marcas, mesmo após outros lotes. Uma revisão de codex sobre marca com avaliação/visibilidade alterada pelo leitor é recusada integralmente; `lote_recusado` guarda o lote e o motivo, sem criar lote aplicado ou trilha de operação executada. **O chamador deve tratar `recusado` como recusa e confirmar a transação para preservar o diagnóstico**, sem anunciar revisão aplicada. O retorno explícito evita que uma exceção apague esse registro. A proteção humana inclui remoção e demais mudanças da marca protegida.

`progresso.gravar(cliente, progressoV1)` considera revisão inicial 0, retorna o registro com revisão incrementada e recusa âncoras/capítulos alheios ao documento. `ProgressoObsoleto.revisao_atual` informa a revisão a recarregar. A data enviada é armazenada, mas a revisão é quem decide a ordem das gravações.

A data literal de criação da marca é preservada junto do timestamp SQL: a conversão automática do PostgreSQL para UTC ou a redução de precisão não pode mudar `hashMarcas` nem o `antes` de uma remoção. As FKs de `revisao_marca` apontam ao lote, não à marca, para a trilha sobreviver à remoção da marca.
