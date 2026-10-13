-- 0003_operacao.sql — J14: rotas de operação e proveniência.
--
-- `documento.arquivado_em` e o estado `cancelado` do job já existem desde a 0001; aqui
-- entra só o que faltava para as rotas novas, para a proveniência da execução e para o
-- SSE por LISTEN/NOTIFY.

-- Faixa de páginas pedida na ingestão de um PDF (inclusiva, 1 em diante). Nula = inteiro.
ALTER TABLE documento
  ADD COLUMN paginas_inicio integer,
  ADD COLUMN paginas_fim integer,
  ADD CONSTRAINT documento_faixa_de_paginas CHECK (
    (paginas_inicio IS NULL AND paginas_fim IS NULL)
    OR (paginas_inicio >= 1 AND paginas_fim >= paginas_inicio AND formato = 'pdf'));
CREATE INDEX documento_arquivado ON documento(arquivado_em) WHERE arquivado_em IS NOT NULL;

-- Proveniência: `modelo`/`esforco` passam a ser os que o executor declarou ao publicar a
-- primeira parte; o que a configuração pediu fica em `*_pedido`. Partes que divergem da
-- primeira são registradas em `divergencias`, visíveis no detalhe do documento.
ALTER TABLE execucao_leitura
  ADD COLUMN modelo_pedido text,
  ADD COLUMN esforco_pedido text,
  ADD COLUMN proveniencia text NOT NULL DEFAULT 'configuracao'
    CHECK (proveniencia IN ('configuracao','executor')),
  ADD COLUMN divergencias jsonb NOT NULL DEFAULT '[]';
UPDATE execucao_leitura SET modelo_pedido = modelo, esforco_pedido = esforco;

-- Todo evento de job avisa quem escuta, na mesma transação que o grava: o NOTIFY só é
-- entregue no COMMIT, e um ROLLBACK o descarta junto com a linha.
CREATE FUNCTION avisar_evento_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('margem_evento', NEW.id::text);
  RETURN NULL;
END;
$$;
CREATE TRIGGER evento_job_notifica AFTER INSERT ON evento_job
  FOR EACH ROW EXECUTE FUNCTION avisar_evento_job();
