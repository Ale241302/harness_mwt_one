FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Harness fijado (misma versión que el checkout fuente 0.1.5-rc.2).
RUN npm install -g @deepseek-ai/dsh@0.1.5-rc.2

# Dependencias del gateway.
COPY gateway/package.json ./gateway/package.json
RUN cd gateway && npm install --omit=dev

COPY gateway/ ./gateway/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=5 --start-period=20s \
  CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "gateway/server.mjs"]
