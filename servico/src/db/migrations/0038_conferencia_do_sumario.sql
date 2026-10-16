-- 0038_conferencia_do_sumario.sql — v0.2 (J164): a conferência do sumário de EPUB e PDF novos.
--
-- Uma linha por versão conferida (só a primeira versão de um EPUB ou PDF, com a conferência ligada nas
-- Configurações). `suspeitas` são as heurísticas locais; sem nenhuma, a linha nasce `ok` e o Codex não é
-- chamado. Com suspeita, o job `conferir_sumario` grava em `resposta` o `ConferenciaDoSumarioV1` validado
-- (a `proposta` só fica se passou nas regras do serviço) e o estado vira `ok` ou `suspeito`.
--
-- "Usar o sumário sugerido" põe o estado em `aplicada`: a apresentação do sumário passa a usar a proposta
-- (outro título e nível para seções que já existem). Nada no texto, nas seções do canônico, nas análises
-- nem nos grifos muda; "Manter" (`mantida`) volta ao sumário do canônico. A versão é imutável, então
-- esta é uma tabela ao lado dela, não uma versão nova.
--
-- Tabela nova: nenhuma linha existente muda, e um serviço anterior a ignora.
CREATE TABLE conferencia_sumario (
  versao_id ulid PRIMARY KEY REFERENCES versao_texto(id),
  documento_id ulid NOT NULL REFERENCES documento(id),
  estado text NOT NULL CHECK (estado IN ('conferindo','ok','suspeito','aplicada','mantida')),
  suspeitas jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- O sumário que o próprio arquivo declara, lido na execução (para conferir as palavras da proposta).
  sumario_original jsonb,
  resposta jsonb,
  job_id ulid,
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizada_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX conferencia_sumario_documento ON conferencia_sumario (documento_id);
