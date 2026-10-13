-- 0018_salas_de_teste.sql — sala de teste do beta.
--
-- Uma sala abre alguns documentos da biblioteca a testadores que entram com uma senha (só o hash
-- scrypt mora aqui). O testador lê no modo restrito, comenta trechos e responde um formulário.
-- Nada daqui toca as tabelas do Pedro (marca, anotacao, progresso): a sala tem as próprias.
-- (A 0017 está reservada para outra sessão; esta não depende dela.)
CREATE TABLE sala (
  id ulid PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{4,62}[a-z0-9]$'),
  titulo text NOT NULL CHECK (length(titulo) BETWEEN 1 AND 160),
  boas_vindas text NOT NULL DEFAULT '' CHECK (length(boas_vindas) <= 4000),
  -- scrypt$<N>$<r>$<p>$<sal base64url>$<hash base64url>
  senha_hash text NOT NULL CHECK (senha_hash ~ '^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$'),
  ativa boolean NOT NULL DEFAULT true,
  expira_em timestamptz,
  formulario jsonb NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizada_em timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE sala_documento (
  sala_id ulid NOT NULL REFERENCES sala(id) ON DELETE CASCADE,
  documento_id ulid NOT NULL REFERENCES documento(id),
  ordem integer NOT NULL CHECK (ordem >= 0),
  PRIMARY KEY (sala_id, documento_id),
  UNIQUE (sala_id, ordem)
);

-- O testador é identificado na sala pelo nome (e e-mail, se deu): quem entra de novo com o mesmo
-- nome retoma o mesmo rascunho.
CREATE TABLE sala_testador (
  id ulid PRIMARY KEY,
  sala_id ulid NOT NULL REFERENCES sala(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 120),
  email text CHECK (email IS NULL OR length(email) <= 254),
  chave text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  ultimo_acesso_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (sala_id, chave),
  UNIQUE (sala_id, id)
);

-- Sessão do testador: o cookie carrega o id e um segredo aleatório; aqui fica só o SHA-256 dele.
CREATE TABLE sala_sessao (
  id ulid PRIMARY KEY,
  sala_id ulid NOT NULL,
  testador_id ulid NOT NULL,
  segredo_sha256 sha256 NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  expira_em timestamptz NOT NULL,
  encerrada_em timestamptz,
  FOREIGN KEY (sala_id, testador_id) REFERENCES sala_testador(sala_id, id) ON DELETE CASCADE
);
CREATE INDEX sala_sessao_por_sala ON sala_sessao (sala_id, expira_em);

-- Comentário no trecho (ComentarioDaSalaV1): bloco + intervalo + citação literal, resolvidos pelo serviço.
CREATE TABLE sala_comentario (
  id ulid PRIMARY KEY,
  sala_id ulid NOT NULL,
  testador_id ulid NOT NULL,
  documento_id ulid NOT NULL REFERENCES documento(id),
  versao_id ulid NOT NULL,
  bloco_id ulid NOT NULL,
  inicio_utf16 integer NOT NULL CHECK (inicio_utf16 >= 0),
  fim_utf16 integer NOT NULL CHECK (fim_utf16 > inicio_utf16),
  citacao text NOT NULL CHECK (length(citacao) BETWEEN 1 AND 2000),
  texto text NOT NULL CHECK (length(texto) BETWEEN 1 AND 4000),
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (sala_id, testador_id) REFERENCES sala_testador(sala_id, id) ON DELETE CASCADE,
  FOREIGN KEY (sala_id, documento_id) REFERENCES sala_documento(sala_id, documento_id) ON DELETE CASCADE,
  FOREIGN KEY (versao_id, bloco_id) REFERENCES bloco(versao_id, id)
);
CREATE INDEX sala_comentario_por_documento ON sala_comentario (sala_id, documento_id, criado_em);

-- Respostas ao formulário (RespostaDaSalaV1, sem os carimbos, que são colunas): uma linha por testador.
CREATE TABLE sala_resposta (
  sala_id ulid NOT NULL,
  testador_id ulid NOT NULL,
  geral jsonb NOT NULL DEFAULT '{}'::jsonb,
  por_documento jsonb NOT NULL DEFAULT '{}'::jsonb,
  estado text NOT NULL DEFAULT 'rascunho' CHECK (estado IN ('rascunho','enviada')),
  atualizada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  enviada_em timestamptz,
  PRIMARY KEY (sala_id, testador_id),
  FOREIGN KEY (sala_id, testador_id) REFERENCES sala_testador(sala_id, id) ON DELETE CASCADE,
  CHECK ((estado = 'enviada') = (enviada_em IS NOT NULL))
);
