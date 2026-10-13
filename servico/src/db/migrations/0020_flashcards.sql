-- 0020_flashcards.sql — flashcards do Pedro: cartões frente/verso ancorados num trecho e a repetição espaçada.
--
-- `flashcard`: um cartão por linha, sempre ancorado (bloco + intervalo + citação literal, resolvidos pelo
-- serviço) e preso ao capítulo (seção de nível 1) do trecho. `origem = 'ia'` vem do job `gerar_flashcards`
-- (o job fica na linha: publicação duplicada não acontece); `manual`, de uma seleção ou grifo.
-- `revisao_flashcard`: cada resposta (1 Errei, 2 Difícil, 3 Bom, 4 Fácil) com o agendamento que ela produziu
-- (SM-2 simplificado). O estado do cartão é a revisão mais recente; sem revisão, o cartão é novo e já entra
-- na fila do dia.
CREATE TABLE flashcard (
  id ulid PRIMARY KEY,
  documento_id ulid NOT NULL,
  versao_id ulid NOT NULL,
  secao_id ulid NOT NULL,
  bloco_id ulid NOT NULL,
  inicio_utf16 bigint NOT NULL,
  fim_utf16 bigint NOT NULL,
  citacao text NOT NULL CHECK (length(citacao) BETWEEN 1 AND 2000),
  prefixo text NOT NULL,
  sufixo text NOT NULL,
  frente text NOT NULL CHECK (length(btrim(frente)) BETWEEN 1 AND 1000),
  verso text NOT NULL CHECK (length(btrim(verso)) BETWEEN 1 AND 4000),
  origem text NOT NULL CHECK (origem IN ('ia', 'manual')),
  job_id ulid REFERENCES job(id),
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (inicio_utf16 >= 0 AND fim_utf16 > inicio_utf16),
  CHECK ((origem = 'ia') = (job_id IS NOT NULL)),
  CHECK (criado_em <= atualizado_em),
  FOREIGN KEY (documento_id, versao_id) REFERENCES versao_texto(documento_id, id),
  FOREIGN KEY (versao_id, secao_id) REFERENCES secao(versao_id, id),
  FOREIGN KEY (versao_id, bloco_id) REFERENCES bloco(versao_id, id)
);
CREATE INDEX flashcard_do_documento ON flashcard (documento_id, secao_id, criado_em);
CREATE INDEX flashcard_do_job ON flashcard (job_id) WHERE job_id IS NOT NULL;

CREATE TABLE revisao_flashcard (
  id ulid PRIMARY KEY,
  flashcard_id ulid NOT NULL REFERENCES flashcard(id) ON DELETE CASCADE,
  nota smallint NOT NULL CHECK (nota BETWEEN 1 AND 4),
  facilidade double precision NOT NULL CHECK (facilidade >= 1.3 AND facilidade <= 4),
  intervalo_dias integer NOT NULL CHECK (intervalo_dias >= 0),
  repeticoes integer NOT NULL CHECK (repeticoes >= 0),
  proxima_revisao timestamptz NOT NULL,
  revisado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (proxima_revisao >= revisado_em - interval '1 minute')
);
CREATE INDEX revisao_flashcard_do_cartao ON revisao_flashcard (flashcard_id, revisado_em DESC, id DESC);
