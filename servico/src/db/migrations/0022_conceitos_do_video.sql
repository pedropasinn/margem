-- noite2/video-popups · Conceitos programados de um vídeo (popups sobre o vídeo).
-- O Codex escolhe poucos momentos com um conceito que merece explicação curta; o serviço confere a
-- citação literal e resolve âncora e instante. Derivado imutável da mídia: outro pedido cria outra linha
-- (o leitor usa a mais recente). O estado "preparando/falhou" é o do job `conceitos_do_video`.
CREATE TABLE conceitos_video (
  id ulid PRIMARY KEY,
  midia_id ulid NOT NULL REFERENCES midia(id),
  versao_id ulid NOT NULL REFERENCES versao_texto(id),
  job_id ulid NOT NULL REFERENCES job(id),
  conteudo jsonb NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (job_id)
);
CREATE INDEX conceitos_video_da_midia ON conceitos_video (midia_id, criado_em DESC);
CREATE TRIGGER conceitos_video_imutavel BEFORE UPDATE OR DELETE ON conceitos_video
  FOR EACH ROW EXECUTE FUNCTION recusar_mutacao();
