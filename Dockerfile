# syntax=docker/dockerfile:1

# =====================================================================
# MWT.ONE Harness · gateway + our customized DeepSeek Harness fork.
#
# The fork is built OUTSIDE this image by scripts/deploy-vps.sh, in the
# persistent builder at /opt/harness-build (incremental installs and builds
# across deploys); this image only packages the resulting tree at
# `vendor/deepseek-harness-built.tgz`. The per-user supervisor launches
# `dsh --profile faberloom`.
# =====================================================================

FROM node:22.23.2-bookworm-slim

# Real fork commit, injected by scripts/push-to-vps.ps1 via docker-compose build
# args and verified against /opt/dsh/.fork-sha (written by deploy-vps.sh).
ARG DSH_FORK_SHA=unknown

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates bubblewrap python3 \
    tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng poppler-utils \
    libreoffice-writer libreoffice-calc libreoffice-impress fonts-liberation \
  && rm -rf /var/lib/apt/lists/*
# Sandbox: la cadena Linux de `dsh-sandbox-local` exige `bwrap` (el launcher
# Landlock no viaja en la imagen), y el perfil base pide `workspace-write`.
# Sin bubblewrap, cada comando falla con SANDBOX_UNAVAILABLE.
# python3: los agentes lo usan para parsear volcados de tools (JSON/JSONL) en
# el shell; la imagen slim no lo trae.
# OCR local de adjuntos (`FABERLOOM_OCR=local`): `tesseract-ocr` con los idiomas
# español e inglés lee una imagen o una página escaneada, y `poppler-utils`
# aporta `pdftoppm`, que rasteriza el PDF página a página. Sin
# `tesseract-ocr-spa` un pedido en español se lee a medias. Coste medido:
# 115 MB de disco y 38 MB de descarga (69 paquetes).
#
# Office escaneado: un .docx/.xlsx/.pptx sin texto se convierte a PDF con
# LibreOffice headless y luego pasa por el mismo OCR. `fonts-liberation` (2 MB)
# mantiene las métricas de Arial, para que una tabla no se descuadre antes de
# que el OCR lea sus columnas. Coste medido de los tres módulos con
# `--no-install-recommends`: 506 MB de disco adicional y 154 MB de descarga
# (171 paquetes); la imagen pasa de 329 MB a 991 MB. Supera los 400 MB: si eso
# es un techo, las variantes `-nogui` bajan a 431 MB, sólo
# `libreoffice-writer-nogui` a 368 MB, y convertir en un contenedor aparte deja
# la imagen como está (ver la Agent Note 2026-11-24-attachment-local-ocr).

# OCR de páginas difíciles: una foto de celular torcida o manuscrita no la lee
# Tesseract, así que `deploy/ocr/ocr-tools.py` endereza la página y, cuando la
# confianza de Tesseract dice que no la leyó bien, la relee con RapidOCR
# (PP-OCRv4 sobre ONNX, CPU). Medido sobre adjuntos reales del buzón: Tesseract
# acertó 3 de 5 campos en una factura manuscrita y 0-2 de 5 en los mismos
# recibos girados 7 grados; RapidOCR acertó 5 de 5 en las doce variantes, y
# enderezar antes de Tesseract devolvió los recibos girados a 5 de 5.
# `opencv-python-headless` y no `opencv-python` porque son 137 MB en vez de
# 203 MB, con el mismo resultado. Coste medido: 350 MB de disco.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3-pip \
  && python3 -m pip install --no-cache-dir --break-system-packages --target /opt/ocr/py --no-deps \
    rapidocr-onnxruntime==1.4.4 \
  && python3 -m pip install --no-cache-dir --break-system-packages --target /opt/ocr/py \
    onnxruntime==1.32.0 opencv-python-headless==4.11.0.86 numpy==1.26.4 Pillow==13.0.0 \
    shapely==2.2.0 pyclipper==1.4.0 six==1.17.0 PyYAML==6.0.4 \
  && chmod -R a+rX /opt/ocr \
  && rm -rf /var/lib/apt/lists/*

# context-mode: servidor MCP de ahorro de contexto (sandbox + FTS5). Se fija la
# versión y se instala global para que cada dsh lo arranque por stdio. Licencia
# Elastic-2.0 (source-available; uso interno permitido, no revender como servicio).
ARG CONTEXT_MODE_VERSION=1.0.169
RUN npm install -g --no-audit --no-fund "context-mode@${CONTEXT_MODE_VERSION}" \
  && test -f /usr/local/lib/node_modules/context-mode/start.mjs \
  && echo "context-mode ${CONTEXT_MODE_VERSION} instalado"

# context-mode renders its prompts in the container locale; the slim image has
# none, so it falls back to Chinese. Pin English for every process it starts.
ENV CONTEXT_MODE_LOCALE=en-US

# The built harness fork: a workspace with its built lib/ and node_modules.
COPY vendor/deepseek-harness-built.tgz /tmp/fork.tgz
RUN mkdir -p /opt/dsh \
  && tar -xzf /tmp/fork.tgz -C /opt/dsh \
  && rm /tmp/fork.tgz \
  && test -f /opt/dsh/apps/cli/lib/bin.js

# Catálogo de skills del MCP, aplanado por rol (<rol>/<skill>/SKILL.md).
COPY skills-catalog/ /opt/skills-catalog/
COPY skills-shared/ /opt/skills-shared/
COPY agents-shared/ /opt/agents-shared/

# Enderezado y segundo motor de OCR; el código lo invoca por ruta absoluta.
COPY deploy/ocr/ /opt/ocr/

# Stable entrypoint the supervisor spawns per user (DSH_BIN).
RUN printf '#!/bin/sh\nexec node /opt/dsh/apps/cli/lib/bin.js "$@"\n' > /opt/dsh/bin-dsh \
  && chmod +x /opt/dsh/bin-dsh

# Jaula por corrida de Code Mode (`run_code` → fila `ptc-runtime`, que la usa
# como `nodeExecutable`). `node-jail` envuelve el hijo en bwrap con namespaces
# propios y solo el home del inquilino escribible; sin ella, un programa del
# modelo lee `/data/users/*` de todos. bubblewrap ya viene del apt de arriba.
# `sh -n` en el build: un script de seguridad con un error de sintaxis no debe
# llegar a la imagen, donde solo se descubriría en la primera corrida.
COPY deploy/jail/node-jail deploy/jail/verify.sh /opt/dsh/bin/
RUN chmod 0755 /opt/dsh/bin/node-jail /opt/dsh/bin/verify.sh \
  && sh -n /opt/dsh/bin/node-jail \
  && sh -n /opt/dsh/bin/verify.sh

# Dependencies of the gateway.
COPY gateway/package.json ./gateway/package.json
RUN cd gateway && npm install --omit=dev

# Manifiesto del despliegue: /healthz (M9) avisa si no cita el SHA construido.
COPY MANIFEST.md /app/MANIFEST.md

COPY gateway/ ./gateway/

# Migración y reversión de la propiedad de los homes por inquilino. Importa
# `../gateway/tenant-uids.mjs`, que ya viaja arriba; el script tiene que estar
# en la imagen para poder correrlo con el volumen montado en /data.
COPY scripts/harden-homes.mjs ./scripts/harden-homes.mjs

# The gateway applies the canonical schema; it keeps no DDL of its own. In the
# image it travels beside board-api.mjs (resolved before the repo path), so
# MESA_SCHEMA_FILE is only needed to point somewhere else.
COPY packages/faberloom/board/postgres/schema.sql ./gateway/schema.sql

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=5 --start-period=20s \
  CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "gateway/server.mjs"]
