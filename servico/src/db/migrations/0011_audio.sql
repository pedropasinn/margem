-- Áudio é derivado imutável. Arquivo por hash precede a publicação da referência.
CREATE TABLE audio (
  id ulid PRIMARY KEY,
  versao_id ulid NOT NULL REFERENCES versao_texto(id),
  secao_id ulid NOT NULL,
  conteudo jsonb NOT NULL,
  sha256_audio sha256 NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (versao_id,secao_id) REFERENCES secao(versao_id,id),
  UNIQUE (versao_id, secao_id, sha256_audio)
);
CREATE TRIGGER audio_imutavel BEFORE UPDATE OR DELETE ON audio
  FOR EACH ROW EXECUTE FUNCTION recusar_mutacao_texto();
