# Manifiesto de compatibilidad · mwt-one-harness

**Tag de despliegue:** `deploy-2026-09-15` (commit `e2a61d4`, incluye E7-bis memoria Tencent + E8 respaldo)
**Imagen desplegada actual:** build de `main` @ `8ca5f5c393fcaf0e7e5c17d80550b11a3447df74` (Spaces↔Workspace: área de conversación por espacio; Work bench con revisiones, excepciones y efectos; prompt de menciones @agent/skill; builder persistente en el VPS: deploy caliente ~6 min).
**Verificado en el VPS:** 22 de septiembre de 2026 (16:52 UTC).

Este archivo fija las versiones exactas de la línea base. No describe funciones
de FaberLoom; solo lo que está desplegado y comprobado.

## Componentes

| Componente | Versión / referencia | Notas |
|---|---|---|
| DeepSeek Harness (`dsh`) | `0.1.6-alpha.1` (**nuestro fork**) | Construido en la etapa 1 del `Dockerfile` desde `vendor/deepseek-harness-src.tgz` |
| Fuente del harness | `git archive` del tree del push (rama `feat/faberloom-native`) | Incluye `packages/faberloom/*` y el perfil `faberloom` |
| Perfil arrancado por usuario | `faberloom` | `DSH_PROFILE`; = `dsh-base` + `dsh-web-app` + `dsh-faberloom-app` |
| Node.js (imagen) | `node:22.23.2-bookworm-slim` (tag fijo, no `node:22`) | `v22.23.2` en el contenedor |
| Gateway `harness-mwt-gateway` | `0.1.0` | `gateway/package.json` |
| `express` | `^4.19.2` | Dependencia del gateway |
| `http-proxy` | `^1.18.1` | Dependencia del gateway |
| Imagen desplegada | `mwt-one-harness/gateway:latest` y `:0.1.6-alpha.1` | `sha256:e4e92921ac34…` (`main` @ `8ca5f5c393`, build del 22 sep 16:52 UTC) |
| Memoria de agente (E7-bis) | `agentmemory/memory-core`, `memory-hub`, `memory-proxy` (hoy `:latest`; **pendiente fijar por digest**) | `55fec3a6067a`, `0fbac7ebc484`, `85d0360534bd`; red `tdai-memory-stack`; stack externo en `/opt/tdai` |
| Contexto (MCP) | `context-mode@1.0.169` (npm global en la imagen) | MCP **stdio** por usuario; 11 herramientas `ctx_*`; estado bajo `<DSH_HOME>/context-mode`; licencia Elastic-2.0 (uso interno) |
| Contenedores | `mwt-one-harness-gateway`, `tdai-memory-core`, `tdai-memory-hub`, `tdai-proxy` | los cuatro `Up`, `healthy`; `healthz` público OK |

## Redes

| Red | Subred | Uso |
|---|---|---|
| `harness-net` | 172.24.0.0/16 | Gateway ↔ `mwt-nginx` |
| `consola-mwt-one-net` | 172.21.0.0/16 | Gateway ↔ MCP de la consola |
| `tdai-memory-stack` | — (external) | Gateway ↔ `memory-core`/`memory-hub`/`proxy` |
| `mcp-gateway-net` | 172.25.0.0/16 | Authentik + ContextForge |
| `mwt_default` | 172.20.0.0/16 | nginx principal |

## Memoria de agente (E7-bis)

Cada `dsh` enruta su modelo por `http://proxy:8096/dsh/default` (protocolo
`chat-completions`) y recibe su `PROXY_USER_KEY`. El gateway aprovisiona
usuario + equipo + agente de memoria por email y persiste la identidad en
`/data/memory-users.json` (volumen `harness-users`). Los tools nativos
`faberloom_memory_*`/`faberloom_access_*` ya no se registran; los servicios
`ctx.faberloomMemory`/`ctx.faberloomAccess` siguen montados pero dormidos.

Puertos del stack de memoria publicados solo en `127.0.0.1` (panel 8125 por
túnel SSH, no en Internet).

## Respaldo y actualización (E8)

