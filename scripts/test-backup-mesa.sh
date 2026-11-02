#!/usr/bin/env bash
# =====================================================================
# Pruebas de `scripts/backup-mesa.sh` y `scripts/restore-mesa-drill.sh`.
#
#   bash scripts/test-backup-mesa.sh            # todo (host con docker)
#   bash scripts/test-backup-mesa.sh --offline  # sin docker: poda, guardas, estado
#
# Cada prueba usa un directorio de respaldos y un archivo de estado
# desechables bajo mktemp; nada escribe en /opt. El respaldo real y las
# comprobaciones contra el contenedor solo corren si el contenedor responde.
# =====================================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SH="$HERE/backup-mesa.sh"
DRILL_SH="$HERE/restore-mesa-drill.sh"
WORK="$(mktemp -d)"
OFFLINE=0
OUT_LOG=""
[[ "${1:-}" == "--offline" ]] && OFFLINE=1
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAILED=0
ok() { PASS=$((PASS + 1)); printf 'ok   %s\n' "$1"; }
ko() { FAILED=$((FAILED + 1)); printf 'FAIL %s\n' "$1"; }
assert_true() { if eval "$2" >/dev/null 2>&1; then ok "$1"; else ko "$1"; fi }
assert_false() { if eval "$2" >/dev/null 2>&1; then ko "$1"; else ok "$1"; fi }
assert_exit() { # <zero|nonzero|código> <nombre> <cmd...>
  local want="$1" name="$2" got=0
  shift 2
  if [[ -n "$OUT_LOG" ]]; then
    "$@" >"$OUT_LOG" 2>&1 || got=$?
  else
    "$@" >/dev/null 2>&1 || got=$?
  fi
  if [[ "$want" =~ ^[0-9]+$ ]]; then
    if [[ "$got" -eq "$want" ]]; then ok "$name (exit=$got)"; else ko "$name (exit=$got, esperado $want)"; fi
  elif [[ "$want" == "zero" && "$got" -eq 0 ]] || [[ "$want" != "zero" && "$got" -ne 0 ]]; then
    ok "$name (exit=$got)"
  else
    ko "$name (exit=$got, esperado $want)"
  fi
}

now="$(date -u +%s)"
mkdump() { # <dir> <name> <epoch> — artifact + compañeros con la misma mtime
  local dir="$1" name="$2" epoch="$3"
  printf 'MESA-DUMP-FIXTURE\n' >"$dir/$name"
  ( cd "$dir" && sha256sum "$name" >"$name.sha256" )
  printf 'stamp=fixture\n' >"$dir/$name.meta"
  touch -d "@$epoch" "$dir/$name" "$dir/$name.sha256" "$dir/$name.meta"
}
named() { echo "mesa_$(date -u -d "@$1" +%Y%m%dT%H%M%SZ).dump"; }
# Mediodía UTC de hace N días: agrupación diaria sin cruzar medianoche.
noon_days_ago() { date -u -d "$(date -u -d "-$1 day" +%F) 12:00" +%s; }
new_sandbox() { local dir="$WORK/$1"; mkdir -p "$dir/backups"; echo "$dir"; }

# ── 1. Poda: conserva lo reciente, adelgaza a una por día, borra lo viejo ──
SB="$(new_sandbox prune-basic)"
B="$SB/backups"
n_recent=( "$(named $((now - 600)))" "$(named $((now - 1200)))" "$(named $((now - 1800)))" )
day_a="$(noon_days_ago 3)"
n_daya_old1="$(named $((day_a)))"
n_daya_old2="$(named $((day_a + 1800)))"
n_daya_new="$(named $((day_a + 3600)))"
day_b="$(noon_days_ago 4)"
n_dayb="$(named "$day_b")"
aged="$(noon_days_ago 40)"
n_aged="$(named "$aged")"

mkdump "$B" "${n_recent[0]}" $((now - 600))
mkdump "$B" "${n_recent[1]}" $((now - 1200))
mkdump "$B" "${n_recent[2]}" $((now - 1800))
mkdump "$B" "$n_daya_old1" "$day_a"
mkdump "$B" "$n_daya_old2" $((day_a + 1800))
mkdump "$B" "$n_daya_new" $((day_a + 3600))
mkdump "$B" "$n_dayb" "$day_b"
mkdump "$B" "$n_aged" "$aged"

