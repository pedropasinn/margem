#!/usr/bin/env bash
# Deriva geometria sem recanonizar; aceita originais na versão ou no documento.
set -euo pipefail
if [[ $# -lt 1 || $# -gt 2 || ( $# -eq 2 && $2 != --forcar ) ]]; then
  echo 'Uso: gerar-geometria.sh <pasta de dados> [--forcar]' >&2
  exit 2
fi
margem_raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
margem_dados="$1"
for margem_canonico in "$margem_dados"/*/versao-*/canonico.json; do
  [[ -f "$margem_canonico" ]] || continue
  margem_pasta="${margem_canonico%/*}"
  [[ ! -e "$margem_pasta/geometria.json" || ${2:-} == --forcar ]] || continue
  margem_original="$margem_pasta/original.pdf"
  [[ -f "$margem_original" ]] || margem_original="${margem_pasta%/*}/original.pdf"
  [[ -f "$margem_original" ]] || continue
  margem_opcoes=()
  [[ ${2:-} != --forcar ]] || margem_opcoes+=(--forcar)
  PYTHONPATH="$margem_raiz/motor${PYTHONPATH:+:$PYTHONPATH}" "$margem_raiz/motor/.venv/bin/python" \
    -m margem_motor.geometria --canonico "$margem_canonico" --entrada "$margem_original" \
    --saida "$margem_pasta/geometria.json" "${margem_opcoes[@]}"
done
