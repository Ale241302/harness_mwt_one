# Inventario del servidor en uso

Contrato: C-FL-02 / O0-03 / FM-O0-03 Autorización: `AUTH-2026-11-16-F0-2` (`AUTH-F0-2-SERVER`), solo lectura Ejecutado: 2026-11-16, 21:43-21:47 UTC Nivel: `OBSERVADO_REAL` sobre metadatos. **No** es C1-E ni C1-I, y no habilita ningún efecto.

## 1. Método y exclusiones

- Acceso SSH `root` al servidor del CEO, puerto no estándar, `BatchMode=yes`. Sin contraseña, sin copiar claves. El destino exacto no se publica en el repositorio: vive en la custodia del CEO.
- Solo lectura: `ls`, `stat`, `du -sh`, `df`, `docker ps/inspect/network inspect`, `printenv` de una lista blanca, `curl` al health local del propio contenedor, `crontab -l`, `systemctl list-*`.
- **No** se leyó: `.env` ni sus siete copias, `.backup-passphrase`, contenido de `/data/users`, `/data/secrets`, `gateway-users.json`, `mcp-token-index.json`, `memory-users.json`, logs de aplicación, correo, adjuntos, memorias ni sesiones.
- **No** se escribió, instaló, reinició ni desplegó nada.

## 2. El host no es un servidor dedicado a FaberLoom

| Dato | Valor |
|---|---|
| Host | servidor del CEO (nombre redactado), Linux 6.8.0-147 x86_64, 8 CPU |
| Encendido | 30 días |
| Carga media | 5,60 / 5,61 / 5,46 sobre 8 CPU |
| Disco | 387 G, 209 G usados, 178 G libres (54 %) |
| Contenedores en ejecución | **52** al inventariar; **56** al cerrar el 2026-11-16, porque los cuatro nuevos son el laboratorio `faberloom-lab-*` |
| Red del harness | `harness-net` con `mwt-nginx` y `mwt-one-harness-gateway` |
| Unidades systemd propias | ninguna: el arranque depende de `restart=unless-stopped` |

Productos que comparten el host, además del harness: `consola-mwt-one` (7 contenedores), `sicop_mcp` (7), `mwt-builder` (4), `mwt-*` (django, postgres, redis, minio, nginx), `mailcowdockerized` (17), `roundcube`, `ranawalk-web`, `tdai-memory` (3), `mcp-gateway-contextforge`, `authentik` (3).

Consecuencia directa para PC1 y F0-8: **DaMail no llegaría a un servidor libre**. Necesita su propio PostgreSQL y su aplicación, en un host que ya sirve cinco motores PostgreSQL, 52 al inventariar (56 con el laboratorio), contenedores y una carga media de 5,6 sobre 8 CPU. Eso entra en los rangos de esfuerzo y en el tope de alcance, no se decide por gusto.

## 3. El harness: qué dice de sí mismo

Health consultado **dentro** del contenedor (`127.0.0.1:8080/healthz`). Desde el host no responde: el puerto 8080 no está publicado, solo expuesto en la red interna.

```json
{"ok":true,"publicHost":"harness.mwt.one","consolaApi":"https://consola.mwt.one/api",
 "mcpConfigured":true,"sicopConfigured":true,"permissionMode":"danger-full-access",
 "faberloomConfigured":false,"memoryEnabled":true,"memoryConfigured":true,
 "contextModeEnabled":true,
 "dispatcher":{"intervalMs":60000,"inboundEnabled":true,"inboundIntervalMs":60000,"waitTimeoutMs":86400000},
 "build":{"forkSha":"0b01ca39365ba04fe89858bcac56e3523896ee4d","manifestPresent":true,"manifestDrift":false},
 "rateLimits":{"loginPerMin":12,"mcpPerMin":120,"llmPerMin":120},"instances":8}
```

### Qué significa cada campo, leído en el código

