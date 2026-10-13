<#
  Instalação local no Windows (Docker Desktop). Uso: .\instalar.ps1 [comando]

    iniciar      (padrão) instala na primeira vez e sobe: confere o Docker, prepara a pasta da
                 instalação, gera .env, baixa/constrói a imagem, sobe e espera a API
    login        entra na conta ChatGPT pelo Codex (código no navegador)
    estado       mostra os serviços, a URL e se o Codex está logado
    parar        para os serviços (os dados ficam)
    atualizar    faz backup, atualiza a imagem e sobe de novo
    backup [dir] copia o banco e os arquivos para <instalação>\backups\<data>\ (ou dir)
    restaurar d  restaura um backup feito por "backup"
    logs         acompanha os registros (Ctrl+C sai)
    desinstalar  remove os containers; com -ApagarDados remove também banco, livros e login
    arte instalar [arquivo|url] [-Sha256 hex]
                 instala o acervo de quadros (obras em domínio público); sem argumento baixa o
                 pacote publicado. Um arquivo local é copiado para dentro do container e apagado depois

  Equivale a instalar.sh. Variáveis de ambiente já definidas têm precedência:
  $env:PORTA = 8731; .\instalar.ps1
  Se o PowerShell recusar o script: powershell -ExecutionPolicy Bypass -File .\instalar.ps1
  Compatível com o Windows PowerShell 5.1 e o PowerShell 7.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)] [string] $Comando = 'iniciar',
  [Parameter(Position = 1)] [string] $Pasta = '',
  [Parameter(Position = 2)] [string] $Alvo = '',
  [string] $Sha256 = '',
  [switch] $ApagarDados
)
$ErrorActionPreference = 'Stop'

# ------------------------------------------------------------------ produto (ponto único)
# Valores padrão do produto. No repositório, `produto.env` ao lado deste script tem precedência;
# os dois precisam bater (tools/tests/distribuicao.test.mjs confere).
$PADRAO_PRODUTO_NOME = 'Margem'
$PADRAO_PRODUTO_PROJETO = 'margem'
$PADRAO_PRODUTO_IMAGEM = 'ghcr.io/pedropasinn/margem:latest'
$PADRAO_PRODUTO_RELEASE = 'https://github.com/pedropasinn/margem/releases/latest/download'

$Este = $PSCommandPath
$PastaScript = $PSScriptRoot
$SemBom = New-Object System.Text.UTF8Encoding($false)

function Info([string] $Texto) { Write-Host $Texto }
function Falhar([string] $Texto) { Write-Host "erro: $Texto" -ForegroundColor Red; exit 1 }

