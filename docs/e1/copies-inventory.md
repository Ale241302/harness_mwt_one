# R2-18 · Inventario de copias del piloto

Estado: **CUBIERTO**. Hay inventario completo de lo que vive en el VPS, verificación de que el respaldo diario se ejecutó, las tareas muertas detenidas y el riesgo residual de continuidad declarado aparte (§11).

Observación del **servidor real del piloto**, ejecutada el **2026-11-23 entre 23:29 y 23:58 UTC**. Solo lectura: no se borró, movió, reinició ni desplegó nada.

## 1. Método

Contenedores y volúmenes: `docker ps`, `docker volume ls`, `du -sh /var/lib/docker/volumes/*`. Respaldos: `ls -la /opt/backups`, `/opt/backups/harness-mwt-one`, `/opt/backups/mesa-mwt-one`, `/opt/mwt/backups`, `find / -xdev -name '*.tgz' -o -name '*.gpg' -o -name '*.dump' -size +1M`. Programación: `crontab -l`, `ls /etc/cron.d`, `systemctl list-timers --all`. Estado: `cat /opt/mwt/backup_status.txt` y `cat /opt/mwt/harness_backup_status.txt`. Destino remoto: `rclone listremotes` y las claves `type`/`provider`/`endpoint` de `/root/.config/rclone/rclone.conf` (sin credenciales). Correo: `find /var/vmail -name '*Mesa-Backups*'` dentro del contenedor de dovecot y el log `/opt/mwt/logs/mesa_backup.log`.

No se leyeron credenciales ni contenido de correo: de `/etc/mwt/mesa-offsite.env` solo se listaron los **nombres** de las claves, y de `rclone.conf` solo el tipo, el proveedor y el endpoint. No se abrió ningún mensaje del buzón de copias.

## 2. Las copias que existen

