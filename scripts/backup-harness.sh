#!/usr/bin/env bash
# =====================================================================
# MWT.ONE Harness · respaldo verificado y cifrado (E8)
#
#   bash scripts/backup-harness.sh            # respaldo completo
#   QUIESCE=0 bash scripts/backup-harness.sh  # sin parar contenedores
#
# Respalda, con el gateway y la memoria en pausa unos segundos para que las
# bases SQLite y los DSH_HOME queden consistentes:
#   - volumen harness-users              (sesiones, DSH_HOME, identidad de memoria)
#   - volumen tdai-memory-core-data      (SQLite de la memoria de agente)
#   - volumen tdai-panel-data            (panel de memoria)
#   - configuración: .env, compose, nginx, manifiesto del stack de memoria
# Produce un único `harness_<UTC>.tar.zst.gpg` (AES256 simétrico) + `.sha256`,
# lo verifica descifrándolo, lo sube al remoto rclone y poda por retención.
# =====================================================================
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"
LOCAL_DIR="${LOCAL_DIR:-/opt/backups/harness-mwt-one}"
BACKUP_REMOTE="${BACKUP_REMOTE:-mlocal}"
BACKUP_PATH="${BACKUP_PATH:-harness-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
PASSPHRASE_FILE="${PASSPHRASE_FILE:-$ROOT/.backup-passphrase}"
QUIESCE="${QUIESCE:-1}"
TD_IMAGES_DIR="${TD_IMAGES_DIR:-/opt/tdai/src/deploy/global-images}"
VOLUMES=(harness-users tdai-memory-core-data tdai-panel-data)
QUIESCE_CONTAINERS=(mwt-one-harness-gateway tdai-proxy tdai-memory-hub tdai-memory-core)
STATUS_FILE="${STATUS_FILE:-/opt/mwt/harness_backup_status.txt}"

ARTIFACT="harness_${STAMP}.tar.zst"
ENCRYPTED="${ARTIFACT}.gpg"
STARTED_CONTAINERS=()

log() { echo "[$(date '+%F %T')] $*"; }

status() {
  printf '%s %s %s\n' "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${2:-}" > "$STATUS_FILE" 2>/dev/null || true
}

resume() {
  for c in "${STARTED_CONTAINERS[@]}"; do
    docker start "$c" >/dev/null 2>&1 || log "AVISO: no se pudo reactivar $c"
  done
  rm -rf "$WORK"
}
trap resume EXIT

fail() { log "ERROR: $1"; status FAIL "$1"; exit 1; }

[[ -s "$PASSPHRASE_FILE" ]] || fail "falta la passphrase en $PASSPHRASE_FILE"
command -v zstd >/dev/null || fail "falta zstd"
command -v gpg >/dev/null || fail "falta gpg"
command -v rclone >/dev/null || fail "falta rclone"

log "== 1/7  Pausando contenedores (consistencia) =="
# La versión se lee antes de pausar: con el gateway detenido no responde.
DSH_VERSION="$(docker exec mwt-one-harness-gateway /opt/dsh/bin-dsh --version 2>/dev/null || echo desconocida)"
log "   dsh $DSH_VERSION"
if [[ "$QUIESCE" == "1" ]]; then
  for c in "${QUIESCE_CONTAINERS[@]}"; do
    if [[ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null || echo false)" == "true" ]]; then
      docker stop "$c" >/dev/null && STARTED_CONTAINERS+=("$c") && log "   pausado $c"
    fi
  done
else
  log "   omitido (QUIESCE=0): respaldo a nivel de sistema de archivos"
fi

log "== 2/7  Empaquetando volúmenes =="
mkdir -p "$WORK/payload"
for v in "${VOLUMES[@]}"; do
  mp="$(docker volume inspect "$v" --format '{{.Mountpoint}}' 2>/dev/null || true)"
  if [[ -z "$mp" || ! -d "$mp" ]]; then
    log "   omitido $v (volumen inexistente)"
    continue
  fi
  tar -C "$mp" -cf - . | zstd -q -T0 -10 -o "$WORK/payload/${v}.tar.zst"
  files="$(find "$mp" -type f | wc -l)"
  bytes="$(du -sb "$mp" | cut -f1)"
  printf '%s %s %s\n' "$v" "$files" "$bytes" >> "$WORK/volumes.txt"
  log "   $v: ${files} archivos, ${bytes} bytes"
done

log "== 3/7  Copiando configuración =="
mkdir -p "$WORK/config"
cp -a "$ROOT/.env" "$WORK/config/harness.env" 2>/dev/null || true
cp -a "$ROOT/docker-compose.yml" "$WORK/config/docker-compose.yml" 2>/dev/null || true
cp -a "$ROOT/nginx/harness.conf" "$WORK/config/harness.conf" 2>/dev/null || true
cp -a "$ROOT/MANIFEST.md" "$WORK/config/MANIFEST.md" 2>/dev/null || true
if [[ -d "$TD_IMAGES_DIR" ]]; then
  mkdir -p "$WORK/config/tdai"
  cp -a "$TD_IMAGES_DIR/.env" "$WORK/config/tdai/env" 2>/dev/null || true
  cp -a "$TD_IMAGES_DIR/.admin-key" "$WORK/config/tdai/admin-key" 2>/dev/null || true
  cp -a "$TD_IMAGES_DIR/.proxy-config/config.yaml" "$WORK/config/tdai/proxy-config.yaml" 2>/dev/null || true
fi

log "== 4/7  Manifiesto de versiones =="
{
  echo "{"
  echo "  \"stamp\": \"$STAMP\","
  echo "  \"host\": \"$(hostname)\","
  echo "  \"dshVersion\": \"$DSH_VERSION\","
  echo "  \"images\": {"
  docker images --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.Digest}}' \
    | grep -E 'mwt-one-harness/gateway|agentmemory/' \
    | awk '{printf "    \"%s\": {\"id\":\"%s\",\"digest\":\"%s\"},\n", $1, $2, $3}' | sed '$ s/,$//'
  echo "  }"
  echo "}"
} > "$WORK/MANIFEST.json"

