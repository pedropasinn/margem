-- revisao já contém o histórico textual do Codex (JSONB, J37).
ALTER TABLE anotacao ADD COLUMN revisao_edicao integer NOT NULL DEFAULT 1 CHECK (revisao_edicao > 0);
ALTER TABLE anotacao ADD COLUMN chave_cliente text;
CREATE UNIQUE INDEX anotacao_chave_cliente ON anotacao (chave_cliente) WHERE chave_cliente IS NOT NULL;
