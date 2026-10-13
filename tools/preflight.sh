#!/usr/bin/env bash
set -uo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." || exit 1
faltas=0
ok() { printf 'ok | %s\n' "$*"; }
falta() { printf 'falta | %s\n' "$*"; faltas=$((faltas + 1)); }
aviso() { printf 'aviso | %s\n' "$*"; }

if command -v node >/dev/null && node -e 'const [a,b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)' 2>/dev/null; then
  ok "node $(node --version) (mínimo 22.12)"
else
  falta 'node >= 22.12'
fi
if versao=$(npm --version 2>/dev/null); then ok "npm $versao"; else falta 'npm'; fi

python=motor/.venv/bin/python
if versao=$("$python" --version 2>/dev/null); then
  ok "venv $versao"
  for modulo in pymupdf pytest; do
    if versao=$("$python" -c 'import importlib.metadata, importlib, sys; importlib.import_module(sys.argv[1]); print(importlib.metadata.version(sys.argv[1]))' "$modulo" 2>/dev/null); then
      ok "$modulo $versao"
    else
      falta "$modulo no venv"
    fi
  done
else
  falta 'Python em motor/.venv'
fi

if command -v codex >/dev/null; then
  if versao=$(codex --version 2>/dev/null); then
    ok "$versao"
  else
    falta 'codex --version indisponível (CLI ou wrapper inacessível no sandbox)'
  fi
  # Não reproduzir a saída: login por chave pode incluir parte da credencial.
  if codex login status >/dev/null 2>&1; then ok 'codex autenticado'; else falta 'codex login status indisponível ou não autenticado'; fi
else
  falta 'codex'
fi

if versao=$(docker --version 2>/dev/null); then
  ok "$versao"
  if estado=$(docker inspect --format '{{.State.Running}}' margem-postgres 2>/dev/null); then
    if [[ "$estado" == true ]]; then ok 'container margem-postgres rodando'; else falta 'container margem-postgres parado'; fi
  else
    falta 'container margem-postgres ausente ou Docker inacessível no sandbox'
  fi
else
  falta 'docker'
fi

if node --input-type=module -e 'await import("pg")' >/dev/null 2>&1; then
  ok 'driver pg disponível'
  if node --import tsx --input-type=module -e '
    import pg from "pg";
    import { lerUrlBanco } from "./servico/src/db/configuracao.ts";
    let cliente;
    try {
      cliente = new pg.Client({ connectionString: lerUrlBanco().toString(), connectionTimeoutMillis: 3000, query_timeout: 3000 });
      await cliente.connect();
      await cliente.query("SELECT 1");
    } catch { process.exitCode = 1; }
    finally { if (cliente) await cliente.end().catch(() => { process.exitCode = 1; }); }
  ' >/dev/null 2>&1; then
    ok 'Postgres em 127.0.0.1:5435: conexão autenticada e SELECT 1'
  else
    falta 'Postgres em 127.0.0.1:5435: configuração ou conexão indisponível'
  fi
else
  falta 'driver pg ausente; conexão autenticada ao Postgres não verificada'
fi

if node --input-type=module -e '
  import { existsSync } from "node:fs";
  import { homedir } from "node:os";
  import { chromium, firefox } from "playwright";
  const cache = `${homedir()}/.cache/ms-playwright/`;
  for (const [nome, navegador] of [["chromium", chromium], ["firefox", firefox]]) {
    const caminho = navegador.executablePath();
    if (!caminho.startsWith(cache) || !existsSync(caminho)) { console.log(`falta | Playwright ${nome}: executável ausente no cache local`); process.exitCode = 1; }
    else console.log(`ok | Playwright ${nome}: ${caminho}`);
  }
' 2>/dev/null; then :; else falta 'navegadores Playwright indisponíveis'; fi

if [[ -x "$python" ]]; then
  if "$python" tools/conferir-fixtures.py; then :; else falta 'manifesto de fixtures inválido ou conteúdo divergente'; fi
else
  falta 'não foi possível conferir o manifesto sem Python do venv'
fi
if (( faltas > 0 )); then printf 'falta | %s requisito(s) obrigatório(s) não atendido(s)\n' "$faltas"; exit 1; fi
ok 'preflight completo'
