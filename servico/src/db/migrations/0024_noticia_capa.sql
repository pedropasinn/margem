-- A capa é independente da edição imutável e do áudio.
CREATE TABLE noticia_capa (
  edicao_id ulid PRIMARY KEY REFERENCES noticia_edicao(id),
  conteudo jsonb NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER noticia_capa_imutavel BEFORE UPDATE OR DELETE ON noticia_capa
  FOR EACH ROW EXECUTE FUNCTION recusar_mutacao();
