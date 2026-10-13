# syntax=docker/dockerfile:1
#
# Imagem da instalação local (J100): API + worker + motor Python + CLI do Codex numa imagem só.
# A mesma imagem roda os dois serviços do compose de distribuição (`distribuicao/compose.yml`).
#
#   docker build -t <imagem> .
#
# Sem segredos: nenhuma credencial entra na imagem. O banco vem do compose (DATABASE_URL), o login
# do Codex mora no volume CODEX_HOME e os livros no volume MARGEM_DADOS.

ARG NODE_VERSION=22
ARG PYTHON_VERSION=3.12
ARG CODEX_VERSION=0.162.1
# Versão registrada em tools/midia/yt-dlp.txt (que fixa também as dependências).
ARG YTDLP_VERSION=2026.8.19

# ------------------------------------------------------------------ dependências do Node e build do web
FROM node:${NODE_VERSION}-bookworm-slim AS node-build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    npm_config_fund=false \
    npm_config_audit=false \
    npm_config_update_notifier=false
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY servico/package.json servico/
COPY contratos/package.json contratos/
COPY core/package.json core/
RUN --mount=type=cache,target=/root/.npm npm ci
COPY tsconfig.base.json tsconfig.json ./
COPY contratos contratos
COPY core core
COPY web web
RUN npm run build --workspace @margem/web
# Pacotes que só servem a testes, capturas e ao bundle do leitor (já construído em web/dist).
RUN rm -rf node_modules/playwright node_modules/playwright-core \
      node_modules/mermaid node_modules/@mermaid-js node_modules/cytoscape* node_modules/elkjs \
      node_modules/@vitest node_modules/vitest node_modules/eslint* node_modules/@eslint \
      node_modules/typescript-eslint node_modules/@typescript-eslint \
      web/node_modules

# ------------------------------------------------------------------ motor Python (venv)
FROM python:${PYTHON_VERSION}-slim-bookworm AS motor-build
WORKDIR /app/motor
COPY motor/requirements.txt ./
RUN python -m venv /app/motor/.venv \
 && /app/motor/.venv/bin/pip install --no-cache-dir --disable-pip-version-check -r requirements.txt

# yt-dlp (importação do YouTube, J109) num venv próprio, com versões fixadas.
ARG YTDLP_VERSION
COPY tools/midia/yt-dlp.txt /tmp/yt-dlp.txt
RUN grep -qx "yt-dlp\[default\]==${YTDLP_VERSION}" /tmp/yt-dlp.txt \
 && python -m venv /opt/yt-dlp \
 && /opt/yt-dlp/bin/pip install --no-cache-dir --disable-pip-version-check -r /tmp/yt-dlp.txt \
 && /opt/yt-dlp/bin/python -c "import importlib.metadata as m, sys; sys.exit(m.version('yt-dlp') != '${YTDLP_VERSION}')"

# ------------------------------------------------------------------ imagem final
FROM python:${PYTHON_VERSION}-slim-bookworm AS final
ARG CODEX_VERSION
ARG TITULO=app
ARG VERSAO=dev
ARG REVISAO=desconhecida
ARG CRIADO_EM=
ARG FONTE=https://github.com/pedropasinn/margem
# Rótulos OCI (preenchidos no build de release; a imagem pode ir ao GHCR sem mudanças).
LABEL org.opencontainers.image.title="${TITULO}" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.description="Leitor de textos marcados: API, worker, motor e CLI do Codex." \
      org.opencontainers.image.version="${VERSAO}" \
      org.opencontainers.image.revision="${REVISAO}" \
      org.opencontainers.image.created="${CRIADO_EM}" \
      org.opencontainers.image.source="${FONTE}"

# bubblewrap: o confinamento do `codex exec` (servico/src/executor/confinamento.ts).
# ca-certificates: TLS da CLI do Codex e do yt-dlp. tini: PID 1 que repassa sinais e colhe zumbis.
# ffmpeg/ffprobe: áudio do YouTube e mídia própria (J108/J109), miniaturas e imagens da arte (J110).
# fonts-dejavu-core: DejaVuSans.ttf, que a geração de imagens da arte desenha (arte/v2/imagens.ts).
RUN apt-get update \
 && apt-get install -y --no-install-recommends bubblewrap ca-certificates tini ffmpeg fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/* \
 && test -f /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf \
 && ffprobe -version >/dev/null

# Node 22 da imagem oficial (mesma base Debian bookworm).
COPY --from=node-build /usr/local/bin/node /usr/local/bin/node
COPY --from=node-build /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && node --version

# CLI oficial do Codex. O `codex` do PATH é o lançador do npm; o binário nativo (ELF) é o que roda
# dentro do bwrap, e fica sob /usr, que o confinamento monta só leitura.
RUN npm install -g --no-fund --no-audit "@openai/codex@${CODEX_VERSION}" \
 && motor="$(find /usr/local/lib/node_modules/@openai -type f -name codex -perm -u+x \
             -path '*/vendor/*' | head -n 1)" \
 && test -n "$motor" \
 && mkdir -p /usr/local/lib/leitor \
 && ln -s "$motor" /usr/local/lib/leitor/codex-motor \
 && /usr/local/lib/leitor/codex-motor --version \
 && npm cache clean --force

RUN groupadd --gid 10001 app \
 && useradd --uid 10001 --gid app --create-home --home-dir /home/app --shell /usr/sbin/nologin app \
 && mkdir -p /dados /home/app/.codex /home/app/tmp \
 && chown app:app /dados /home/app/.codex /home/app/tmp && chmod 700 /home/app/.codex /home/app/tmp

WORKDIR /app
COPY --from=node-build /app/node_modules node_modules
COPY --from=node-build /app/web/dist web/dist
COPY --from=motor-build /app/motor/.venv motor/.venv
COPY --from=motor-build /opt/yt-dlp /opt/yt-dlp
# O `yt-dlp` do PATH usa o Node da imagem para os desafios de JavaScript do YouTube.
RUN printf '#!/bin/sh\nexec /opt/yt-dlp/bin/yt-dlp --js-runtimes node "$@"\n' > /usr/local/bin/yt-dlp \
 && chmod 755 /usr/local/bin/yt-dlp
COPY LICENSE package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY web/package.json web/
COPY contratos contratos
COPY core core
COPY servico servico
COPY motor/margem_motor motor/margem_motor
COPY motor/pyproject.toml motor/
COPY prompts prompts
COPY fixtures fixtures
COPY tools/renderizar-paginas.py tools/camada-da-transcricao.py tools/exercicios-do-pdf.py tools/
# O checkout pode ter permissões restritas (ACL, umask 007): o código precisa ser legível pelo usuário app.
RUN chmod -R go+rX,go-w /app/LICENSE /app/*.json /app/web/package.json /app/contratos /app/core /app/servico \
      /app/motor/margem_motor /app/motor/pyproject.toml /app/prompts /app/fixtures /app/tools

ENV NODE_ENV=production \
    LANG=C.UTF-8 \
    HOME=/home/app \
    CODEX_HOME=/home/app/.codex \
    TMPDIR=/home/app/tmp \
    MARGEM_MODO=instalado \
    MARGEM_RAIZ=/app \
    MARGEM_DADOS=/dados \
    MARGEM_PORTA=8730 \
    MARGEM_MODELO=conta \
    MARGEM_CODEX_MOTOR=/usr/local/lib/leitor/codex-motor \
    NODE_OPTIONS=--enable-source-maps

USER app
EXPOSE 8730
VOLUME ["/dados", "/home/app/.codex"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--import", "tsx", "servico/src/api.ts"]
