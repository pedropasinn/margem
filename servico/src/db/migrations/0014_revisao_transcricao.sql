-- J90 · Revisão da transcrição de um vídeo (deslizes do reconhecimento corrigidos pelo Codex).
-- O texto revisado é outra fonte do mesmo documento: mora em MARGEM_DADOS/documentos/<id>/revisoes/<sha>.txt,
-- vira uma versão NOVA pelo job `canonizar_revisao` (a versão anterior, as marcas e as notas dela ficam
-- intactas) e a mídia é realinhada na mesma transação que publica a versão. A linha é imutável.
CREATE TABLE revisao_transcricao (
  id ulid PRIMARY KEY,
  documento_id ulid NOT NULL REFERENCES documento(id),
  versao_base_id ulid NOT NULL REFERENCES versao_texto(id),
  midia_base_id ulid NOT NULL REFERENCES midia(id),
  sha256_texto sha256 NOT NULL,
  caminho_texto text NOT NULL,
  -- {motor, idioma, palavras: [{texto, inicio_s, fim_s}]}: as palavras revisadas, com tempo.
  transcricao jsonb NOT NULL,
  -- O que a ferramenta relatou: prompt, aplicadas, pendentes, dúvidas.
  resumo jsonb NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (documento_id, sha256_texto)
);
CREATE TRIGGER revisao_transcricao_imutavel BEFORE UPDATE OR DELETE ON revisao_transcricao
  FOR EACH ROW EXECUTE FUNCTION recusar_mutacao_texto();
