#!/usr/bin/env bash
# =====================================================================
# Mesa central (faberloom_mesa) · respaldo lógico verificado y podado
#
#   bash scripts/backup-mesa.sh                 # respaldo + verificación + poda
#   bash scripts/backup-mesa.sh --prune-only    # solo aplica retención
#   bash scripts/backup-mesa.sh --check-freshness  # 0 si el último respaldo sirve
#
# Cada ejecución produce `mesa_<UTC>.dump` (`pg_dump -Fc`, ~270 kB, <1 s) más
# su `.sha256` y su `.meta` con los conteos del origen. El artifact se escribe
# con nombre temporal y se renombra al final, así que un dump interrumpido no
# deja un archivo que parezca válido. Se verifica con sha256 y con
# `pg_restore --list`; si algo falla, el artifact se borra y el script sale
# distinto de 0.
#
# Estado en `MESA_STATUS_FILE` (por omisión /opt/mwt/mesa_backup_status.txt),
# una sola línea `OK|REMOTE_FAIL|FAIL <ISO8601> clave=valor...` para el
# healthcheck. No usa ni imprime credenciales: el dump corre dentro del
# contenedor con el superusuario del clúster, que ya es alcanzable por quien es
# root en el host.
#
# Copia externa, dos destinos independientes (cada uno se apaga con su variable):
#
#   MESA_REMOTE=<destino rclone>   sube artifact, `.sha256` y `.meta`, y verifica
#                                  la copia leyéndola de vuelta (tamaño y sha256).
#   MESA_OFFSITE=on                copia el artifact a una carpeta del buzón IMAP
#                                  configurado en `MESA_ENV_FILE`
#                                  (/etc/mwt/mesa-offsite.env, modo 600), que es
#                                  otro proveedor y otro host. También se relee y
#                                  se compara sha256 antes de podar el buzón.
#
# Un fallo de cualquiera de los dos no invalida el respaldo local: el estado pasa
# a `REMOTE_FAIL` y el script sigue con 0. La retención remota replica la local
# (borra del destino lo que ya no existe aquí), así que el destino está acotado
# por construcción; la del buzón usa una ventana propia (ver `mesa-offsite.py`).
#
# Códigos de salida: 0 respaldo local válido (con o sin copia externa),
# 1 fallo del respaldo o del último estado, 2 uso o estado ilegible.
# `--check-freshness`: 0 fresco y verificado, 1 inválido o vencido,
# 2 estado ilegible, 3 local válido pero la copia externa falló.
#
# Retención local (acotada, tres reglas y un tope en este orden):
#   1. mtime más viejo que MESA_BACKUP_RETENTION_DAYS  → se borra
#   2. mtime dentro de MESA_BACKUP_RECENT_HOURS        → se conserva
#   3. entre ambos                                     → se conserva el más
#      nuevo de cada día UTC
#   4. tope duro de MESA_BACKUP_KEEP_COUNT artifacts   → se borran los más viejos
# =====================================================================
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=mesa-env.sh
. "$SCRIPT_DIR/mesa-env.sh"
# `.env` de la copia externa: se lee sin ejecutarlo y sin pisar el entorno.
mesa_load_env "${MESA_ENV_FILE:-/etc/mwt/mesa-offsite.env}"

CONTAINER="${MESA_CONTAINER:-consola-mwt-one-postgres}"
SUPERUSER="${MESA_SUPERUSER:-mwt}"
DB="${MESA_DB:-faberloom_mesa}"
BACKUP_DIR="${MESA_BACKUP_DIR:-/opt/backups/mesa-mwt-one}"
STATUS_FILE="${MESA_STATUS_FILE:-/opt/mwt/mesa_backup_status.txt}"
KEEP_COUNT="${MESA_BACKUP_KEEP_COUNT:-240}"
RETENTION_DAYS="${MESA_BACKUP_RETENTION_DAYS:-30}"
RECENT_HOURS="${MESA_BACKUP_RECENT_HOURS:-48}"
MIN_FREE_MB="${MESA_MIN_FREE_MB:-512}"
COMPRESS="${MESA_DUMP_COMPRESS:-6}"
MAX_AGE_MINUTES="${MESA_MAX_AGE_MINUTES:-45}"
REMOTE="${MESA_REMOTE:-}"
OFFSITE="${MESA_OFFSITE:-off}"
OFFSITE_SCRIPT="$SCRIPT_DIR/mesa-offsite.py"
RCLONE_TIMEOUTS=(--contimeout 15s --timeout 60s --retries 1)