| Copia | Tipo | Qué contiene | Quién accede | Cifrada | Fecha | Decisión |
|---|---|---|---|---|---|---|
| `harness-users` (volumen docker, 4,9 G) | origen, no copia | Todo el dato del harness: 13 usuarios, espacios, sesiones, memorias, secretos | El gateway y root | No | En uso | No aplica: es el original |
| `/opt/backups/harness-mwt-one/` (15 G, 13 entradas) | local, mismo disco | 4 artefactos `harness_2026112{0,1,2,3}T043001Z.tar.zst.gpg` de 3.874 a 3.898 G + `.sha256` + `MANIFEST.json`; el artefacto empaqueta `harness-users` (21.334 archivos, 5.079.184.082 B), `tdai-memory-core-data`, `tdai-panel-data` y la configuración | root (`0600`) y `restore-harness.sh` | Sí, GPG simétrico | Último: 2026-11-23 04:33, 3.898.000.408 B | Se conserva: es la recuperación principal |
| `mlocal:harness-backups` en MinIO (`http://127.0.0.1:9000`, contenedor `mwt-minio`) | **remoto falso**: mismo VPS, mismo disco | 7 entradas, 11 G: los artefactos del 21, 22 y 23 de noviembre | Cualquier proceso que lea `/root/.config/rclone/rclone.conf`, que guarda las claves S3 | Sí, el mismo artefacto GPG | 2026-11-23 04:35 | Se conserva como copia rápida; **no es respaldo externo** |
| `/opt/mwt/backups/harness-data-pre-f578a240f1.tgz.gpg` | local, ad hoc | 4.255.104.749 B **cifrado AES256** con la frase del respaldo; descifra a `gateway-users.json`, `mcp-token-index.json`, `memory-users.json`, `secrets/mwt_mcp_gateway_key` (+ `.bak`), `shared/` (agentes y skills) y `users/` | root (`0600`) | **Sí** | 2026-11-20 22:58; cifrado el 2026-11-24 | Se conserva cifrado; el original sin cifrar se retiró (§10) |
| `harness-users-restoretest` (volumen docker, 4,9 G) | local, mismo disco | Copia descifrada del volumen vivo, incluida `secrets/`: 21.220 archivos y 5.071.270.360 B verificados el 22-nov, 13 usuarios | root; la reescribe el drill dominical | **No** | Drill 2026-11-22 05:10:49–05:11:39 | Se conserva como prueba de restauración, pero no debe quedar permanente ni descifrada |
| `/opt/backups/mesa-mwt-one/` (636 archivos, 167 M) | local, mismo disco | Dumps de la base `faberloom_mesa` (`items=2110`, `events=4556`) con `.meta` y `.sha256`, cada 15 minutos; retención `MESA_BACKUP_KEEP_COUNT=240`, el log informa `kept=212` | root, `mesa-alert.py`, `restore-mesa-drill.sh` | **No** | Último: 2026-11-23 23:30:03 (857.405 B) | Se conserva: es la recuperación de las últimas 60 h de la Mesa |
| `INBOX.Mesa-Backups` en `imap.hostinger.com`, buzón `alejandro@muitowork.com` | remoto, proveedor externo | Artefactos de la Mesa cifrados con age: `mesa-offsite.py` cifra cuando hay destinatario y anota `enc=age` en el asunto, con el adjunto `.age` (el log local nombra el artefacto por su `.dump`); 2.028 envíos con `offsite_ok=1`; último `uid=2063` a las 23:30:08 del 23-nov; `kept=212`, `oldest=503h` | El dueño del buzón; credenciales en `/etc/mwt/mesa-offsite.env` (`0600`) | Sí, age (`mesa-age.pub`) | 2026-11-23 23:30:08 | Se conserva: es la única copia del piloto que sale del VPS |
| Respaldo integral `backup_mwt.sh` (cron 03:00) | local hacia MinIO | **Nada**: `mc` responde `Bucket mwt-backups does not exist` y `Bucket mwt-documents does not exist` | root | No aplica | 218 fallos, del 2026-04-18 al 2026-11-23 | Se detiene o se corrige el destino: hoy no produce copia y falla a diario |
| Cron `faberloom-mcp` (04:10 y 04:40) | local | **Nada**: el contenedor `faberloom-mcp` no existe (ni corriendo ni detenido) y `/opt/faberloom` tampoco, así que `>> /opt/faberloom/backup.log` falla | root | No aplica | Fallando desde hace semanas | Se detiene: automatización huérfana |
| `faberloom_backup.json` (almacén del producto) | dentro del estado del producto | 2 registros `note: "e2e-admin"` del 2026-09-20 con `payload` en línea y tablas vacías (`recordCount: 0`); sin destino externo | El producto y root | No | 2026-09-20 | Se conserva como registro histórico; no seguir generando copias de prueba |
| Configuración duplicada: 8 `docker-compose.yml.bak*` y 11 `.env*` en `/opt/mwt-one-harness`, `.env.bak-*` en `/opt/mwt` | local, mismo disco | Secretos y composición de cada despliegue anterior | root (`0600`, alguno `0644`) | **No** | 2026-04-28 a 2026-11-23 | Se conservan las dos últimas por servicio; el resto no debe seguir acumulándose |

Suma de disco del mismo dato en el mismo disco de 387 G (238 G usados, 62 %): 4,9 G del volumen vivo, 4,9 G del volumen restaurado, 15 G de artefactos GPG locales, 11 G de los mismos artefactos en MinIO y 4,25 G del tarball, ahora también cifrado. Cerca de 40 G para un solo conjunto de datos.

Fuera del alcance de este inventario, y listadas para que no se confundan con copias del harness: `/opt/backups/consola-mwt-one`, `/opt/backups/consola-prerestore-20260706T185015Z`, `/opt/sicop_data/backups`, `/opt/backups/fb_beta_20260705`, `/opt/backups/mwt_schema_pre_qr_20261102_154108.sql`, `/opt/backups/pre_e5arq_20260714_173456.sql` y los `.tgz` de `vendor/` en `/opt/mwt-one-harness` (código, no datos).

## 3. Replicación activa

`crontab -l` de root tiene once líneas. Tres son del sistema o de otros productos (health check cada 5 minutos, poda de docker, poda de imágenes) y ocho tocan datos del piloto: `backup_mwt.sh` a las 03:00, dos `faberloom-mcp` a las 04:10 y 04:40, `backup-harness.sh` a las 04:30 con `RETENTION_DAYS=3`, `restore-harness.sh` los domingos a las 05:10, `backup-mesa.sh` cada 15 minutos con `flock`, los dos drills de la Mesa los domingos a las 05:20 y 05:40, y `mesa-alert.py` cada hora.

