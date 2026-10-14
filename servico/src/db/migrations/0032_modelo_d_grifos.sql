-- 0032_modelo_d_grifos.sql — J138 (V-G1): modelo D dos grifos, "o trecho no centro, um dono por pergunta".
--
-- O grifo é o trecho + a cor/papel de uma função do modo dele. A nota do leitor pertence ao grifo (uma por
-- grifo, texto simples, sem tipo) e continua guardada em `anotacao` (mesmo id: links e Obsidian não mudam).
-- A dificuldade vira um sinal à parte (`dificuldade`), do Codex ou do leitor. Migração só aditiva: nenhuma
-- linha é apagada; o que deixa de aparecer fica marcado e com o original guardado.

-- 1. Anotação: a que foi juntada a outra nota do mesmo grifo (`fundida_em`), o que a migração fez com ela e
--    o texto de antes, quando a migração o reescreveu.
ALTER TABLE anotacao ADD COLUMN fundida_em ulid REFERENCES anotacao ON DELETE SET NULL;
ALTER TABLE anotacao ADD COLUMN modelo_d text
  CHECK (modelo_d IN ('nota_do_grifo', 'juntou_notas', 'fundida', 'grifo_criado', 'grifo_vizinho'));
ALTER TABLE anotacao ADD COLUMN texto_antes_do_modelo_d text;
ALTER TABLE anotacao ADD CONSTRAINT anotacao_fundida_nao_e_ela CHECK (fundida_em IS NULL OR fundida_em <> id);

