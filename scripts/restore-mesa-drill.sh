#!/usr/bin/env bash
# =====================================================================
# Mesa central · prueba de restauración (drill) sobre base desechable
#
#   bash scripts/restore-mesa-drill.sh                     # último artifact
#   bash scripts/restore-mesa-drill.sh --artifact <ruta>   # uno concreto
#   bash scripts/restore-mesa-drill.sh --keep              # no borra la base
#
# Restaura el artifact en una base `mesa_drill_<UTC>`, verifica conteos
# (ítems, eventos, huérfanos, RLS y políticas), mide la duración y borra la
# base. Devuelve 0 solo si todas las comprobaciones pasan.
#
# Nunca toca `faberloom_mesa` ni `mwt_one`: el destino debe encajar con
# `mesa_drill_[a-zA-Z0-9_]*` y no estar en la lista de bases protegidas, y el
# script se niega a continuar si la base ya existe (jamás sobrescribe).
#
# Estado en `MESA_DRILL_STATUS_FILE` (por omisión
# /opt/mwt/mesa_restore_drill_status.txt), una línea `OK|FAIL <ISO8601> k=v`.
# =====================================================================
set -euo pipefail
umask 077

CONTAINER="${MESA_CONTAINER:-consola-mwt-one-postgres}"
SUPERUSER="${MESA_SUPERUSER:-mwt}"
BACKUP_DIR="${MESA_BACKUP_DIR:-/opt/backups/mesa-mwt-one}"
STATUS_FILE="${MESA_DRILL_STATUS_FILE:-${MESA_STATUS_FILE:-/opt/mwt/mesa_restore_drill_status.txt}}"
MIN_ITEMS="${MESA_DRILL_MIN_ITEMS:-460}"
MIN_EVENTS="${MESA_DRILL_MIN_EVENTS:-2413}"
ARTIFACT=""
TARGET=""
KEEP_DB=0

usage() { echo "uso: $0 [--artifact <ruta>] [--target <mesa_drill_nombre>] [--keep]" >&2; exit 2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact) ARTIFACT="${2:-}"; shift 2 || usage ;;
    --target) TARGET="${2:-}"; shift 2 || usage ;;
    --keep) KEEP_DB=1; shift ;;
    *) usage ;;
  esac
done

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
status() { printf '%s %s %s\n' "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${2:-}" >"$STATUS_FILE" 2>/dev/null || true; }
die() { log "ERROR: $2"; status FAIL "reason=$1"; exit 1; }
sql() { docker exec -i "$CONTAINER" psql -U "$SUPERUSER" -d "$1" -At -v ON_ERROR_STOP=1 -c "$2"; }

# ── Guardas de destino: antes de leer nada ───────────────────────────
[[ -n "$TARGET" ]] || TARGET="mesa_drill_$(date -u +%Y%m%dT%H%M%SZ | tr '[:upper:]' '[:lower:]')"
case "$TARGET" in
  mesa_drill_[a-zA-Z0-9_]*) ;;
  *) die target_rejected "el destino debe encajar con mesa_drill_[a-zA-Z0-9_]*: '$TARGET'" ;;
esac
for protected in faberloom_mesa mwt_one postgres template0 template1; do
  [[ "$TARGET" == "$protected" ]] && die target_rejected "'$TARGET' es una base protegida"
done

# ── Contenedor ───────────────────────────────────────────────────────
container_running() {
  [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)" == "true" ]]
}
container_running || die container_down "el contenedor $CONTAINER no responde"

# ── Artifact ─────────────────────────────────────────────────────────
if [[ -z "$ARTIFACT" ]]; then
  ARTIFACT="$(ls -1t "$BACKUP_DIR"/mesa_*.dump 2>/dev/null | head -1 || true)"
  [[ -n "$ARTIFACT" ]] || die no_artifact "no hay respaldos en $BACKUP_DIR"
fi
[[ -f "$ARTIFACT" ]] || die no_artifact "no existe el artifact $ARTIFACT"
[[ -f "$ARTIFACT.sha256" ]] || die no_checksum "falta $ARTIFACT.sha256"
( cd "$(dirname "$ARTIFACT")" && sha256sum -c --status "$(basename "$ARTIFACT").sha256" ) \
  || die checksum_mismatch "el sha256 de $ARTIFACT no coincide"
sha256="$(cut -d' ' -f1 "$ARTIFACT.sha256")"
bytes="$(stat -c %s "$ARTIFACT")"
log "artifact=$(basename "$ARTIFACT") bytes=$bytes sha256=${sha256:0:16}…"

