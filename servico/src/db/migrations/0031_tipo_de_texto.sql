-- v0.1 (J131) · Tipo de texto do documento e preparação à espera dele.
-- `tipo_de_texto` é um TipoDoDocumentoV1 (`contratos/src/tipos-de-texto.ts`): o tipo detectado pelo Codex
-- (job `identificar_tipo`, depois da canonização) ou escolhido pela pessoa. A escolha dela (origem
-- 'escolhido') nunca é sobrescrita por uma detecção. Nulo: ainda não detectado.
-- `preparacao_pedida` guarda o "Preparar leitura" pedido antes de o tipo ser conhecido ({ todos, em });
-- a identificação, ao publicar, começa a preparação e limpa a coluna.
ALTER TABLE documento ADD COLUMN tipo_de_texto jsonb
  CHECK (tipo_de_texto IS NULL OR (jsonb_typeof(tipo_de_texto) = 'object' AND tipo_de_texto->>'origem' IN ('detectado', 'escolhido')));
ALTER TABLE documento ADD COLUMN preparacao_pedida jsonb
  CHECK (preparacao_pedida IS NULL OR jsonb_typeof(preparacao_pedida) = 'object');
-- O que a pessoa pediu na janela "Preparar leitura" (v0.1): { itens: [...], em }. Os itens que dependem da
-- compreensão (flashcards, mapa, fluxograma) são pedidos capítulo a capítulo quando cada um fica pronto.
ALTER TABLE documento ADD COLUMN preparacao_itens jsonb
  CHECK (preparacao_itens IS NULL OR jsonb_typeof(preparacao_itens) = 'object');
-- Preferências gerais do leitor (uma linha por chave). 'preparacao': o que criar sozinho ao importar.
CREATE TABLE preferencia_geral (
  chave text PRIMARY KEY CHECK (chave ~ '^[a-z][a-z_]{0,39}$'),
  valor jsonb NOT NULL,
  atualizada_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
