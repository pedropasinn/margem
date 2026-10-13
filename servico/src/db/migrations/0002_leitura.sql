-- 0002_leitura.sql — colunas que o J06 registrou como faltantes (J06-RESULTADO, seção
-- "Coluna ou tabela que falta na migração 0001"). Sem elas, recuperação, mapa da seção,
-- resumo da parte e o resultado da revisão só existiam em JSON no diretório de artefatos,
-- fora do banco e fora do alcance da API do J07.
ALTER TABLE parte
  ADD COLUMN resumo_da_parte text,
  ADD COLUMN recuperacao jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN mapa_da_secao jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN limites jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN leitura_integral boolean,
  ADD CONSTRAINT parte_estado_valido CHECK (estado IN ('fila','ok','falhou'));

ALTER TABLE lote_revisao
  ADD COLUMN consistencia_das_cores text,
  ADD COLUMN observacoes jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN ignoradas jsonb NOT NULL DEFAULT '[]';
