# =====================================================================
# MWT.ONE Harness · push local → VPS
#
# Uso (desde el checkout del harness):
#   pwsh -File scripts/push-to-vps.ps1              # empaqueta y sube
#   pwsh -File scripts/push-to-vps.ps1 -Deploy      # sube y despliega
#   pwsh -File scripts/push-to-vps.ps1 -AllowDirtyTree   # empaqueta con cambios sin guardar (a proposito)
#
# Empaqueta el fork del harness en `vendor/deepseek-harness-src.tgz` (el
# Dockerfile lo construye dentro de la imagen) y sube por rutas explícitas el
# resto del directorio de despliegue. No sube .env ni node_modules: el .env del
# VPS se conserva.
# =====================================================================
param(
  [string]$SshHost = "187.77.218.102",
  [int]$Port = 2222,
  [string]$User = "root",
  [string]$RemoteDir = "/opt/mwt-one-harness",
  [string]$HarnessDir = "",
  [switch]$SkipHarnessPackage,
  [switch]$AllowDirtyTree,
  [switch]$Deploy
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrEmpty($HarnessDir)) {
  $HarnessDir = Join-Path (Split-Path -Parent $root) 'deepseek-harness'
}

# git, ssh y scp escriben avisos por stderr (p. ej. la conversión CRLF→LF del
# índice); con ErrorActionPreference=Stop eso aborta el script. Se ejecutan con
# Continue y el fallo real se decide por $LASTEXITCODE.
function Invoke-Native {
  param([Parameter(Mandatory)][scriptblock]$Command, [string]$What = 'comando')
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Command | Out-Host } finally { $ErrorActionPreference = $previous }
  if ($LASTEXITCODE -ne 0) { throw "$What fallo (exit $LASTEXITCODE)" }
}

# Igual que Invoke-Native, pero devuelve la salida para capturarla.
function Invoke-NativeCapture {
  param([Parameter(Mandatory)][scriptblock]$Command, [string]$What = 'comando')
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $output = & $Command 2>$null } finally { $ErrorActionPreference = $previous }
  if ($LASTEXITCODE -ne 0) { throw "$What fallo (exit $LASTEXITCODE)" }
  return @($output)
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
  # El tar sale del indice (`write-tree`), no de HEAD: con el arbol sucio el
  # archivo describe un arbol que no es ningun commit. Un despliegue llego a
  # publicar en /healthz el sha del commit anterior mientras el arbol ya iba un
  # commit por delante, asi que sirvio codigo que no era el que se creia. El
  # indice debe coincidir con el arbol de trabajo y con HEAD antes de
  # empaquetar; -AllowDirtyTree salta la guarda para el empaquetado sucio a
  # proposito.
  $headBefore = ((Invoke-NativeCapture { git -C $HarnessDir rev-parse HEAD } 'git rev-parse HEAD') -join '').Trim()
  if (-not $AllowDirtyTree) {
    $dirty = @()
    $dirty += @(Invoke-NativeCapture { git -C $HarnessDir diff --name-only } 'git diff')
    $dirty += @(Invoke-NativeCapture { git -C $HarnessDir diff --name-only --cached } 'git diff --cached')
    $dirty += @(Invoke-NativeCapture { git -C $HarnessDir ls-files --others --exclude-standard } 'git ls-files --others')
    $dirty = @($dirty | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
    if ($dirty.Count -gt 0) {
      Write-Host "    archivos que no coinciden con el indice/HEAD:"
      $dirty | ForEach-Object { Write-Host "      $_" }
      throw ("Empaquetado abortado: el indice difiere del arbol de trabajo o de HEAD ({0} archivo(s)). El tar saldria de un arbol que no es ningun commit; guarda o descarta los cambios, o usa -AllowDirtyTree si el empaquetado sucio es intencional." -f $dirty.Count)
    }
  } else {
    Write-Host "    AVISO: -AllowDirtyTree; el indice puede no coincidir con ningun commit."
  }
  Invoke-Native { git -C $HarnessDir add -A } "git add en $HarnessDir"
  $tree = ((Invoke-NativeCapture { git -C $HarnessDir write-tree } 'git write-tree') -join '').Trim()
  $headTree = ((Invoke-NativeCapture { git -C $HarnessDir rev-parse 'HEAD^{tree}' } 'git rev-parse HEAD^{tree}') -join '').Trim()
  Invoke-Native { git -C $HarnessDir archive --format=tar.gz -o $forkTar $tree } 'git archive'
  $headAfter = ((Invoke-NativeCapture { git -C $HarnessDir rev-parse HEAD } 'git rev-parse HEAD') -join '').Trim()
  if ($headAfter -ne $headBefore) { throw "HEAD cambio durante el empaquetado ($headBefore -> $headAfter); reintenta el push" }
  # SHA real del fork: se inyecta como build arg para que la imagen quede
  # trazable (el tarball no lleva .git, el Dockerfile sintetiza un commit).
  # Sale del arbol archivado, no de un `rev-parse HEAD` tomado en otro momento:
  # con el arbol limpio el commit es el del tar; con -AllowDirtyTree el tar no
  # es ningun commit y se publica el id del arbol (`tree:<id>`).
  if ($tree -eq $headTree) {
    $script:ForkSha = $headAfter
  } elseif ($AllowDirtyTree) {
    $script:ForkSha = "tree:$tree"
  } else {
    throw "El arbol archivado ($tree) no es el de HEAD ($headTree); reintenta el push"
  }
  $forkDigest = (Get-FileHash -LiteralPath $forkTar -Algorithm SHA256).Hash.ToLowerInvariant()
  $revisionFile = Join-Path $vendor 'deepseek-harness-src.revision.txt'
  $revisionLines = @(
    "forkSha=$($script:ForkSha)"
    "tree=$tree"
    "archive=deepseek-harness-src.tgz"
    "sha256=$forkDigest"
  )
  [IO.File]::WriteAllText($revisionFile, (($revisionLines -join "`n") + "`n"))
  Write-Host ("    {0:N1} MB (tree {1}, forkSha {2})" -f ((Get-Item $forkTar).Length / 1MB), $tree, $script:ForkSha)
  Write-Host ("    sha256 {0} (registrado en {1})" -f $forkDigest, $revisionFile)
}

