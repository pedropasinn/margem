-- 0021_agente.sql — página "Perguntar": conversas com o agente que lê a biblioteca inteira.
--
-- Uma conversa é um fio de mensagens. A pergunta do Pedro guarda o job que a responde (`job_id`, o
-- mais recente: "tentar de novo" troca o job); o estado (na fila, pensando, falhou) vem do job.
-- A resposta do agente aponta a pergunta (`em_resposta_a`, única: publicar duas vezes é recusado) e
-- guarda as citações já conferidas pelo serviço, os artefatos (mapa, resumo, quadro, conceitos) e os
-- diagnósticos (citação recusada, Mermaid fora da régua).
CREATE TABLE agente_conversa (
  id ulid PRIMARY KEY,
  titulo text NOT NULL CHECK (length(titulo) BETWEEN 1 AND 200),
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  apagada_em timestamptz
);

CREATE TABLE agente_mensagem (
  id ulid PRIMARY KEY,
  conversa_id ulid NOT NULL REFERENCES agente_conversa(id),
  autor text NOT NULL CHECK (autor IN ('pedro', 'agente')),
  texto text NOT NULL CHECK (length(texto) BETWEEN 1 AND 200000),
  em_resposta_a ulid UNIQUE REFERENCES agente_mensagem(id),
  job_id ulid REFERENCES job(id),
  citacoes jsonb NOT NULL DEFAULT '[]'::jsonb,
  artefatos jsonb NOT NULL DEFAULT '[]'::jsonb,
  diagnosticos jsonb NOT NULL DEFAULT '[]'::jsonb,
  execucao jsonb,
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((autor = 'agente') = (em_resposta_a IS NOT NULL)),
  CHECK (autor = 'pedro' OR job_id IS NULL)
);
CREATE INDEX agente_mensagem_da_conversa ON agente_mensagem (conversa_id, criada_em, id);
CREATE INDEX agente_conversa_recentes ON agente_conversa (atualizada_em DESC) WHERE apagada_em IS NULL;
