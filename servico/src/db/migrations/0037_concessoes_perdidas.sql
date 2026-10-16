-- 0037_concessoes_perdidas.sql — v0.2 (D-10): esperar a cota não gasta as tentativas do job.
--
-- `attempt` sobe a cada tentativa (adiamento por cota incluído) e numera a pasta da auditoria de cada
-- uma; o teto de reentregas automáticas (`MAXIMO_TENTATIVAS`) passa a contar só as concessões que
-- venceram. Um job adiado três vezes pela cota não vai mais direto a `tentativas_esgotadas` na primeira
-- concessão perdida.
--
-- Só acrescenta uma coluna com padrão: as linhas existentes começam com zero perdas, e um serviço
-- anterior a ignora.
ALTER TABLE job ADD COLUMN concessoes_perdidas integer NOT NULL DEFAULT 0 CHECK (concessoes_perdidas >= 0);
