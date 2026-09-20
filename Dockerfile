# syntax=docker/dockerfile:1

# =====================================================================
# MWT.ONE Harness · gateway + our customized DeepSeek Harness fork.
#
# The harness is built from the source tarball at
# `vendor/deepseek-harness-src.tgz` (produced from the local fork checkout
# by scripts/push-to-vps.ps1), NOT installed from the upstream npm package.
# The per-user supervisor launches `dsh --profile faberloom`.
# =====================================================================

# ── Stage 1: build the harness fork ──────────────────────────────────
FROM node:22.23.2-bookworm-slim AS harness-build

# Real fork commit, injected by scripts/push-to-vps.ps1 via docker-compose build
# args. It is recorded in the image so the built dsh is traceable to a source SHA
# instead of an unattributed synthetic commit.
ARG DSH_FORK_SHA=unknown

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential python3 pkg-config git ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable

WORKDIR /src
COPY vendor/deepseek-harness-src.tgz /src/fork.tgz
RUN mkdir -p /src/deepseek-harness \
 && tar -xzf /src/fork.tgz -C /src/deepseek-harness \
 && rm /src/fork.tgz

WORKDIR /src/deepseek-harness
ENV CI=1
# The source tarball carries no `.git`, but the build reads the repository
# commit hash; materialize one synthetic commit for the build.
RUN git init -q \
 && git add -A \
 && git -c user.email=build@local -c user.name=build commit -qm "faberloom fork ${DSH_FORK_SHA}" \
 && printf '%s' "$DSH_FORK_SHA" > /src/deepseek-harness/.fork-sha \
 && git rev-parse HEAD
RUN pnpm install --frozen-lockfile
RUN pnpm run build

# ── Stage 2: gateway runtime ─────────────────────────────────────────
FROM node:22.23.2-bookworm-slim

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

# The built harness fork: a workspace with its built lib/ and node_modules.
COPY --from=harness-build /src/deepseek-harness /opt/dsh

# Catálogo de skills del MCP, aplanado por rol (<rol>/<skill>/SKILL.md).
COPY skills-catalog/ /opt/skills-catalog/

# Stable entrypoint the supervisor spawns per user (DSH_BIN).
RUN printf '#!/bin/sh\nexec node /opt/dsh/apps/cli/lib/bin.js "$@"\n' > /opt/dsh/bin-dsh \
 && chmod +x /opt/dsh/bin-dsh

# Dependencies of the gateway.
COPY gateway/package.json ./gateway/package.json
RUN cd gateway && npm install --omit=dev

COPY gateway/ ./gateway/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=5 --start-period=20s \
  CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "gateway/server.mjs"]
