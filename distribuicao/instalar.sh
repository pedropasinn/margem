#!/usr/bin/env bash
# Instalação local (Linux, macOS ou WSL2; no Windows nativo use instalar.ps1). Uso: ./instalar.sh [comando]
#
#   iniciar      (padrão) instala na primeira vez e sobe: confere o Docker, prepara a pasta da
#                instalação, gera .env, baixa/constrói a imagem, sobe e espera a API
#   login        entra na conta ChatGPT pelo Codex (código no navegador)
#   estado       mostra os serviços, a URL e se o Codex está logado
#   parar        para os serviços (os dados ficam)
#   atualizar    faz backup, atualiza a imagem e sobe de novo
#   backup [dir] copia o banco e os arquivos para <instalação>/backups/<data>/ (ou dir)
#   restaurar d  restaura um backup feito por "backup"
#   logs         acompanha os registros (Ctrl+C sai)
#   desinstalar  remove os containers; com --apagar-dados remove também banco, livros e login
#   arte instalar [arquivo|url] [--sha256 hex]
#                instala o acervo de quadros (obras em domínio público); sem argumento baixa o
#                pacote publicado. Um arquivo local é copiado para dentro do container e apagado depois
#
# Variáveis já definidas no ambiente têm precedência: PORTA=8731 ./instalar.sh
# Compatível com o bash 3.2 do macOS.
set -euo pipefail

# ------------------------------------------------------------------ produto (ponto único)
# Valores padrão do produto. No repositório, `produto.env` ao lado deste script tem precedência;
# os dois precisam bater (tools/tests/distribuicao.test.mjs confere).
PADRAO_PRODUTO_NOME='Margem'
PADRAO_PRODUTO_PROJETO='margem'
PADRAO_PRODUTO_IMAGEM='ghcr.io/pedropasinn/margem:latest'
PADRAO_PRODUTO_RELEASE='https://github.com/pedropasinn/margem/releases/latest/download'

info() { printf '%s\n' "$*"; }
erro() { printf 'erro: %s\n' "$*" >&2; exit 1; }

