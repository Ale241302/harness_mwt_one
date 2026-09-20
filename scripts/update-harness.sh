#!/usr/bin/env bash
# =====================================================================
# MWT.ONE Harness · actualización controlada (E8)
#
#   bash scripts/update-harness.sh            # respalda, reconstruye, verifica y publica
#   SKIP_BACKUP=1 bash scripts/update-harness.sh
#   bash scripts/update-harness.sh --rollback # vuelve a la imagen :prev
#
# La secuencia es: respaldo previo → conservar la imagen actual como :prev →
# reconstruir → levantar → comprobar /healthz → si falla, revertir sola →
# registrar la release en RELEASES.tsv y refrescar nginx.
# =====================================================================
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
IMAGE=mwt-one-harness/gateway
CONTAINER=mwt-one-harness-gateway
RELEASES="$ROOT/RELEASES.tsv"
SKIP_BACKUP="${SKIP_BACKUP:-0}"
HEALTH_TRIES="${HEALTH_TRIES:-30}"

log() { echo "[$(date '+%F %T')] $*"; }
fail() { log "ERROR: $1"; exit 1; }

health_ok() {
  local i
  for ((i=1; i<=HEALTH_TRIES; i++)); do
    if docker exec "$CONTAINER" curl -fsS http://127.0.0.1:8080/healthz >/dev/null 2>&1; then return 0; fi
    sleep 3
  done
  return 1
}

reload_nginx() {
  docker network connect harness-net mwt-nginx 2>/dev/null || true
  docker restart mwt-nginx >/dev/null 2>&1 || true
}

record() { # estado dshVersion imageId prevId nota
  [[ -f "$RELEASES" ]] || printf 'utc\testado\tdsh_version\timage_id\tprev_id\tnota\n' > "$RELEASES"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$3" "$4" "${5:-}" >> "$RELEASES"
}

# ── Rollback explícito ───────────────────────────────────────────────
if [[ "${1:-}" == "--rollback" ]]; then
  prev="$(docker image inspect "$IMAGE:prev" --format '{{.Id}}' 2>/dev/null || true)"
  [[ -n "$prev" ]] || fail "no hay imagen :prev para revertir"
  log "Revirtiendo a :prev ($prev)"
  docker tag "$IMAGE:prev" "$IMAGE:latest"
  docker compose up -d gateway
  health_ok || fail "el rollback no pasó el health check"
  reload_nginx
  record OK "$(docker exec "$CONTAINER" /opt/dsh/bin-dsh --version 2>/dev/null || echo '?')" "$prev" "" "rollback"
  log "Rollback completado y sano"
  exit 0
fi

# ── 1. Respaldo previo ───────────────────────────────────────────────
if [[ "$SKIP_BACKUP" == "1" ]]; then
  log "== 1/6  Respaldo previo omitido (SKIP_BACKUP=1)"
else
  log "== 1/6  Respaldo previo a la actualización"
  bash "$ROOT/scripts/backup-harness.sh" || fail "el respaldo previo falló; se aborta la actualización"
fi

# ── 2. Conservar la imagen actual ────────────────────────────────────
log "== 2/6  Conservando la imagen actual como :prev"
current="$(docker image inspect "$IMAGE:latest" --format '{{.Id}}' 2>/dev/null || true)"
if [[ -n "$current" ]]; then
  docker tag "$IMAGE:latest" "$IMAGE:prev"
  log "   :prev = $current"
else
  log "   AVISO: no hay imagen :latest previa (primer despliegue)"
fi
current_dsh="$(docker exec "$CONTAINER" /opt/dsh/bin-dsh --version 2>/dev/null || echo '?')"

# ── 3. Reconstruir ───────────────────────────────────────────────────
log "== 3/6  Reconstruyendo la imagen desde vendor/deepseek-harness-src.tgz"
docker compose build gateway

# ── 4. Levantar ──────────────────────────────────────────────────────
log "== 4/6  Levantando el gateway actualizado"
docker compose up -d gateway
if health_ok; then
  log "   healthz OK"
else
  log "   healthz FALLÓ: revirtiendo a :prev"
  if [[ -n "$current" ]]; then
    docker tag "$IMAGE:prev" "$IMAGE:latest"
    docker compose up -d gateway
    health_ok && log "   rollback sano" || log "   ATENCIÓN: el rollback tampoco pasó healthz"
    reload_nginx
    record FAIL "$current_dsh" "$(docker image inspect "$IMAGE:prev" --format '{{.Id}}' 2>/dev/null || echo '')" "$current" "update failed, rolled back"
    fail "actualización revertida"
  fi
  record FAIL "$current_dsh" "" "$current" "update failed, sin imagen previa"
  fail "actualización fallida y sin imagen previa para revertir"
fi

# ── 5. Publicar y etiquetar ──────────────────────────────────────────
newid="$(docker image inspect "$IMAGE:latest" --format '{{.Id}}')"
new_dsh="$(docker exec "$CONTAINER" /opt/dsh/bin-dsh --version 2>/dev/null || echo '?')"
docker tag "$IMAGE:latest" "$IMAGE:$new_dsh" 2>/dev/null || true
reload_nginx
log "== 5/6  Publicado · dsh=$new_dsh imagen=${newid:0:12} nginx recargado"

# ── 6. Registrar ─────────────────────────────────────────────────────
log "== 6/6  Registrando la release en RELEASES.tsv"
record OK "$new_dsh" "$newid" "$current" "update"
tail -3 "$RELEASES"

# Cada actualización deja capas y la imagen anterior: se limpian las cachés de
# más de un día y las imágenes colgantes (nunca :latest, :prev ni la versionada).
log "== Limpieza de residuos de build =="
docker builder prune -af --filter until=24h >/dev/null 2>&1 || true
docker image prune -f >/dev/null 2>&1 || true
df -h / | awk 'NR==2{print "   disco: " $4 " libres (" $5 " usado)"}'
log "OK: actualización controlada completada"
