-- 0004_f2.sql — J16: camadas e saliência nas marcas, modo na execução, anotações,
-- conversas, conexões e a preferência "primeiro eu".
--
-- Idempotente de propósito: rodar este arquivo de novo sobre um banco já migrado não
-- muda nada (IF NOT EXISTS, restrições guardadas por nome, backfill só onde falta).

-- ULID gerado no banco, só para o backfill dos lotes de importação desta migração.
-- 48 bits de milissegundos (10 caracteres, o primeiro entre 0 e 7) e 80 bits do md5 de
-- um UUID aleatório (16 caracteres). O serviço continua gerando os seus ULIDs em TS.
CREATE OR REPLACE FUNCTION margem_ulid(momento timestamptz DEFAULT clock_timestamp()) RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  alfabeto constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  ms bigint := floor(extract(epoch FROM momento) * 1000)::bigint;
  aleatorio bytea := decode(md5(gen_random_uuid()::text), 'hex');
  tempo text := '';
  resto text := '';
BEGIN
  FOR i IN 1..10 LOOP
    tempo := substr(alfabeto, (ms % 32)::int + 1, 1) || tempo;
    ms := ms / 32;
  END LOOP;
  FOR i IN 0..15 LOOP
    resto := resto || substr(alfabeto, (get_byte(aleatorio, i) % 32) + 1, 1);
  END LOOP;
  RETURN tempo || resto;
END;
$$;

-- ------------------------------------------------------------------ execução com modo

ALTER TABLE execucao_leitura
  ADD COLUMN IF NOT EXISTS modo_id text NOT NULL DEFAULT 'argumentativa',
  ADD COLUMN IF NOT EXISTS modo_revisao integer NOT NULL DEFAULT 1,
  -- As execuções de F1 só produziram saliência 2 (toda marca V1 convertida é 2).
  ADD COLUMN IF NOT EXISTS nivel_de_atencao_alvo smallint NOT NULL DEFAULT 2;
