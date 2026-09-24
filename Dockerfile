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
  && apt-get install -y --no-install-recommends curl ca-certificates \
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

# Stable entrypoint the supervisor spawns per user (DSH_BIN).
RUN printf '#!/bin/sh\nexec node /opt/dsh/apps/cli/lib/bin.js "$@"\n' > /opt/dsh/bin-dsh \
  && chmod +x /opt/dsh/bin-dsh

# Dependencies of the gateway.
COPY gateway/package.json ./gateway/package.json
RUN cd gateway && npm install --omit=dev

# Manifiesto del despliegue: /healthz (M9) avisa si no cita el SHA construido.
COPY MANIFEST.md /app/MANIFEST.md

COPY gateway/ ./gateway/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=5 --start-period=20s \
  CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "gateway/server.mjs"]
