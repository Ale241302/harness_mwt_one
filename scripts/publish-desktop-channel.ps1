# =====================================================================
# MWT.ONE · publicar el canal de actualizacion del escritorio FaberLoom
#
# Uso (desde el checkout del harness):
#   pwsh -File scripts/publish-desktop-channel.ps1 -Target win-x64
#   pwsh -File scripts/publish-desktop-channel.ps1 -Target mac-arm64 -SkipStaging
#
# El paquete calcula la URL de su actualizador como
#   <origen>/_/harness/desktop/stable/<target>/
# asi que este script deja el arbol validado exactamente en esa ruta del VPS,
# que es el origen de produccion del fork (DOWNLOAD_PROD_ORIGIN, por defecto
# https://harness.mwt.one). No interviene ninguna cuenta de almacenamiento de
# terceros: el canal vive en el mismo host que ya sirve el producto.
#
# El entorno debe ser el mismo con el que se empaqueto (DSH_DESKTOP_AUTO_UPDATE_ENV
# y, si aplica, DOWNLOAD_PROD_ORIGIN): el registro de release del paquete cita el
# destino y la validacion rechaza un paquete de otro canal.
# =====================================================================
param(
  [ValidateSet('win-x64', 'mac-arm64', 'mac-x64')]
  [string]$Target = 'win-x64',
  [string]$SshHost = '187.77.218.102',
  [int]$Port = 2222,
  [string]$User = 'root',
  [string]$ChannelRoot = '/opt/mwt/harness-desktop-channel',
  [string]$PublicOrigin = 'https://harness.mwt.one',
  [switch]$SkipStaging
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Invoke-Native {
  param([Parameter(Mandatory)][scriptblock]$Command, [string]$What = 'comando')
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Command | Out-Host } finally { $ErrorActionPreference = $previous }
  if ($LASTEXITCODE -ne 0) { throw "$What fallo (exit $LASTEXITCODE)" }
}

# pnpm no esta en el PATH de todas las estaciones (aqui se invoca por corepack).
function Invoke-Pnpm {
  param([Parameter(Mandatory)][string[]]$Arguments, [string]$What = 'pnpm')
  $ErrorActionPreference = 'Continue'
  try {
    if (Get-Command pnpm -ErrorAction SilentlyContinue) { & pnpm @Arguments } else { & corepack pnpm @Arguments }
  } finally {
    $ErrorActionPreference = 'Stop'
  }
  if ($LASTEXITCODE -ne 0) { throw "$What fallo (exit $LASTEXITCODE)" }
}

$keyPrefix = "_/harness/desktop/stable/$Target"
$stage = Join-Path $env:TEMP 'mwt-desktop-channel'
$payload = Join-Path $env:TEMP 'mwt-desktop-channel.tgz'

if (-not $SkipStaging) {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  Write-Host "==> Validando y preparando $Target en $stage"
  # El staging valida el paquete (registro de release, version, sha512 y
  # metadata del canal) antes de que nada viaje por la red.
  $env:DSH_DESKTOP_CHANNEL_DIR = $stage
  Invoke-Pnpm -Arguments @('run', "channel:$Target") -What "channel:$Target"
}

$releaseDir = Join-Path $stage ($keyPrefix -replace '/', [IO.Path]::DirectorySeparatorChar)
if (-not (Test-Path -LiteralPath $releaseDir)) {
  throw "No hay nada que publicar en $releaseDir. Ejecuta el staging (sin -SkipStaging) o empaqueta el canal primero."
}

Write-Host "==> Empaquetando el canal en un solo archivo"
if (Test-Path -LiteralPath $payload) { Remove-Item -LiteralPath $payload -Force }
Invoke-Native { tar -czf $payload -C $stage . } 'tar del canal'
Write-Host ("    {0:N1} KB" -f ((Get-Item $payload).Length / 1KB))

Write-Host "==> Asegurando $ChannelRoot"
Invoke-Native { ssh -p $Port -o LogLevel=ERROR "${User}@${SshHost}" "mkdir -p $ChannelRoot" } 'ssh mkdir'

Write-Host "==> Subiendo y publicando $keyPrefix"
Invoke-Native { scp -P $Port -o LogLevel=ERROR $payload "${User}@${SshHost}:/tmp/mwt-desktop-channel.tgz" } 'scp del canal'
# Solo se reemplaza el directorio del target que se publica: los demas targets
# del canal (mac-arm64, mac-x64) siguen sirviendo su ultima version.
Invoke-Native {
  ssh -p $Port -o LogLevel=ERROR "${User}@${SshHost}" "rm -rf $ChannelRoot/$keyPrefix && tar -xzf /tmp/mwt-desktop-channel.tgz -C $ChannelRoot && rm -f /tmp/mwt-desktop-channel.tgz"
} 'publicacion en el VPS'
Remove-Item -LiteralPath $payload -Force -ErrorAction SilentlyContinue

$publicUrl = "$PublicOrigin/$keyPrefix/"
Write-Host "==> Canal publicado en $publicUrl"
$metadata = if ($Target -eq 'mac-arm64' -or $Target -eq 'mac-x64') { 'latest-mac.yml' } else { 'latest.yml' }
$status = $null
try {
  $status = (Invoke-WebRequest -Uri "$publicUrl$metadata" -UseBasicParsing -Method Head -TimeoutSec 20).StatusCode
} catch {
  Write-Host "    AVISO: $publicUrl$metadata no responde todavia ($($_.Exception.Message))"
  Write-Host "    Comprueba que nginx sirve /_/harness/desktop/ desde $ChannelRoot (nginx/harness.conf)."
  exit 1
}
Write-Host "    $metadata responde $status"
Write-Host "OK"
