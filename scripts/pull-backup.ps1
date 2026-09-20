# =====================================================================
# MWT.ONE Harness · copia off-host del respaldo cifrado (E8)
#
# Trae el último respaldo del VPS al equipo (carpeta sincronizada con
# OneDrive) usando la clave SSH local, verifica el sha256 y poda copias
# locales antiguas. El artefacto viaja cifrado; la passphrase de
# restauración vive aparte en RESTORE-PASSPHRASE.txt.
#
#   pwsh -File scripts/pull-backup.ps1
#   pwsh -File scripts/pull-backup.ps1 -LocalDir "D:\backups\harness"
# =====================================================================
param(
  [string]$SshHost = "187.77.218.102",
  [int]$Port = 2222,
  [string]$User = "root",
  [string]$KeyPath = "$env:USERPROFILE\.ssh\id_ed25519",
  [string]$RemoteDir = "/opt/backups/harness-mwt-one",
  [string]$LocalDir = "$env:OneDrive\MWT-Backups\harness",
  [int]$KeepDays = 30
)

$ErrorActionPreference = "Stop"
$logDir = Join-Path $LocalDir "_log"
New-Item -ItemType Directory -Force -Path $LocalDir, $logDir | Out-Null
$logFile = Join-Path $logDir "pull.log"
function Log($m) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
  Write-Output $line
  Add-Content -LiteralPath $logFile -Value $line
}

$commonArgs = @("-i", $KeyPath, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new")
$sshArgs = $commonArgs + @("-p", "$Port")
$scpArgs = $commonArgs + @("-P", "$Port")

Log "==> Buscando el último respaldo en ${User}@${SshHost}:$RemoteDir"
$latest = (& ssh @sshArgs "${User}@${SshHost}" "ls -1t $RemoteDir/harness_*.tar.zst.gpg 2>/dev/null | head -1") -join ""
$latest = $latest.Trim()
if (-not $latest) { Log "ERROR: no hay respaldos en el VPS"; exit 1 }
$name = Split-Path -Leaf $latest
Log "    último: $name"

$localArtifact = Join-Path $LocalDir $name
if (Test-Path -LiteralPath $localArtifact) {
  Log "    ya estaba descargado; se re-verifica"
} else {
  Log "==> Descargando (cifrado)"
  & scp @scpArgs "${User}@${SshHost}:${latest}" "${User}@${SshHost}:${latest}.sha256" "${User}@${SshHost}:${RemoteDir}/MANIFEST.json" $LocalDir
  if ($LASTEXITCODE -ne 0) { Log "ERROR: scp falló"; exit 1 }
}

Log "==> Verificando sha256"
$shaFile = "$localArtifact.sha256"
if (-not (Test-Path -LiteralPath $shaFile)) { Log "ERROR: falta $shaFile"; exit 1 }
$expected = ((Get-Content -LiteralPath $shaFile -Raw).Trim() -split '\s+')[0].ToLower()
$actual = (Get-FileHash -LiteralPath $localArtifact -Algorithm SHA256).Hash.ToLower()
if ($expected -ne $actual) { Log "ERROR: sha256 no coincide (esperado $expected, real $actual)"; exit 1 }
Log "    OK sha256=$($actual.Substring(0,16))…"

Log "==> Podando copias locales de más de $KeepDays días"
$cut = (Get-Date).AddDays(-$KeepDays)
Get-ChildItem -LiteralPath $LocalDir -File | Where-Object { $_.Name -like 'harness_*' -and $_.LastWriteTime -lt $cut } | ForEach-Object {
  Remove-Item -LiteralPath $_.FullName -Force
  Log "    borrado $($_.Name)"
}

$size = [math]::Round((Get-Item -LiteralPath $localArtifact).Length / 1KB, 1)
Log "OK: copia off-host en $LocalDir ($name, ${size} KB)"
