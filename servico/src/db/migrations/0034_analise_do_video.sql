-- 0034_analise_do_video.sql — v0.1 (J142): análise própria do vídeo.
-- `analise_video` guarda o "Analisar" pedido num documento de vídeo enquanto a transcrição é passada a limpo
-- ({ pedido: { todos, itens }, etapa, em }): a etapa 'transcricao' espera o job `revisar_transcricao` (e, se
-- ele virar versão nova, o `canonizar_revisao`); ao publicar, a análise segue (grifos e relações, partes e
-- momentos do vídeo) e a etapa passa a 'leitura'.
ALTER TABLE documento ADD COLUMN analise_video jsonb
  CHECK (analise_video IS NULL OR (jsonb_typeof(analise_video) = 'object' AND analise_video->>'etapa' IN ('transcricao', 'leitura')));
