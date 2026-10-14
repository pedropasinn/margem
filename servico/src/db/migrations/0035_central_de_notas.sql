-- 0035_central_de_notas.sql — Central de Notas (J145): a página Notas reúne tudo o que foi produzido em todos os documentos. As relações e
-- as dificuldades que o Codex deixou dentro do modelo do capítulo (`modelo_capitulo.conteudo`, JSON grande)
-- ganham um índice consultável, para a lista paginada não ler o JSON de todos os capítulos a cada pedido.
--
-- Só acrescenta: tabela derivada, função, gatilho e índices. As revisões do modelo são imutáveis
-- (modelo_capitulo_imutavel), então o índice de uma revisão nunca precisa ser refeito; ele nasce no INSERT
-- (gatilho) e, para as revisões que já existiam, aqui mesmo. Só as revisões >= 2 (as que o leitor mostra).

CREATE TABLE item_do_modelo (
  modelo_id ulid NOT NULL REFERENCES modelo_capitulo(id),
  -- Id da relação ou da dificuldade dentro do modelo (o mesmo de relacao_adotada.relacao_id e de
  -- dificuldade.codex_dificuldade_id).
  item_id text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('relacao', 'dificuldade')),
  execucao_id ulid NOT NULL,
  secao_id ulid NOT NULL,
  revisao integer NOT NULL,
  -- A âncora principal: a do elemento de origem (relação) ou a primeira da dificuldade.
  versao_id ulid NOT NULL,
  bloco_id ulid NOT NULL,
  inicio_utf16 bigint NOT NULL,
  fim_utf16 bigint NOT NULL,
  citacao text NOT NULL,
  -- Tipo da relação semântica (`pressupoe`…) ou da dificuldade (`premissa_implicita`…).
  chave text NOT NULL,
  -- Explicação da relação ou descrição da dificuldade.
  texto text NOT NULL,
  -- Relação: a âncora principal do elemento de destino (pode faltar num modelo antigo).
  destino_versao_id ulid,
  destino_bloco_id ulid,
  destino_inicio_utf16 bigint,
  destino_fim_utf16 bigint,
  destino_citacao text,
  -- Relação: os elementos das duas pontas no modelo; apagar um deles (V-T8, `elemento_apagado`) tira a relação.
  origem_id text,
  destino_id text,
  criada_em timestamptz NOT NULL,
  PRIMARY KEY (modelo_id, tipo, item_id)
);

CREATE OR REPLACE FUNCTION indexar_modelo_do_capitulo(m modelo_capitulo) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF m.revisao < 2 THEN RETURN; END IF;
  INSERT INTO item_do_modelo (modelo_id, item_id, tipo, execucao_id, secao_id, revisao, versao_id, bloco_id,
    inicio_utf16, fim_utf16, citacao, chave, texto, destino_versao_id, destino_bloco_id, destino_inicio_utf16,
    destino_fim_utf16, destino_citacao, origem_id, destino_id, criada_em)
  SELECT m.id, r->>'id', 'relacao', m.execucao_id, m.secao_id, m.revisao,
    o.a->>'versao_id', o.a->>'bloco_id', (o.a->>'inicio_utf16')::bigint, (o.a->>'fim_utf16')::bigint, o.a->>'citacao',
    r->>'tipo', coalesce(r->>'explicacao', ''),
    d.a->>'versao_id', d.a->>'bloco_id', (d.a->>'inicio_utf16')::bigint, (d.a->>'fim_utf16')::bigint, d.a->>'citacao',
    r->>'origem_id', r->>'destino_id', m.criada_em
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.conteudo->'relacoes') = 'array' THEN m.conteudo->'relacoes' ELSE '[]'::jsonb END) r
  CROSS JOIN LATERAL (SELECT e->'ancoras'->0 AS a FROM jsonb_array_elements(m.conteudo->'elementos') e
    WHERE e->>'id' = r->>'origem_id' LIMIT 1) o
  LEFT JOIN LATERAL (SELECT e->'ancoras'->0 AS a FROM jsonb_array_elements(m.conteudo->'elementos') e
    WHERE e->>'id' = r->>'destino_id' LIMIT 1) d ON true
  WHERE r->>'id' IS NOT NULL AND o.a->>'bloco_id' IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO item_do_modelo (modelo_id, item_id, tipo, execucao_id, secao_id, revisao, versao_id, bloco_id,
    inicio_utf16, fim_utf16, citacao, chave, texto, criada_em)
  SELECT m.id, x->>'id', 'dificuldade', m.execucao_id, m.secao_id, m.revisao,
    x->'ancoras'->0->>'versao_id', x->'ancoras'->0->>'bloco_id', (x->'ancoras'->0->>'inicio_utf16')::bigint,
    (x->'ancoras'->0->>'fim_utf16')::bigint, x->'ancoras'->0->>'citacao', x->>'tipo', coalesce(x->>'descricao', ''), m.criada_em
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.conteudo->'dificuldades') = 'array' THEN m.conteudo->'dificuldades' ELSE '[]'::jsonb END) x
  WHERE x->>'id' IS NOT NULL AND x->'ancoras'->0->>'bloco_id' IS NOT NULL
  ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION indexar_modelo_ao_publicar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM indexar_modelo_do_capitulo(NEW);
  RETURN NEW;
END $$;

CREATE TRIGGER modelo_capitulo_indexa_itens AFTER INSERT ON modelo_capitulo
  FOR EACH ROW EXECUTE FUNCTION indexar_modelo_ao_publicar();

SELECT indexar_modelo_do_capitulo(mc) FROM modelo_capitulo mc WHERE mc.revisao >= 2;

-- Exercícios recortados de um PDF: o primeiro bloco de uma página, para pôr a resolução na ordem do texto.
CREATE INDEX IF NOT EXISTS bloco_pagina_do_pdf ON bloco (versao_id, ((origens->0->>'pagina')::integer), ordem)
  WHERE origens->0->>'tipo' = 'pdf';
-- A camada de execução mais recente de cada modo, por versão.
CREATE INDEX IF NOT EXISTS camada_da_versao ON camada (versao_id, modo_id, criada_em DESC) WHERE tipo = 'execucao';