MODE=backup
case "${1:-}" in
  '') ;;
  --prune-only) MODE=prune ;;
  --check-freshness) MODE=freshness ;;
  *) echo "uso: $0 [--prune-only|--check-freshness]" >&2; exit 2 ;;
esac

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
status() { printf '%s %s %s\n' "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${2:-}" >"$STATUS_FILE" 2>/dev/null || true; }
die() { log "ERROR: $2"; status FAIL "reason=$1"; exit 1; }

sql() { docker exec -i "$CONTAINER" psql -U "$SUPERUSER" -d "$1" -At -v ON_ERROR_STOP=1 -c "$2"; }

container_running() {
  [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)" == "true" ]]
}

field() { printf '%s\n' "$1" | tr ' ' '\n' | sed -n "s/^$2=//p" | head -1; }

check_freshness() {
  local state ts rest age artifact ts_epoch
  [[ -r "$STATUS_FILE" ]] || { echo "sin archivo de estado: $STATUS_FILE"; exit 2; }
  read -r state ts rest <"$STATUS_FILE" || { echo "estado ilegible: $STATUS_FILE"; exit 2; }
  case "$state" in
    OK | REMOTE_FAIL) ;;
    *) echo "último respaldo en estado $state"; exit 1 ;;
  esac
  ts_epoch="$(date -u -d "$ts" +%s 2>/dev/null)" || { echo "marca de tiempo ilegible en el estado: $ts"; exit 2; }
  age=$(( $(date -u +%s) - ts_epoch ))
  if (( age > MAX_AGE_MINUTES * 60 )); then
    echo "respaldo con ${age}s de antigüedad (límite ${MAX_AGE_MINUTES}min)"
    exit 1
  fi
  artifact="$(field "$rest" artifact)"
  [[ -n "$artifact" && -f "$BACKUP_DIR/$artifact" ]] || { echo "artifact ausente: ${artifact:-?}"; exit 1; }
  ( cd "$BACKUP_DIR" && sha256sum -c --status "$artifact.sha256" ) || { echo "checksum no verifica: $artifact"; exit 1; }
  if [[ "$state" == REMOTE_FAIL ]]; then
    echo "local válido ($artifact, ${age}s) pero falló la copia externa: remote=$(field "$rest" remote_reason) offsite=$(field "$rest" offsite_reason)"
    exit 3
  fi
  echo "fresco: $artifact (${age}s)"
}

# ── Retención local ──────────────────────────────────────────────────
pruned=0
drop_backup() { # <archivo> <motivo>
  log "   poda: elimino $(basename "$1") ($2)"
  rm -f "$1" "$1.sha256" "$1.meta"
  pruned=$((pruned + 1))
}

