-- 0025_leitor.sql — J101: o domínio deixa de falar "pedro"; quem lê é o `leitor`.
--
-- O Margem passa a ser instalado por outras pessoas. Os valores 'pedro' das colunas de autoria e do
-- tipo da camada de grifos viram 'leitor', e as CHECK constraints passam a aceitar só o valor novo.
-- Os contratos acompanham em versão nova (`ConversaV2`, `ConexaoV2`, `ResolucaoV2`, `LoteRevisaoV2`);
-- as sessões de resolução guardadas como `ResolucaoV1` em `resolucao.dados` são convertidas para V2.
--
-- Segura em banco com dados: o migrador roda todas as migrações numa transação única (falha desfaz
-- tudo). A ordem é: soltar as constraints antigas, atualizar os dados, criar as constraints novas
-- (que validam as linhas existentes) e, por fim, conferir que nada ficou com 'pedro'.

-- 1. Constraints e índice que citam 'pedro'.
ALTER TABLE lote_revisao DROP CONSTRAINT IF EXISTS lote_revisao_autor_check;
ALTER TABLE mensagem DROP CONSTRAINT IF EXISTS mensagem_autor_check;
ALTER TABLE conexao DROP CONSTRAINT IF EXISTS conexao_autor_check;
ALTER TABLE camada DROP CONSTRAINT IF EXISTS camada_tipo_check;
ALTER TABLE camada DROP CONSTRAINT IF EXISTS camada_check1;
ALTER TABLE agente_mensagem DROP CONSTRAINT IF EXISTS agente_mensagem_autor_check;
ALTER TABLE agente_mensagem DROP CONSTRAINT IF EXISTS agente_mensagem_check1;
DROP INDEX IF EXISTS camada_do_pedro;

-- 2. Dados.
UPDATE lote_revisao SET autor = 'leitor' WHERE autor = 'pedro';
UPDATE mensagem SET autor = 'leitor' WHERE autor = 'pedro';
UPDATE conexao SET autor = 'leitor' WHERE autor = 'pedro';
UPDATE camada SET tipo = 'leitor' WHERE tipo = 'pedro';
UPDATE agente_mensagem SET autor = 'leitor' WHERE autor = 'pedro';

-- Sessões de resolução: `ResolucaoV1` → `ResolucaoV2` (versao 2; mensagem do leitor com autor 'leitor').
-- A ordem das mensagens é preservada (WITH ORDINALITY); só `versao` e `autor` mudam.
UPDATE resolucao r SET dados = jsonb_set(
  jsonb_set(r.dados, '{versao}', '2'::jsonb),
  '{mensagens}',
  COALESCE((
    SELECT jsonb_agg(
      CASE WHEN m.valor->>'autor' = 'pedro' THEN jsonb_set(m.valor, '{autor}', '"leitor"'::jsonb) ELSE m.valor END
      ORDER BY m.ordem)
    FROM jsonb_array_elements(r.dados->'mensagens') WITH ORDINALITY AS m(valor, ordem)
  ), '[]'::jsonb))
WHERE r.dados->>'versao' = '1' AND jsonb_typeof(r.dados->'mensagens') = 'array';

-- 3. Constraints novas (mesmos nomes, mesmo significado, valor novo).
ALTER TABLE lote_revisao ADD CONSTRAINT lote_revisao_autor_check CHECK (autor IN ('leitor', 'codex', 'claude'));
ALTER TABLE mensagem ADD CONSTRAINT mensagem_autor_check CHECK (autor IN ('leitor', 'ia'));
ALTER TABLE conexao ADD CONSTRAINT conexao_autor_check CHECK (autor IN ('ia', 'leitor'));
ALTER TABLE camada ADD CONSTRAINT camada_tipo_check CHECK (tipo IN ('execucao', 'importacao', 'leitor'));
ALTER TABLE camada ADD CONSTRAINT camada_check1 CHECK (tipo IN ('importacao', 'leitor') OR execucao_id IS NOT NULL);
ALTER TABLE agente_mensagem ADD CONSTRAINT agente_mensagem_autor_check CHECK (autor IN ('leitor', 'agente'));
ALTER TABLE agente_mensagem ADD CONSTRAINT agente_mensagem_check1 CHECK (autor = 'leitor' OR job_id IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS camada_do_leitor ON camada (versao_id, modo_id, modo_revisao) WHERE tipo = 'leitor';

-- 4. Conferência: nenhuma constraint, índice ou sessão de resolução continua com 'pedro'.
DO $$
DECLARE
  restante text;
BEGIN
  SELECT string_agg(conrelid::regclass::text || '.' || conname, ', ') INTO restante
    FROM pg_constraint WHERE pg_get_constraintdef(oid) LIKE '%''pedro''%';
  IF restante IS NOT NULL THEN RAISE EXCEPTION '0025_leitor: constraints ainda citam pedro: %', restante; END IF;
  SELECT string_agg(indexname, ', ') INTO restante FROM pg_indexes WHERE indexdef LIKE '%''pedro''%';
  IF restante IS NOT NULL THEN RAISE EXCEPTION '0025_leitor: índices ainda citam pedro: %', restante; END IF;
  IF EXISTS (SELECT 1 FROM resolucao WHERE dados->>'versao' <> '2'
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(dados->'mensagens') m WHERE m->>'autor' = 'pedro')) THEN
    RAISE EXCEPTION '0025_leitor: há sessão de resolução que não virou ResolucaoV2.';
  END IF;
END $$;
