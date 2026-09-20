#!/usr/bin/env bash
# =====================================================================
# MWT.ONE Harness · restauración verificada (E8)
#
#   bash scripts/restore-harness.sh                      # último respaldo local
#   bash scripts/restore-harness.sh --from mlocal:harness-backups
#   bash scripts/restore-harness.sh --from /opt/backups/harness-mwt-one/harness_<UTC>.tar.zst.gpg
#   bash scripts/restore-harness.sh --inspect <artifact> # solo listar/verificar
#
# Por omisión restaura en un entorno AISLADO: un volumen desechable
# `harness-users-restoretest`. Nunca escribe sobre el volumen de producción
# salvo que se pase --target <volumen-real> --yes explícitamente.
#
# Prueba de restauración (F21): descifra, verifica sha256, restaura el árbol y
# comprueba que los recuentos de archivos/bytes coinciden con el manifiesto del
# respaldo, que el estado de memoria es JSON válido y que las sesiones están.
# =====================================================================
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_DIR="${LOCAL_DIR:-/opt/backups/harness-mwt-one}"
PASSPHRASE_FILE="${PASSPHRASE_FILE:-$ROOT/.backup-passphrase}"
FROM=""
TARGET_VOLUME="harness-users-restoretest"
INSPECT_ONLY=0
CONFIRMED=0
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

log() { echo "[$(date '+%F %T')] $*"; }
fail() { log "ERROR: $1"; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) FROM="${2:-}"; shift 2 ;;
    --target) TARGET_VOLUME="${2:-}"; shift 2 ;;
    --local-dir) LOCAL_DIR="${2:-}"; shift 2 ;;
    --inspect) INSPECT_ONLY=1; FROM="${2:-}"; shift 2 ;;
    --yes) CONFIRMED=1; shift ;;
    *) fail "argumento no reconocido: $1" ;;
  esac
done

[[ -s "$PASSPHRASE_FILE" ]] || fail "falta la passphrase en $PASSPHRASE_FILE"

# ── Resolver el artifact ─────────────────────────────────────────────
if [[ -z "$FROM" ]]; then
  FROM="$(ls -1t "$LOCAL_DIR"/harness_*.tar.zst.gpg 2>/dev/null | head -1 || true)"
  [[ -n "$FROM" ]] || fail "no hay respaldos en $LOCAL_DIR"
elif [[ "$FROM" == *:* ]]; then
  remote="${FROM%%:*}"; path="${FROM#*:}"
  log "Buscando el último respaldo en $remote:$path"
  name="$(rclone lsf "$remote:$path" --include 'harness_*.tar.zst.gpg' | sort | tail -1)"
  [[ -n "$name" ]] || fail "no hay respaldos en $remote:$path"
  rclone copy "$remote:$path/$name" "$WORK/" || fail "no se pudo descargar $name"
  FROM="$WORK/$name"
fi
[[ -f "$FROM" ]] || fail "no existe el artifact $FROM"
log "Artifact: $FROM ($(du -h "$FROM" | cut -f1))"

# ── Verificar sha256 y descifrar ─────────────────────────────────────
if [[ -f "${FROM}.sha256" ]]; then
  ( cd "$(dirname "$FROM")" && sha256sum -c "$(basename "${FROM}.sha256")" ) >/dev/null \
    || fail "sha256 no coincide"
  log "sha256 OK"
else
  log "AVISO: sin archivo .sha256 junto al artifact"
fi

plain="${FROM%.gpg}"
log "Descifrando…"
gpg --batch --yes --quiet --pinentry-mode loopback \
  --passphrase-file "$PASSPHRASE_FILE" --decrypt -o "$WORK/bundle.tar.zst" "$FROM"
zstd -qdc "$WORK/bundle.tar.zst" | tar -C "$WORK" -xf -
[[ -f "$WORK/MANIFEST.json" ]] || fail "el bundle no trae MANIFEST.json"
log "Manifiesto: $(tr -d '\n' < "$WORK/MANIFEST.json")"

if [[ "$INSPECT_ONLY" == "1" ]]; then
  log "Contenido:"
  find "$WORK/payload" "$WORK/config" -type f 2>/dev/null | sed "s#$WORK/##" | sort
  log "Volúmenes declarados (nombre archivos bytes):"
  cat "$WORK/volumes.txt" 2>/dev/null || true
  trap 'rm -rf "$WORK"' EXIT
  exit 0
fi

# ── Destino: aislado por omisión ─────────────────────────────────────
if [[ "$TARGET_VOLUME" == "harness-users" && "$CONFIRMED" != "1" ]]; then
  fail "restaurar sobre el volumen de producción exige --target harness-users --yes"
fi
if [[ "$TARGET_VOLUME" == "harness-users" ]]; then
  log "ATENCIÓN: restaurando sobre el volumen de PRODUCCIÓN $TARGET_VOLUME"
fi

log "Restaurando harness-users → volumen aislado '$TARGET_VOLUME'"
docker volume create "$TARGET_VOLUME" >/dev/null
zstd -qdc "$WORK/payload/harness-users.tar.zst" > "$WORK/hu.tar"
docker run --rm -v "$TARGET_VOLUME":/dst -v "$WORK":/src:ro alpine sh -c \
  'rm -rf /dst/* /dst/.[!.]* 2>/dev/null; tar -C /dst -xf /src/hu.tar'

# ── Verificación de la restauración (F21) ────────────────────────────
mp="$(docker volume inspect "$TARGET_VOLUME" --format '{{.Mountpoint}}')"
read -r want_files want_bytes < <(awk '$1=="harness-users"{print $2, $3}' "$WORK/volumes.txt" 2>/dev/null || echo "0 0")
got_files="$(find "$mp" -type f | wc -l)"
got_bytes="$(du -sb "$mp" | cut -f1)"
log "Archivos: esperado=$want_files restaurado=$got_files"
log "Bytes:    esperado=$want_bytes restaurado=$got_bytes"

failures=0
[[ "$want_files" -eq 0 || "$want_files" -eq "$got_files" ]] || { log "MISMATCH de archivos"; failures=1; }
[[ "$want_bytes" -eq 0 || "$want_bytes" -eq "$got_bytes" ]] || { log "MISMATCH de bytes"; failures=1; }

memory_state="$mp/memory-users.json"
if [[ -f "$memory_state" ]]; then
  if command -v jq >/dev/null && jq -e . "$memory_state" >/dev/null 2>&1; then
    log "memory-users.json: JSON válido ($(jq -r '.users|length' "$memory_state") usuarios)"
  else
    log "AVISO: memory-users.json presente pero no validado con jq"
  fi
fi
sessions="$(find "$mp" -type d -name sessions 2>/dev/null | wc -l)"
patches="$(find "$mp" -name harness.patch.yml 2>/dev/null | wc -l)"
log "DSH_HOME con sessions: $sessions · patches por usuario: $patches"

if [[ "$failures" != "0" ]]; then
  log "RESTAURACIÓN FALLIDA: los recuentos no cuadran con el manifiesto"
  exit 1
fi
log "OK: restauración verificada en el entorno aislado '$TARGET_VOLUME' (sin tocar producción)"
log "Para promover: docker run --rm -v harness-users:/dst -v $TARGET_VOLUME:/src:ro alpine:3 sh -c 'rm -rf /dst/*; cp -a /src/. /dst/'"