| Campo | Lectura en `gateway/server.mjs` | Consecuencia |
|---|---|---|
| `permissionMode: danger-full-access` | `cfg.dshPermissionMode` (línea 1698) | Las instancias por usuario arrancan sin restricción de permisos del harness |
| `faberloomConfigured: false` | `Boolean(FABERLOOM_MCP_URL && FABERLOOM_GATEWAY_KEY)` (línea 1699) | Falta la clave o la URL. **El servidor MCP `faberloom` no se registra** (línea 1022) |
| `instances: 8` | `instances.size` (línea 1716): instancias dsh vivas por usuario | Ocho instancias activas, no ocho procesos ni ocho usuarios confirmados |
| `manifestDrift: false` | Comparación contra `/opt/mwt/harness-manifest/MANIFEST.md` | Coincide con el manifiesto montado, actualizado 2026-11-16 13:21 |
| `dispatcher.inboundEnabled: true` | Configuración del despachador | El productor de entrada está **configurado**, no probado |
| `rateLimits` | Límites de login, MCP y LLM | Existen; no se probaron |

`K-09` queda resuelta en parte: `faberloomConfigured=false` no es un error de perfil, es la ausencia de `FABERLOOM_GATEWAY_KEY` (o de `FABERLOOM_MCP_URL`). Entre las variables sensibles declaradas no aparece `FABERLOOM_GATEWAY_KEY`, así que la causa más probable es esa.

## 4. Composición del despliegue

| Dato | Valor |
|---|---|
| Contenedor | `mwt-one-harness-gateway` |
| Imagen | `mwt-one-harness/gateway:latest`, ID `sha256:c2c13c5e…5822` |
| Estado | `Up 8 hours (healthy)`, `restart=unless-stopped` |
| Arrancado | 2026-11-16T13:25:35Z |
| Comando | `node gateway/server.mjs` en `/app` |
| Contenido de `/app` | `MANIFEST.md`, `gateway` |
| Montajes | volumen `harness-users` → `/data` (rw); `/opt/mwt/harness_backup_status.txt` (ro); `/opt/mwt/harness-manifest` (ro); `/opt/mwt/harness-desktop-channel` (ro) |
| Fuente candidata | `/opt/harness-build/tree` en `c2fec429758e7a1d5fbb05deeb493de5115f8cc1`, solo `MANIFEST.md` modificado |
| `/opt/mwt-one-harness` | copia de despliegue **sin `.git`** |
| `forkSha` publicado | `0b01ca39365ba04fe89858bcac56e3523896ee4d` |

No se pudo reproducir `docker compose --services` sin expandir variables de entorno. Se omitió a propósito: `docker compose config` imprime secretos. Queda como límite del inventario, no como hallazgo.

## 5. Datos, memoria y secretos

Volumen `harness-users`, 4,5 G.

| Ruta | Tipo | Observación |
|---|---|---|
| `/data/gateway-users.json` | usuarios del gateway | No se leyó: dato personal |
| `/data/mcp-token-index.json` | índice de tokens MCP | No se leyó: credencial |
| `/data/memory-users.json` | memoria por usuario | No se leyó: contenido |
| `/data/secrets/` | 2 entradas | No se listaron nombres ni contenido |
| `/data/users/` | 5+ directorios UUID | Espacios por usuario. No se leyó |
| `/data/shared/` | agentes globales y `skills` | Configuración compartida |

Variables sensibles **declaradas** en el contenedor (solo nombres): `DEEPSEEK_API_KEY`, `FABERLOOM_AGENT_API_KEY`, `FABERLOOM_AGENT_API_KEY_ENV`, `FABERLOOM_MIRROR_KEY`, `MEMORY_ADMIN_KEY`, `MWT_MCP_GATEWAY_KEY`, `MWT_MCP_GATEWAY_KEY_FILE`, `SESSION_SECRET`. Ningún valor fue impreso ni registrado.

## 6. Respaldos: hay más copias de las que el plan suponía

| Copia | Dónde | Estado |
|---|---|---|
| Volumen vivo | `harness-users` (4,5 G) | En uso |
| Copia restaurada semanal | volumen `harness-users-restoretest` (4,5 G), fechado **2026-11-15T05:10:42Z** | Existe y tiene datos. Servicios, secretos y usuarios incluidos |
| Respaldo remoto cifrado | `harness_20261116T043001Z.tar.zst.gpg`, 3,5 G, `remote=1` | Reportado `OK` a las 04:34:38Z |
| Pasafrase | `/opt/mwt-one-harness/.backup-passphrase` (0600) | **En el mismo host que los datos** |

Hallazgos:

