-- 0033_apagar.sql — v0.1 (V-T8): cancelar o que se pediu ao Codex sem deixar rastro e apagar o que foi feito.
--
-- 1. As tabelas imutáveis da compreensão (análise local, revisões do modelo, lotes, planos), da visita, da
--    leitura comentada e dos conceitos do vídeo continuam recusando UPDATE sempre, e DELETE fora de um
--    apagamento pedido pela pessoa. O serviço liga `SET LOCAL margem.apagando = 'sim'` só dentro da
--    transação de "Cancelar" ou "Apagar" (`servico/src/apagar/`): assim uma análise apagada some de verdade
--    (nada sobra para a exportação nem para a idempotência da preparação), sem abrir a porta para edições.
CREATE OR REPLACE FUNCTION recusar_mutacao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('margem.apagando', true) = 'sim' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% é imutável', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$;

-- 2. Um item da compreensão apagado pela pessoa (uma relação, uma dificuldade, o elemento de um grifo): as
--    revisões do modelo são imutáveis e os planos citam relações e elementos pelo id, então o item sai da
--    leitura por esta lista, aplicada a tudo o que o leitor vê. Apagar a análise do capítulo apaga também
--    estas linhas.
CREATE TABLE elemento_apagado (
  execucao_id ulid NOT NULL REFERENCES execucao_leitura(id),
  secao_id ulid NOT NULL,
  item_id ulid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('elemento', 'relacao', 'dificuldade')),
  apagado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (execucao_id, item_id)
);
CREATE INDEX elemento_apagado_do_capitulo ON elemento_apagado (execucao_id, secao_id);
