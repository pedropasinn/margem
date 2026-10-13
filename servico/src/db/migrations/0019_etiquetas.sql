-- NOITE-JOB-tags-livres: preserva nomes, alvos e unicidade sem maiúsculas.
-- O limite de 1–40 caracteres e o trim já são exigidos pela migração 0009.
ALTER TABLE etiqueta DROP CONSTRAINT etiqueta_de_dificuldade;
