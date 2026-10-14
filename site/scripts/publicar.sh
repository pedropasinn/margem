#!/usr/bin/env bash
# Publica o site na Vercel (projeto margem-site) com o build feito AQUI.
# O site importa componentes de web/ (J121), que não sobem quando a pasta enviada é só site/;
# por isso o build é local (`vercel build`) e o envio é do resultado pronto (`--prebuilt`).
#
#   bash site/scripts/publicar.sh          # produção (margem.dev)
#   bash site/scripts/publicar.sh --previa # só uma prévia *.vercel.app
set -euo pipefail
cd "$(dirname "$0")/.."
alvo=(--prod)
[[ "${1:-}" == "--previa" ]] && alvo=()
(cd .. && npm ci --prefer-offline --silent)
npm ci --prefer-offline --silent
vercel pull --yes --environment="$([[ ${#alvo[@]} -gt 0 ]] && echo production || echo preview)"
vercel build "${alvo[@]}"
vercel deploy --prebuilt "${alvo[@]}"
