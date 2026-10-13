#!/usr/bin/env bash
# Backup da Margem: dump do banco + cópia dos arquivos, com retenção de 14 dias.
#   bash ops/backup.sh
# Destino: ~/backups/margem/<AAAA-MM-DD>/ (sobrescreve o do dia).
set -Eeuo pipefail

CONFIG="${MARGEM_CONFIG:-$HOME/.config/margem/postgres.env}"
DADOS="${MARGEM_DADOS:-$HOME/dados/margem}"
DESTINO_RAIZ="${MARGEM_BACKUPS:-$HOME/backups/margem}"
RETENCAO_DIAS="${MARGEM_RETENCAO_DIAS:-14}"
CONTAINER="${MARGEM_PG_CONTAINER:-margem-postgres}"

if [[ ! -r "$CONFIG" ]]; then
  echo "backup: não consigo ler $CONFIG" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$CONFIG"; set +a
: "${POSTGRES_USER:?POSTGRES_USER ausente}"
BANCO="${MARGEM_BANCO:-${POSTGRES_DB:-margem}}"

DIA="$(date +%F)"
DESTINO="$DESTINO_RAIZ/$DIA"
mkdir -p "$DESTINO"
chmod 700 "$DESTINO_RAIZ" "$DESTINO"

# O dump sai de dentro do container: não é preciso pg_dump instalado no host.
docker exec -i -e PGPASSWORD="${POSTGRES_PASSWORD:-}" "$CONTAINER" \
  pg_dump -U "$POSTGRES_USER" -d "$BANCO" --format=custom \
  > "$DESTINO/margem.dump.parcial"
mv "$DESTINO/margem.dump.parcial" "$DESTINO/margem.dump"
chmod 600 "$DESTINO/margem.dump"

if [[ -d "$DADOS" ]]; then
  rsync -a --delete "$DADOS/" "$DESTINO/dados/"
fi

sha256sum "$DESTINO/margem.dump" > "$DESTINO/SHA256SUMS"
echo "{\"dia\":\"$DIA\",\"banco\":\"$BANCO\",\"destino\":\"$DESTINO\"}"

# Retenção: apaga diretórios de backup mais velhos que a janela.
find "$DESTINO_RAIZ" -mindepth 1 -maxdepth 1 -type d -mtime "+$RETENCAO_DIAS" -exec rm -rf {} +
