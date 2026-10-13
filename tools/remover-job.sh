#!/usr/bin/env bash
set -euo pipefail
if [[ $# != 1 || ! $1 =~ ^[Jj][0-9]{2}$ ]]; then
  printf 'Uso: %s <Jnn>\n' "$0" >&2
  exit 1
fi
job=${1,,}
origem=$(git -C "$(dirname -- "${BASH_SOURCE[0]}")/.." rev-parse --path-format=absolute --git-common-dir)
raiz=$(dirname -- "$origem")
destino="$(dirname -- "$raiz")/margem-wt/$job"
if [[ ! -d "$destino" ]] || [[ $(git -C "$destino" branch --show-current) != "$job" ]]; then
  printf 'falta | worktree não encontrada na branch esperada: %s\n' "$job" >&2
  exit 1
fi
if ! git -C "$raiz" merge-base --is-ancestor "$job" main; then
  printf 'falta | branch ainda não mesclada em main: %s\n' "$job" >&2
  exit 1
fi
if [[ -n $(git -C "$destino" status --porcelain) ]]; then
  printf 'falta | worktree tem alterações; remoção recusada\n' >&2
  exit 1
fi
git -C "$raiz" worktree remove "$destino"
git -C "$raiz" branch -d "$job"
printf 'ok | worktree e branch integrada removidas: %s\n' "$job"
