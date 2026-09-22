#!/usr/bin/env bash
# =====================================================================
# MWT.ONE Harness · despliegue en el VPS (ejecutar EN el VPS).
#
#   cd /opt/mwt-one-harness && bash scripts/deploy-vps.sh
#
# Requisitos: docker + docker compose y un .env ya configurado.
# El server block de nginx NO se copia: es un bind-mount de archivo desde
# $ROOT/nginx/harness.conf, así que basta recargar nginx tras cambiar el archivo.
#
# El fork se construye en el árbol persistente /opt/harness-build/tree (dentro
# del builder mwt-one-harness/builder): pnpm install solo toca las dependencias
# que cambiaron, tsc -b emite incremental gracias al tsbuildinfo que sobrevive
# en el árbol, y la imagen final solo empaqueta el resultado. Un despliegue
# caliente tarda minutos, no la media hora del build frío dentro de Docker.
# =====================================================================
set -euo pipefail

export DOCKER_BUILDKIT=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BUILD_DIR=/opt/harness-build
TREE="$BUILD_DIR/tree"
FORK_SHA="${DSH_FORK_SHA:-unknown}"

step() { echo "==> $1 ($(date -u +%H:%M:%S))"; }

if [[ ! -f .env ]]; then
  echo "ERROR: falta $ROOT/.env (copia .env.example y rellénalo)"; exit 1
fi
if [[ ! -f vendor/deepseek-harness-src.tgz ]]; then
  echo "ERROR: falta vendor/deepseek-harness-src.tgz (lo sube scripts/push-to-vps.ps1)"; exit 1
fi

step "1/6  Sincronizando el árbol persistente del fork"
mkdir -p "$BUILD_DIR/new" "$BUILD_DIR/pnpm-store"
rm -rf "$BUILD_DIR/new/deepseek-harness"
mkdir -p "$BUILD_DIR/new/deepseek-harness"
tar -xzf vendor/deepseek-harness-src.tgz -C "$BUILD_DIR/new/deepseek-harness"
command -v rsync >/dev/null 2>&1 || { echo "   instalando rsync (una vez)"; apt-get update -qq && apt-get install -y -qq rsync; }
mkdir -p "$TREE"
# --delete limpia fuentes retiradas; las exclusiones conservan lo que hace el
# build incremental: .git (commit incremental), node_modules, lib/, tsbuildinfo.
rsync -a --delete \
  --exclude='.git' --exclude='node_modules' --exclude='lib' --exclude='dist' \
  --exclude='*.tsbuildinfo' --exclude='.dsh-build' \
  "$BUILD_DIR/new/deepseek-harness/" "$TREE/"
printf '%s' "$FORK_SHA" > "$TREE/.fork-sha"
rm -rf "$BUILD_DIR/new"

step "2/6  Builder persistente (imagen toolchain, se construye una vez)"
docker build -q -t mwt-one-harness/builder -f scripts/Dockerfile.builder scripts >/dev/null

step "3/6  Build del fork (incremental sobre el árbol persistente)"
docker run --rm \
  -v "$TREE:/src" \
  -v "$BUILD_DIR/pnpm-store:/pnpm-store" \
  -e CI=1 -e PNPM_STORE_DIR=/pnpm-store -e DSH_FORK_SHA="$FORK_SHA" \
  -w /src \
  mwt-one-harness/builder sh -lc '
    set -e
    if [ ! -d .git ]; then git init -q; fi
    git add -A
    git -c user.email=build@local -c user.name=build commit -qm "faberloom fork ${DSH_FORK_SHA}" --allow-empty
    pnpm install --frozen-lockfile
    pnpm run build
    test -f apps/cli/lib/bin.js
  '

step "4/6  Empaquetando el árbol construido"
rm -f vendor/deepseek-harness-built.tgz
# gzip -1 por pipe: --use-compress-program no existe en el bsdtar del VPS.
tar --exclude='./.git' -C "$TREE" -cf - . | gzip -1 > vendor/deepseek-harness-built.tgz
echo "   $(du -h vendor/deepseek-harness-built.tgz | cut -f1) (sha del fork: $FORK_SHA)"

step "5/6  Levantando el stack"
# M9 · manifiesto que /healthz compara: se copia al directorio montado en solo
# lectura. `cp` trunca el archivo existente (mismo inodo), así que el bind-mount
# del contenedor ve el contenido nuevo sin recrearlo.
mkdir -p /opt/mwt/harness-manifest
cp -f "$ROOT/MANIFEST.md" /opt/mwt/harness-manifest/MANIFEST.md
# La red del stack de memoria es external; si aún no existe (primer despliegue
# antes de levantar /opt/tdai) se crea vacía para no romper el `compose up`.
docker network create tdai-memory-stack >/dev/null 2>&1 || true
# El push extrae los scripts sin bit de ejecución: sin esto, el cron de respaldo
# falla con "Permission denied" hasta que alguien lo arregle a mano.
chmod +x scripts/*.sh 2>/dev/null || true
docker compose up -d --build

step "6/6  nginx y estado"
docker network connect harness-net mwt-nginx 2>/dev/null || true
if docker inspect mwt-nginx -f '{{range .Mounts}}{{.Source}}{{"\n"}}{{end}}' | grep -q "$ROOT/nginx/harness.conf"; then
  docker exec mwt-nginx nginx -t
  docker exec mwt-nginx nginx -s reload
else
  echo "AVISO: mwt-nginx no monta $ROOT/nginx/harness.conf."
  echo "       Ajusta el mount en /opt/mwt/docker-compose.yml y recrea mwt-nginx,"
  echo "       o copia el archivo dentro del contenedor antes de recargar."
fi
docker compose ps
echo
echo "Comprueba:  curl -fsS https://harness.mwt.one/healthz"