1. Existe un ensayo de restauración semanal real (`restore-harness.sh`, domingo 05:10) que produce una copia completa. El plan decía "restauración no demostrada". Ahora está **parcialmente demostrada**: hay copia restaurada, pero no se verificó que esa copia arranque, que conserve pendientes ni que no reenvíe.
2. La passphrase vive junto al dato que protege. Quien comprometa el host obtiene cifrado y llave. `T18` y `R2-18` deben tratarlo como copia no autorizada hasta que se decida su custodia.
3. La copia `restoretest` está sin cifrar en el mismo disco y contiene `/data/secrets`. Es una cuarta copia, no inventariada en el plan anterior.

## 7. Rutinas del sistema

Sin unidades systemd propias. Todo depende de cron y de `unless-stopped`.

```
*/5  * * * *  /opt/mwt/scripts/health_check_cron.sh
0    3 * * *  /opt/mwt/scripts/backup_mwt.sh
30  12 * * *  docker builder prune; docker image prune            # sicop
10   4 * * *  docker exec faberloom-mcp node src/backup/main.js export scheduled
40   4 * * *  docker exec faberloom-mcp node src/backup/main.js verify-latest
30   4 * * *  RETENTION_DAYS=3 bash /opt/mwt-one-harness/scripts/backup-harness.sh
10   5 * * 0  bash /opt/mwt-one-harness/scripts/restore-harness.sh
*/15 * * * *  /opt/mwt/scripts/backup-mesa.sh
20   5 * * 0  /opt/mwt/scripts/restore-mesa-drill.sh
40   5 * * 0  /opt/mwt/scripts/restore-mesa-drill.sh --offsite
7    * * * *  /opt/mwt/scripts/mesa-alert.py
```

**Hallazgo operativo: dos tareas de cron están muertas.** `faberloom-mcp` no existe como contenedor (ni corriendo ni detenido) y `/opt/faberloom` no existe. Las líneas 4 y 5 fallan a diario y escriben en `/opt/faberloom/backup.log`, una ruta inexistente. No afectan al respaldo del harness, que es otra tarea, pero sí demuestran que el servidor tiene automatizaciones huérfanas que nadie mira. Entra en `O3-01` y `O3-05`.

## 8. Red y puertos

Públicos relevantes: 25/465/587 (SMTP), 110/143/993/995/4190 (IMAP/POP/managesieve), 80/443, dos puertos SSH no estándar (redactados), 3100/3101/3200/8000/8003/8100/8400/8443/8450/9000/9001. Solo loopback: 13306, 19991, 7654, 8082, 8096, 8125, 8420, 8424.

El correo del host lo sirve **mailcow** (dovecot, postfix, rspamd, sogo) y hay `roundcube` en 8003. Esto importa para PC1: si los dos buzones del piloto viven en este mailcow, la vía "IMAP directo" (permitida por la decisión 4b) existe en el mismo host, y el "conector de Hostinger" puede no aplicar a esos buzones. No se consultó el dominio servido por mailcow; queda como verificación.

## 9. Desconocidos que mantienen O0-03 abierta

| # | Desconocido | Por qué no se resolvió | Qué lo cierra |
|---:|---|---|---|
| U-1 | Grants y usuarios del gateway | `gateway-users.json` y `mcp-token-index.json` son datos personales y credenciales | Autorización específica para leer **solo conteos y campos de rol**, sin identificadores |
| U-2 | Estado de colas y trabajo en curso | Requiere leer el despachador o el estado persistido de instancias | Prueba en aislado (O3-05) |
| U-3 | Qué dominio y buzones sirve mailcow | Requiere consultar su base o su API | Autorización específica de metadatos de mailcow |
| U-4 | Correspondencia imagen ↔ proceso | Solo se compararon dos archivos por hash | O7-04 con la actualización |

Ninguno de los cuatro autoriza efectos ni transición. Los cuatro son inventariables con una autorización más estrecha que la actual, y por eso O0-03 **no se declara cerrada**.

## 10. Custodia

- Clasificación `INTERNAL`. Contiene metadatos operativos reales, ningún secreto.
- Ubicación: `docs/scratch/faberloom-daily-work/server-inventory.md` en el clon local (OneDrive).
- No se copia a documentación pública, fixtures, prompts de terceros ni artefactos de publicación.
- Retención y eliminación: se definen con N6 antes de cerrar O0-03.

## 11. Reproducir

Los guiones usados están en `tasks/evidence/F0-2-command-log-sanitized.md` y en este mismo documento. Cualquier repetición exige renovar `AUTH-F0-2-SERVER`: la autorización es de un inventario, no de un acceso permanente.
