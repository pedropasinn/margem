-- 0009_etiqueta.sql — etiquetas (tags) do Pedro sobre uma marca ou uma anotação (`EtiquetaV1`).
--
-- O alvo é uma marca ou uma anotação da mesma versão: duas chaves estrangeiras, exatamente uma
-- preenchida, e a etiqueta some com o alvo. O nome é livre; a unicidade por alvo ignora maiúsculas.
CREATE TABLE IF NOT EXISTS etiqueta (
  id ulid PRIMARY KEY,
  versao_id ulid NOT NULL REFERENCES versao_texto,
  marca_id ulid REFERENCES marca ON DELETE CASCADE,
  anotacao_id ulid REFERENCES anotacao ON DELETE CASCADE,
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 40 AND nome = btrim(nome)),
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((marca_id IS NULL) <> (anotacao_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS etiqueta_unica_no_alvo ON etiqueta (coalesce(marca_id, anotacao_id), lower(nome));
CREATE INDEX IF NOT EXISTS etiqueta_da_versao ON etiqueta (versao_id, criada_em);
