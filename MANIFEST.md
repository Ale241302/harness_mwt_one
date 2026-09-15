# Manifiesto de compatibilidad · harness-mwt-one

**Tag de despliegue:** `deploy-2026-09-14`
**Verificado en el VPS:** 14 de septiembre de 2026.

Este archivo fija las versiones exactas de la línea base. No describe funciones
de FaberLoom; solo lo que está desplegado y comprobado.

## Componentes

| Componente | Versión / referencia | Notas |
|---|---|---|
| DeepSeek Harness (`dsh`) | `0.1.5-rc.2` | Fijado en el `Dockerfile`; developer preview |
| Commit fuente de `dsh` según README | `c291e79` | Registrado por el proyecto |
| Node.js (imagen) | `node:22-bookworm-slim`; `v22.23.2` en el contenedor | |
| Gateway `harness-mwt-gateway` | `0.1.0` | `gateway/package.json` |
| `express` | `^4.19.2` | Dependencia del gateway |
| `http-proxy` | `^1.18.1` | Dependencia del gateway |
| Imagen desplegada | `harness-mwt/gateway:latest` | Creada `2026-09-14T16:19:34Z` |
| Contenedor | `harness-gateway` | `Up`, sano; `healthz` OK |

## Redes

| Red | Subred | Uso |
|---|---|---|
| `harness-net` | 172.24.0.0/16 | Gateway ↔ `mwt-nginx` |
| `consola-mwt-one-net` | 172.21.0.0/16 | Gateway ↔ MCP de la consola |
| `mcp-gateway-net` | 172.25.0.0/16 | Authentik + ContextForge |
| `mwt_default` | 172.20.0.0/16 | nginx principal |

## Límites conocidos de esta base

- Un proceso `dsh` por usuario **dentro** del mismo contenedor gateway: sin
  límites de recursos ni aislamiento por contenedor (pendiente E1).
- Una sola `DEEPSEEK_API_KEY` compartida; sin costo por usuario (pendiente E1/E4).
- Sesiones del gateway en memoria: un redeploy obliga a re-login (los `DSH_HOME`
  persisten en el volumen `harness-users`).
- `dsh` es developer preview: pueden aparecer cambios incompatibles (revisar al
  actualizar).

## Cómo verificar el despliegue

```bash
docker inspect harness-gateway --format '{{.Config.Image}} {{.Created}}'
docker exec harness-gateway dsh --version
docker exec harness-gateway node --version
docker exec harness-gateway curl -sS http://127.0.0.1:8080/healthz
```
