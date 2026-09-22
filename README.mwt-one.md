# MWT.ONE Harness — DeepSeek Harness en harness.mwt.one

Stack que monta [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(`dsh`) detrás de un gateway de login que valida contra los usuarios de
`consola-mwt-one`, con **un `dsh` aislado por usuario** y el MCP de la consola
con **identidad por usuario**.

> Estado: desplegado y verificado en el VPS. El contenedor **construye y ejecuta
> nuestro fork** de DeepSeek Harness (`0.1.6-alpha.1`, rama `feat/faberloom-native`)
> y arranca `dsh --profile faberloom` por usuario.
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
        └─ mwt-nginx (/etc/nginx/conf.d/harness.conf)  →  mwt-one-harness-gateway:8080
              ┌──────────────────────────────────────────────┐
              │ mwt-one-harness-gateway (Node, contenedor)   │
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

- `mwt-one-harness-gateway` sano, en `harness-net` + `consola-mwt-one-net`.
- `dsh 0.1.6-alpha.1` (fork propio) dentro del contenedor; perfil `faberloom` con los servicios `ctx.faberloom*` y las tools `faberloom_*` montados.
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

El build del fork NO se hace dentro de la imagen: `deploy-vps.sh` sincroniza el
árbol persistente `/opt/harness-build/tree` (rsync con exclusiones), lo construye
dentro del builder `mwt-one-harness/builder` (imagen toolchain que se crea una
vez) y la imagen final solo empaqueta `vendor/deepseek-harness-built.tgz`. Así
`pnpm install` solo toca dependencias nuevas, `tsc -b` emite incremental con el
tsbuildinfo del árbol, y un despliegue caliente tarda minutos en vez de la media
hora del build frío. Para forzar un build total: `rm -rf /opt/harness-build/tree`.

## Puesta en marcha desde cero

```bash
# en el VPS
cd /opt/mwt-one-harness
# .env ya existe; si no: copiar .env.example y rellenar
bash scripts/deploy-vps.sh
```

## Operación: respaldo, restauración y actualización (E8)

```bash
# respaldo cifrado y verificado (local + externo MinIO), retención 30 días
bash scripts/backup-harness.sh

# prueba de restauración en un volumen AISLADO (no toca producción)
bash scripts/restore-harness.sh
bash scripts/restore-harness.sh --from mlocal:harness-backups   # desde el externo
bash scripts/restore-harness.sh --inspect <artifact>            # solo verificar/listar

# actualización controlada: respaldo previo + :prev + health check + rollback
bash scripts/update-harness.sh
bash scripts/update-harness.sh --rollback
```

- Cifrado **gpg simétrico AES256**; passphrase en `.backup-passphrase` (chmod 600).
- Cron ya instalado: respaldo diario **04:30** y prueba de restauración semanal
  (**domingo 05:10**). Registro de releases en `RELEASES.tsv`.
- El respaldo incluye `harness-users`, la memoria de agente
  (`tdai-memory-core-data`, `tdai-panel-data`) y la configuración (`.env`,
  compose, nginx, `.admin-key`). Los contenedores se pausan unos segundos para
  que SQLite y los `DSH_HOME` queden consistentes.
- El destino externo es `mlocal:harness-backups` (MinIO en el mismo host:
  off-volume, no off-host). Para desastre físico, añadir un remoto rclone a un S3
  externo; el script lo usa igual (`BACKUP_REMOTE=...`).

### Copia off-host (equipo del responsable)

```powershell
powershell -ExecutionPolicy Bypass -File scripts/pull-backup.ps1
```

Trae el último `.tar.zst.gpg` al equipo (carpeta OneDrive), **verifica el sha256**
y poda a 30 días. Tareas programadas ya creadas: `MWT-HarnessBackupPull` (09:30) y
`MWT-HarnessBackupPullEvening` (21:30). La **passphrase de restauración** está en
`%OneDrive%\MWT-Backups\harness\RESTORE-PASSPHRASE.txt`, separada del respaldo.

## Memoria de agente (E7-bis)

El stack **TencentDB Agent Memory** (`tdai-memory-core`, `tdai-memory-hub`,
`tdai-proxy`) vive en `/opt/tdai` y comparte la red `tdai-memory-stack` con el
gateway. Cada `dsh` enruta su modelo por `http://proxy:8096/dsh/default`, y el
gateway aprovisiona por email un usuario + equipo + agente de memoria. Si el
stack falla, el usuario sigue contra DeepSeek directo. El panel se consulta por
túnel SSH (`ssh -p 2222 -L 8125:127.0.0.1:8125 root@…`).

## context-mode (MCP de contexto)

La imagen instala **`context-mode@1.0.169`** (npm global, licencia Elastic-2.0) y cada `dsh`
lo arranca como **MCP por stdio**, con su `DSH_HOME` como proyecto y almacenamiento propio
(`CONTEXT_MODE_DIR=<DSH_HOME>/context-mode`). Aporta 11 herramientas `ctx_*`: `ctx_execute`,
`ctx_execute_file`, `ctx_batch_execute` (código en sandbox; solo la salida entra al contexto),
`ctx_index`, `ctx_search`, `ctx_fetch_and_index` (base FTS5 con BM25) y las meta
`ctx_stats`, `ctx_doctor`, `ctx_upgrade`, `ctx_purge`, `ctx_insight`.

- Se desactiva por usuario o globalmente con `CONTEXT_MODE_ENABLED=0`.
- `failOnStartupError: false`: si el servidor no arranca, el dsh sigue funcionando.
- Nota de licencia: Elastic-2.0 (source-available); uso interno permitido, no se puede
  revender como servicio gestionado.

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

### MCP de FaberLoom (espacios)

Si `FABERLOOM_MCP_URL` y `FABERLOOM_GATEWAY_KEY` están definidos, cada `dsh`
arranca además con el MCP `faberloom` (espacios y futuros módulos). El gateway
inyecta la identidad por usuario (`X-Faberloom-User-Id`) y la empresa
(`X-MWT-Client-ID` cuando el usuario tiene una sola). El stack de FaberLoom vive
en `/opt/faberloom` (`faberloom-mcp:8090`, red `harness-net`, volumen
`faberloom-data`). `healthz` reporta `faberloomConfigured`.

## Límites por instancia (E1)

- Cap de heap Node `--max-old-space-size=1024` y `--nofile=8192` por `dsh`
  (aplicado con `prlimit`), configurables con `DSH_MAX_OLD_SPACE_MB`,
  `DSH_NOFILE_LIMIT` y `DSH_CPU_LIMIT_S`.
- No se usa `--as` (V8 reserva mucha memoria virtual y rompería Node) ni
  `--nproc` (es por UID y afectaría a todas las instancias).

## Endurecimiento y observabilidad (M1–M9)

- **M1 · índice de tokens MCP**: el gateway resuelve `token → propietario` con un
  índice en `/data/mcp-token-index.json` (escrito con `tmp`+`rename`, permisos
  `0600`) en vez de escanear el almacén de cada usuario en cada `/mcp`; se
  reconstruye desde los `DSH_HOME` al caducar (`MCP_TOKEN_INDEX_REFRESH_MS`, 5 min
  por defecto). Además hay rate limit por IP en `/mcp`
  (`MCP_RATE_LIMIT_PER_MIN`, 120 r/min) que responde `429` antes de tocar disco o
  arrancar un `dsh`.
- **M2 · límites del contenedor**: `docker-compose.yml` fija `mem_limit`,
  `memswap_limit`, `cpus` y `pids_limit` (`GATEWAY_MEM_LIMIT`, …), ajustables por
  `.env`; el techo debe cubrir varios `dsh` concurrentes (heap por proceso =
  `DSH_MAX_OLD_SPACE_MB`).
- **M3 · respawn transparente**: si la cookie firmada sigue viva pero el proceso
  `dsh` se perdió (p. ej. tras un redeploy), el catch-all lo vuelve a arrancar en
  el momento desde `gateway-users.json` sin obligar a re-login.
- **M4 · observabilidad**: una línea JSON por evento (`login`, `mcp`,
  `dsh_spawn`, `dsh_exit`, `session_respawn`, `mcp_token_index`) y `/metrics`
  (texto Prometheus) con contadores de login, arranques/paradas de `dsh`,
  peticiones MCP y límites aplicados.
- **M5 · costo por usuario**: `ctx.faberloomAgents.costs()` agrega el gasto
  registrado por modelo, agente y tarea (una selección sin costo marca el resumen
  como parcial; la moneda solo se informa si los modelos coinciden); se expone por
  el remote `costs` y por la tool MCP `faberloom_costs`, y el panel de Agentes lo
  muestra con "Ver gasto registrado".
- **M6 · intentos de login**: además del límite de nginx por IP, el gateway aplica
  un límite por cuenta (`LOGIN_RATE_LIMIT_PER_MIN`, 12 r/min) y otro por IP más
  holgado (×4), para cubrir usuarios tras NAT.
- **M7 · CSRF de login**: `GET /login` fija una cookie `hcsrf` y la incrusta como
  campo oculto; `POST /login` exige que ambos coincidan (`timingSafeEqual`). No
  requiere configuración.
- **M9 · healthcheck ampliado**: `/healthz` publica el estado del despachador, el
  último backup (`BACKUP_STATUS_FILE`), la identidad de build
  (`DSH_FORK_SHA_FILE`) y `manifestDrift` (el manifiesto desplegado no cita el SHA
  construido), más el tamaño del pool de instancias. Dos mounts de solo lectura lo
  alimentan: `/opt/mwt/harness_backup_status.txt` (lo escribe
  `scripts/backup-harness.sh`) y `/opt/mwt/harness-manifest/` (lo rellena
  `deploy-vps.sh`); sin ellos `lastBackup` sale nulo y el drift compara contra el
  manifiesto cocido en la imagen.

### M8 · TLS de extremo a extremo (pendiente operativo)

El tramo Cloudflare→origen es hoy **Flexible**: viaja en HTTP. Para **Full
(strict)** hay que (1) emitir un certificado de origen válido para
`harness.mwt.one` (Cloudflare Origin CA o Let's Encrypt), (2) montarlo en
`mwt-nginx` y escuchar `443 ssl` con `ssl_certificate`/`ssl_certificate_key`,
(3) subir el modo TLS del registro a Full (strict) y (4) comprobar
`https://harness.mwt.one/healthz` y el login antes de darlo por hecho; si el
handshake falla, revertir a Flexible (downtime total). No se completa desde el
repositorio: requiere el certificado y el cambio en Cloudflare/nginx.

## Pendientes / límites

- **Un proceso `dsh` por usuario**, no un contenedor por usuario (fase 2:
  aislamiento real de CPU/RAM/disco con cgroups).
- **Tenant MCP** (`X-MWT-Client-ID`): el gateway lo fija con la empresa del
  usuario cuando tiene **una sola** (`legal_entity_ids` del login); con varias no
  lo envía (E2 hecho). El MCP valida pertenencia y deniega con `TENANT_MISMATCH`.
- **Modelo**: una sola `DEEPSEEK_API_KEY` compartida; sin costo por usuario.
- **Persistencia de sesiones del gateway**: en memoria; un redeploy obliga a
  re-login (los `DSH_HOME` sí persisten en el volumen `harness-users`).
- **Token de `dsh`**: el gateway ya canjea el token por la cookie de `dsh` del
  lado servidor, así que no viaja en la URL del navegador; el modo token-en-URL
  queda solo como respaldo si ese canje falla (Queda registrado en logs).
- **Mount de nginx de archivo**: `harness.conf`/`consola.conf` son bind-mount de
  archivo; editarlos desde el host con reemplazo de inodo (`sed -i`, `docker cp`)
  no se refleja en el contenedor. Aplicar desde dentro del contenedor o recrear
  `mwt-nginx`.
- El límite de subida se alinea con Cloudflare: nginx usa
  `client_max_body_size 100m` (antes 320m, que fallaba en el edge). Subirlo
  requiere antes ampliar el límite del plan/regla de Cloudflare.

## Seguridad (estado tras E1)

- `SESSION_SECRET` y `MWT_MCP_GATEWAY_KEY` **rotados**; sin valores en logs
  (verificado).
- `MWT_MCP_GATEWAY_KEY` ya **no se escribe** en los `harness.patch.yml` por
  usuario: el parche lo referencia como `!!js process.env.MWT_MCP_GATEWAY_KEY`,
  igual que `FABERLOOM_GATEWAY_KEY`. Sigue **en claro** en
  `/opt/mwt/nginx/consola.conf` (lo necesita nginx como header); para sacarlo de
  `.env` usa los secretos `*_FILE` (ver `.env.example`).
- **Cookie del gateway con `Secure` por defecto** (`COOKIE_SECURE=0` solo para
  pruebas locales por HTTP); HSTS activo; rate limit de `/login` (12 r/m por IP
  real de cliente vía `CF-Connecting-IP`, más el límite por cuenta y el CSRF de
  doble envío del gateway, M6/M7).
- **Rotación de la gateway key** (tras moverla a secreto): generar el valor
  nuevo, actualizarlo en el secreto y en `consola.conf`, recrear `gateway` y
  `mwt-nginx`, y reintentar `tools/list` del MCP. Los `DSH_HOME` no cambian.
- `/opt/mwt-one-harness` en `700`, `.env` en `600`.
- `DEEPSEEK_API_KEY` rotada (15 sep 2026) y validada; password root **no** se rotó
  por decisión del responsable.
- `SESSION_SECRET` y la API key viven solo en `/opt/mwt-one-harness/.env` y
  nunca se suben al repositorio.

## Distribución y escritorio (E9)

Decisión vigente: **el navegador es el acceso principal del piloto**. La aplicación
de escritorio del harness upstream ejecuta un runtime local; convertirla en cliente
del servidor permanente exige empaquetado propio, identidad de aplicación, firma y
canal de actualización, y no aporta al piloto ninguna capacidad que el navegador no
tenga. Se pospone hasta que exista un requisito operativo concreto (trabajo sin
conexión, integración con el sistema de archivos del usuario o notificaciones
nativas). Mientras tanto la experiencia FaberLoom viaja en la superficie web con sus
tokens y paneles, y el "instalador" es la URL de `harness.mwt.one` con el login de la
consola.
