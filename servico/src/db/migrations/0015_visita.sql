-- 0015_visita.sql — J91: visita guiada do livro.
--
-- `roteiro_visita`: o roteiro narrado de um capítulo (RoteiroGuiadoV1), gerado pelo Codex sobre uma
-- revisão imutável do modelo do capítulo e um perfil. `narracao_visita`: a voz de um roteiro
-- (NarracaoDaVisitaV1), gerada pela fábrica de voz; o MP3 mora por hash em MARGEM_DADOS/audio.
-- Os dois são derivados imutáveis: outra revisão, outro perfil ou outra voz criam outra linha.
-- O estado "preparando/falhou" não mora aqui: é o do job `roteirizar_visita`.
CREATE TABLE roteiro_visita (
  id ulid PRIMARY KEY,
  execucao_id ulid NOT NULL REFERENCES execucao_leitura(id),
  versao_id ulid NOT NULL REFERENCES versao_texto(id),
  secao_id ulid NOT NULL,
  modelo_id ulid NOT NULL REFERENCES modelo_capitulo(id),
  perfil_hash text NOT NULL,
  job_id ulid NOT NULL REFERENCES job(id),
  conteudo jsonb NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (versao_id, secao_id) REFERENCES secao(versao_id, id),
  UNIQUE (job_id)
);
CREATE INDEX roteiro_visita_do_capitulo ON roteiro_visita (execucao_id, secao_id, criado_em);
CREATE TRIGGER roteiro_visita_imutavel BEFORE UPDATE OR DELETE ON roteiro_visita
  FOR EACH ROW EXECUTE FUNCTION recusar_mutacao();

CREATE TABLE narracao_visita (
  id ulid PRIMARY KEY,
  roteiro_id ulid NOT NULL REFERENCES roteiro_visita(id),
  sha256_audio sha256 NOT NULL,
  job_colab text NOT NULL,
  conteudo jsonb NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (roteiro_id, sha256_audio)
);
CREATE INDEX narracao_visita_do_roteiro ON narracao_visita (roteiro_id, criado_em);
CREATE TRIGGER narracao_visita_imutavel BEFORE UPDATE OR DELETE ON narracao_visita
  FOR EACH ROW EXECUTE FUNCTION recusar_mutacao();
