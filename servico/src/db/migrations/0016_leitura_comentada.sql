-- 0016_leitura_comentada.sql — J92: leitura comentada integral.
--
-- `leitura_comentada`: o capítulo inteiro em frases lidas e as pausas do professor (LeituraComentadaV1),
-- sobre uma revisão do modelo do capítulo e um conjunto de grifos (`fontes_hash`). `narracao_leitura`: a
-- voz montada de uma leitura (NarracaoDaLeituraV1); o MP3 mora por hash em MARGEM_DADOS/audio.
-- Derivados imutáveis: outra revisão, outros grifos ou outra voz criam outra linha.
CREATE TABLE leitura_comentada (
  id ulid PRIMARY KEY,
  execucao_id ulid NOT NULL REFERENCES execucao_leitura(id),
  versao_id ulid NOT NULL REFERENCES versao_texto(id),
  secao_id ulid NOT NULL,
  modelo_id ulid NOT NULL REFERENCES modelo_capitulo(id),
  fontes_hash sha256 NOT NULL,
  job_id ulid NOT NULL REFERENCES job(id),
  conteudo jsonb NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (versao_id, secao_id) REFERENCES secao(versao_id, id),
  UNIQUE (job_id)
);
CREATE INDEX leitura_comentada_do_capitulo ON leitura_comentada (execucao_id, secao_id, criado_em);
CREATE TRIGGER leitura_comentada_imutavel BEFORE UPDATE OR DELETE ON leitura_comentada
  FOR EACH ROW EXECUTE FUNCTION recusar_mutacao();

CREATE TABLE narracao_leitura (
  id ulid PRIMARY KEY,
  leitura_id ulid NOT NULL REFERENCES leitura_comentada(id),
  sha256_audio sha256 NOT NULL,
  conteudo jsonb NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (leitura_id, sha256_audio)
);
CREATE INDEX narracao_leitura_da_leitura ON narracao_leitura (leitura_id, criado_em);
CREATE TRIGGER narracao_leitura_imutavel BEFORE UPDATE OR DELETE ON narracao_leitura
  FOR EACH ROW EXECUTE FUNCTION recusar_mutacao();
