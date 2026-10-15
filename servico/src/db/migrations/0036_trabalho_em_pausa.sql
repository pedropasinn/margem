-- 0036_trabalho_em_pausa.sql — v0.1 (V-F1): o trabalho do Codex que ficou parado não volta a rodar sozinho.
--
-- Ao abrir o app (o worker partir), os jobs do Codex que esperam na fila há mais de algumas horas e as
-- preparações que esperavam o tipo do texto desde antes disso ficam "em pausa": o worker não os reserva e
-- o `seguirSemTipo` não as começa. A janela mostra "N trabalhos esperando" com Retomar, Ver e Descartar
-- (`servico/src/pausa/`). Pedidos novos, feitos depois da partida, não ganham a marca e rodam normal.
--
-- Só acrescenta duas colunas anuláveis: nenhuma linha existente muda, e um serviço anterior as ignora.
ALTER TABLE job ADD COLUMN retido_em timestamptz;
ALTER TABLE documento ADD COLUMN preparacao_retida_em timestamptz;
-- A lista dos trabalhos em pausa (poucos, consultada pela janela a cada meio minuto).
CREATE INDEX job_retido ON job (retido_em) WHERE retido_em IS NOT NULL;