# Lê CHAVE=valor (sem aspas) sem sobrescrever o que já veio do ambiente.
function Carregar([string] $Arquivo) {
  if (-not (Test-Path -LiteralPath $Arquivo)) { return }
  foreach ($linha in [System.IO.File]::ReadAllLines($Arquivo)) {
    $l = $linha.Trim()
    if ($l -eq '' -or $l.StartsWith('#') -or -not $l.Contains('=')) { continue }
    $i = $l.IndexOf('=')
    $chave = $l.Substring(0, $i); $valor = $l.Substring($i + 1)
    if ($chave -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { continue }
    if (-not (Test-Path "env:$chave")) { Set-Item -Path "env:$chave" -Value $valor }
  }
}

function Valor([string] $Nome, [string] $Padrao) {
  $v = [Environment]::GetEnvironmentVariable($Nome)
  if ($v) { return $v } else { return $Padrao }
}

Carregar (Join-Path $PastaScript 'produto.env')
# Rodando da cópia na pasta da instalação (compose.yml ao lado, sem produto.env): a pasta é esta,
# e o .env dela tem o projeto, a imagem e o código-fonte.
if ((Test-Path (Join-Path $PastaScript 'compose.yml')) -and -not (Test-Path (Join-Path $PastaScript 'produto.env'))) {
  Carregar (Join-Path $PastaScript '.env')
  if (-not $env:PASTA_INSTALACAO) { $env:PASTA_INSTALACAO = $PastaScript }
}
$Nome = Valor 'PRODUTO_NOME' $PADRAO_PRODUTO_NOME
$Projeto = Valor 'PRODUTO_PROJETO' (Valor 'COMPOSE_PROJECT_NAME' $PADRAO_PRODUTO_PROJETO)
$Imagem = Valor 'PRODUTO_IMAGEM' $PADRAO_PRODUTO_IMAGEM
$Release = Valor 'PRODUTO_RELEASE' $PADRAO_PRODUTO_RELEASE

# Pasta da instalação: compose.yml, .env (senha do banco, porta), backups e uma cópia deste script.
$Instalacao = Valor 'PASTA_INSTALACAO' (Join-Path $HOME $Projeto)
$ArquivoEnv = Join-Path $Instalacao '.env'
# Código-fonte (para construir a imagem enquanto ela não estiver publicada).
$CodigoFonte = Valor 'CODIGO_FONTE' ''
if (-not $CodigoFonte) {
  $acima = Split-Path -Parent $PastaScript
  if ($acima -and (Test-Path (Join-Path $acima 'Dockerfile'))) { $CodigoFonte = (Resolve-Path $acima).Path }
}

function Compose {
  Push-Location $Instalacao
  try {
    & docker compose @args
    if ($LASTEXITCODE -ne 0) { Falhar "docker compose $($args -join ' ') saiu com $LASTEXITCODE" }
  } finally { Pop-Location }
}

function ComposeSilencioso {
  Push-Location $Instalacao
  try { & docker compose @args 2>$null | Out-Null; return ($LASTEXITCODE -eq 0) } finally { Pop-Location }
}

function ConferirDocker {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Falhar 'Docker não encontrado. Instale o Docker Desktop: https://docs.docker.com/desktop/setup/install/windows-install/'
  }
  & docker info 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Falhar 'O Docker está instalado mas não responde. Abra o Docker Desktop e espere ele ficar pronto.' }
  & docker compose version 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Falhar "Falta o 'docker compose' (v2). Atualize o Docker Desktop." }
}

function ExigirInstalacao {
  if (-not ((Test-Path (Join-Path $Instalacao 'compose.yml')) -and (Test-Path $ArquivoEnv))) {
    Falhar "nada instalado em $Instalacao. Rode: .\instalar.ps1 iniciar"
  }
  Carregar $ArquivoEnv
}