prune() {
  local now f mtime age day
  local -a all=() survivors=()
  local -A seen_day=()
  now="$(date -u +%s)"
  mapfile -t all < <(ls -1 "$BACKUP_DIR"/mesa_*.dump 2>/dev/null | sort -r)
  for f in "${all[@]}"; do
    mtime="$(stat -c %Y "$f")"
    age=$(( now - mtime ))
    if (( age > RETENTION_DAYS * 86400 )); then
      drop_backup "$f" "más de ${RETENTION_DAYS}d"
      continue
    fi
    if (( age <= RECENT_HOURS * 3600 )); then
      survivors+=("$f")
      continue
    fi
    day="$(date -u -d "@$mtime" +%Y-%m-%d)"
    if [[ -n "${seen_day[$day]:-}" ]]; then
      drop_backup "$f" "ya hay uno del $day"
      continue
    fi
    seen_day[$day]=1
    survivors+=("$f")
  done
  local i n=${#survivors[@]}
  for (( i = KEEP_COUNT; i < n; i++ )); do
    drop_backup "${survivors[$i]}" "tope de ${KEEP_COUNT} artifacts"
  done
}

kept_count() {
  local n=0 f
  for f in "$BACKUP_DIR"/mesa_*.dump; do [[ -e "$f" ]] && n=$((n + 1)); done
  echo "$n"
}

# ── Copia externa ────────────────────────────────────────────────────
# Devuelve 1 y deja el motivo en `remote_reason`; nunca aborta el script.
remote_reason=""
remote_stage() { # <artifact> <sha256> <bytes>
  local artifact="$1" sha="$2" bytes="$3" tmp size remote_sha
  [[ "$REMOTE" == *:* ]] || { remote_reason=remote_invalid; return 1; }
  command -v rclone >/dev/null || { remote_reason=rclone_missing; return 1; }
  tmp="$(mktemp -d)" || { remote_reason=tmp_failed; return 1; }

  rclone mkdir "$REMOTE" "${RCLONE_TIMEOUTS[@]}" >/dev/null 2>&1 \
    || { remote_reason=mkdir_failed; rm -rf "$tmp"; return 1; }
  for companion in "$artifact" "$artifact.sha256" "$artifact.meta"; do
    rclone copyto "$BACKUP_DIR/$companion" "$REMOTE/$companion" "${RCLONE_TIMEOUTS[@]}" >/dev/null 2>&1 \
      || { remote_reason=upload_failed; rm -rf "$tmp"; return 1; }
  done

  size="$(rclone lsjson --stat "$REMOTE/$artifact" "${RCLONE_TIMEOUTS[@]}" 2>/dev/null \
    | tr ',' '\n' | sed -n 's/.*"Size":[[:space:]]*\([0-9]*\).*/\1/p' | head -1)"
  if [[ -n "$size" ]]; then
    [[ "$size" == "$bytes" ]] || { remote_reason=size_mismatch; rm -rf "$tmp"; return 1; }
  fi

  rclone copyto "$REMOTE/$artifact" "$tmp/$artifact" "${RCLONE_TIMEOUTS[@]}" >/dev/null 2>&1 \
    || { remote_reason=readback_failed; rm -rf "$tmp"; return 1; }
  cmp -s "$BACKUP_DIR/$artifact" "$tmp/$artifact" || { remote_reason=bytes_differ; rm -rf "$tmp"; return 1; }
  remote_sha="$(sha256sum "$tmp/$artifact" | cut -d' ' -f1)"
  rm -rf "$tmp"
  [[ "$remote_sha" == "$sha" ]] || { remote_reason=checksum_mismatch; return 1; }
  return 0
}

# El destino guarda exactamente lo que conserva el local: se borra del remoto
# todo `mesa_*` cuyo nombre ya no existe aquí. Un fallo sólo se registra.
remote_pruned=0
remote_retention() {
  local -A keep=()
  local f name
  local -a remote_files=()
  for f in "$BACKUP_DIR"/mesa_*; do
    if [[ -e "$f" ]]; then keep["$(basename "$f")"]=1; fi
  done
  mapfile -t remote_files < <(rclone lsf "$REMOTE" --files-only "${RCLONE_TIMEOUTS[@]}" 2>/dev/null || true)
  for name in "${remote_files[@]}"; do
    [[ "$name" == mesa_* ]] || continue
    if [[ -n "${keep[$name]:-}" ]]; then continue; fi
    if rclone deletefile "$REMOTE/$name" "${RCLONE_TIMEOUTS[@]}" >/dev/null 2>&1; then
      log "   poda remota: elimino $name"
      remote_pruned=$((remote_pruned + 1))
    else
      log "   AVISO: no se pudo borrar $REMOTE/$name"
    fi
  done
}

# ── Copia externa al buzón ───────────────────────────────────────────
# Sube, relee y poda. Devuelve 1 y deja el motivo en `offsite_reason`; nunca
# aborta el script. Sólo imprime el slug, jamás la respuesta del servidor.
offsite_reason=""
offsite_stage() { # <artifact> <sha256>
  local out
  command -v python3 >/dev/null || { offsite_reason=python_missing; return 1; }
  [[ -r "$OFFSITE_SCRIPT" ]] || { offsite_reason=script_missing; return 1; }
  if ! out="$(python3 "$OFFSITE_SCRIPT" upload --artifact "$BACKUP_DIR/$1" --sha256 "$2" 2>&1)"; then
    offsite_reason="$(printf '%s\n' "$out" | sed -n 's/^reason=//p' | tail -1)"
    offsite_reason="${offsite_reason:-upload_failed}"
    return 1
  fi
  log "   $out"
  return 0
}

# ── Frescura ─────────────────────────────────────────────────────────
if [[ "$MODE" == freshness ]]; then
  check_freshness
  exit 0
fi

mkdir -p "$BACKUP_DIR" || exit 1

# ── Poda sola ────────────────────────────────────────────────────────
if [[ "$MODE" == prune ]]; then
  prune
  kept="$(kept_count)"
  remote_label="$REMOTE"
  [[ -n "$remote_label" ]] || remote_label=off
  log "OK: poda aplicada, kept=$kept pruned=$pruned"
  status OK "mode=prune kept=$kept pruned=$pruned remote=$remote_label"
  exit 0
fi

# ── Respaldo ─────────────────────────────────────────────────────────
log "== 1/8  Comprobaciones previas =="
command -v docker >/dev/null || die docker_missing "falta docker"
container_running || die container_down "el contenedor $CONTAINER no responde"
[[ "$(sql postgres "select 1 from pg_database where datname='$DB'")" == "1" ]] \
  || die database_missing "no existe la base $DB en $CONTAINER"
free_mb="$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print int($4/1024)}')"
(( free_mb >= MIN_FREE_MB )) || die disk_low "quedan ${free_mb}MB libres, mínimo ${MIN_FREE_MB}MB en $BACKUP_DIR"
log "   base=$DB contenedor=$CONTAINER libre=${free_mb}MB"

log "== 2/8  Conteos del origen =="
items="$(sql "$DB" 'select count(*) from public.mesa_items')" \
  || die source_counts_failed "no se pudo contar mesa_items"
events="$(sql "$DB" 'select count(*) from public.mesa_events')" \
  || die source_counts_failed "no se pudo contar mesa_events"
log "   items=$items events=$events"

log "== 3/8  Dump =="
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARTIFACT="mesa_${STAMP}.dump"
PARTIAL="$BACKUP_DIR/.${ARTIFACT}.part"
start_ms="$(date +%s%N)"
docker exec "$CONTAINER" pg_dump -U "$SUPERUSER" -d "$DB" -Fc -Z"$COMPRESS" >"$PARTIAL" \
  || { rm -f "$PARTIAL"; die dump_failed "pg_dump falló"; }
[[ -s "$PARTIAL" ]] || { rm -f "$PARTIAL"; die dump_empty "el dump quedó vacío"; }
chmod 600 "$PARTIAL"
mv -f "$PARTIAL" "$BACKUP_DIR/$ARTIFACT"
duration_ms=$(( ($(date +%s%N) - start_ms) / 1000000 ))
bytes="$(stat -c %s "$BACKUP_DIR/$ARTIFACT")"
log "   $ARTIFACT ${bytes} bytes en ${duration_ms}ms"

log "== 4/8  Verificación =="
( cd "$BACKUP_DIR" && sha256sum "$ARTIFACT" >"$ARTIFACT.sha256" )
( cd "$BACKUP_DIR" && sha256sum -c --status "$ARTIFACT.sha256" ) \
  || { rm -f "$BACKUP_DIR/$ARTIFACT" "$BACKUP_DIR/$ARTIFACT.sha256"; die checksum_mismatch "el sha256 no verifica"; }
sha256="$(cut -d' ' -f1 "$BACKUP_DIR/$ARTIFACT.sha256")"
toc="$(docker exec -i "$CONTAINER" pg_restore --list <"$BACKUP_DIR/$ARTIFACT")" \
  || { rm -f "$BACKUP_DIR/$ARTIFACT" "$BACKUP_DIR/$ARTIFACT.sha256"; die toc_failed "pg_restore --list falló"; }
toc_entries="$(printf '%s\n' "$toc" | grep -c . || true)"
(( toc_entries > 0 )) || { rm -f "$BACKUP_DIR/$ARTIFACT" "$BACKUP_DIR/$ARTIFACT.sha256"; die toc_empty "el TOC está vacío"; }
for table in mesa_items mesa_events; do
  printf '%s\n' "$toc" | grep -q "TABLE DATA public $table" \
    || { rm -f "$BACKUP_DIR/$ARTIFACT" "$BACKUP_DIR/$ARTIFACT.sha256"; die "toc_missing_$table" "el TOC no declara $table"; }
done
log "   sha256=${sha256:0:16}… toc_entries=$toc_entries"

log "== 5/8  Manifiesto del artifact =="
{
  printf 'stamp=%s\n' "$STAMP"
  printf 'database=%s\n' "$DB"
  printf 'bytes=%s\n' "$bytes"
  printf 'sha256=%s\n' "$sha256"
  printf 'items=%s\n' "$items"
  printf 'events=%s\n' "$events"
  printf 'duration_ms=%s\n' "$duration_ms"
  printf 'toc_entries=%s\n' "$toc_entries"
  printf 'pg_version=%s\n' "$(docker exec "$CONTAINER" pg_dump --version | awk '{print $3}')"
} >"$BACKUP_DIR/$ARTIFACT.meta"
chmod 600 "$BACKUP_DIR/$ARTIFACT.meta"

log "== 6/8  Retención local =="
prune
kept="$(kept_count)"
oldest="$(ls -1 "$BACKUP_DIR"/mesa_*.dump 2>/dev/null | head -1 || true)"
oldest_age_h=0
if [[ -n "$oldest" ]]; then
  oldest_age_h=$(( ($(date -u +%s) - $(stat -c %Y "$oldest")) / 3600 ))
fi

log "== 7/8  Copia externa (rclone) =="
remote_ok=0
if [[ -z "$REMOTE" ]]; then
  log "   apagada (MESA_REMOTE vacío)"
elif remote_stage "$ARTIFACT" "$sha256" "$bytes"; then
  remote_ok=1
  log "   copia verificada en $REMOTE (leída de vuelta, sha256 idéntico)"
  remote_retention
else
  log "   AVISO: falló la copia externa a $REMOTE ($remote_reason); el respaldo local sigue válido"
fi

log "== 8/8  Copia externa (buzón IMAP) =="
offsite_ok=0
offsite_host="${MESA_OFFSITE_HOST:-imap.hostinger.com}"
if [[ "$OFFSITE" != on ]]; then
  log "   apagada (MESA_OFFSITE != on)"
else
  log "   destino $offsite_host como ${MESA_OFFSITE_USER:-?}"
  if offsite_stage "$ARTIFACT" "$sha256"; then
    offsite_ok=1
  else
    log "   AVISO: falló la copia al buzón ($offsite_reason); el respaldo local sigue válido"
  fi
fi

# ── Estado final ─────────────────────────────────────────────────────
remote_status="$REMOTE"
[[ -n "$remote_status" ]] || remote_status=off
offsite_status="off"
[[ "$OFFSITE" == on ]] && offsite_status="imap:$offsite_host"
failed=""
[[ -n "$REMOTE" && "$remote_ok" != 1 ]] && failed="remote"
if [[ "$OFFSITE" == on && "$offsite_ok" != 1 ]]; then
  failed="${failed:+$failed,}offsite"
fi

legs="remote=$remote_status"
[[ "$remote_ok" == 1 ]] && legs="$legs remote_ok=1 remote_pruned=$remote_pruned"
[[ -n "$remote_reason" ]] && legs="$legs remote_reason=$remote_reason"
legs="$legs offsite=$offsite_status"
[[ "$offsite_ok" == 1 ]] && legs="$legs offsite_ok=1"
[[ -n "$offsite_reason" ]] && legs="$legs offsite_reason=$offsite_reason"
[[ -n "$failed" ]] && legs="$legs failed=$failed"

common="artifact=$ARTIFACT bytes=$bytes sha256=$sha256 items=$items events=$events duration_ms=$duration_ms kept=$kept pruned=$pruned oldest_h=$oldest_age_h"

if [[ -z "$failed" ]]; then
  log "OK: $ARTIFACT ${bytes} bytes · items=$items events=$events · ${duration_ms}ms · kept=$kept pruned=$pruned oldest=${oldest_age_h}h · $legs"
  status OK "$common $legs"
  exit 0
fi

log "REMOTE_FAIL: $ARTIFACT ${bytes} bytes · items=$items events=$events · ${duration_ms}ms · kept=$kept pruned=$pruned · falló $failed"
status REMOTE_FAIL "reason=remote_failed $legs $common"
exit 0
