# =====================================================================
# MWT.ONE Harness · push local → VPS
#
# Uso (desde esta carpeta mwt-one-harness):
#   pwsh -File scripts/push-to-vps.ps1              # empaqueta y sube
#   pwsh -File scripts/push-to-vps.ps1 -Deploy      # sube y despliega (build del fork)
#
# Empaqueta el fork del harness (`../deepseek-harness`) en
# `vendor/deepseek-harness-src.tgz`; el Dockerfile lo construye dentro de la
# imagen. No sube .env ni node_modules (el .env del VPS se conserva).
# =====================================================================
param(
  [string]$SshHost = "187.77.218.102",
  [int]$Port = 2222,
  [string]$User = "root",
  [string]$RemoteDir = "/opt/mwt-one-harness",
  [string]$HarnessDir = "",
  [switch]$SkipHarnessPackage,
  [switch]$Deploy
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrEmpty($HarnessDir)) {
  $HarnessDir = Join-Path (Split-Path -Parent $root) 'deepseek-harness'
}

if (-not $SkipHarnessPackage) {
  if (-not (Test-Path -LiteralPath $HarnessDir)) { throw "No existe el checkout del fork: $HarnessDir" }
  $vendor = Join-Path $root 'vendor'
  New-Item -ItemType Directory -Force -Path $vendor | Out-Null
  $forkTar = Join-Path $vendor 'deepseek-harness-src.tgz'
  if (Test-Path $forkTar) { Remove-Item $forkTar }
  # `git archive` of the staged tree (no commit): reliable on Windows where
  # bsdtar crashes on the repository's symlinks, and source-only (gitignored
  # build output and node_modules stay out).
  Write-Host "==> Empaquetando fork $HarnessDir (git archive del índice)"
  git -C $HarnessDir add -A
  if ($LASTEXITCODE -ne 0) { throw "git add fallo en $HarnessDir" }
  $tree = (git -C $HarnessDir write-tree).Trim()
  git -C $HarnessDir archive --format=tar.gz -o $forkTar $tree
  if ($LASTEXITCODE -ne 0) { throw "git archive fallo en $HarnessDir" }
  # SHA real del fork: se inyecta como build arg para que la imagen quede
  # trazable (el tarball no lleva .git, el Dockerfile sintetiza un commit).
  $script:ForkSha = (git -C $HarnessDir rev-parse HEAD).Trim()
  Write-Host ("    {0:N1} MB (tree {1}, HEAD {2})" -f ((Get-Item $forkTar).Length / 1MB), $tree, $script:ForkSha)
}

$tar = Join-Path $env:TEMP "mwt-one-harness.tgz"
if (Test-Path $tar) { Remove-Item $tar }

Write-Host "==> Empaquetando $root"
tar -czf $tar --exclude=node_modules --exclude=.env --exclude=.git -C $root .
Write-Host ("    {0:N0} KB" -f ((Get-Item $tar).Length / 1KB))

Write-Host "==> Subiendo a ${User}@${SshHost}:/tmp/"
scp -P $Port $tar "${User}@${SshHost}:/tmp/mwt-one-harness.tgz"

Write-Host "==> Extrayendo en $RemoteDir"
$remote = "mkdir -p $RemoteDir && tar -xzf /tmp/mwt-one-harness.tgz -C $RemoteDir && rm -f /tmp/mwt-one-harness.tgz && echo 'contenido:' && ls -1 $RemoteDir"
ssh -p $Port "${User}@${SshHost}" $remote

if ($Deploy) {
  $shaArg = if ([string]::IsNullOrEmpty($script:ForkSha)) { '' } else { "DSH_FORK_SHA=$($script:ForkSha) " }
  Write-Host "==> Desplegando (build del fork + up + nginx). El build tarda."
  ssh -p $Port "${User}@${SshHost}" "cd $RemoteDir && ${shaArg}bash scripts/deploy-vps.sh"
}
Write-Host "OK"
