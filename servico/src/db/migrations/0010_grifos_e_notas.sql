-- 0010_grifos_e_notas.sql — J37: grifos do Pedro, etiquetas fixas e notas editadas pelo outro.
--
-- 1. Grifos do Pedro: marcas `manual` numa camada própria (`tipo = 'pedro'`), uma por versão e modo,
--    sem execução. Ela não é camada de leitura: não entra na escolha de camada nem na camada padrão,
--    e as marcas dela aparecem em qualquer camada.
ALTER TABLE camada DROP CONSTRAINT IF EXISTS camada_tipo_check;
ALTER TABLE camada ADD CONSTRAINT camada_tipo_check CHECK (tipo IN ('execucao', 'importacao', 'pedro'));
ALTER TABLE camada DROP CONSTRAINT IF EXISTS camada_check1;
ALTER TABLE camada ADD CONSTRAINT camada_check1 CHECK (tipo IN ('importacao', 'pedro') OR execucao_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS camada_do_pedro ON camada (versao_id, modo_id, modo_revisao) WHERE tipo = 'pedro';

-- 2. O Pedro troca a função de uma marca da IA ou reescreve a nota dela: o que a IA escreveu fica guardado
--    na primeira troca, para mostrar "editada" e poder voltar ao original.
ALTER TABLE marca ADD COLUMN IF NOT EXISTS funcao_da_ia text;
ALTER TABLE marca ADD COLUMN IF NOT EXISTS comentario_da_ia jsonb;

-- 3. Etiquetas: só os tipos de dificuldade do texto (os "?"); a função da marca é a própria função, não
--    uma etiqueta. Etiquetas livres do J36 (nunca integrado) saem.
DELETE FROM etiqueta WHERE nome NOT IN ('premissa_implicita', 'mudanca_de_notacao', 'sintaxe_complexa',
  'conceito_sem_definicao', 'salto_argumentativo', 'referencia_externa', 'ambiguidade');
ALTER TABLE etiqueta ADD CONSTRAINT etiqueta_de_dificuldade CHECK (nome IN ('premissa_implicita', 'mudanca_de_notacao',
  'sintaxe_complexa', 'conceito_sem_definicao', 'salto_argumentativo', 'referencia_externa', 'ambiguidade'));

-- 4. O Codex revisa uma nota do Pedro (job `revisar_anotacao`): o pedido pendente (com a instrução dele) e,
--    depois, o texto anterior e o motivo ficam com a nota.
ALTER TABLE anotacao ADD COLUMN IF NOT EXISTS revisao jsonb;
ALTER TABLE anotacao ADD COLUMN IF NOT EXISTS pedido_de_revisao jsonb;