expected_items=""
expected_events=""
if [[ -f "$ARTIFACT.meta" ]]; then
  expected_items="$(sed -n 's/^items=//p' "$ARTIFACT.meta" | head -1)"
  expected_events="$(sed -n 's/^events=//p' "$ARTIFACT.meta" | head -1)"
fi

toc="$(docker exec -i "$CONTAINER" pg_restore --list <"$ARTIFACT")" \
  || die toc_failed "pg_restore --list falló sobre $ARTIFACT"
for table in mesa_items mesa_events; do
  printf '%s\n' "$toc" | grep -q "TABLE DATA public $table" \
    || die "toc_missing_$table" "el TOC no declara $table"
done

# ── Base desechable ──────────────────────────────────────────────────
[[ "$(sql postgres "select 1 from pg_database where datname='$TARGET'")" != "1" ]] \
  || die target_exists "la base $TARGET ya existe; no se sobrescribe"

created=0
cleanup() {
  if (( created == 1 && KEEP_DB == 0 )); then
    docker exec "$CONTAINER" psql -U "$SUPERUSER" -d postgres -q \
      -c "drop database if exists \"$TARGET\"" >/dev/null 2>&1 \
      || log "AVISO: no se pudo borrar $TARGET"
  fi
}
trap cleanup EXIT

log "creando $TARGET"
docker exec "$CONTAINER" createdb -U "$SUPERUSER" "$TARGET" || die create_failed "no se pudo crear $TARGET"
created=1

log "restaurando…"
start_ms="$(date +%s%N)"
docker exec -i "$CONTAINER" pg_restore -U "$SUPERUSER" -d "$TARGET" --exit-on-error <"$ARTIFACT" \
  || die restore_failed "pg_restore falló sobre $TARGET"
restore_ms=$(( ($(date +%s%N) - start_ms) / 1000000 ))

# ── Verificación ─────────────────────────────────────────────────────
log "verificando…"
items="$(sql "$TARGET" 'select count(*) from public.mesa_items')" || die verify_failed "no se pudo contar mesa_items"
events="$(sql "$TARGET" 'select count(*) from public.mesa_events')" || die verify_failed "no se pudo contar mesa_events"
orphans="$(sql "$TARGET" 'select count(*) from public.mesa_events e left join public.mesa_items i on i.tenant_id = e.tenant_id and i.id = e.item_id where i.id is null')"
tenants="$(sql "$TARGET" 'select count(distinct tenant_id) from public.mesa_items')"
rls="$(sql "$TARGET" "select count(*) from pg_class where relname in ('mesa_items','mesa_events') and relrowsecurity and relforcerowsecurity")"
policies="$(sql "$TARGET" 'select count(*) from pg_policies where schemaname = '\''public'\''')"

(( items >= MIN_ITEMS )) || die items_below_floor "restaurados $items ítems, mínimo $MIN_ITEMS"
(( events >= MIN_EVENTS )) || die events_below_floor "restaurados $events eventos, mínimo $MIN_EVENTS"
[[ -z "$expected_items" || "$items" == "$expected_items" ]] \
  || die items_mismatch "restaurados $items ítems, el artifact declaraba $expected_items"
[[ -z "$expected_events" || "$events" == "$expected_events" ]] \
  || die events_mismatch "restaurados $events eventos, el artifact declaraba $expected_events"
[[ "$orphans" == "0" ]] || die orphan_events "$orphans eventos sin ítem"
[[ "$rls" == "2" ]] || die rls_missing "RLS habilitada y forzada en $rls de 2 tablas"
(( policies >= 6 )) || die policies_missing "solo $policies políticas RLS restauradas"

log "   items=$items events=$events tenants=$tenants orphans=$orphans rls=$rls/2 policies=$policies restore_ms=$restore_ms"

if (( KEEP_DB == 1 )); then
  log "   --keep: la base $TARGET queda en pie"
else
  docker exec "$CONTAINER" psql -U "$SUPERUSER" -d postgres -q -c "drop database if exists \"$TARGET\"" \
    || die drop_failed "no se pudo borrar la base desechable $TARGET"
  created=0
fi
trap - EXIT

log "OK: drill sobre $(basename "$ARTIFACT") · items=$items events=$events · restore=${restore_ms}ms"
status OK "artifact=$(basename "$ARTIFACT") bytes=$bytes sha256=$sha256 items=$items events=$events tenants=$tenants orphans=$orphans policies=$policies restore_ms=$restore_ms dropped=$(( KEEP_DB == 0 ? 1 : 0 ))"
