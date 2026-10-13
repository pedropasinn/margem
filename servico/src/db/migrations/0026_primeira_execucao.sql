-- J103: primeira execução de uma instalação local.
--
-- Uma linha só (a chave é sempre `true`). `concluida_em` nulo quer dizer que a tela de
-- boas-vindas da instalação ainda aparece; `exemplo_documento_id` guarda o documento de exemplo
-- semeado por ela, para abrir de novo sem duplicar.
--
-- Banco que já tem documentos (o servidor pessoal que existia antes do J103) nasce com a
-- primeira execução concluída: quem já usa o Margem não é recebido como instalação nova.
CREATE TABLE instalacao (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  primeira_execucao_concluida_em timestamptz,
  exemplo_documento_id ulid REFERENCES documento ON DELETE SET NULL
);
INSERT INTO instalacao (id, primeira_execucao_concluida_em)
SELECT true, CASE WHEN EXISTS (SELECT 1 FROM documento) THEN clock_timestamp() END;