# No se empaqueta el árbol completo: bsdtar en Windows aborta con los symlinks
# del fork (CLAUDE.md, packages/*/CLAUDE.md) y deja un .tgz truncado que se
# extrae a medias, con lo que el VPS conserva archivos viejos sin que el script
# lo note. En su lugar se sube una lista explícita de rutas.
#
# Los archivos se suben normalizados a LF: el checkout de Windows conserva CRLF
# aunque el blob sea LF (`* text=auto eol=lf`), y scp copia los bytes tal cual.
# Con CRLF, bash falla en el shebang y en `set -o pipefail` de los .sh (rompe el
# cron de respaldo) y Docker ve un `\r` en las continuaciones del Dockerfile.
$deployPaths = @(
  'gateway', 'scripts', 'skills-catalog', 'skills-shared', 'agents-shared',
  'docker-compose.yml', 'Dockerfile', '.dockerignore', 'MANIFEST.md', 'README.mwt-one.md', '.env.example'
)
# `nginx/` se omite a propósito: harness.conf es un bind-mount de archivo y
# reemplazarlo desde el host cambia el inodo que ve el contenedor
# (ver README.mwt-one.md, "Mount de nginx de archivo").
$binaryExtensions = @('.png', '.jpg', '.jpeg', '.gif', '.ico', '.gz', '.tgz', '.zst', '.woff', '.woff2', '.pdf', '.zip')

# Copia un archivo o árbol al staging normalizando los finales de línea a LF.
function Copy-Normalized {
  param([string]$Source, [string]$Destination)
  if (-not (Test-Path -LiteralPath $Source)) { throw "Falta $Source" }
  $item = Get-Item -LiteralPath $Source -Force
  if ($item.PSIsContainer) {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    foreach ($child in Get-ChildItem -LiteralPath $Source -Force) {
      Copy-Normalized -Source $child.FullName -Destination (Join-Path $Destination $child.Name)
    }
    return
  }
  if ($binaryExtensions -contains $item.Extension.ToLowerInvariant()) {
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
    return
  }
  $lf = [IO.File]::ReadAllText($Source).Replace("`r`n", "`n").Replace("`r", "`n")
  [IO.File]::WriteAllText($Destination, $lf)
}

$stage = Join-Path $env:TEMP 'mwt-deploy'
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Write-Host "==> Preparando el staging (LF) en $stage"
foreach ($path in $deployPaths) {
  Copy-Normalized -Source (Join-Path $root $path) -Destination (Join-Path $stage $path)
}

