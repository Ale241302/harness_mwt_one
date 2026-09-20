#!/usr/bin/env bash
# =====================================================================
# MWT.ONE Harness · despliegue en el VPS (ejecutar EN el VPS).
#
#   cd /opt/mwt-one-harness && bash scripts/deploy-vps.sh
#
# Requisitos: docker + docker compose y un .env ya configurado.
# El server block de nginx NO se copia: es un bind-mount de archivo desde
# $ROOT/nginx/harness.conf, así que basta recargar nginx tras cambiar el archivo.
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "ERROR: falta $ROOT/.env (copia .env.example y rellénalo)"; exit 1
fi

echo "==> 1/4  Levantando el stack"
# La red del stack de memoria es external; si aún no existe (primer despliegue
# antes de levantar /opt/tdai) se crea vacía para no romper el `compose up`.
docker network create tdai-memory-stack >/dev/null 2>&1 || true
# El push extrae los scripts sin bit de ejecución: sin esto, el cron de respaldo
# falla con "Permission denied" hasta que alguien lo arregle a mano.
chmod +x scripts/*.sh 2>/dev/null || true
docker compose up -d --build

echo "==> 2/4  Conectando mwt-nginx a la red harness-net"
docker network connect harness-net mwt-nginx 2>/dev/null || true

echo "==> 3/4  Validando y recargando nginx"
if docker inspect mwt-nginx -f '{{range .Mounts}}{{.Source}}{{"\n"}}{{end}}' | grep -q "$ROOT/nginx/harness.conf"; then
  docker exec mwt-nginx nginx -t
  docker exec mwt-nginx nginx -s reload
else
  echo "AVISO: mwt-nginx no monta $ROOT/nginx/harness.conf."
  echo "       Ajusta el mount en /opt/mwt/docker-compose.yml y recrea mwt-nginx,"
  echo "       o copia el archivo dentro del contenedor antes de recargar."
fi

echo "==> 4/4  Estado"
docker compose ps
echo
echo "Comprueba:  curl -fsS https://harness.mwt.one/healthz"
