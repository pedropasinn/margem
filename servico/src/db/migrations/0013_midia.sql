-- J71 · Mídia (vídeo ou áudio) de um documento cuja versão de texto é a transcrição.
-- O arquivo mora por hash em MARGEM_DADOS/midia e é gravado antes da referência; a linha é
-- imutável, e o alinhamento palavra→tempo (conteudo.palavras/frases) pertence à versão de texto:
-- uma recanonização publica outra linha para a nova versão, com o mesmo arquivo.
-- (0012 fica reservada ao J70.)
CREATE TABLE midia (
  id ulid PRIMARY KEY,
  documento_id ulid NOT NULL REFERENCES documento(id),
  versao_id ulid NOT NULL REFERENCES versao_texto(id),
  sha256 sha256 NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('video', 'audio')),
  conteudo jsonb NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (versao_id, sha256)
);
CREATE INDEX midia_por_documento ON midia (documento_id, criado_em DESC);
CREATE TRIGGER midia_imutavel BEFORE UPDATE OR DELETE ON midia
  FOR EACH ROW EXECUTE FUNCTION recusar_mutacao_texto();
