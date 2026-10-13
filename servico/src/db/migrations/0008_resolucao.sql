-- 0008_resolucao.sql — J34: resolução passo a passo de exercícios recortados de um documento.
--
-- A sessão inteira é uma `ResolucaoV1` em `dados` (validada pelo serviço a cada escrita); as colunas
-- repetem só o que se consulta. A imagem do recorte fica em disco, sob a pasta do documento, pelo hash.
CREATE TABLE IF NOT EXISTS resolucao (
  id ulid PRIMARY KEY,
  documento_id ulid NOT NULL REFERENCES documento,
  versao_id ulid NOT NULL REFERENCES versao_texto,
  dados jsonb NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (dados->>'id' = id AND dados->>'documento_id' = documento_id AND dados->>'versao_id' = versao_id)
);
CREATE INDEX IF NOT EXISTS resolucao_do_documento ON resolucao(documento_id, criada_em DESC);