-- O rótulo de cada tipo antigo e a fonte por extenso: entram no texto quando ele junta notas, ou (a fonte)
-- quando só existia nos campos que a tela deixa de mostrar.
CREATE FUNCTION pg_temp.rotulo_do_tipo(tipo text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE tipo WHEN 'impressao' THEN 'Impressão' WHEN 'observacao' THEN 'Observação' WHEN 'hipotese' THEN 'Hipótese'
    WHEN 'duvida' THEN 'Dúvida' WHEN 'fonte' THEN 'Fonte' ELSE NULL END
$$;
CREATE FUNCTION pg_temp.fonte_por_extenso(fonte jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN fonte IS NULL THEN NULL ELSE 'Fonte: ' || (fonte->>'titulo')
    || coalesce(', p. ' || (fonte->>'pagina'), '') || coalesce(' — ' || (fonte->>'url'), '') END
$$;
-- Um pedaço da nota juntada: "Hipótese: texto", com a fonte por extenso no fim.
CREATE FUNCTION pg_temp.pedaco(tipo text, texto text, fonte jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(pg_temp.rotulo_do_tipo(tipo) || ': ', '') || texto || coalesce(E'\n' || pg_temp.fonte_por_extenso(fonte), '')
$$;
-- O limite do contrato (8000); o texto inteiro de cada anotação fica na linha dela.
CREATE FUNCTION pg_temp.no_limite(texto text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN char_length(texto) <= 8000 THEN texto ELSE left(texto, 7999) || '…' END
$$;
-- Junta `nova` ao fim da nota `alvo` (com o separador), guardando o texto de antes uma vez.
CREATE FUNCTION pg_temp.juntar(alvo text, nova text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n record;
BEGIN
  SELECT tipo, texto, fonte INTO n FROM anotacao WHERE id = nova;
  UPDATE anotacao SET texto_antes_do_modelo_d = coalesce(texto_antes_do_modelo_d, texto),
    texto = pg_temp.no_limite(texto || E'\n\n—\n\n' || pg_temp.pedaco(n.tipo, n.texto, n.fonte)),
    modelo_d = 'juntou_notas', revisao_edicao = revisao_edicao + 1,
    atualizada_em = greatest(atualizada_em, (SELECT atualizada_em FROM anotacao WHERE id = nova))
  WHERE id = alvo;
  UPDATE anotacao SET fundida_em = alvo, modelo_d = 'fundida' WHERE id = nova;
END
$$;

-- 1b. A nota que o leitor escrevia no próprio grifo pelo comentário dele (J37, `PUT /api/marcas/:id/nota` num
--     grifo `manual`) é nota do leitor: vira uma anotação ligada ao grifo (juntada às outras no passo 2); o
--     comentário sai da marca, guardado em `comentario_antes_do_modelo_d`.
ALTER TABLE marca ADD COLUMN comentario_antes_do_modelo_d jsonb;
INSERT INTO anotacao (id, versao_id, bloco_id, inicio_utf16, fim_utf16, citacao, prefixo, sufixo, tipo, texto, marca_id, criada_em, atualizada_em)
SELECT margem_ulid(m.atualizada_em), m.versao_id, m.bloco_id, m.inicio_utf16, m.fim_utf16, m.citacao, m.prefixo, m.sufixo, 'nota',
  left(m.comentario->>'texto', 8000), m.id, m.atualizada_em, m.atualizada_em
FROM marca m WHERE m.origem = 'manual' AND m.comentario IS NOT NULL AND btrim(coalesce(m.comentario->>'texto', '')) <> '';
UPDATE marca SET comentario_antes_do_modelo_d = comentario, comentario = NULL WHERE origem = 'manual' AND comentario IS NOT NULL;

-- 2. Várias anotações no mesmo grifo: a mais antiga vira a nota do grifo, com o texto de todas em ordem de
--    criação, cada uma com o seu tipo antigo como rótulo ("Hipótese: …"); as outras ficam marcadas como fundidas.
DO $$
DECLARE g record; primeira text; outra text;
BEGIN
  FOR g IN SELECT marca_id, array_agg(id ORDER BY criada_em, id) AS ids FROM anotacao
    WHERE marca_id IS NOT NULL GROUP BY marca_id HAVING count(*) > 1 LOOP
    primeira := g.ids[1];
    UPDATE anotacao SET texto_antes_do_modelo_d = texto, texto = pg_temp.no_limite(pg_temp.pedaco(tipo, texto, fonte))
      WHERE id = primeira;
    FOREACH outra IN ARRAY g.ids[2:] LOOP PERFORM pg_temp.juntar(primeira, outra); END LOOP;
  END LOOP;
END
$$;
-- A única nota de um grifo, do tipo fonte: a fonte por extenso entra no texto (a tela não mostra mais os campos).
UPDATE anotacao SET texto_antes_do_modelo_d = texto, texto = pg_temp.no_limite(texto || E'\n\n' || pg_temp.fonte_por_extenso(fonte))
  WHERE marca_id IS NOT NULL AND fundida_em IS NULL AND modelo_d IS NULL AND tipo = 'fonte';
UPDATE anotacao SET modelo_d = 'nota_do_grifo' WHERE marca_id IS NOT NULL AND fundida_em IS NULL AND modelo_d IS NULL;

-- 3. Anotações soltas (sem grifo): viram a nota de um grifo do trecho da âncora. Se um grifo do leitor já
--    cobre ou cruza o trecho, a nota vai para ele (juntada à nota que ele já tiver); senão nasce um grifo sem
--    função ("nenhuma", o cinza), na camada do leitor do modo mais presente na versão.
DO $$
DECLARE a record; alvo text; nota text; modo record; camada_alvo text; quando timestamptz;
BEGIN
  FOR a IN SELECT * FROM anotacao WHERE marca_id IS NULL AND fundida_em IS NULL ORDER BY criada_em, id LOOP
    alvo := NULL;
    SELECT m.id INTO alvo FROM marca m JOIN camada c ON c.id = m.camada_id AND c.tipo = 'leitor'
      WHERE m.versao_id = a.versao_id AND m.bloco_id = a.bloco_id AND m.inicio_utf16 < a.fim_utf16 AND a.inicio_utf16 < m.fim_utf16
      ORDER BY (m.inicio_utf16 = a.inicio_utf16 AND m.fim_utf16 = a.fim_utf16) DESC, m.criada_em, m.id LIMIT 1;
    IF alvo IS NOT NULL THEN
      nota := (SELECT id FROM anotacao WHERE marca_id = alvo AND fundida_em IS NULL ORDER BY criada_em, id LIMIT 1);
      IF nota IS NULL THEN
        UPDATE anotacao SET marca_id = alvo, modelo_d = 'grifo_vizinho' WHERE id = a.id;
      ELSE
        UPDATE anotacao SET marca_id = alvo WHERE id = a.id;
        PERFORM pg_temp.juntar(nota, a.id);
      END IF;
      CONTINUE;
    END IF;
    SELECT x.modo_id, x.modo_revisao INTO modo FROM (
      SELECT c.modo_id, c.modo_revisao, 0 AS ordem, 0::bigint AS total FROM camada c WHERE c.versao_id = a.versao_id AND c.tipo = 'leitor'
      UNION ALL
      SELECT m.modo_id, m.modo_revisao, 1, count(*) FROM marca m WHERE m.versao_id = a.versao_id GROUP BY m.modo_id, m.modo_revisao
      UNION ALL
      SELECT 'argumentativa', 1, 2, 0
    ) x ORDER BY x.ordem, x.total DESC, x.modo_id, x.modo_revisao LIMIT 1;
    INSERT INTO camada (id, versao_id, tipo, execucao_id, modo_id, modo_revisao, criada_em)
      VALUES (margem_ulid(a.criada_em), a.versao_id, 'leitor', NULL, modo.modo_id, modo.modo_revisao, a.criada_em)
      ON CONFLICT (versao_id, modo_id, modo_revisao) WHERE tipo = 'leitor' DO NOTHING;
    camada_alvo := (SELECT id FROM camada WHERE versao_id = a.versao_id AND tipo = 'leitor' AND modo_id = modo.modo_id AND modo_revisao = modo.modo_revisao);
    alvo := margem_ulid(a.criada_em);
    quando := date_trunc('milliseconds', a.criada_em);
    INSERT INTO marca (id, versao_id, bloco_id, inicio_utf16, fim_utf16, citacao, prefixo, sufixo, funcao, subfaixas, comentario,
        origem, validade, visivel, avaliacao, execucao_id, job_id, criada_em, criada_em_literal, saliencia, camada_id, modo_id, modo_revisao)
      VALUES (alvo, a.versao_id, a.bloco_id, a.inicio_utf16, a.fim_utf16, a.citacao, a.prefixo, a.sufixo, 'nenhuma', '[]'::jsonb, NULL,
        'manual', 'resolvida', true, 'confirmada', NULL, NULL, quando,
        to_char(quando AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 2, camada_alvo, modo.modo_id, modo.modo_revisao);
    UPDATE anotacao SET marca_id = alvo, modelo_d = 'grifo_criado',
      texto_antes_do_modelo_d = CASE WHEN tipo = 'fonte' THEN texto END,
      texto = CASE WHEN tipo = 'fonte' THEN pg_temp.no_limite(texto || E'\n\n' || pg_temp.fonte_por_extenso(fonte)) ELSE texto END
      WHERE id = a.id;
  END LOOP;
END
$$;

-- Daqui em diante, uma nota por grifo.
CREATE UNIQUE INDEX anotacao_uma_por_grifo ON anotacao (marca_id) WHERE marca_id IS NOT NULL AND fundida_em IS NULL;

-- 4. O sinal de dificuldade (`DificuldadeV1`): marcado pelo leitor, ou a decisão dele sobre uma dificuldade
--    que o Codex sugeriu no modelo do capítulo (as sugeridas ainda sem decisão vêm do próprio modelo).
CREATE TABLE dificuldade (
  id ulid PRIMARY KEY,
  versao_id ulid NOT NULL REFERENCES versao_texto, bloco_id ulid NOT NULL,
  inicio_utf16 bigint NOT NULL, fim_utf16 bigint NOT NULL,
  citacao text NOT NULL, prefixo text NOT NULL, sufixo text NOT NULL,
  origem text NOT NULL CHECK (origem IN ('codex', 'leitor')),
  estado text NOT NULL CHECK (estado IN ('sugerida', 'confirmada', 'descartada')),
  tipo text CHECK (tipo IN ('premissa_implicita', 'mudanca_de_notacao', 'sintaxe_complexa', 'conceito_sem_definicao',
    'salto_argumentativo', 'referencia_externa', 'ambiguidade')),
  descricao text CHECK (descricao IS NULL OR char_length(descricao) BETWEEN 1 AND 2000),
  marca_id ulid REFERENCES marca ON DELETE SET NULL,
  codex_modelo_id ulid, codex_dificuldade_id ulid,
  -- A etiqueta "?" de onde a migração tirou esta dificuldade (a etiqueta continua no banco, sem tela).
  etiqueta_id ulid UNIQUE REFERENCES etiqueta ON DELETE SET NULL,
  criada_em timestamptz NOT NULL, atualizada_em timestamptz NOT NULL,
  CHECK (inicio_utf16 >= 0 AND fim_utf16 > inicio_utf16),
  CHECK (criada_em <= atualizada_em),
  CHECK ((origem = 'codex') = (codex_modelo_id IS NOT NULL AND codex_dificuldade_id IS NOT NULL)),
  CHECK (origem = 'codex' OR estado <> 'sugerida'),
  FOREIGN KEY (versao_id, bloco_id) REFERENCES bloco(versao_id, id)
);
CREATE UNIQUE INDEX dificuldade_decisao_do_codex ON dificuldade (codex_dificuldade_id) WHERE codex_dificuldade_id IS NOT NULL;
CREATE INDEX dificuldade_do_bloco ON dificuldade (versao_id, bloco_id);

-- As etiquetas de dificuldade do leitor viram sinais dele, já confirmados, no trecho do alvo da etiqueta.
INSERT INTO dificuldade (id, versao_id, bloco_id, inicio_utf16, fim_utf16, citacao, prefixo, sufixo, origem, estado, tipo,
    marca_id, etiqueta_id, criada_em, atualizada_em)
SELECT margem_ulid(e.criada_em), e.versao_id, coalesce(m.bloco_id, a.bloco_id), coalesce(m.inicio_utf16, a.inicio_utf16),
  coalesce(m.fim_utf16, a.fim_utf16), coalesce(m.citacao, a.citacao), coalesce(m.prefixo, a.prefixo), coalesce(m.sufixo, a.sufixo),
  'leitor', 'confirmada', lower(e.nome), coalesce(m.id, a.marca_id), e.id, e.criada_em, e.criada_em
FROM etiqueta e
LEFT JOIN marca m ON m.id = e.marca_id
LEFT JOIN anotacao a ON a.id = e.anotacao_id
WHERE lower(e.nome) IN ('premissa_implicita', 'mudanca_de_notacao', 'sintaxe_complexa', 'conceito_sem_definicao',
    'salto_argumentativo', 'referencia_externa', 'ambiguidade')
  AND coalesce(m.id, a.id) IS NOT NULL
ORDER BY e.criada_em, e.id;

DROP FUNCTION pg_temp.juntar(text, text);
DROP FUNCTION pg_temp.no_limite(text);
DROP FUNCTION pg_temp.pedaco(text, text, jsonb);
DROP FUNCTION pg_temp.fonte_por_extenso(jsonb);
DROP FUNCTION pg_temp.rotulo_do_tipo(text);
