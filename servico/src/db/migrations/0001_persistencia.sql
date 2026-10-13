CREATE DOMAIN ulid AS text CHECK (VALUE ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$');
CREATE DOMAIN sha256 AS text CHECK (VALUE ~ '^[0-9a-f]{64}$');

CREATE TABLE documento (
  id ulid PRIMARY KEY, titulo text NOT NULL, autor text, formato text NOT NULL
    CHECK (formato IN ('pdf','pdf_foto','epub','md','txt','colado')),
  sha256_original sha256 NOT NULL, origem_caminho text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(), arquivado_em timestamptz
);
CREATE TABLE versao_texto (
  id ulid PRIMARY KEY, documento_id ulid NOT NULL REFERENCES documento,
  numero integer NOT NULL CHECK (numero > 0), hash_estrutural sha256 NOT NULL,
  canonico jsonb NOT NULL, motor text NOT NULL, config jsonb NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (documento_id, numero), UNIQUE (documento_id, id)
);
CREATE FUNCTION recusar_mutacao_texto() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Texto canônico imutável: %', TG_TABLE_NAME USING ERRCODE = '55000'; END;
$$;
CREATE TRIGGER versao_imutavel BEFORE UPDATE OR DELETE ON versao_texto
  FOR EACH ROW EXECUTE FUNCTION recusar_mutacao_texto();
CREATE TABLE bloco (
  versao_id ulid NOT NULL REFERENCES versao_texto, id ulid NOT NULL,
  ordem bigint NOT NULL CHECK (ordem >= 0), tipo text NOT NULL, texto text NOT NULL,
  inline jsonb NOT NULL, origens jsonb NOT NULL, asset_id ulid,
  idioma_busca regconfig NOT NULL CHECK (idioma_busca IN ('english'::regconfig,'portuguese'::regconfig,'simple'::regconfig)),
  busca tsvector GENERATED ALWAYS AS (to_tsvector(idioma_busca, texto)) STORED,
  PRIMARY KEY (versao_id, id), UNIQUE (versao_id, ordem)
);
CREATE INDEX bloco_busca ON bloco USING gin(busca);
CREATE TABLE secao (
  versao_id ulid NOT NULL REFERENCES versao_texto, id ulid NOT NULL,
  nivel integer NOT NULL CHECK (nivel > 0), titulo text NOT NULL, ordem bigint NOT NULL CHECK (ordem >= 0),
  bloco_inicio ulid NOT NULL, bloco_fim ulid NOT NULL, PRIMARY KEY (versao_id, id),
  FOREIGN KEY (versao_id, bloco_inicio) REFERENCES bloco(versao_id,id),
  FOREIGN KEY (versao_id, bloco_fim) REFERENCES bloco(versao_id,id)
);
CREATE TABLE asset (
  versao_id ulid NOT NULL REFERENCES versao_texto, id ulid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('imagem','pagina')), caminho text NOT NULL,
  sha256 sha256 NOT NULL, bloco_id ulid, PRIMARY KEY (versao_id,id),
  FOREIGN KEY (versao_id,bloco_id) REFERENCES bloco(versao_id,id)
);
ALTER TABLE bloco ADD FOREIGN KEY (versao_id,asset_id) REFERENCES asset(versao_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER bloco_imutavel BEFORE UPDATE OR DELETE ON bloco FOR EACH ROW EXECUTE FUNCTION recusar_mutacao_texto();
CREATE TRIGGER secao_imutavel BEFORE UPDATE OR DELETE ON secao FOR EACH ROW EXECUTE FUNCTION recusar_mutacao_texto();
CREATE TRIGGER asset_imutavel BEFORE UPDATE OR DELETE ON asset FOR EACH ROW EXECUTE FUNCTION recusar_mutacao_texto();
CREATE TABLE execucao_leitura (
  id ulid PRIMARY KEY, versao_id ulid NOT NULL REFERENCES versao_texto,
  metodo_versao text NOT NULL, prompt_versao text NOT NULL, schema_versao integer NOT NULL CHECK (schema_versao = 1),
  modelo text NOT NULL, esforco text NOT NULL, tamanho_parte_tokens bigint NOT NULL CHECK (tamanho_parte_tokens > 0),
  concorrencia integer NOT NULL CHECK (concorrencia > 0), plano jsonb NOT NULL, criada_em timestamptz NOT NULL,
  UNIQUE (versao_id,id)
);
CREATE TABLE parte (
  id ulid PRIMARY KEY, execucao_id ulid NOT NULL REFERENCES execucao_leitura,
  ordem bigint NOT NULL CHECK (ordem >= 0), blocos_responsaveis jsonb NOT NULL, blocos_contexto jsonb NOT NULL,
  continuidade_anterior text, hash_entrada sha256 NOT NULL, estado text NOT NULL DEFAULT 'fila',
  UNIQUE (execucao_id,ordem)
);
CREATE TABLE job (
  id ulid PRIMARY KEY, tipo text NOT NULL, documento_id ulid REFERENCES documento,
  versao_id ulid REFERENCES versao_texto, parte_id ulid REFERENCES parte,
  dedup_key text NOT NULL UNIQUE, input_snapshot_hash sha256 NOT NULL,
  estado text NOT NULL DEFAULT 'fila' CHECK (estado IN ('fila','reservado','ok','falhou','adiado','cancelado')),
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0), not_before timestamptz,
  lease_owner text, lease_token ulid, lease_expires_at timestamptz, heartbeat_at timestamptz,
  cancel_requested_at timestamptz, output_artifact_hash sha256, error_code text,
  diagnosticos jsonb NOT NULL DEFAULT '[]', criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((estado = 'reservado') = (lease_token IS NOT NULL AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  FOREIGN KEY (documento_id,versao_id) REFERENCES versao_texto(documento_id,id),
  UNIQUE (versao_id,id)
);
CREATE INDEX job_fila ON job(estado,not_before);
CREATE TABLE evento_job (
  id bigserial PRIMARY KEY, job_id ulid NOT NULL REFERENCES job,
  quando timestamptz NOT NULL DEFAULT clock_timestamp(), tipo text NOT NULL, detalhe jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE marca (
  id ulid PRIMARY KEY, versao_id ulid NOT NULL REFERENCES versao_texto, bloco_id ulid NOT NULL,
  inicio_utf16 bigint NOT NULL, fim_utf16 bigint NOT NULL, citacao text NOT NULL, prefixo text NOT NULL, sufixo text NOT NULL,
  funcao text NOT NULL CHECK (funcao IN ('tese','conceito','justificativa','nenhuma')),
  subfaixas jsonb NOT NULL, comentario jsonb,
  origem text NOT NULL CHECK (origem IN ('parte','revisao_consistencia','revisao_cobertura','manual','importacao')),
  validade text NOT NULL CHECK (validade IN ('resolvida','ambigua','orfa')), visivel boolean NOT NULL,
  avaliacao text NOT NULL CHECK (avaliacao IN ('nao_avaliada','confirmada','rejeitada')),
  execucao_id ulid REFERENCES execucao_leitura, job_id ulid REFERENCES job,
  criada_em timestamptz NOT NULL, criada_em_literal text NOT NULL, atualizada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (criada_em = criada_em_literal::timestamptz),
  CHECK (inicio_utf16 >= 0 AND fim_utf16 > inicio_utf16),
  FOREIGN KEY (versao_id,bloco_id) REFERENCES bloco(versao_id,id),
  FOREIGN KEY (versao_id,execucao_id) REFERENCES execucao_leitura(versao_id,id),
  FOREIGN KEY (versao_id,job_id) REFERENCES job(versao_id,id)
);
CREATE INDEX marca_bloco ON marca(versao_id,bloco_id);
CREATE TABLE lote_revisao (
  id ulid PRIMARY KEY, execucao_id ulid REFERENCES execucao_leitura, versao_id ulid NOT NULL REFERENCES versao_texto,
  snapshot_base sha256 NOT NULL, autor text NOT NULL CHECK (autor IN ('pedro','codex','claude')),
  motivo text NOT NULL, operacoes jsonb NOT NULL, aplicado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (versao_id,execucao_id) REFERENCES execucao_leitura(versao_id,id)
);
CREATE TABLE revisao_marca (
  id bigserial PRIMARY KEY, lote_id ulid NOT NULL REFERENCES lote_revisao, ordem bigint NOT NULL,
  marca_id ulid NOT NULL, op text NOT NULL, antes jsonb NOT NULL, depois jsonb NOT NULL, motivo text NOT NULL,
  UNIQUE (lote_id,ordem)
);
-- A marca pode ter sido removida; a trilha histórica deliberadamente não tem FK para marca.
CREATE INDEX revisao_marca_historico ON revisao_marca(marca_id);
CREATE TABLE lote_recusado (
  id ulid PRIMARY KEY, versao_id ulid NOT NULL REFERENCES versao_texto,
  lote jsonb NOT NULL, motivo text NOT NULL, recusado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE progresso (
  documento_id ulid PRIMARY KEY REFERENCES documento, versao_id ulid NOT NULL, bloco_id ulid NOT NULL,
  inicio_utf16 bigint NOT NULL, fim_utf16 bigint NOT NULL, citacao text NOT NULL, prefixo text NOT NULL, sufixo text NOT NULL,
  revisao bigint NOT NULL CHECK (revisao > 0), capitulos_concluidos jsonb NOT NULL, atualizado_em timestamptz NOT NULL,
  CHECK (inicio_utf16 >= 0 AND fim_utf16 > inicio_utf16),
  FOREIGN KEY (documento_id,versao_id) REFERENCES versao_texto(documento_id,id),
  FOREIGN KEY (versao_id,bloco_id) REFERENCES bloco(versao_id,id)
);
CREATE TABLE exportacao (
  id ulid PRIMARY KEY, documento_id ulid NOT NULL REFERENCES documento, versao_id ulid NOT NULL,
  snapshot_marcas sha256 NOT NULL, tipo text NOT NULL, caminho text NOT NULL, sha256 sha256 NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (documento_id,versao_id) REFERENCES versao_texto(documento_id,id)
);
