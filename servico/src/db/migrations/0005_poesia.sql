-- J19: a ingestão de texto pode pedir poesia (`--poesia` do motor, J15) para md, txt e colado.
-- O pedido é do documento: o worker que canoniza o lê daqui, e ele entra no instantâneo do job.
ALTER TABLE documento ADD COLUMN IF NOT EXISTS poesia boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documento_poesia_so_texto') THEN
    ALTER TABLE documento ADD CONSTRAINT documento_poesia_so_texto CHECK (NOT poesia OR formato IN ('md','txt','colado'));
  END IF;
END $$;
