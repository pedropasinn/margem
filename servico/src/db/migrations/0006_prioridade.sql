-- 0006_prioridade.sql — J27: prioridade mínima na fila (docs/desenho/10-MODELO-DO-CAPITULO.md §9).
--
-- Uma coluna e a ordenação: o capítulo aberto (100) passa à frente do seguinte (50) e de
-- reprocessamentos (20). Nada de scheduler. Jobs antigos ficam com 50 e a ordem de hoje.
ALTER TABLE job ADD COLUMN IF NOT EXISTS prioridade smallint NOT NULL DEFAULT 50;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_prioridade_valida') THEN
    ALTER TABLE job ADD CONSTRAINT job_prioridade_valida CHECK (prioridade BETWEEN 0 AND 100);
  END IF;
END $$;
DROP INDEX IF EXISTS job_fila;
CREATE INDEX IF NOT EXISTS job_fila_prioridade ON job(estado, prioridade DESC, criado_em, id);