No hay unidades systemd propias del harness: `systemctl list-timers --all` solo muestra timers del sistema (`sysstat`, `certbot`, `apt-daily`, `logrotate`, `fstrim`, `e2scrub`) y tres de otros productos (`consola-backup.timer`, `consola-backup-check.timer`, `sicop-memoria.timer`). El arranque del harness depende de `restart=unless-stopped`.

El espejo del producto está apagado en los hechos: `mirror-status.json` dice `enabled: false`, `cycles: 0`, `lastCycleAt: null` y `startedAt: 2026-11-23T22:35:27Z`, y `docker exec ... cat .../mirror-journal.json` no devolvió contenido (archivo ausente o vacío). La variable del contenedor dice lo contrario (`FABERLOOM_MIRROR_ENABLED=1`, con `FABERLOOM_MIRROR_KEY` presente), así que hay discrepancia entre configuración y estado; ninguna replicación ocurrió desde el arranque.

Efecto secundario medido en el log: `backup-harness.sh` **pausa** `mwt-one-harness-gateway`, `tdai-proxy`, `tdai-memory-hub` y `tdai-memory-core` mientras empaqueta (04:30:06 a 04:30:09). El harness queda detenido unos minutos cada madrugada.

## 4. El respaldo informado está vivo

`cat /opt/mwt/harness_backup_status.txt` devuelve `OK 2026-11-23T04:35:25Z artifact=harness_20261123T043001Z.tar.zst.gpg remote=1 size=3.7G`.

El log `/opt/mwt/logs/harness_backup.log` lo confirma paso a paso: `04:31:46` empaquetado de `harness-users` (21.334 archivos, 5.079.184.082 B), `04:33:51` verificación de integridad y descifrado (`descifrado OK, 15 entradas en el bundle`), `04:34:21` copia local en `/opt/backups/harness-mwt-one`, `04:35:21` subida a `mlocal:harness-backups/...` y `04:35:25` cierre `OK ... externo=si · retención 3d`.

El archivo más reciente es `/opt/backups/harness-mwt-one/harness_20261123T043001Z.tar.zst.gpg`, 3.898.000.408 B, del 2026-11-23 04:33, con su `.sha256` de 103 B.

El simulacro de restauración también está vivo: el 2026-11-22 a las 05:11:39 cerró con `Archivos: esperado=21220 restaurado=21220` y `Bytes: esperado=5071270360 restaurado=5071270360`.

Lo que **no** está vivo es el otro respaldo: `cat /opt/mwt/backup_status.txt` devuelve `FAIL 2026-11-23 03:00:13 Fallo al subir dump PG`, y el log muestra que la causa es que los buckets `mwt-backups` y `mwt-documents` no existen en MinIO. Hay 218 fallos iguales desde el 2026-04-18.

El `remote=1` del estado del harness no significa fuera del VPS: significa que rclone subió el artefacto, y el destino `mlocal` es MinIO en `127.0.0.1:9000`. `/opt/backups/OFFSITE_BACKUP.md`, escrito el 2026-11-13, ya lo dice con todas las letras: «dos copias en el mismo disco. Si el disco (o el VPS) se pierde, se pierden las dos».

## 5. Qué copia se conserva y por qué

Se conserva `/opt/backups/harness-mwt-one/` porque es el artefacto completo y cifrado del harness, con manifiesto de imágenes y verificación de descifrado, y es el que alimenta el drill dominical que ya demostró 21.220 archivos y 5.071.270.360 B restaurados.

Se conserva `mlocal:harness-backups` solo como copia rápida de lectura local, mientras se sepa que no protege de la pérdida del VPS; su utilidad es restaurar sin salir del host.

Se conserva `INBOX.Mesa-Backups` porque es la única copia del piloto que duerme en un proveedor distinto, y está cifrada con age antes de salir. Es la que salvaría la Mesa si el VPS desaparece.

Se conservan los dumps de `/opt/backups/mesa-mwt-one/` y el volumen `harness-users-restoretest` porque son la recuperación de corto plazo (60 h de la Mesa) y la prueba de que el respaldo del harness se puede restaurar.

Se conservan el volumen vivo `harness-users` y la base `faberloom_mesa` como origen, y los dos artefactos de configuración más recientes por servicio.

## 6. Qué copia no debe seguir generándose

El tarball `/opt/mwt/backups/harness-data-pre-f578a240f1.tgz` no debe repetirse: es un snapshot previo a un cambio, **sin cifrar**, con `secrets/`, usuarios y tokens, y ya cumplió su función.