| Pieza | Ruta / comando |
|---|---|
| Respaldo cifrado y verificado | `scripts/backup-harness.sh` (diario 04:30, cron `# harness_backup`) |
| Restauración verificada | `scripts/restore-harness.sh` (prueba semanal dom 05:10; entorno aislado por defecto) |
| Actualización + rollback | `scripts/update-harness.sh` (`:prev`, health check, `--rollback`) |
| Cifrado | gpg simétrico AES256; passphrase en `/opt/mwt-one-harness/.backup-passphrase` (chmod 600) |
| Destino externo | MinIO vía rclone `mlocal:harness-backups` (retención 30 días) |
| **Copia off-host** | `scripts/pull-backup.ps1` → `%OneDrive%\MWT-Backups\harness` (tareas `MWT-HarnessBackupPull` 09:30 y `MWT-HarnessBackupPullEvening` 21:30; sha256 verificado) |
| **Passphrase off-host** | `%OneDrive%\MWT-Backups\harness\RESTORE-PASSPHRASE.txt` (independiente del respaldo) |
| Copia local | `/opt/backups/harness-mwt-one/` |
| Registro de releases | `RELEASES.tsv` (utc, estado, versión, imagen, prev, nota) |

Alcance del respaldo: `harness-users`, `tdai-memory-core-data`, `tdai-panel-data`
y la configuración (`.env`, compose, nginx, manifiesto, `.admin-key` y config del
proxy de memoria). Los contenedores se pausan unos segundos para que SQLite y los
`DSH_HOME` queden consistentes.

## Límites conocidos de esta base

- Un proceso `dsh` por usuario **dentro** del mismo contenedor gateway: sin
  límites de CPU/RAM ni aislamiento por contenedor (riesgo residual aceptado en E1).
- Una sola `DEEPSEEK_API_KEY` compartida; sin costo por usuario (pendiente E4/R2).
- Sesiones del gateway en memoria: un redeploy obliga a re-login (los `DSH_HOME`
  persisten en el volumen `harness-users`).
- `mlocal` es MinIO en el mismo host: es off-volume, pero no off-host. La copia
  **off-host** real la aporta `scripts/pull-backup.ps1` en el equipo del
  responsable (OneDrive), que además guarda la passphrase de restauración.
- `dsh` es developer preview: pueden aparecer cambios incompatibles (revisar al
  actualizar; usar `:prev` para revertir).

## Límites por instancia (E1)

| Variable | Valor por defecto | Efecto |
|---|---|---|
| `DSH_MAX_OLD_SPACE_MB` | `1024` | `--max-old-space-size` (heap Node por `dsh`) |
| `DSH_NOFILE_LIMIT` | `8192` | `prlimit --nofile` por proceso |
| `DSH_CPU_LIMIT_S` | `0` | `prlimit --cpu` (0 = sin límite) |

## Endurecimiento y observabilidad (M1–M9)

| Variable | Valor por defecto | Efecto |
|---|---|---|
| `MCP_TOKEN_INDEX_FILE` | `<DATA_DIR>/../mcp-token-index.json` | Índice `token → propietario` para `/mcp` (tmp+rename, `0600`) |
| `MCP_TOKEN_INDEX_REFRESH_MS` | `300000` | Edad máxima del índice antes de reconstruirlo |
| `MCP_RATE_LIMIT_PER_MIN` | `120` | Peticiones `/mcp` por IP y minuto (`429`) |
| `LOGIN_RATE_LIMIT_PER_MIN` | `12` | Intentos de login por cuenta y minuto (por IP: ×4) |
| `DSH_FORK_SHA_FILE` | `/opt/dsh/.fork-sha` | SHA del fork construido, publicado por `/healthz` |
| `BACKUP_STATUS_FILE` | `/opt/mwt/harness_backup_status.txt` | mtime+texto del último backup, publicados por `/healthz` |
| `MANIFEST_FILE` | `/app/MANIFEST.md` | Manifiesto comparado para `manifestDrift` |
| `GATEWAY_MEM_LIMIT` / `GATEWAY_MEMSWAP_LIMIT` | `6g` / `6g` | `mem_limit`/`memswap_limit` del contenedor gateway |
| `GATEWAY_CPUS` | `2.0` | `cpus` del contenedor gateway |
| `GATEWAY_PIDS_LIMIT` | `2048` | `pids_limit` del contenedor gateway |

`/metrics` expone contadores Prometheus (login, `/mcp`, arranques/paradas de
`dsh`, límites aplicados). El gasto por usuario (M5) se agrega en memoria del
producto y por la tool MCP `faberloom_costs`; **la facturación sigue siendo una
sola `DEEPSEEK_API_KEY` compartida**. El tramo Cloudflare→origen sigue en TLS
**Flexible** (M8 pendiente: certificado de origen + Full strict; ver
`README.mwt-one.md`).

## Cómo verificar el despliegue

```bash
docker inspect mwt-one-harness-gateway --format '{{.Config.Image}} {{.Created}}'
docker exec mwt-one-harness-gateway /opt/dsh/bin-dsh --version
docker exec mwt-one-harness-gateway node --version
curl -fsS https://harness.mwt.one/healthz
tail -3 /opt/mwt-one-harness/RELEASES.tsv
```