OUT_LOG="$SB/out.log"
assert_exit zero 'poda: termina con 0' \
  env MESA_BACKUP_DIR="$B" MESA_STATUS_FILE="$SB/status.txt" MESA_BACKUP_KEEP_COUNT=100 \
      MESA_BACKUP_RETENTION_DAYS=30 MESA_BACKUP_RECENT_HOURS=1 bash "$BACKUP_SH" --prune-only
OUT_LOG=""

assert_true 'poda: quedan 5 artifacts (3 recientes + 1 por día antiguo)' "[[ \$(ls -1 "$B"/mesa_*.dump | wc -l) -eq 5 ]]"
assert_true 'poda: conserva la más nueva del día de 3 días' "[[ -f '$B/$n_daya_new' ]]"
assert_false 'poda: descarta las otras dos del día de 3 días' "[[ -f '$B/$n_daya_old1' || -f '$B/$n_daya_old2' ]]"
assert_true 'poda: conserva el día de 4 días' "[[ -f '$B/$n_dayb' ]]"
assert_false 'poda: borra el artifact de 40 días' "[[ -f '$B/$n_aged' ]]"
assert_false 'poda: borra su .sha256' "[[ -f '$B/$n_aged.sha256' ]]"
assert_false 'poda: borra su .meta' "[[ -f '$B/$n_aged.meta' ]]"
assert_true 'poda: loguea cada borrado' "grep -q 'poda:' '$SB/out.log'"
assert_true 'poda: estado OK con kept=5 y pruned=3' "grep -q 'kept=5' '$SB/status.txt' && grep -q 'pruned=3' '$SB/status.txt'"

# ── 2. Poda: el tope por conteo manda sobre la ventana reciente ──────
SB="$(new_sandbox prune-count)"
B="$SB/backups"
for i in $(seq 1 10); do mkdump "$B" "$(named $((now - i * 60)))" $((now - i * 60)); done
assert_exit zero 'tope: termina con 0' \
  env MESA_BACKUP_DIR="$B" MESA_STATUS_FILE="$SB/status.txt" MESA_BACKUP_KEEP_COUNT=4 \
      MESA_BACKUP_RETENTION_DAYS=30 MESA_BACKUP_RECENT_HOURS=48 bash "$BACKUP_SH" --prune-only
assert_true 'tope: deja exactamente KEEP_COUNT artifacts' "[[ \$(ls -1 "$B"/mesa_*.dump | wc -l) -eq 4 ]]"
assert_true 'tope: conserva el más nuevo' "[[ -f '$B/$(named $((now - 60)))' ]]"
assert_false 'tope: descarta el más viejo' "[[ -f '$B/$(named $((now - 600)))' ]]"
assert_true 'tope: ningún checksum huérfano' "[[ \$(ls -1 "$B"/*.sha256 | wc -l) -eq 4 ]]"
assert_true 'tope: ningún .meta huérfano' "[[ \$(ls -1 "$B"/*.meta | wc -l) -eq 4 ]]"

# ── 3. Poda: un directorio vacío no es un fallo ──────────────────────
SB="$(new_sandbox prune-empty)"
assert_exit zero 'poda: directorio vacío termina con 0' \
  env MESA_BACKUP_DIR="$SB/backups" MESA_STATUS_FILE="$SB/status.txt" bash "$BACKUP_SH" --prune-only
assert_true 'poda: estado OK con kept=0' "grep -q 'kept=0' '$SB/status.txt'"
assert_true 'estado: forma `OK|REMOTE_FAIL|FAIL <ISO8601> k=v`' \
  "grep -Eq '^(OK|REMOTE_FAIL|FAIL) [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z( |$)' '$SB/status.txt'"

# ── 4. Respaldo: un contenedor ausente falla y lo deja escrito ───────
SB="$(new_sandbox backup-fail)"
assert_exit nonzero 'respaldo: contenedor ausente sale != 0' \
  env MESA_CONTAINER=mesa-no-existe MESA_BACKUP_DIR="$SB/backups" MESA_STATUS_FILE="$SB/status.txt" bash "$BACKUP_SH"
assert_true 'respaldo: estado FAIL con reason' "grep -Eq '^FAIL [0-9]{4}-.*reason=[a-z_]+' '$SB/status.txt'"
assert_false 'respaldo: no deja artifacts ni parciales' "ls -1 '$SB/backups' 2>/dev/null | grep -qE 'part$|\\.dump$'"

