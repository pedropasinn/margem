-- 0007_compreensao.sql — J29/J30: compreensão do capítulo (docs/desenho/10-MODELO-DO-CAPITULO.md).
--
-- A execução de compreensão é uma linha de `execucao_leitura` com `schema_versao = 3`: ganha de graça
-- a camada (trigger `camada_da_execucao`), a proveniência e o plano de partes. O resto são tabelas
-- novas. Revisões do modelo, lotes e planos são imutáveis.

ALTER TABLE execucao_leitura DROP CONSTRAINT IF EXISTS execucao_leitura_schema_versao_valida;
ALTER TABLE execucao_leitura ADD CONSTRAINT execucao_leitura_schema_versao_valida CHECK (schema_versao IN (1, 2, 3));
-- Versões dos quatro prompts da compreensão (`ExecucaoCompreensaoV1.prompts`); nulas fora da V3.
ALTER TABLE execucao_leitura ADD COLUMN IF NOT EXISTS prompts jsonb;
ALTER TABLE execucao_leitura ADD CONSTRAINT execucao_leitura_prompts_da_v3 CHECK ((schema_versao = 3) = (prompts IS NOT NULL));

-- A parte sabe de que capítulo é (nula nas execuções antigas e nos blocos fora de capítulo).
ALTER TABLE parte ADD COLUMN IF NOT EXISTS secao_id ulid;

-- Marca projetada de um elemento do modelo.
ALTER TABLE marca DROP CONSTRAINT IF EXISTS marca_origem_check;
ALTER TABLE marca ADD CONSTRAINT marca_origem_check
  CHECK (origem IN ('parte','revisao_consistencia','revisao_cobertura','manual','importacao','projecao'));

-- Rótulo de uma camada (comparação cega, J32): quando existe, o leitor mostra só ele.
ALTER TABLE camada ADD COLUMN IF NOT EXISTS rotulo text;

CREATE OR REPLACE FUNCTION recusar_mutacao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% é imutável', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$;

-- Análise local de uma parte, já resolvida (elementos com âncoras e ids do serviço).
CREATE TABLE analise_local (
  parte_id ulid PRIMARY KEY REFERENCES parte,
  job_id ulid NOT NULL REFERENCES job,
  conteudo jsonb NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER analise_local_imutavel BEFORE UPDATE OR DELETE ON analise_local FOR EACH ROW EXECUTE FUNCTION recusar_mutacao();

-- Revisões do modelo do capítulo (r0, r1, r2…): `ModeloDoCapituloV1` inteiro em `conteudo`.
CREATE TABLE modelo_capitulo (
  id ulid PRIMARY KEY,
  execucao_id ulid NOT NULL REFERENCES execucao_leitura,
  secao_id ulid NOT NULL,
  revisao integer NOT NULL CHECK (revisao >= 0),
  estagio text NOT NULL CHECK (estagio IN ('analise_local','sintese','revisao')),
  conteudo jsonb NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (execucao_id, secao_id, revisao)
);
CREATE TRIGGER modelo_capitulo_imutavel BEFORE UPDATE OR DELETE ON modelo_capitulo FOR EACH ROW EXECUTE FUNCTION recusar_mutacao();

-- Lotes de operações entre revisões (`LoteDoModeloV1`).
CREATE TABLE lote_modelo (
  id ulid PRIMARY KEY,
  execucao_id ulid NOT NULL REFERENCES execucao_leitura,
  secao_id ulid NOT NULL,
  estagio text NOT NULL CHECK (estagio IN ('sintese','revisao')),
  base_id ulid NOT NULL REFERENCES modelo_capitulo,
  resultado_id ulid NOT NULL UNIQUE REFERENCES modelo_capitulo DEFERRABLE INITIALLY DEFERRED,
  conteudo jsonb NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER lote_modelo_imutavel BEFORE UPDATE OR DELETE ON lote_modelo FOR EACH ROW EXECUTE FUNCTION recusar_mutacao();

-- Resultado de cada janela da revisão global; a última janela junta todas e publica a revisão.
CREATE TABLE revisao_janela (
  execucao_id ulid NOT NULL REFERENCES execucao_leitura,
  secao_id ulid NOT NULL,
  janela integer NOT NULL CHECK (janela >= 0),
  job_id ulid NOT NULL REFERENCES job,
  base_id ulid NOT NULL REFERENCES modelo_capitulo,
  saida jsonb NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (execucao_id, secao_id, janela)
);

-- Pedido de preparação de um capítulo: marca o capítulo como pedido e guarda a prioridade que as
-- etapas seguintes herdam. O estado em si é derivado dos jobs.
CREATE TABLE preparacao_capitulo (
  execucao_id ulid NOT NULL REFERENCES execucao_leitura,
  secao_id ulid NOT NULL,
  prioridade smallint NOT NULL CHECK (prioridade BETWEEN 0 AND 100),
  pedida_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (execucao_id, secao_id)
);

-- De que elemento (e de que revisão) veio uma marca projetada.
CREATE TABLE marca_elemento (
  marca_id ulid PRIMARY KEY REFERENCES marca,
  elemento_id ulid NOT NULL,
  modelo_id ulid NOT NULL REFERENCES modelo_capitulo,
  regra text NOT NULL
);
CREATE INDEX marca_elemento_por_elemento ON marca_elemento(elemento_id);

-- Plano pedagógico (`PlanoPedagogicoV1`): um por revisão do modelo e perfil do leitor.
CREATE TABLE plano_pedagogico (
  id ulid PRIMARY KEY,
  execucao_id ulid NOT NULL REFERENCES execucao_leitura,
  secao_id ulid NOT NULL,
  modelo_id ulid NOT NULL REFERENCES modelo_capitulo,
  perfil_hash text NOT NULL CHECK (perfil_hash ~ '^[0-9a-f]{64}$'),
  conteudo jsonb NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (modelo_id, perfil_hash)
);
CREATE TRIGGER plano_pedagogico_imutavel BEFORE UPDATE OR DELETE ON plano_pedagogico FOR EACH ROW EXECUTE FUNCTION recusar_mutacao();

-- Perfil do leitor, só de acréscimo: cada edição é uma revisão.
CREATE TABLE perfil_leitor (
  revisao integer PRIMARY KEY CHECK (revisao >= 0),
  conteudo jsonb NOT NULL,
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER perfil_leitor_imutavel BEFORE UPDATE OR DELETE ON perfil_leitor FOR EACH ROW EXECUTE FUNCTION recusar_mutacao();

-- Relação semântica adotada pelo Pedro como conexão dele.
CREATE TABLE relacao_adotada (
  relacao_id ulid PRIMARY KEY,
  modelo_id ulid NOT NULL REFERENCES modelo_capitulo,
  conexao_id ulid NOT NULL UNIQUE REFERENCES conexao,
  tipo_original text NOT NULL,
  adotada_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