ESTE="$0"
# Chamado pelo atalho (~/.local/bin/<projeto>): segue o link até o script real.
while [ -L "$ESTE" ]; do
  alvo="$(readlink "$ESTE")"
  case "$alvo" in /*) ESTE="$alvo" ;; *) ESTE="$(dirname "$ESTE")/$alvo" ;; esac
done
PASTA_SCRIPT="$(cd "$(dirname "$ESTE")" && pwd)"

# Lê CHAVE=valor (sem aspas) sem sobrescrever o que já veio do ambiente.
carregar() {
  local arquivo="$1" linha chave valor
  [ -f "$arquivo" ] || return 0
  while IFS= read -r linha || [ -n "$linha" ]; do
    linha="${linha%$'\r'}"
    case "$linha" in ''|\#*) continue ;; esac
    chave="${linha%%=*}"; valor="${linha#*=}"
    case "$chave" in ''|[!A-Za-z_]*|*[!A-Za-z0-9_]*) continue ;; esac
    # Já definida no ambiente? (eval com nome validado acima: funciona no bash 3.2 do macOS)
    if eval "[ -z \"\${$chave+x}\" ]"; then export "$chave=$valor"; fi
  done < "$arquivo"
}

carregar "$PASTA_SCRIPT/produto.env"
# Rodando da cópia na pasta da instalação (compose.yml ao lado, sem produto.env): a pasta é esta,
# e o .env dela tem o projeto, a imagem e o código-fonte.
if [ -f "$PASTA_SCRIPT/compose.yml" ] && [ ! -f "$PASTA_SCRIPT/produto.env" ]; then
  carregar "$PASTA_SCRIPT/.env"
  PASTA_INSTALACAO="${PASTA_INSTALACAO:-$PASTA_SCRIPT}"
fi
PRODUTO_NOME="${PRODUTO_NOME:-$PADRAO_PRODUTO_NOME}"
PRODUTO_PROJETO="${PRODUTO_PROJETO:-${COMPOSE_PROJECT_NAME:-$PADRAO_PRODUTO_PROJETO}}"
PRODUTO_IMAGEM="${PRODUTO_IMAGEM:-$PADRAO_PRODUTO_IMAGEM}"
PRODUTO_RELEASE="${PRODUTO_RELEASE:-$PADRAO_PRODUTO_RELEASE}"

# Pasta da instalação: compose.yml, .env (senha do banco, porta), backups e uma cópia deste script.
INSTALACAO="${PASTA_INSTALACAO:-$HOME/$PRODUTO_PROJETO}"
ARQUIVO_ENV="$INSTALACAO/.env"
# Código-fonte (para construir a imagem enquanto ela não estiver publicada): o repositório deste
# script, se houver, ou o que ficou registrado no .env da instalação.
if [ -z "${CODIGO_FONTE:-}" ] && [ -f "$PASTA_SCRIPT/../Dockerfile" ]; then
  CODIGO_FONTE="$(cd "$PASTA_SCRIPT/.." && pwd)"
fi
CODIGO_FONTE="${CODIGO_FONTE:-}"

compose() { (cd "$INSTALACAO" && docker compose "$@"); }

conferir_docker() {
  command -v docker >/dev/null 2>&1 || erro "Docker não encontrado. Instale o Docker Desktop (macOS/Windows) ou o Docker Engine (Linux)."
  docker info >/dev/null 2>&1 || erro "O Docker está instalado mas não responde. Abra o Docker Desktop ou inicie o serviço (sudo systemctl start docker)."
  docker compose version >/dev/null 2>&1 || erro "Falta o plugin 'docker compose' (v2)."
}

exigir_instalacao() {
  { [ -f "$INSTALACAO/compose.yml" ] && [ -f "$ARQUIVO_ENV" ]; } || erro "nada instalado em $INSTALACAO. Rode: $0 iniciar"
  carregar "$ARQUIVO_ENV"
}

segredo() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 24
  else LC_ALL=C tr -dc 'a-f0-9' < /dev/urandom | head -c 48; fi
}

baixar() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -q "$1" -O "$2"
  else erro "sem curl nem wget para baixar $1"; fi
}

preparar_pasta() {
  mkdir -p "$INSTALACAO"
  if [ "$PASTA_SCRIPT" != "$INSTALACAO" ]; then
    if [ -f "$PASTA_SCRIPT/compose.yml" ]; then
      cp "$PASTA_SCRIPT/compose.yml" "$INSTALACAO/compose.yml"
    elif [ ! -f "$INSTALACAO/compose.yml" ]; then
      case "$PRODUTO_RELEASE" in *'<'*) erro "sem compose.yml ao lado do script e sem endereço de release configurado." ;; esac
      info "Baixando compose.yml ..."
      baixar "$PRODUTO_RELEASE/compose.yml" "$INSTALACAO/compose.yml" \
        || erro "não foi possível baixar $PRODUTO_RELEASE/compose.yml (o release pode ainda não ter sido publicado; use o instalar.sh do repositório)."
    fi
    cp "$ESTE" "$INSTALACAO/instalar.sh"
    chmod +x "$INSTALACAO/instalar.sh"
  fi
  if [ ! -f "$ARQUIVO_ENV" ]; then
    ( umask 077
      {
        echo "# Gerado por instalar.sh em $(date '+%Y-%m-%d %H:%M'). Guarde: a senha do banco está aqui."
        echo "# O docker compose lê este arquivo sozinho: rode os comandos dentro desta pasta."
        echo "COMPOSE_PROJECT_NAME=$PRODUTO_PROJETO"
        echo "PRODUTO_IMAGEM=$PRODUTO_IMAGEM"
        echo "PORTA=${PORTA:-8730}"
        if [ -n "$CODIGO_FONTE" ]; then echo "CODIGO_FONTE=$CODIGO_FONTE"; fi
      } > "$ARQUIVO_ENV" )
    info "Instalação em $INSTALACAO (configuração em .env)"
  fi
  # Senha nova a cada banco novo (primeira instalação ou depois de "desinstalar --apagar-dados").
  grep -q '^BANCO_SENHA=' "$ARQUIVO_ENV" || echo "BANCO_SENHA=$(segredo)" >> "$ARQUIVO_ENV"
  carregar "$ARQUIVO_ENV"
}

url() { echo "http://localhost:${PORTA:-8730}"; }

construir() {
  { [ -n "$CODIGO_FONTE" ] && [ -f "$CODIGO_FONTE/Dockerfile" ]; } || return 1
  info "Construindo a imagem a partir de $CODIGO_FONTE (alguns minutos) ..."
  docker build --pull -t "$PRODUTO_IMAGEM" \
    --build-arg TITULO="$PRODUTO_PROJETO" --build-arg FONTE="${PRODUTO_REPOSITORIO:-}" \
    --build-arg REVISAO="$(git -C "$CODIGO_FONTE" rev-parse HEAD 2>/dev/null || echo desconhecida)" \
    "$CODIGO_FONTE"
}

garantir_imagem() {
  docker image inspect "$PRODUTO_IMAGEM" >/dev/null 2>&1 && return 0
  info "Baixando a imagem $PRODUTO_IMAGEM ..."
  docker pull "$PRODUTO_IMAGEM" >/dev/null 2>&1 && return 0
  construir || erro "imagem $PRODUTO_IMAGEM indisponível e sem código-fonte para construí-la."
}

esperar_saude() {
  local limite id estado
  limite=$(( $(date +%s) + ${ESPERA:-240} ))
  info "Esperando a API ficar pronta ..."
  while :; do
    id="$(compose ps -q app 2>/dev/null || true)"
    estado=ausente
    if [ -n "$id" ]; then
      estado="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo ausente)"
    fi
    [ "$estado" = "healthy" ] && return 0
    if [ "$(date +%s)" -ge "$limite" ]; then
      compose logs --tail 40 app >&2 || true
      erro "a API não ficou pronta (estado: $estado)."
    fi
    sleep 3
  done
}

codex_logado() { compose exec -T worker codex login status >/dev/null 2>&1; }

abrir_navegador() {
  [ "${SEM_NAVEGADOR:-0}" = "1" ] && return 0
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$(url)" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then open "$(url)" || true
  elif command -v wslview >/dev/null 2>&1; then wslview "$(url)" || true
  fi
}

instrucoes_login() {
  info ""
  info "Falta entrar na sua conta ChatGPT pelo Codex (uma vez só):"
  info "  $PRODUTO_PROJETO login"
  info "ou: cd $INSTALACAO && docker compose exec worker codex login --device-auth"
}

# Atalho `<projeto>` (ex.: `margem iniciar`, o que a extensão do navegador pede quando o servidor
# está fechado): link em ~/.local/bin para a cópia do script na instalação. SEM_ATALHO=1 desliga.
# Nunca sobrescreve um arquivo que não seja um link para cá.
instalar_atalho() {
  [ "${SEM_ATALHO:-0}" = "1" ] && return 0
  local pasta_bin="$HOME/.local/bin" atalho alvo="$INSTALACAO/instalar.sh"
  atalho="$pasta_bin/$PRODUTO_PROJETO"
  mkdir -p "$pasta_bin"
  if [ -e "$atalho" ] || [ -L "$atalho" ]; then
    { [ -L "$atalho" ] && [ "$(readlink "$atalho")" = "$alvo" ]; } || return 0
  else
    ln -s "$alvo" "$atalho"
  fi
  case ":$PATH:" in
    *":$pasta_bin:"*) info "Comando: $PRODUTO_PROJETO iniciar | parar | estado | atualizar | backup" ;;
    *) info "Atalho criado em $atalho (acrescente $pasta_bin ao PATH para usar '$PRODUTO_PROJETO iniciar')." ;;
  esac
}

cmd_iniciar() {
  conferir_docker
  preparar_pasta
  garantir_imagem
  compose up -d
  esperar_saude
  info ""
  info "$PRODUTO_NOME está no ar em $(url)"
  instalar_atalho
  codex_logado || instrucoes_login
  abrir_navegador
}

cmd_login() { conferir_docker; exigir_instalacao; compose exec worker codex login --device-auth; }

cmd_estado() {
  conferir_docker; exigir_instalacao
  compose ps
  info ""; info "Instalação: $INSTALACAO"; info "Endereço: $(url)"
  if codex_logado; then info "Codex: logado"; else info "Codex: sem login"; instrucoes_login; fi
}

cmd_parar() { conferir_docker; exigir_instalacao; compose stop; info "$PRODUTO_NOME parado. Os dados ficam nos volumes."; }

cmd_backup() {
  conferir_docker; exigir_instalacao
  local destino="${1:-$INSTALACAO/backups/$(date '+%Y-%m-%d-%H%M%S')}"
  mkdir -p "$destino"
  info "Banco → $destino/banco.dump"
  compose exec -T postgres pg_dump -U app -d app -Fc > "$destino/banco.dump"
  info "Arquivos → $destino/dados.tar"
  compose exec -T app tar -C /dados -cf - . > "$destino/dados.tar"
  info "Backup pronto em $destino (o login do Codex não entra no backup)."
}

cmd_restaurar() {
  local origem="${1:-}" resposta
  { [ -n "$origem" ] && [ -f "$origem/banco.dump" ] && [ -f "$origem/dados.tar" ]; } || erro "uso: $0 restaurar <pasta com banco.dump e dados.tar>"
  conferir_docker; exigir_instalacao
  printf 'Isto substitui o banco e os arquivos atuais por %s. Continuar? [s/N] ' "$origem"
  read -r resposta; case "$resposta" in s|S|sim|SIM) ;; *) erro "cancelado." ;; esac
  compose up -d postgres app
  esperar_saude
  compose stop worker >/dev/null 2>&1 || true
  compose exec -T postgres pg_restore -U app -d app --clean --if-exists --no-owner < "$origem/banco.dump"
  compose exec -T app sh -c 'find /dados -mindepth 1 -delete && tar -C /dados -xf -' < "$origem/dados.tar"
  compose restart app worker
  esperar_saude
  info "Restaurado de $origem."
}

cmd_atualizar() {
  conferir_docker; exigir_instalacao
  if compose ps -q postgres 2>/dev/null | grep -q .; then cmd_backup; fi
  if ! docker pull "$PRODUTO_IMAGEM" >/dev/null 2>&1; then
    construir || erro "não foi possível baixar $PRODUTO_IMAGEM."
  fi
  compose pull postgres >/dev/null 2>&1 || true
  compose up -d
  esperar_saude
  info "$PRODUTO_NOME atualizado: $(url)"
}

cmd_logs() { conferir_docker; exigir_instalacao; compose logs -f --tail 100; }

cmd_desinstalar() {
  conferir_docker; exigir_instalacao
  local resposta
  if [ "${1:-}" = "--apagar-dados" ]; then
    printf 'Apagar DEFINITIVAMENTE banco, livros e login do Codex? Digite "apagar": '
    read -r resposta; [ "$resposta" = "apagar" ] || erro "cancelado."
    compose down -v
    # A senha do banco apagado sai do .env; o resto (projeto, imagem, porta) fica para reinstalar.
    grep -v '^BANCO_SENHA=' "$ARQUIVO_ENV" > "$ARQUIVO_ENV.novo" || true
    mv "$ARQUIVO_ENV.novo" "$ARQUIVO_ENV"
    info "Removido, com os dados. Configuração, backups e scripts continuam em $INSTALACAO."
  else
    compose down
    info "Containers removidos. Os dados continuam nos volumes (${PRODUTO_PROJETO}_*); para apagá-los: $0 desinstalar --apagar-dados"
  fi
}

cmd_arte() {
  local sub="${1:-}"; [ $# -gt 0 ] && shift
  [ "$sub" = "instalar" ] || erro "uso: $0 arte instalar [arquivo.tar.gz|url] [--sha256 <hex>]"
  conferir_docker; exigir_instalacao
  local args=() temporario='' alvo
  while [ $# -gt 0 ]; do
    case "$1" in
      --sha256) [ $# -ge 2 ] || erro "--sha256 precisa do hash"; args+=(--sha256 "$2"); shift 2 ;;
      -*) erro "opção desconhecida: $1" ;;
      *)
        alvo="$1"; shift
        case "$alvo" in
          http://*|https://*) args+=("$alvo") ;;
          *)
            [ -f "$alvo" ] || erro "arquivo não encontrado: $alvo"
            # O arquivo está no computador, não no container: vai para a pasta temporária do app
            # (no volume da imagem, não no de dados) e é apagado no fim.
            temporario="/home/app/tmp/acervo-$$.tar.gz"
            info "Copiando $alvo para o container…"
            compose cp "$alvo" "app:$temporario"
            compose exec -T -u root app chown app:app "$temporario"
            args+=("$temporario") ;;
        esac ;;
    esac
  done
  local saida=0
  compose exec -T app npm run --silent arte:instalar -- ${args[@]+"${args[@]}"} || saida=$?
  if [ -n "$temporario" ]; then compose exec -T app rm -f "$temporario" >/dev/null 2>&1 || true; fi
  return "$saida"
}

comando="${1:-iniciar}"; [ $# -gt 0 ] && shift
case "$comando" in
  iniciar|instalar) cmd_iniciar ;;
  login) cmd_login ;;
  estado|status) cmd_estado ;;
  parar) cmd_parar ;;
  atualizar) cmd_atualizar ;;
  backup) cmd_backup "$@" ;;
  restaurar) cmd_restaurar "$@" ;;
  logs) cmd_logs ;;
  desinstalar) cmd_desinstalar "$@" ;;
  arte) cmd_arte "$@" ;;
  -h|--help|ajuda) sed -n '2,19p' "$ESTE" | sed 's/^# \{0,1\}//' ;;
  *) erro "comando desconhecido: $comando (veja $0 ajuda)" ;;
esac
