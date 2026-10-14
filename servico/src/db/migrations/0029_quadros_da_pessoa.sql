-- J118 · Quadros da pessoa. O Margem não distribui acervo: a pessoa envia a imagem de uma obra e o worker
-- prepara a análise guiada pela fila (job `preparar_quadro`). Os arquivos ficam em `<dados>/quadros/<slug>/`
-- (original, imagem normalizada, dossiê, análises); aqui ficam a obra, o que a pessoa informou e o job
-- mais recente (o estado vem dele, como nas perguntas do agente). `identificacao` é um
-- IdentificacaoDaObraV1 informado ou corrigido pela pessoa; nula, o Codex propõe a partir da imagem.
-- `rotulo` é a análise em preparo (`geracoes/<rotulo>/`); `pronto_em` marca a primeira publicação.
-- (0027 ficou sem uso: o J106 não precisou dela.)
CREATE TABLE quadro_da_pessoa (
  id ulid PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  formato text NOT NULL CHECK (formato IN ('jpeg', 'png', 'webp')),
  bytes bigint NOT NULL CHECK (bytes > 0),
  nome_do_arquivo text CHECK (nome_do_arquivo IS NULL OR length(nome_do_arquivo) BETWEEN 1 AND 255),
  sha256_original sha256 NOT NULL,
  identificacao jsonb,
  rotulo text NOT NULL CHECK (rotulo ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  job_id ulid REFERENCES job(id),
  pronto_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX quadro_da_pessoa_por_imagem ON quadro_da_pessoa (sha256_original);