# El manifiesto que se despliega debe citar el build que se despliega: es el
# documento con el que /healthz compara el forkSha en marcha, y un manifiesto
# que cita otro build no documenta lo que corre. Se sella aqui, en la copia del
# staging, y no en el del repositorio: el del repositorio declara el despliegue
# anterior y no puede citar un commit que aun no existia cuando se escribio.
$stagedManifest = Join-Path $stage 'MANIFEST.md'
if ((Test-Path -LiteralPath $stagedManifest) -and -not [string]::IsNullOrEmpty($script:ForkSha)) {
  $sha = $script:ForkSha
  $short = if ($sha.Length -ge 10) { $sha.Substring(0, 10) } else { $sha }
  $stampDay = (Get-Date).ToString('yyyy-MM-dd')
  $text = [IO.File]::ReadAllText($stagedManifest)
  $text = [Text.RegularExpressions.Regex]::Replace($text, '(?m)^\*\*Imagen desplegada actual:\*\*.*$', '**Imagen desplegada actual:** build de `main` @ `' + $sha + '` (deploy caliente).')
  $text = [Text.RegularExpressions.Regex]::Replace($text, '(?m)^\*\*Verificado en el VPS:\*\*.*$', '**Verificado en el VPS:** ' + $stampDay + '.')
  $text = [Text.RegularExpressions.Regex]::Replace($text, '\(`[0-9a-f]{7,40}`\) es el `build\.forkSha`', '(`' + $short + '`) es el `build.forkSha`')
  [IO.File]::WriteAllText($stagedManifest, $text, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "    manifiesto sellado con $short"
}

# Un solo archivo, una sola conexión: cada scp por ruta abría una conexión y
# el sshd del VPS cortaba la secuencia a mitad de subida.
$payload = Join-Path $env:TEMP 'mwt-deploy-payload.tgz'
if (Test-Path -LiteralPath $payload) { Remove-Item -LiteralPath $payload -Force }
Write-Host "==> Empaquetando el despliegue en un solo archivo"
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'vendor') | Out-Null
if (-not [string]::IsNullOrEmpty($forkTar) -and (Test-Path -LiteralPath $forkTar)) {
  Copy-Item -LiteralPath $forkTar -Destination (Join-Path $stage 'vendor/deepseek-harness-src.tgz') -Force
}
Invoke-Native { tar -czf $payload -C $stage . } 'tar del payload'
Write-Host ("    {0:N1} MB" -f ((Get-Item $payload).Length / 1MB))

Write-Host "==> Asegurando $RemoteDir"
Invoke-Native { ssh -p $Port -o LogLevel=ERROR "${User}@${SshHost}" "mkdir -p $RemoteDir" } 'ssh mkdir'

Write-Host "==> Subiendo y extrayendo en $RemoteDir"
Invoke-Native { scp -P $Port -o LogLevel=ERROR $payload "${User}@${SshHost}:/tmp/mwt-deploy-payload.tgz" } 'scp del payload'
# Los catálogos y presets se borran antes de extraer: `tar` no elimina los
# archivos retirados del origen, así que un skill o preset borrado seguiría
# viajando a la imagen.
Invoke-Native { ssh -p $Port -o LogLevel=ERROR "${User}@${SshHost}" "rm -rf $RemoteDir/skills-catalog $RemoteDir/skills-shared $RemoteDir/agents-shared && tar -xzf /tmp/mwt-deploy-payload.tgz -C $RemoteDir && rm -f /tmp/mwt-deploy-payload.tgz" } 'extract en el VPS'
Remove-Item -LiteralPath $payload -Force -ErrorAction SilentlyContinue

if ($Deploy) {
  $shaArg = if ([string]::IsNullOrEmpty($script:ForkSha)) { '' } else { "DSH_FORK_SHA=$($script:ForkSha) " }
  Write-Host "==> Desplegando (build del fork + up + nginx). El build tarda."
  # Keepalive explicito: el paso que mas tarda (la exportacion de la imagen) pasa
  # minutos sin imprimir nada, y una conexion ociosa la resetea el camino. Sin
  # esto el despliegue muere con "client_loop: send disconnect: Connection reset"
  # justo al exportar, con el build ya terminado.
  Invoke-Native { ssh -p $Port -o ServerAliveInterval=15 -o ServerAliveCountMax=40 -o TCPKeepAlive=yes "${User}@${SshHost}" "cd $RemoteDir && ${shaArg}bash scripts/deploy-vps.sh" } 'deploy en el VPS'
}
Write-Host "OK"