-- `schema_versao` 2 é a execução V2 (`MarcaGeradaV2`).
ALTER TABLE execucao_leitura DROP CONSTRAINT IF EXISTS execucao_leitura_schema_versao_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'execucao_leitura_schema_versao_valida') THEN
    ALTER TABLE execucao_leitura ADD CONSTRAINT execucao_leitura_schema_versao_valida CHECK (schema_versao IN (1, 2));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'execucao_leitura_modo_valido') THEN
    ALTER TABLE execucao_leitura ADD CONSTRAINT execucao_leitura_modo_valido CHECK (
      modo_id ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$' AND modo_revisao >= 1 AND nivel_de_atencao_alvo BETWEEN 1 AND 3);
  END IF;
END $$;

-- ------------------------------------------------------------------ camadas

-- Cada execução de leitura é uma camada (com o mesmo id), e cada lote de importação
-- também. A não sobreposição editorial vale dentro de uma camada.
CREATE TABLE IF NOT EXISTS camada (
  id ulid PRIMARY KEY,
  versao_id ulid NOT NULL REFERENCES versao_texto,
  tipo text NOT NULL CHECK (tipo IN ('execucao', 'importacao')),
  execucao_id ulid UNIQUE,
  modo_id text NOT NULL CHECK (modo_id ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'),
  modo_revisao integer NOT NULL CHECK (modo_revisao >= 1),
  criada_em timestamptz NOT NULL,
  UNIQUE (versao_id, id),
  CHECK (execucao_id IS NULL OR execucao_id = id),
  CHECK (tipo = 'importacao' OR execucao_id IS NOT NULL),
  FOREIGN KEY (versao_id, execucao_id) REFERENCES execucao_leitura(versao_id, id)
);

-- Uma execução de importação (J06/J08: `modelo = 'importacao'`) é camada de importação.
CREATE OR REPLACE FUNCTION camada_da_execucao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO camada (id, versao_id, tipo, execucao_id, modo_id, modo_revisao, criada_em)
  VALUES (NEW.id, NEW.versao_id,
    CASE WHEN coalesce(NEW.modelo_pedido, NEW.modelo) = 'importacao' THEN 'importacao' ELSE 'execucao' END,
    NEW.id, NEW.modo_id, NEW.modo_revisao, NEW.criada_em)
  ON CONFLICT (id) DO NOTHING;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS execucao_cria_camada ON execucao_leitura;
CREATE TRIGGER execucao_cria_camada AFTER INSERT ON execucao_leitura
  FOR EACH ROW EXECUTE FUNCTION camada_da_execucao();

INSERT INTO camada (id, versao_id, tipo, execucao_id, modo_id, modo_revisao, criada_em)
SELECT e.id, e.versao_id,
  CASE WHEN coalesce(e.modelo_pedido, e.modelo) = 'importacao' THEN 'importacao' ELSE 'execucao' END,
  e.id, e.modo_id, e.modo_revisao, e.criada_em
FROM execucao_leitura e
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------ marcas em V2

ALTER TABLE marca
  ADD COLUMN IF NOT EXISTS camada_id ulid,
  ADD COLUMN IF NOT EXISTS saliencia smallint,
  ADD COLUMN IF NOT EXISTS modo_id text,
  ADD COLUMN IF NOT EXISTS modo_revisao integer;

-- `funcao` deixa o enum de F1: é a chave de uma função do modo (ou `nenhuma`),
-- conferida pelo serviço contra o modo gravado na marca.
ALTER TABLE marca DROP CONSTRAINT IF EXISTS marca_funcao_check;

-- Backfill com `marcaV1ParaV2`: modo `argumentativa@1`, saliência 2, camada = execução.
UPDATE marca SET camada_id = execucao_id WHERE camada_id IS NULL AND execucao_id IS NOT NULL;
-- Marcas sem execução: um lote de importação por documento e versão, criado aqui.
INSERT INTO camada (id, versao_id, tipo, execucao_id, modo_id, modo_revisao, criada_em)
SELECT margem_ulid(min(m.criada_em)), m.versao_id, 'importacao', NULL, 'argumentativa', 1, min(m.criada_em)
FROM marca m WHERE m.camada_id IS NULL AND m.execucao_id IS NULL
GROUP BY m.versao_id;
UPDATE marca m SET camada_id = (
  SELECT c.id FROM camada c WHERE c.versao_id = m.versao_id AND c.tipo = 'importacao' AND c.execucao_id IS NULL
  ORDER BY c.criada_em, c.id LIMIT 1)
WHERE m.camada_id IS NULL AND m.execucao_id IS NULL;
UPDATE marca SET saliencia = 2 WHERE saliencia IS NULL;
UPDATE marca SET modo_id = 'argumentativa', modo_revisao = 1 WHERE modo_id IS NULL OR modo_revisao IS NULL;

ALTER TABLE marca
  ALTER COLUMN camada_id SET NOT NULL,
  ALTER COLUMN saliencia SET NOT NULL,
  ALTER COLUMN modo_id SET NOT NULL,
  ALTER COLUMN modo_revisao SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marca_funcao_slug') THEN
    ALTER TABLE marca ADD CONSTRAINT marca_funcao_slug CHECK (funcao ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$' AND length(funcao) <= 40);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marca_saliencia_valida') THEN
    ALTER TABLE marca ADD CONSTRAINT marca_saliencia_valida CHECK (saliencia BETWEEN 1 AND 3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marca_modo_valido') THEN
    ALTER TABLE marca ADD CONSTRAINT marca_modo_valido CHECK (modo_id ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$' AND modo_revisao >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marca_camada_da_execucao') THEN
    ALTER TABLE marca ADD CONSTRAINT marca_camada_da_execucao CHECK (execucao_id IS NULL OR camada_id = execucao_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marca_camada_fk') THEN
    ALTER TABLE marca ADD CONSTRAINT marca_camada_fk FOREIGN KEY (versao_id, camada_id) REFERENCES camada(versao_id, id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS marca_camada ON marca(versao_id, camada_id);

-- ------------------------------------------------------------------ anotações do Pedro

CREATE TABLE IF NOT EXISTS anotacao (
  id ulid PRIMARY KEY,
  versao_id ulid NOT NULL REFERENCES versao_texto, bloco_id ulid NOT NULL,
  inicio_utf16 bigint NOT NULL, fim_utf16 bigint NOT NULL,
  citacao text NOT NULL, prefixo text NOT NULL, sufixo text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('impressao', 'observacao', 'hipotese', 'duvida', 'fonte', 'nota')),
  texto text NOT NULL,
  fonte jsonb,
  marca_id ulid REFERENCES marca ON DELETE SET NULL,
  criada_em timestamptz NOT NULL,
  atualizada_em timestamptz NOT NULL,
  CHECK (inicio_utf16 >= 0 AND fim_utf16 > inicio_utf16),
  CHECK ((tipo = 'fonte') = (fonte IS NOT NULL)),
  CHECK (criada_em <= atualizada_em),
  FOREIGN KEY (versao_id, bloco_id) REFERENCES bloco(versao_id, id)
);
CREATE INDEX IF NOT EXISTS anotacao_bloco ON anotacao(versao_id, bloco_id);

-- ------------------------------------------------------------------ conversas

CREATE TABLE IF NOT EXISTS conversa (
  id ulid PRIMARY KEY,
  versao_id ulid NOT NULL REFERENCES versao_texto, bloco_id ulid NOT NULL,
  inicio_utf16 bigint NOT NULL, fim_utf16 bigint NOT NULL,
  citacao text NOT NULL, prefixo text NOT NULL, sufixo text NOT NULL,
  marca_id ulid REFERENCES marca ON DELETE SET NULL,
  anotacao_id ulid REFERENCES anotacao ON DELETE SET NULL,
  estado text NOT NULL DEFAULT 'aberta' CHECK (estado IN ('aberta', 'arquivada')),
  criada_em timestamptz NOT NULL,
  CHECK (inicio_utf16 >= 0 AND fim_utf16 > inicio_utf16),
  FOREIGN KEY (versao_id, bloco_id) REFERENCES bloco(versao_id, id)
);
CREATE INDEX IF NOT EXISTS conversa_bloco ON conversa(versao_id, bloco_id);

CREATE TABLE IF NOT EXISTS mensagem (
  id ulid PRIMARY KEY,
  conversa_id ulid NOT NULL REFERENCES conversa,
  ordem integer NOT NULL CHECK (ordem >= 0),
  autor text NOT NULL CHECK (autor IN ('pedro', 'ia')),
  texto text NOT NULL,
  citacoes jsonb,
  contexto jsonb,
  execucao jsonb,
  -- Resposta da IA à pergunta do Pedro: no máximo uma por pergunta (publicação única).
  em_resposta_a ulid UNIQUE REFERENCES mensagem,
  job_id ulid REFERENCES job,
  criada_em timestamptz NOT NULL,
  UNIQUE (conversa_id, ordem),
  CHECK ((autor = 'ia') = (citacoes IS NOT NULL)),
  CHECK (autor = 'ia' OR (contexto IS NULL AND execucao IS NULL AND em_resposta_a IS NULL AND job_id IS NULL))
);

-- ------------------------------------------------------------------ conexões

CREATE TABLE IF NOT EXISTS conexao (
  id ulid PRIMARY KEY,
  versao_id ulid NOT NULL REFERENCES versao_texto, bloco_id ulid NOT NULL,
  inicio_utf16 bigint NOT NULL, fim_utf16 bigint NOT NULL,
  citacao text NOT NULL, prefixo text NOT NULL, sufixo text NOT NULL,
  destino_tipo text NOT NULL CHECK (destino_tipo IN ('trecho', 'documento', 'nota_externa')),
  destino_versao_id ulid, destino_bloco_id ulid,
  destino_inicio_utf16 bigint, destino_fim_utf16 bigint,
  destino_citacao text, destino_prefixo text, destino_sufixo text,
  destino_documento_id ulid REFERENCES documento,
  destino_caminho text, destino_titulo text,
  relacao text NOT NULL CHECK (relacao IN ('semelhanca', 'contraste', 'tensao', 'prerequisito', 'desenvolve', 'exemplo')),
  justificativa text NOT NULL,
  autor text NOT NULL CHECK (autor IN ('ia', 'pedro')),
  estado text NOT NULL CHECK (estado IN ('sugerida', 'aceita', 'rejeitada')),
  conversa_id ulid REFERENCES conversa,
  criada_em timestamptz NOT NULL,
  decidida_em timestamptz,
  CHECK (inicio_utf16 >= 0 AND fim_utf16 > inicio_utf16),
  CHECK ((estado = 'sugerida') = (decidida_em IS NULL)),
  CHECK (autor = 'ia' OR (estado = 'aceita' AND decidida_em = criada_em)),
  CHECK ((destino_tipo = 'trecho') = (destino_versao_id IS NOT NULL AND destino_bloco_id IS NOT NULL
    AND destino_inicio_utf16 IS NOT NULL AND destino_fim_utf16 IS NOT NULL
    AND destino_citacao IS NOT NULL AND destino_prefixo IS NOT NULL AND destino_sufixo IS NOT NULL)),
  CHECK ((destino_tipo = 'documento') = (destino_documento_id IS NOT NULL)),
  CHECK ((destino_tipo = 'nota_externa') = (destino_caminho IS NOT NULL AND destino_titulo IS NOT NULL)),
  FOREIGN KEY (versao_id, bloco_id) REFERENCES bloco(versao_id, id),
  FOREIGN KEY (destino_versao_id, destino_bloco_id) REFERENCES bloco(versao_id, id)
);
CREATE INDEX IF NOT EXISTS conexao_bloco ON conexao(versao_id, bloco_id);
CREATE INDEX IF NOT EXISTS conexao_destino_bloco ON conexao(destino_versao_id, destino_bloco_id) WHERE destino_tipo = 'trecho';

-- ------------------------------------------------------------------ preferências por documento

CREATE TABLE IF NOT EXISTS preferencia_documento (
  documento_id ulid PRIMARY KEY REFERENCES documento,
  primeiro_eu boolean NOT NULL DEFAULT false,
  camada_padrao ulid REFERENCES camada,
  atualizada_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