# ── 5. Respaldo: una base inexistente falla antes de escribir ────────
SB="$(new_sandbox backup-nodb)"
assert_exit nonzero 'respaldo: base inexistente sale != 0' \
  env MESA_DB=mesa_no_existe MESA_BACKUP_DIR="$SB/backups" MESA_STATUS_FILE="$SB/status.txt" bash "$BACKUP_SH"
assert_true 'respaldo: reason=database_missing' "grep -q 'reason=database_missing' '$SB/status.txt'"

# ── 6. Frescura: un estado viejo o fallido no pasa ───────────────────
SB="$(new_sandbox freshness)"
mkdump "$SB/backups" mesa_20260101T000000Z.dump "$((now - 7200))"
printf 'OK %s artifact=mesa_20260101T000000Z.dump bytes=1 sha256=%s\n' \
  "$(date -u -d "@$((now - 3600))" +%Y-%m-%dT%H:%M:%SZ)" "$(cut -d' ' -f1 "$SB/backups/mesa_20260101T000000Z.dump.sha256")" >"$SB/status.txt"
assert_exit nonzero 'frescura: respaldo de hace 1 h no pasa con límite 45 min' \
  env MESA_BACKUP_DIR="$SB/backups" MESA_STATUS_FILE="$SB/status.txt" MESA_MAX_AGE_MINUTES=45 bash "$BACKUP_SH" --check-freshness
assert_exit zero 'frescura: el mismo estado pasa con límite 90 min' \
  env MESA_BACKUP_DIR="$SB/backups" MESA_STATUS_FILE="$SB/status.txt" MESA_MAX_AGE_MINUTES=90 bash "$BACKUP_SH" --check-freshness
printf 'OK %s artifact=mesa_ausente.dump bytes=1 sha256=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(cut -d' ' -f1 "$SB/backups/mesa_20260101T000000Z.dump.sha256")" >"$SB/status.txt"
assert_exit nonzero 'frescura: un artifact ausente no pasa' \
  env MESA_BACKUP_DIR="$SB/backups" MESA_STATUS_FILE="$SB/status.txt" bash "$BACKUP_SH" --check-freshness
printf 'FAIL %s reason=dump_failed\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$SB/status.txt"
assert_exit nonzero 'frescura: estado FAIL no pasa' \
  env MESA_BACKUP_DIR="$SB/backups" MESA_STATUS_FILE="$SB/status.txt" bash "$BACKUP_SH" --check-freshness

# ── 7. Drill: nunca apunta a una base de producción ──────────────────
# Todo drill lanzado desde la suite escribe en un estado desechable: la suite no
# debe pisar /opt/mwt/mesa_restore_drill_status.txt.
TSTATUS="$WORK/test-drill-status.txt"
for protected in faberloom_mesa mwt_one postgres template0 template1; do
  assert_exit nonzero "drill: rechaza --target $protected" \
    env MESA_STATUS_FILE="$TSTATUS" bash "$DRILL_SH" --artifact /nonexistent.dump --target "$protected"
done
assert_exit nonzero 'drill: rechaza un nombre fuera de mesa_drill_*' \
  env MESA_STATUS_FILE="$TSTATUS" bash "$DRILL_SH" --artifact /nonexistent.dump --target mesa_items
assert_exit nonzero 'drill: rechaza un artifact inexistente' \
  env MESA_STATUS_FILE="$TSTATUS" bash "$DRILL_SH" --artifact /nonexistent.dump
SB="$(new_sandbox drill-nocontainer)"
assert_exit nonzero 'drill: contenedor ausente sale != 0' \
  env MESA_CONTAINER=mesa-no-existe MESA_STATUS_FILE="$SB/drill.txt" bash "$DRILL_SH" --artifact /nonexistent.dump
assert_true 'drill: reason=container_down' "grep -q 'reason=container_down' '$SB/drill.txt'"
assert_false 'drill: la suite no escribe el estado de producción' \
  "grep -q 'reason=target_rejected' /opt/mwt/mesa_restore_drill_status.txt"

# ── 8. Drill: un artifact corrupto falla antes de crear la base ──────
SB="$(new_sandbox drill-corrupt)"
corrupt="$SB/mesa_20260101T000000Z.dump"
printf 'no-es-un-dump\n' >"$corrupt"
( cd "$SB" && sha256sum mesa_20260101T000000Z.dump >mesa_20260101T000000Z.dump.sha256 )
printf 'basura' >>"$corrupt"
if [[ "$OFFLINE" -eq 0 ]] && docker inspect -f '{{.State.Running}}' consola-mwt-one-postgres 2>/dev/null | grep -q true; then
  dbs_before="$(docker exec consola-mwt-one-postgres psql -U mwt -d postgres -Atc 'select datname from pg_database order by 1' 2>/dev/null)"
