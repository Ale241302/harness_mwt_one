# syntax=docker/dockerfile:1

# Builder persistente del fork: toolchain nativa para `pnpm install` (módulos
# con compilación) + pnpm por corepack. deploy-vps.sh lo construye una vez y lo
# reutiliza montando el árbol persistente /opt/harness-build.
FROM node:22.23.2-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential python3 pkg-config git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
