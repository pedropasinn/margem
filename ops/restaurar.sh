#!/usr/bin/env bash
# Restauração da Margem a partir de um backup de ops/backup.sh.
#   bash ops/restaurar.sh --origem ~/backups/margem/2026-09-20 --banco margem_restauro \
#                          --dados /tmp/margem-restauro
# Cria um banco vazio (recusa sobrescrever um existente), restaura o dump e copia
# os arquivos. A restauração de verdade, com conferência, é o teste do J10.
set -Eeuo pipefail

CONFIG="${MARGEM_CONFIG:-$HOME/.config/margem/postgres.env}"
DADOS="${MARGEM_DADOS:-$HOME/dados/margem}"
CONTAINER="${MARGEM_PG_CONTAINER:-margem-postgres}"
ORIGEM=""
BANCO_PEDIDO=""

# Aceita a forma posicional (`<origem> [banco]`) e a de bandeiras que o J10 exercita:
#   bash ops/restaurar.sh --origem <dir> --banco margem_restauro --dados /tmp/margem-restauro
while (($#)); do
  case "$1" in
    --origem) ORIGEM="${2:-}"; shift 2 ;;
    --banco) BANCO_PEDIDO="${2:-}"; shift 2 ;;
    --dados) DADOS="${2:-}"; shift 2 ;;
    --*) echo "restaurar: opção desconhecida $1" >&2; exit 1 ;;
    *) if [[ -z "$ORIGEM" ]]; then ORIGEM="$1"; else BANCO_PEDIDO="$1"; fi; shift ;;
  esac
done

# Sem `--origem`, o backup mais recente de ~/backups/margem.
if [[ -z "$ORIGEM" ]]; then
  RAIZ_BACKUPS="${MARGEM_BACKUPS:-$HOME/backups/margem}"
  ORIGEM="$(find "$RAIZ_BACKUPS" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | tail -n 1)"
fi

if [[ -z "$ORIGEM" || ! -f "$ORIGEM/margem.dump" ]]; then
  echo "uso: bash ops/restaurar.sh [--origem <dir>] [--banco <nome>] [--dados <dir>]" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$CONFIG"; set +a
: "${POSTGRES_USER:?POSTGRES_USER ausente}"
BANCO="${BANCO_PEDIDO:-margem_restaurado}"

if [[ ! "$BANCO" =~ ^[a-z][a-z0-9_]{0,50}$ ]]; then
  echo "restaurar: nome de banco inválido" >&2
  exit 1
fi

executar() {
  docker exec -i -e PGPASSWORD="${POSTGRES_PASSWORD:-}" "$CONTAINER" "$@"
}

if executar psql -U "$POSTGRES_USER" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='$BANCO'" | grep -q 1; then
  echo "restaurar: o banco $BANCO já existe; escolha outro nome" >&2
  exit 1
fi

executar createdb -U "$POSTGRES_USER" "$BANCO"
executar pg_restore -U "$POSTGRES_USER" -d "$BANCO" --no-owner < "$ORIGEM/margem.dump"

if [[ -d "$ORIGEM/dados" ]]; then
  mkdir -p "$DADOS"
  rsync -a "$ORIGEM/dados/" "$DADOS/"
fi

echo "{\"banco\":\"$BANCO\",\"origem\":\"$ORIGEM\",\"dados\":\"$DADOS\"}"
