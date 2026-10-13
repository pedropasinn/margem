-- Notícias usa a fila e a biblioteca existentes. Publicar uma edição é idempotente por dia.
CREATE TABLE noticia_agenda (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  ativa boolean NOT NULL DEFAULT true,
  hora integer NOT NULL DEFAULT 7 CHECK (hora BETWEEN 0 AND 23)
);
INSERT INTO noticia_agenda (id) VALUES (true);
CREATE TABLE noticia_edicao (
  id ulid PRIMARY KEY,
  dia date NOT NULL UNIQUE,
  corte_em timestamptz NOT NULL,
  job_id ulid NOT NULL REFERENCES job(id),
  conteudo jsonb,
  documento_id ulid REFERENCES documento(id),
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE noticia_audio (
  edicao_id ulid PRIMARY KEY REFERENCES noticia_edicao(id),
  sha256_audio sha256 NOT NULL,
  sha256_roteiro sha256 NOT NULL,
  duracao_s double precision NOT NULL CHECK (duracao_s > 0 AND duracao_s <= 300),
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION preservar_edicao_noticia() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.dia <> OLD.dia OR NEW.corte_em <> OLD.corte_em OR NEW.job_id <> OLD.job_id
     OR (OLD.conteudo IS NOT NULL AND NEW.conteudo IS DISTINCT FROM OLD.conteudo) THEN
    RAISE EXCEPTION 'Edição publicada e entrada de notícias são imutáveis';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER noticia_edicao_preservada BEFORE UPDATE ON noticia_edicao
  FOR EACH ROW EXECUTE FUNCTION preservar_edicao_noticia();
CREATE TRIGGER noticia_audio_imutavel BEFORE UPDATE OR DELETE ON noticia_audio
  FOR EACH ROW EXECUTE FUNCTION recusar_mutacao();