El respaldo integral de las 03:00 no debe seguir corriendo como está: falla desde abril, escribe `FAIL` todos los días y da la impresión de que hay copia de PostgreSQL cuando no la hay.

Las dos líneas de cron de `faberloom-mcp` no deben seguir: apuntan a un contenedor y a un directorio que no existen.

El volumen `harness-users-restoretest` no debe quedar como copia permanente descifrada con `secrets/` dentro; el drill lo necesita unas horas, no una semana.

Las copias de `.env` y de `docker-compose.yml.bak*` no deben seguir acumulándose: hay 19 archivos de configuración (11 de entorno y 8 de composición) con secretos o plantillas, sin cifrar, y cada despliegue deja uno más.

Las copias de prueba del producto (`faberloom_backup.json`, `note: "e2e-admin"`) no deben generarse desde pruebas: quedan como registro, no como mecanismo.

## 7. Lo que quedó NO OBSERVADO

El contenido real de `INBOX.Mesa-Backups` no se observó: vive en `imap.hostinger.com` y este servidor no lo sirve (`/var/vmail` tiene `faberloom.ai`, `mwt.one`, `ranawalk.com` y otros, pero **no** `muitowork.com`, y `find /var/vmail -name '*Mesa-Backups*'` no devuelve nada). Leerlo exigía credenciales del buzón, que no se leyeron. Lo afirmado sobre esa copia viene del log del respaldo (uid, cifrado `enc=age`, `kept=212`, `offsite_ok=1`), no de mirar el buzón.

Tampoco se observó si el bucket `harness-backups` de MinIO tiene versionado, bloqueo de objetos o retención: se listó su contenido (7 entradas, 11 G) y nada más.

No se auditó qué otras cuentas del host pueden leer `/opt/backups` o `/root/.config/rclone/rclone.conf`. Los permisos observados son `0600` y `drwx------` de root, y todos los cron corren como root; si hay otra clave SSH con acceso a root, este inventario no lo dice.

No se verificó si existe una copia de la passphrase fuera del host: la que usan los respaldos está en `/opt/mwt-one-harness/.backup-passphrase` (64 B, `0600`), en el mismo disco que el dato que protege. Quien comprometa el host obtiene copia y llave.

## 8. Estado de R2-18

**CUBIERTO** tras las acciones de §9 y §10. La evidencia por comando:

| Requisito | Evidencia | Estado |
|---|---|---|
| Inventario observable de copias | `ls -la /opt/backups`, `du -sh`, `docker volume ls`, `find / -xdev ... -size +1M`: once filas en la tabla de la sección 2 | CUBIERTO |
| Quién accede | `ls -la` con `0600`/`drwx------`, cron de root, `rclone.conf` en `/root` | CUBIERTO en lo observado; auditoría de cuentas del host, pendiente |
| Replicación activa | `crontab -l`, `systemctl list-timers --all`, `mirror-status.json` (`enabled: false`, `cycles: 0`) | CUBIERTO |
| Respaldo informado vivo | `harness_backup_status.txt` = OK 2026-11-23T04:35:25Z; artefacto de 3.898.000.408 B; drill del 22-nov con 21.220/21.220 archivos | CUBIERTO |
| Copia fuera del VPS del harness | `rclone listremotes` = solo `mlocal`; `endpoint = http://127.0.0.1:9000` | **NO CUBIERTO**, declarado como riesgo de negocio en §11 |
| Buzón de copias observado de primera mano | `find /var/vmail -name '*Mesa-Backups*'` sin resultados; `muitowork.com` no está en este mailcow | **NO OBSERVADO** |
| Parada de nuevas copias | El respaldo integral y las dos líneas de `faberloom-mcp` están comentadas desde el 2026-11-23 | **EJECUTADO** |
| Retirada donde corresponde | La copia sin cifrar se cifró con AES256, se verificó el hash y se borró el original | **EJECUTADO** |

Lo que queda como riesgo de negocio —no como requisito de R2-18— es la ausencia de copia del harness fuera del VPS; se declara en §11.

## 9. Acciones ejecutadas el 2026-11-23 (mitad de «parada» y permisos)

Ejecutadas en el servidor por el agente delegado, con respaldo previo y sin borrar datos:

