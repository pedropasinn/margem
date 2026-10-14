-- v0.1 · Relação com o tipo semântico sem perda (ConexaoV3). Só acrescenta: duas colunas nuláveis em
-- `conexao` e o preenchimento a partir de `relacao_adotada` (0007), que já guardava o tipo original
-- de cada relação da compreensão adotada como conexão. `relacao` continua a família (6, a que o
-- leitor vê); `relacao_semantica` é o tipo fino (9). Conexões sem par em `relacao_adotada` ficam
-- com as colunas nulas e são lidas como V3 sem o tipo fino.
ALTER TABLE conexao
  ADD COLUMN relacao_semantica text CHECK (relacao_semantica IS NULL OR relacao_semantica IN
    ('suporta', 'desenvolve', 'pressupoe', 'contrasta', 'exemplifica', 'retoma', 'responde', 'tensiona', 'ecoa')),
  -- A relação semântica (`RelacaoSemanticaV1.id`) e o modelo do capítulo de onde a conexão foi adotada.
  ADD COLUMN relacao_origem_id ulid,
  ADD COLUMN relacao_modelo_id ulid,
  ADD CONSTRAINT conexao_origem_com_semantica CHECK (
    (relacao_origem_id IS NULL AND relacao_modelo_id IS NULL) OR (relacao_origem_id IS NOT NULL AND relacao_modelo_id IS NOT NULL AND relacao_semantica IS NOT NULL));

-- Só onde a família gravada é a do tipo original (o mapa de `FAMILIA_DA_RELACAO_SEMANTICA`): a V3
-- exige essa coerência, e uma linha fora dela (não deveria haver) fica sem o tipo fino.
UPDATE conexao c
   SET relacao_semantica = r.tipo_original, relacao_origem_id = r.relacao_id, relacao_modelo_id = r.modelo_id
  FROM relacao_adotada r
  JOIN (VALUES ('suporta', 'desenvolve'), ('desenvolve', 'desenvolve'), ('pressupoe', 'prerequisito'),
               ('contrasta', 'contraste'), ('exemplifica', 'exemplo'), ('retoma', 'semelhanca'),
               ('responde', 'tensao'), ('tensiona', 'tensao'), ('ecoa', 'semelhanca')) AS f(tipo, familia)
    ON f.tipo = r.tipo_original
 WHERE r.conexao_id = c.id AND c.relacao = f.familia AND c.relacao_semantica IS NULL;
