# =====================================================================
# Harness MWT · push local → VPS
#
# Uso (desde esta carpeta harness-mwt-one):
#   pwsh -File scripts/push-to-vps.ps1              # solo sube
#   pwsh -File scripts/push-to-vps.ps1 -Deploy      # sube y despliega
#
# No sube .env ni node_modules (el .env del VPS se conserva).
# =====================================================================
param(
  [string]$SshHost = "187.77.218.102",
  [int]$Port = 2222,
  [string]$User = "root",
  [string]$RemoteDir = "/opt/harness-mwt-one",
  [switch]$Deploy
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$tar = Join-Path $env:TEMP "harness-mwt-one.tgz"
if (Test-Path $tar) { Remove-Item $tar }

Write-Host "==> Empaquetando $root"
tar -czf $tar --exclude=node_modules --exclude=.env --exclude=.git -C $root .
Write-Host ("    {0:N0} KB" -f ((Get-Item $tar).Length / 1KB))

Write-Host "==> Subiendo a ${User}@${SshHost}:/tmp/"
scp -P $Port $tar "${User}@${SshHost}:/tmp/harness-mwt-one.tgz"

Write-Host "==> Extrayendo en $RemoteDir"
$remote = "mkdir -p $RemoteDir && tar -xzf /tmp/harness-mwt-one.tgz -C $RemoteDir && rm -f /tmp/harness-mwt-one.tgz && echo 'contenido:' && ls -1 $RemoteDir"
ssh -p $Port "${User}@${SshHost}" $remote

if ($Deploy) {
  Write-Host "==> Desplegando (build + up + nginx)"
  ssh -p $Port "${User}@${SshHost}" "cd $RemoteDir && bash scripts/deploy-vps.sh"
}
Write-Host "OK"