| Acción | Comando | Resultado observado |
|---|---|---|
| Cerrar el tarball sin cifrar que estaba legible por cualquiera | `chmod 600 /opt/mwt/backups/harness-data-pre-f578a240f1.tgz` | `600 root …` (antes `644`); después se cifró y se retiró el original (§10) |
| Respaldar el crontab antes de tocarlo | `crontab -l > /opt/mwt/crontab.bak-20261123` | Archivo creado |
| Detener el respaldo integral muerto (218 fallos, buckets inexistentes) | línea comentada con `# DISABLED 2026-11-23` | Ya no se programa |
| Detener los dos cron huérfanos de `faberloom-mcp` (contenedor inexistente) | dos líneas comentadas con `# DISABLED 2026-11-23` | Ya no se programan |

El crontab resultante conserva las tareas vivas: respaldo del harness 04:30, drill de restauración dominical, respaldo de la Mesa cada 15 min, drills de la Mesa, alerta de la Mesa y el chequeo de salud.

## 10. Cierre de R2-18

**CUBIERTO** conforme a lo que la regla 12b exige, que es: identificar almacenes, registros y destinos autorizados; detener nuevas copias; retirar donde corresponda; comprobar que no continúa la replicación; y documentar qué se conserva y quién accede. Los cinco puntos tienen evidencia arriba.

### La retirada de la copia sin cifrar (2026-11-24)

El tarball del 20-nov se cifró en el mismo directorio con la frase del respaldo del harness, se comprobó que el descifrado devuelve exactamente los mismos bytes y solo entonces se borró el original:

```text
sha256 del original:        1d259fb0b89a40e448dbc1bff4ad58ba3ea0b234c9fadafbb0f47ea559943c91
sha256 del descifrado:      1d259fb0b89a40e448dbc1bff4ad58ba3ea0b234c9fadafbb0f47ea559943c91
harness-data-pre-f578a240f1.tgz.gpg: OK   (sha256sum -c)
original borrado; queda harness-data-pre-f578a240f1.tgz.gpg 0600 (4.255.104.749 B)
```

No se perdió dato y ya no existe una copia legible del correo, las sesiones ni `secrets/` por cualquiera del host.

Lo que se conserva, y por qué:

- El volumen `harness-users-restoretest`: es la prueba de restauración. Debe quedar cerrado o eliminarse tras cada drill; hoy se reescribe el domingo. Queda declarado, no oculto.
- Las dos últimas copias de configuración por servicio (`.env*`, `docker-compose.yml.bak*`): son la recuperación de un despliegue fallido.

## 11. Destino de respaldo: MinIO del VPS (decisión del dueño, 2026-11-24)

El dueño decidió usar el **MinIO del VPS** como destino, en lugar de contratar un almacenamiento externo. Se verifica y se documenta tal cual, sin presentarlo como copia fuera del servidor.

| Comprobación | Comando | Resultado |
|---|---|---|
| MinIO vivo | `docker ps --filter name=minio` | `mwt-minio  Up 5 weeks (healthy)` |
| Destino configurado | `rclone listremotes` | `mlocal:` |
| Artefactos en el destino | `rclone lsl mlocal:harness-backups` | `harness_20261121…`, `…22…`, `…23…` con sus `.sha256` y `MANIFEST.json` |
| Artefacto más reciente | `ls -1t /opt/backups/harness-mwt-one/*.gpg \| head -1` | `harness_20261123T043001Z.tar.zst.gpg`, 3 898 000 408 B |
| Integridad publicada | `rclone cat …/….gpg.sha256` frente a `cat` local | `5383c337…5f3d` en los dos |
| Comparación de tamaños del directorio | `rclone check … --size-only` | 7 archivos coincidentes; las diferencias son retención (local conserva 4 artefactos y sus auxiliares, MinIO conserva 3) |

Conclusión: el respaldo diario llega íntegro al MinIO del VPS y el artefacto vigente coincide en tamaño y en el SHA-256 publicado. Cada mañana se sube el artefacto nuevo; el drill dominical restaura y compara 21 220 archivos.

**Riesgo que sigue existiendo, aceptado por el dueño:** el MinIO vive en el mismo disco que el dato. Protege contra un borrado accidental, una corrupción del volumen o un despliegue fallido; no protege contra la pérdida del VPS. La única copia que sale del servidor sigue siendo la de la Mesa por correo. Se acepta para la ventana del piloto y se revisa el 2026-12-23.

