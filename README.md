# Harness MWT — DeepSeek Harness en harness.mwt.one

Stack que monta [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(`dsh`) detrás de un gateway de login que valida contra los usuarios de
`consola-mwt-one`, con **un `dsh` aislado por usuario** y el MCP de la consola
con **identidad por usuario**.

> Estado: desplegado y verificado en el VPS. Versión `dsh` fijada: `0.1.5-rc.2`
> (commit fuente `c291e79`).

## Por qué hace falta este gateway

`dsh` en developer preview **no trae login ni multiusuario**: su auth es un token
aleatorio por proceso + cookie firmada, pensada para loopback
(`packages/client/connection/src/browser-auth.ts`). La carpeta `identity` de
`dsh` es solo un id anónimo de telemetría. Por eso:

- El login real lo pone este gateway (`POST {CONSOLA_API_BASE}/auth/login/`).
- Se ejecuta **un `dsh` por usuario** (su propio `DSH_HOME` y su propia sesión).
- El MCP de la consola se consume con la identidad del usuario vía
  `X-Forwarded-User-Email` + `X-MWT-Gateway-Key`; el MCP mintea el token del
  usuario contra `/api/auth/mcp-token/`. `dsh` nunca guarda el JWT.

## Arquitectura (desplegada)

```
Navegador
  └─ https://harness.mwt.one  (Cloudflare proxied → mwt-nginx TLS)
        └─ mwt-nginx (/etc/nginx/conf.d/harness.conf)  →  harness-gateway:8080
              ┌──────────────────────────────────────────────┐
              │ harness-gateway (Node, contenedor)           │
              │  GET  /login  → formulario                   │
              │  POST /login  → consola /api/auth/login/     │
              │                 → arranca/garantiza dsh(uid) │
              │  /*           → proxy 127.0.0.1:<puerto>     │
              └──────────────────────────────────────────────┘
                     │ harness-net            │ consola-mwt-one-net
              procesos dsh(uid)         consola-mwt-one-mcp:8765/mcp
              DSH_HOME=/data/users/<uid>
```

## Estado verificado en el VPS

- `harness-gateway` sano, en `harness-net` + `consola-mwt-one-net`.
- `dsh 0.1.5-rc.2` dentro del contenedor.
- MCP alcanzable (`consola-mwt-one-mcp:8765`); con un usuario staff real el MCP
  devolvió **175 tools** filtradas por su rol (identidad por header OK).
- `https://harness.mwt.one/healthz` responde; `/` redirige a `/login`; un login
  inválido llega a la consola y vuelve con `?e=auth`.
- `mwt-nginx` con mount persistente de `nginx/harness.conf` y red `harness-net`
  añadidos a `/opt/mwt/docker-compose.yml`.

## Actualizar (local → VPS)

Desde esta carpeta, en Windows:

```powershell
# solo sube (revisas antes)
powershell -ExecutionPolicy Bypass -File scripts/push-to-vps.ps1

# sube y despliega (build + up + reload nginx)
powershell -ExecutionPolicy Bypass -File scripts/push-to-vps.ps1 -Deploy
```

No sube `.env` ni `node_modules`; el `.env` del VPS se conserva.

## Puesta en marcha desde cero

```bash
# en el VPS
cd /opt/harness-mwt-one
# .env ya existe; si no: copiar .env.example y rellenar
bash scripts/deploy-vps.sh
```

## MCP

Cada `dsh` arranca con un `--patch` generado por usuario:

```yaml
- insert:
    - id: mcp-mwt
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: mwt
        transport: streamable-http
        url: http://consola-mwt-one-mcp:8765/mcp
        headers:
          X-Forwarded-User-Email: usuario@dominio
          X-MWT-Gateway-Key: '<secreto compartido>'
          Authorization: 'Bearer dsh-gateway'   # salta el challenge OAuth
```

El `Authorization: Bearer` no es un JWT válido: solo evita que el MCP
(`MWT_MCP_OAUTH=1`) devuelva el challenge OAuth; la identidad real la aporta el
header `X-Forwarded-User-Email` validado por el Gateway Key (diseño Ola 2).

## Límites por instancia (E1)

- Cap de heap Node `--max-old-space-size=1024` y `--nofile=8192` por `dsh`
  (aplicado con `prlimit`), configurables con `DSH_MAX_OLD_SPACE_MB`,
  `DSH_NOFILE_LIMIT` y `DSH_CPU_LIMIT_S`.
- No se usa `--as` (V8 reserva mucha memoria virtual y rompería Node) ni
  `--nproc` (es por UID y afectaría a todas las instancias).

## Pendientes / límites

- **Un proceso `dsh` por usuario**, no un contenedor por usuario (fase 2:
  aislamiento real de CPU/RAM/disco con cgroups).
- **Tenant MCP** (`X-MWT-Client-ID`): el gateway lo fija con la empresa del
  usuario cuando tiene **una sola** (`legal_entity_ids` del login); con varias no
  lo envía (E2 hecho). El MCP valida pertenencia y deniega con `TENANT_MISMATCH`.
- **Modelo**: una sola `DEEPSEEK_API_KEY` compartida; sin costo por usuario.
- **Persistencia de sesiones del gateway**: en memoria; un redeploy obliga a
  re-login (los `DSH_HOME` sí persisten en el volumen `harness-users`).
- **Token de `dsh` en la URL** del redirect de login: endurecer a cookie de un
  solo uso (hoy queda en logs).
- **Mount de nginx de archivo**: `harness.conf`/`consola.conf` son bind-mount de
  archivo; editarlos desde el host con reemplazo de inodo (`sed -i`, `docker cp`)
  no se refleja en el contenedor. Aplicar desde dentro del contenedor o recrear
  `mwt-nginx`.
- El backend aún no está endurecido para imágenes/adjuntos grandes vía
  Cloudflare (límite 100 MB del plan).

## Seguridad (estado tras E1)

- `SESSION_SECRET` y `MWT_MCP_GATEWAY_KEY` **rotados**; sin valores en logs
  (verificado).
- `MWT_MCP_GATEWAY_KEY` sigue **en claro** en `/opt/mwt/nginx/consola.conf`
  (lo necesita nginx como header); conviene moverlo a un secreto.
- Cookie del gateway con `Secure`; HSTS activo; rate limit de `/login`
  (12 r/m por IP real de cliente vía `CF-Connecting-IP`).
- `/opt/harness-mwt-one` en `700`, `.env` en `600`; respaldos en
  `/opt/backups/harness-mwt-one` (`700`).
- `DEEPSEEK_API_KEY` rotada (15 sep 2026) y validada; password root **no** se rotó
  por decisión del responsable.
- `SESSION_SECRET` y la API key viven solo en `/opt/harness-mwt-one/.env` y
  nunca se suben al repositorio.
