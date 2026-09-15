#!/usr/bin/env bash
# =====================================================================
# Harness MWT · despliegue en el VPS (ejecutar EN el VPS).
#
#   cd /opt/harness && bash scripts/deploy-vps.sh
#
# Requisitos: docker + docker compose, y que /opt/harness tenga el stack
# (scp/rsync desde tu máquina) con un .env ya configurado.
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "ERROR: falta $ROOT/.env (copia .env.example y rellénalo)"; exit 1
fi

echo "==> 1/5  Levantando el stack"
docker compose up -d --build

echo "==> 2/5  Conectando mwt-nginx a la red harness-net"
docker network connect harness-net mwt-nginx 2>/dev/null || true

echo "==> 3/5  Instalando el server block de nginx"
docker cp "$ROOT/nginx/harness.conf" mwt-nginx:/etc/nginx/conf.d/harness.conf

echo "==> 4/5  Validando y recargando nginx"
docker exec mwt-nginx nginx -t
docker exec mwt-nginx nginx -s reload

echo "==> 5/5  Estado"
docker compose ps
echo
echo "Listo. DNS: crea un registro A 'harness.mwt.one' -> 187.77.218.102 (Proxied) en Cloudflare."
echo "Comprueba:  curl -fsS https://harness.mwt.one/healthz"
