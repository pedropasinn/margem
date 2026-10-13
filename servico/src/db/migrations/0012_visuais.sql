-- 0012_visuais.sql — J70: visuais ancorados (imagem ou fluxograma gerado pelo Codex a pedido do Pedro).
--
-- O estado não mora aqui: vem do job da fila (`job_id`), que é a verdade de pendente, executando,
-- pronto e falhou. A linha guarda o pedido (tipo, alvo, texto do Pedro) e, depois da publicação,
-- o artefato. A imagem é um arquivo por hash em MARGEM_DADOS/visuais, copiado antes da transação.
-- Gerar de novo cria outra linha com `substitui`; excluir marca `apagado_em` (nada some em silêncio).
CREATE TABLE visual (
  id ulid PRIMARY KEY,
  versao_id ulid NOT NULL REFERENCES versao_texto(id),
  secao_id ulid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('imagem', 'diagrama')),
  alvo jsonb NOT NULL CHECK (alvo->>'tipo' IN ('trecho', 'bloco', 'capitulo')),
  pedido text CHECK (pedido IS NULL OR length(pedido) BETWEEN 1 AND 2000),
  job_id ulid REFERENCES job(id),
  artefato jsonb,
  sha256_imagem sha256,
  diagnosticos jsonb NOT NULL DEFAULT '[]'::jsonb,
  execucao jsonb,
  substitui ulid REFERENCES visual(id),
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  publicado_em timestamptz,
  apagado_em timestamptz,
  FOREIGN KEY (versao_id, secao_id) REFERENCES secao(versao_id, id),
  CHECK (substitui IS NULL OR substitui <> id),
  -- Artefato e data de publicação andam juntos; a imagem só existe no visual do tipo imagem.
  CHECK ((artefato IS NULL) = (publicado_em IS NULL)),
  CHECK (sha256_imagem IS NULL OR (tipo = 'imagem' AND artefato IS NOT NULL))
);
CREATE INDEX visual_do_capitulo ON visual (versao_id, secao_id, criado_em) WHERE apagado_em IS NULL;
CREATE UNIQUE INDEX visual_do_job ON visual (job_id) WHERE job_id IS NOT NULL;