function Segredo {
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function PrepararPasta {
  New-Item -ItemType Directory -Force -Path $Instalacao | Out-Null
  $mesmaPasta = (Resolve-Path $PastaScript).Path.TrimEnd('\', '/') -eq (Resolve-Path $Instalacao).Path.TrimEnd('\', '/')
  if (-not $mesmaPasta) {
    $composeAoLado = Join-Path $PastaScript 'compose.yml'
    $composeDestino = Join-Path $Instalacao 'compose.yml'
    if (Test-Path $composeAoLado) { Copy-Item -LiteralPath $composeAoLado -Destination $composeDestino -Force }
    elseif (-not (Test-Path $composeDestino)) {
      if ($Release.Contains('<')) { Falhar 'sem compose.yml ao lado do script e sem endereço de release configurado.' }
      Info 'Baixando compose.yml ...'
      Invoke-WebRequest -UseBasicParsing -Uri "$Release/compose.yml" -OutFile $composeDestino
    }
    Copy-Item -LiteralPath $Este -Destination (Join-Path $Instalacao 'instalar.ps1') -Force
  }
  if (-not (Test-Path -LiteralPath $ArquivoEnv)) {
    $porta = Valor 'PORTA' '8730'
    $linhas = @(
      "# Gerado por instalar.ps1 em $(Get-Date -Format 'yyyy-MM-dd HH:mm'). Guarde: a senha do banco está aqui.",
      '# O docker compose lê este arquivo sozinho: rode os comandos dentro desta pasta.',
      "COMPOSE_PROJECT_NAME=$Projeto",
      "PRODUTO_IMAGEM=$Imagem",
      "PORTA=$porta"
    )
    if ($CodigoFonte) { $linhas += "CODIGO_FONTE=$CodigoFonte" }
    # LF e sem BOM: o mesmo formato que o instalar.sh gera.
    [System.IO.File]::WriteAllText($ArquivoEnv, (($linhas -join "`n") + "`n"), $SemBom)
    Info "Instalação em $Instalacao (configuração em .env)"
  }
  # Senha nova a cada banco novo (primeira instalação ou depois de "desinstalar -ApagarDados").
  $texto = [System.IO.File]::ReadAllText($ArquivoEnv)
  if ($texto -notmatch '(?m)^BANCO_SENHA=') {
    if ($texto -and -not $texto.EndsWith("`n")) { $texto += "`n" }
    [System.IO.File]::WriteAllText($ArquivoEnv, $texto + "BANCO_SENHA=$(Segredo)`n", $SemBom)
  }
  Carregar $ArquivoEnv
}

function Url { return "http://localhost:$(Valor 'PORTA' '8730')" }

function Construir {
  if (-not ($CodigoFonte -and (Test-Path (Join-Path $CodigoFonte 'Dockerfile')))) { return $false }
  Info "Construindo a imagem a partir de $CodigoFonte (alguns minutos) ..."
  $revisao = (& git -C $CodigoFonte rev-parse HEAD 2>$null)
  if (-not $revisao) { $revisao = 'desconhecida' }
  & docker build --pull -t $Imagem --build-arg "TITULO=$Projeto" --build-arg "FONTE=$(Valor 'PRODUTO_REPOSITORIO' '')" --build-arg "REVISAO=$revisao" $CodigoFonte | Out-Host
  if ($LASTEXITCODE -ne 0) { Falhar 'a construção da imagem falhou.' }
  return $true
}

function GarantirImagem {
  & docker image inspect $Imagem 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { return }
  Info "Baixando a imagem $Imagem ..."
  & docker pull $Imagem 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { return }
  if (-not (Construir)) { Falhar "imagem $Imagem indisponível e sem código-fonte para construí-la." }
}

function EsperarSaude {
  $limite = (Get-Date).AddSeconds([int] (Valor 'ESPERA' '240'))
  Info 'Esperando a API ficar pronta ...'
  while ($true) {
    Push-Location $Instalacao
    try { $id = (& docker compose ps -q app 2>$null | Select-Object -First 1) } finally { Pop-Location }
    $estado = 'ausente'
    if ($id) { $estado = (& docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $id 2>$null) }
    if ($estado -eq 'healthy') { return }
    if ((Get-Date) -gt $limite) { Compose logs --tail 40 app; Falhar "a API não ficou pronta (estado: $estado)." }
    Start-Sleep -Seconds 3
  }
}

function CodexLogado { return (ComposeSilencioso exec -T worker codex login status) }

function InstrucoesLogin {
  Info ''
  Info 'Falta entrar na sua conta ChatGPT pelo Codex (uma vez só):'
  Info "  $Projeto login"
  Info "ou: cd $Instalacao; docker compose exec worker codex login --device-auth"
}

# Atalho `<projeto> iniciar` (ex.: `margem iniciar`, o que a extensão pede com o servidor fechado):
# um .cmd em %LOCALAPPDATA%\Microsoft\WindowsApps, pasta que o Windows já põe no PATH.
# SEM_ATALHO=1 desliga. Só reescreve um .cmd criado por este script.
function InstalarAtalho {
  if ($env:SEM_ATALHO -eq '1' -or -not $env:LOCALAPPDATA) { return }
  $pastaBin = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'
  if (-not (Test-Path -LiteralPath $pastaBin)) { return }
  $atalho = Join-Path $pastaBin "$Projeto.cmd"
  $marca = 'REM criado por instalar.ps1'
  if ((Test-Path -LiteralPath $atalho) -and -not ((Get-Content -LiteralPath $atalho -Raw) -match [regex]::Escape($marca))) { return }
  $alvo = Join-Path $Instalacao 'instalar.ps1'
  $conteudo = "@echo off`r`n$marca`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"$alvo`" %*`r`n"
  # O cmd lê .cmd na página de código OEM; caminhos com acento (C:\Users\João) precisam dela.
  try { $codificacao = [System.Text.Encoding]::GetEncoding([System.Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage) }
  catch { $codificacao = New-Object System.Text.ASCIIEncoding }
  [System.IO.File]::WriteAllText($atalho, $conteudo, $codificacao)
  Info "Comando: $Projeto iniciar | parar | estado | atualizar | backup"
}

function Cmd-Iniciar {
  ConferirDocker; PrepararPasta; GarantirImagem
  Compose up -d
  EsperarSaude
  Info ''; Info "$Nome está no ar em $(Url)"
  InstalarAtalho
  if (-not (CodexLogado)) { InstrucoesLogin }
  if ($env:SEM_NAVEGADOR -ne '1') { Start-Process (Url) | Out-Null }
}

function Cmd-Backup([string] $Destino) {
  ConferirDocker; ExigirInstalacao
  if (-not $Destino) { $Destino = Join-Path (Join-Path $Instalacao 'backups') (Get-Date -Format 'yyyy-MM-dd-HHmmss') }
  New-Item -ItemType Directory -Force -Path $Destino | Out-Null
  $Destino = (Resolve-Path $Destino).Path
  # Cópia binária pelo `docker compose cp`: o redirecionamento do PowerShell 5.1 corrompe bytes.
  Info "Banco -> $(Join-Path $Destino 'banco.dump')"
  Compose exec -T postgres pg_dump -U app -d app -Fc -f /tmp/banco.dump
  Compose cp postgres:/tmp/banco.dump (Join-Path $Destino 'banco.dump')
  Compose exec -T postgres rm -f /tmp/banco.dump
  Info "Arquivos -> $(Join-Path $Destino 'dados.tar')"
  Compose exec -T app tar -C /dados -cf /home/app/tmp/dados.tar .
  Compose cp app:/home/app/tmp/dados.tar (Join-Path $Destino 'dados.tar')
  Compose exec -T app rm -f /home/app/tmp/dados.tar
  Info "Backup pronto em $Destino (o login do Codex não entra no backup)."
}

function Cmd-Restaurar([string] $Origem) {
  if (-not $Origem -or -not (Test-Path (Join-Path $Origem 'banco.dump')) -or -not (Test-Path (Join-Path $Origem 'dados.tar'))) {
    Falhar 'uso: .\instalar.ps1 restaurar <pasta com banco.dump e dados.tar>'
  }
  $Origem = (Resolve-Path $Origem).Path
  ConferirDocker; ExigirInstalacao
  $resposta = Read-Host "Isto substitui o banco e os arquivos atuais por $Origem. Continuar? [s/N]"
  if ($resposta -notmatch '^(s|sim)$') { Falhar 'cancelado.' }
  Compose up -d postgres app
  EsperarSaude
  ComposeSilencioso stop worker | Out-Null
  Compose cp (Join-Path $Origem 'banco.dump') postgres:/tmp/banco.dump
  Compose exec -T postgres pg_restore -U app -d app --clean --if-exists --no-owner /tmp/banco.dump
  Compose exec -T postgres rm -f /tmp/banco.dump
  Compose cp (Join-Path $Origem 'dados.tar') app:/home/app/tmp/dados.tar
  Compose exec -T app sh -c 'find /dados -mindepth 1 -delete && tar -C /dados -xf /home/app/tmp/dados.tar; s=$?; rm -f /home/app/tmp/dados.tar; exit $s'
  Compose restart app worker
  EsperarSaude
  Info "Restaurado de $Origem."
}

function Cmd-Atualizar {
  ConferirDocker; ExigirInstalacao
  if (ComposeSilencioso exec -T postgres true) { Cmd-Backup '' }
  & docker pull $Imagem 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    if (-not (Construir)) { Falhar "não foi possível baixar $Imagem." }
  }
  ComposeSilencioso pull postgres | Out-Null
  Compose up -d
  EsperarSaude
  Info "$Nome atualizado: $(Url)"
}

function Cmd-Desinstalar {
  ConferirDocker; ExigirInstalacao
  if ($ApagarDados -or $Pasta -eq '--apagar-dados') {
    $resposta = Read-Host 'Apagar DEFINITIVAMENTE banco, livros e login do Codex? Digite "apagar"'
    if ($resposta -ne 'apagar') { Falhar 'cancelado.' }
    Compose down -v
    # A senha do banco apagado sai do .env; o resto (projeto, imagem, porta) fica para reinstalar.
    $linhas = [System.IO.File]::ReadAllLines($ArquivoEnv) | Where-Object { $_ -notmatch '^BANCO_SENHA=' }
    [System.IO.File]::WriteAllText($ArquivoEnv, (($linhas -join "`n") + "`n"), $SemBom)
    Info "Removido, com os dados. Configuração, backups e scripts continuam em $Instalacao."
  } else {
    Compose down
    Info "Containers removidos. Os dados continuam nos volumes (${Projeto}_*); para apagá-los: .\instalar.ps1 desinstalar -ApagarDados"
  }
}

function Cmd-Arte {
  if ($Pasta -ne 'instalar') { Falhar 'uso: .\instalar.ps1 arte instalar [arquivo.tar.gz|url] [-Sha256 <hex>]' }
  ConferirDocker; ExigirInstalacao
  $argumentos = @()
  $temporario = ''
  if ($Alvo -match '^https?://') {
    $argumentos += $Alvo
  } elseif ($Alvo) {
    if (-not (Test-Path -LiteralPath $Alvo -PathType Leaf)) { Falhar "arquivo não encontrado: $Alvo" }
    # O arquivo está no computador, não no container: vai para a pasta temporária do app e é apagado no fim.
    # Cópia binária pelo `docker compose cp` (o redirecionamento do PowerShell 5.1 corrompe bytes).
    $temporario = "/home/app/tmp/acervo-$PID.tar.gz"
    Info "Copiando $Alvo para o container..."
    Compose cp (Resolve-Path -LiteralPath $Alvo).Path "app:$temporario"
    Compose exec -T -u root app chown app:app $temporario
    $argumentos += $temporario
  }
  if ($Sha256) { $argumentos += @('--sha256', $Sha256) }
  Push-Location $Instalacao
  try {
    & docker compose exec -T app npm run --silent arte:instalar -- @argumentos
    $saida = $LASTEXITCODE
    if ($temporario) { & docker compose exec -T app rm -f $temporario 2>$null | Out-Null }
  } finally { Pop-Location }
  if ($saida -ne 0) { exit $saida }
}

switch ($Comando) {
  { $_ -in 'iniciar', 'instalar' } { Cmd-Iniciar; break }
  'login' { ConferirDocker; ExigirInstalacao; Compose exec worker codex login --device-auth; break }
  { $_ -in 'estado', 'status' } {
    ConferirDocker; ExigirInstalacao; Compose ps
    Info ''; Info "Instalação: $Instalacao"; Info "Endereço: $(Url)"
    if (CodexLogado) { Info 'Codex: logado' } else { Info 'Codex: sem login'; InstrucoesLogin }
    break
  }
  'parar' { ConferirDocker; ExigirInstalacao; Compose stop; Info "$Nome parado. Os dados ficam nos volumes."; break }
  'atualizar' { Cmd-Atualizar; break }
  'backup' { Cmd-Backup $Pasta; break }
  'restaurar' { Cmd-Restaurar $Pasta; break }
  'logs' { ConferirDocker; ExigirInstalacao; Compose logs -f --tail 100; break }
  'desinstalar' { Cmd-Desinstalar; break }
  'arte' { Cmd-Arte; break }
  { $_ -in 'ajuda', '-h', '--help' } { Get-Help $PSCommandPath; break }
  default { Falhar "comando desconhecido: $Comando (veja .\instalar.ps1 ajuda)" }
}