else
  dbs_before=""
fi
assert_exit nonzero 'drill: checksum que no coincide sale != 0' \
  env MESA_BACKUP_DIR="$SB" MESA_STATUS_FILE="$SB/drill.txt" bash "$DRILL_SH" --artifact "$corrupt"
assert_true 'drill: estado FAIL con reason' "grep -Eq '^FAIL [0-9]{4}-.*reason=[a-z_]+' '$SB/drill.txt'"
if [[ -n "$dbs_before" ]]; then
  assert_true 'drill: un checksum malo no crea base' \
    "[[ \"\$(docker exec consola-mwt-one-postgres psql -U mwt -d postgres -Atc 'select datname from pg_database order by 1' 2>/dev/null)\" == \"$dbs_before\" ]]"
fi

# ── 9. En vivo: respaldo real, checksum verificable, sin secretos ────
if [[ "$OFFLINE" -eq 0 ]] && docker inspect -f '{{.State.Running}}' consola-mwt-one-postgres 2>/dev/null | grep -q true; then
  SB="$(new_sandbox live)"
  OUT_LOG="$SB/out.log"
  assert_exit zero 'vivo: respaldo real termina con 0' \
    env MESA_BACKUP_DIR="$SB/backups" MESA_STATUS_FILE="$SB/status.txt" bash "$BACKUP_SH"
  OUT_LOG=""
  artifact="$(ls -1t "$SB"/backups/mesa_*.dump 2>/dev/null | head -1)"
  assert_true 'vivo: produce un .dump no vacío' "[[ -s '$artifact' ]]"
  assert_true 'vivo: produce su .sha256' "[[ -s '$artifact.sha256' ]]"
  assert_true 'vivo: el checksum verifica' "( cd '$SB/backups' && sha256sum -c --status '$(basename "$artifact").sha256' )"
  assert_true 'vivo: el TOC nombra mesa_items' \
    "docker exec -i consola-mwt-one-postgres pg_restore --list < '$artifact' | grep -q 'TABLE DATA public mesa_items'"
  assert_true 'vivo: el TOC nombra mesa_events' \
    "docker exec -i consola-mwt-one-postgres pg_restore --list < '$artifact' | grep -q 'TABLE DATA public mesa_events'"
  assert_true 'vivo: el .meta registra conteos' \
    "grep -Eq '^items=[0-9]+\$' '$artifact.meta' && grep -Eq '^events=[0-9]+\$' '$artifact.meta'"
  assert_true 'vivo: estado OK con artifact, bytes y sha256' \
    "grep -Eq '^OK [0-9]{4}-.*artifact=mesa_[0-9TZ]+\.dump bytes=[0-9]+ sha256=[0-9a-f]{64}' '$SB/status.txt'"
  assert_true 'vivo: sin MESA_REMOTE el estado dice remote=off' "grep -q 'remote=off' '$SB/status.txt'"
  if [[ -r /opt/mwt-one-harness/.env.mesa ]]; then
    secret="$(sed -n 's/^MESA_DB_PASSWORD=//p' /opt/mwt-one-harness/.env.mesa | head -1)"
    if [[ -n "$secret" ]]; then
      assert_false 'vivo: el estado no contiene la contraseña' "grep -qF -- '$secret' '$SB/status.txt'"
      assert_false 'vivo: el log no contiene la contraseña' "grep -qF -- '$secret' '$SB/out.log'"
    fi
  fi

  # ── 10. Remoto: fallo visible, sin bloquear el respaldo local ──────
  SB="$(new_sandbox remote-bad)"
  assert_exit zero 'remoto: un destino inválido no bloquea el respaldo' \
    env MESA_BACKUP_DIR="$SB/backups" MESA_STATUS_FILE="$SB/status.txt" MESA_REMOTE=sin-dos-puntos \
        bash "$BACKUP_SH"
  assert_true 'remoto: estado REMOTE_FAIL con motivo' \
    "grep -Eq '^REMOTE_FAIL [0-9]{4}-.*reason=remote_failed remote=sin-dos-puntos remote_reason=remote_invalid' '$SB/status.txt'"
  assert_true 'remoto: el artifact local sigue existiendo' "[[ -s \"\$(ls -1t '$SB'/backups/mesa_*.dump | head -1)\" ]]"
  assert_true 'remoto: el estado conserva los conteos locales' "grep -q 'items=[0-9]' '$SB/status.txt' && grep -q 'events=[0-9]' '$SB/status.txt'"

  SB="$(new_sandbox remote-unreachable)"
  assert_exit zero 'remoto: un remoto inexistente no bloquea el respaldo' \
    env MESA_BACKUP_DIR="$SB/backups" MESA_STATUS_FILE="$SB/status.txt" MESA_REMOTE=rclone-no-existe:mesa \
        bash "$BACKUP_SH"
  assert_true 'remoto: motivo mkdir_failed o upload_failed' \
    "grep -Eq 'remote_reason=(mkdir_failed|upload_failed)' '$SB/status.txt'"
  assert_exit 3 'remoto: --check-freshness distingue el fallo remoto (exit 3)' \
    env MESA_BACKUP_DIR="$SB/backups" MESA_STATUS_FILE="$SB/status.txt" bash "$BACKUP_SH" --check-freshness

  # ── 11. Remoto real: copia a un destino rclone que sí responde ─────
  if rclone lsd mlocal: >/dev/null 2>&1; then
    target="mlocal:mesa-selftest-$(date -u +%s)"
    SB="$(new_sandbox remote-live)"
    OUT_LOG="$SB/out.log"
    assert_exit zero 'remoto real: respaldo con copia externa termina con 0' \
      env MESA_BACKUP_DIR="$SB/backups" MESA_STATUS_FILE="$SB/status.txt" MESA_REMOTE="$target" bash "$BACKUP_SH"
    OUT_LOG=""
    artifact="$(ls -1t "$SB"/backups/mesa_*.dump | head -1)"
    base="$(basename "$artifact")"
    local_bytes="$(stat -c %s "$artifact")"
    remote_size="$(rclone lsjson --stat "$target/$base" 2>/dev/null | tr ',' '\n' | sed -n 's/.*"Size":[[:space:]]*\([0-9]*\).*/\1/p' | head -1)"
    assert_true 'remoto real: el artifact llega con el mismo tamaño' "[[ '$remote_size' == '$local_bytes' ]]"
    assert_true 'remoto real: .sha256 y .meta también llegan' \
      "rclone lsf '$target' --files-only 2>/dev/null | grep -qx '$base.sha256' && rclone lsf '$target' --files-only 2>/dev/null | grep -qx '$base.meta'"
    assert_true 'remoto real: la copia leída de vuelta tiene el mismo sha256' \
      "rclone copyto '$target/$base' '$SB/readback.dump' >/dev/null 2>&1 && [[ \"\$(sha256sum '$SB/readback.dump' | cut -d' ' -f1)\" == \"\$(sha256sum '$artifact' | cut -d' ' -f1)\" ]]"
    assert_true 'remoto real: el estado registra remote_ok=1' "grep -q 'remote_ok=1' '$SB/status.txt' && grep -q 'remote=$target' '$SB/status.txt'"
    assert_exit zero 'remoto real: --check-freshness pasa con la copia verificada' \
      env MESA_BACKUP_DIR="$SB/backups" MESA_STATUS_FILE="$SB/status.txt" bash "$BACKUP_SH" --check-freshness
    stray=mesa_00000000T000000Z.dump
    printf 'stray\n' >"$SB/stray.dump"
    rclone copyto "$SB/stray.dump" "$target/$stray" >/dev/null 2>&1
    sleep 1
    assert_exit zero 'remoto real: segunda ejecución con retención remota' \
      env MESA_BACKUP_DIR="$SB/backups" MESA_STATUS_FILE="$SB/status.txt" MESA_REMOTE="$target" bash "$BACKUP_SH"
    assert_false 'remoto real: la retención remota borra lo que ya no existe en local' \
      "rclone lsf '$target' --files-only 2>/dev/null | grep -qx '$stray'"
    rclone purge "$target" >/dev/null 2>&1
    assert_true 'remoto real: destino de prueba limpiado' "! rclone lsd mlocal: 2>/dev/null | grep -q mesa-selftest"
  else
    printf 'skip remoto real: mlocal no responde\n'
  fi
else
  printf 'skip vivas: docker no disponible o --offline\n'
fi

printf '\n%d ok, %d fallidas\n' "$PASS" "$FAILED"
[[ "$FAILED" -eq 0 ]]