log "== 5/7  Empaquetando y cifrando =="
tar -C "$WORK" -cf - payload config volumes.txt MANIFEST.json | zstd -q -T0 -10 -o "$WORK/$ARTIFACT"
( cd "$WORK" && sha256sum "$ARTIFACT" > "${ARTIFACT}.sha256" )
gpg --batch --yes --quiet --pinentry-mode loopback \
  --passphrase-file "$PASSPHRASE_FILE" \
  --symmetric --cipher-algo AES256 \
  -o "$WORK/$ENCRYPTED" "$WORK/$ARTIFACT"
( cd "$WORK" && sha256sum "$ENCRYPTED" > "${ENCRYPTED}.sha256" )

log "== 6/7  Verificando (integridad + descifrado) =="
( cd "$WORK" && sha256sum -c "${ARTIFACT}.sha256" >/dev/null ) || fail "sha256 del artifact no coincide"
entries="$(gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" \
  --decrypt "$WORK/$ENCRYPTED" 2>/dev/null | zstd -qdc | tar -tf - | wc -l)"
[[ "$entries" -gt 0 ]] || fail "el artifact cifrado no se puede leer"
log "   descifrado OK, $entries entradas en el bundle"

mkdir -p "$LOCAL_DIR"
mv "$WORK/$ENCRYPTED" "$WORK/${ENCRYPTED}.sha256" "$WORK/${ARTIFACT}.sha256" "$WORK/MANIFEST.json" "$LOCAL_DIR/"
log "   copia local en $LOCAL_DIR"

log "== 7/7  Subiendo al remoto externo y podando =="
remote_ok=0
LOG_ERR="$(mktemp)"
if rclone mkdir "$BACKUP_REMOTE:$BACKUP_PATH" 2>"$LOG_ERR" \
   && rclone copyto "$LOCAL_DIR/$ENCRYPTED" "$BACKUP_REMOTE:$BACKUP_PATH/$ENCRYPTED" 2>>"$LOG_ERR" \
   && rclone copyto "$LOCAL_DIR/${ENCRYPTED}.sha256" "$BACKUP_REMOTE:$BACKUP_PATH/${ENCRYPTED}.sha256" 2>>"$LOG_ERR" \
   && rclone copyto "$LOCAL_DIR/MANIFEST.json" "$BACKUP_REMOTE:$BACKUP_PATH/MANIFEST.json" 2>>"$LOG_ERR" \
   && rclone lsf "$BACKUP_REMOTE:$BACKUP_PATH" --include "$ENCRYPTED" 2>>"$LOG_ERR" | grep -q .; then
  remote_ok=1
  log "   subido a $BACKUP_REMOTE:$BACKUP_PATH/$ENCRYPTED"
else
  log "   AVISO: la subida al remoto $BACKUP_REMOTE:$BACKUP_PATH falló; el respaldo local queda válido:"
  sed 's/^/     /' "$LOG_ERR" | tail -5
fi
rm -f "$LOG_ERR"

find "$LOCAL_DIR" -maxdepth 1 -type f -mtime "+$RETENTION_DAYS" -delete 2>/dev/null || true
[[ "$remote_ok" == "1" ]] && rclone delete --min-age "${RETENTION_DAYS}d" "$BACKUP_REMOTE:$BACKUP_PATH" >/dev/null 2>&1 || true

resume
trap - EXIT

size="$(du -h "$LOCAL_DIR/$ENCRYPTED" | cut -f1)"
log "OK: respaldo $ENCRYPTED ($size) · externo=$([[ $remote_ok == 1 ]] && echo si || echo NO) · retención ${RETENTION_DAYS}d"
status OK "artifact=$ENCRYPTED remote=$remote_ok size=$size"
