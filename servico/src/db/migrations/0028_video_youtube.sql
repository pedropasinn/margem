-- J109 · Vídeo do YouTube de um documento importado por link. O vídeo toca pelo player oficial
-- embutido (cada reprodução conta para o canal); o serviço não baixa o vídeo. `conteudo` é um
-- VideoYoutubeV1 e muda com a importação (pendente → pronta, sem_transcricao, ...); a sincronia,
-- quando existe, é uma linha imutável de `midia` (o áudio local, fonte.url no YouTube).
-- (0025–0027 ficam para os jobs em paralelo.)
CREATE TABLE video_youtube (
  documento_id ulid PRIMARY KEY REFERENCES documento(id),
  video_id text NOT NULL CHECK (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  conteudo jsonb NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX video_youtube_por_video ON video_youtube (video_id);
