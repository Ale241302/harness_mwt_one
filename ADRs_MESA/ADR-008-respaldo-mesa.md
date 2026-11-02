# ADR-008 · Respaldo y restauración de `faberloom_mesa`

**Estado:** aceptado · **Fecha:** 2/11/2026 · **Decisión:** P2 del cierre de la Mesa
**Relacionado:** `ADR-006` (Mesa central con PostgreSQL y RLS)

## Contexto

`faberloom_mesa` es la única copia del estado de la Mesa compartida: 473 ítems y
2 436 eventos en 11 MB. ADR-006 la dejó sin respaldo; la página de operación lo
registraba como pendiente. Un fallo de la base o un `DELETE` sin `WHERE` no tiene
`git revert`.

El clúster de PostgreSQL 16.15 vive en el contenedor `consola-mwt-one-postgres` y
aloja también `mwt_one`, la base de la consola (130 MB). Es un clúster compartido:
cualquier ajuste de `postgresql.conf` que exija reinicio degrada las dos bases.
Hoy `archive_mode=off` y `wal_level=replica`. El host tiene 104 GB libres y no
tiene Node; el contenedor sí trae `pg_dump`, `pg_restore` y `psql` 16.15.

## Decisión

Respaldo **lógico programado** con `pg_dump -Fc -Z6` cada 15 minutos, verificado en
cada ejecución, podado por retención acotada y con una **restauración real semanal**
en una base desechable.

- `scripts/backup-mesa.sh`: dump a `/opt/backups/mesa-mwt-one/mesa_<UTC>.dump`,
  escrito con nombre temporal y renombrado al final; `sha256` verificado, TOC
  comprobado con `pg_restore --list` (debe declarar `mesa_items` y `mesa_events`),
  `.meta` con los conteos del origen, y poda. Si algo falla borra el artifact y sale
  distinto de 0; el estado queda en `/opt/mwt/mesa_backup_status.txt`.
- `scripts/restore-mesa-drill.sh`: toma el último artifact (o uno concreto), lo
  restaura en `mesa_drill_<UTC>`, verifica conteos exactos contra el `.meta`, cero
  eventos huérfanos, RLS habilitada y forzada, y borra la base. Nunca acepta otro
  destino que `mesa_drill_*` ni una base que ya exista.
- Cron en el host: respaldo `*/15`, drill los domingos a las 05:20 y 05:40 (local y
  desde el buzón), los tres bajo `flock` para que no se pisen.
- `scripts/mesa-offsite.py` copia cada artifact a un buzón de Hostinger, con
  verificación por relectura y retención propia; `/etc/mwt/mesa-offsite.env` guarda
  la cuenta con modo 600.

### Copia externa: dos destinos, uno fuera del host

**Buzón IMAP (activo).** `MESA_OFFSITE=on` copia cada artifact a la carpeta
`INBOX.Mesa-Backups` de `alejandro@muitowork.com` en Hostinger, con
`scripts/mesa-offsite.py`. Hostinger es otro proveedor y otro host: perder el VPS
no pierde esa copia. La subida se verifica leyendo la copia de vuelta: el cliente
abre el mensaje, extrae el adjunto y compara su sha256 con el archivo local antes
de podar el buzón. El asunto es el catálogo (`mesa_<UTC>.dump sha256=… bytes=…
items=… events=…`), y el `.meta` viaja en el cuerpo entre `--- meta ---` y
`--- end meta ---`, así que una restauración recupera también los conteos que
debe igualar.

Subir dos veces el mismo artifact es un no-op (`repeated=1`), el dump se rechaza
si supera `MESA_OFFSITE_MAX_MB` (20 MB) en vez de truncarse, y la retención del
buzón es propia: 72 horas completas, una por día UTC hasta 30 días, tope de 200
mensajes y un mínimo de 3 que nunca se borra.

**Endpoint SFTP (activo, no es copia externa).** `ftp.muitowork.com` resuelve a
la VPS y sirve un SFTP aislado en el puerto 2223 (`sshd-mesa.service`): sólo el
usuario `mesa-backup`, `internal-sftp` forzado, jaula en `/srv/mesa-backups`, sin
contraseñas, TTY ni reenvíos. Sustituye un registro que apuntaba a la cuenta
suspendida de a2hosting. Comparte host y disco con la base, así que cuenta como
comodidad de transferencia, no como respaldo: no cubre perder la VPS. Se
reinstala con `scripts/mesa-sftp-setup.sh` (idempotente; `--check` informa).

**rclone (disponible, apagado).** `MESA_REMOTE` sigue subiendo artifact,
`.sha256` y `.meta` con verificación de tamaño y sha256, y replica la retención
local. Hoy no tiene destino que valga la pena:

| Destino | Estado medido | Sirve como copia fuera del host |
|---|---|---|
| `a2ftp:` (FTP de a2hosting) | `530 Login authentication failed`; la cuenta entera está suspendida (`muitowork.com` responde `302 /cgi-sys/suspendedpage.cgi`) | No: credenciales muertas |
| `mlocal:` (MinIO en `127.0.0.1:9000`) | Responde; volumen `mwt_minio_data` en `/var/lib/docker`, mismo `/dev/sda1` que la base | No: es el mismo host y el mismo disco |

Un fallo de cualquier destino no invalida el respaldo local. El estado pasa a
`REMOTE_FAIL <ISO8601> reason=remote_failed … offsite_reason=<motivo> failed=<remote|offsite>`,
el script sigue saliendo con 0 (el respaldo existe y verifica) y
`backup-mesa.sh --check-freshness` sale con **3**, distinto del 1 que significa
«no hay respaldo local válido». El motivo nunca se imprime con la salida cruda
del servidor: sólo el slug.

### RPO y RTO

| Métrica | Objetivo | Medido hoy | Cómo se sostiene |
|---|---|---|---|
| RPO | ≤ 15 min | 15 min + 0,3 s (peor caso del intervalo más la duración del dump) | cron `*/15`; el dump es de 200–290 ms y la copia externa va en la misma pasada |
| RTO local | ≤ 15 min | 309 ms de `pg_restore`; drill completo ≈ 2 s | restauración probada hoy |
| RTO desde el buzón | ≤ 15 min | 305 ms de `pg_restore` sobre la copia descargada | `restore-mesa-drill.sh --offsite`, probado hoy |

El RTO medido es la parte mecánica. No incluye el tiempo hasta que un humano nota el
fallo, y ese tramo no lo controla este ADR: lo controla la alerta sobre
`/opt/mwt/mesa_backup_status.txt` y sobre la frescura del respaldo
(`backup-mesa.sh --check-freshness` sale con 1 si el último estado no sirve, tiene más
de 45 minutos, el artifact desapareció o su checksum no verifica, y con 3 cuando el
respaldo local vale pero falló la copia externa).

### Retención

Tres reglas y un tope, aplicados en este orden sobre la mtime de cada artifact:

1. más viejo que 30 días → se borra;
2. dentro de las últimas 48 horas → se conserva;
3. entre ambas → se conserva el más nuevo de cada día UTC;
4. tope duro de 240 artifacts → se borran los más viejos.

Con la cadencia de 15 minutos eso son 192 artifacts en la ventana reciente (~51 MiB)
más 28 diarios, con un techo de ~63 MiB. La retención no depende de que alguien la
recuerde: es parte de cada ejecución, y el artifact, su `.sha256` y su `.meta` se
borran juntos. El buzón tiene su propia política, más barata porque un dump pesa
286 KiB y la cuota es de 50 GB: todo lo de las últimas 72 horas, una copia por día
UTC hasta 30 días, tope de 200 mensajes y mínimo de 3.

### Alternativas

| Alternativa | Por qué no |
|---|---|
| PITR con `archive_mode=on` + `pg_basebackup` + archivo de WAL | Exige reiniciar el clúster compartido con `mwt_one` (hoy `archive_mode=off`), y la recuperación es del clúster completo: un `pg_basebackup` más el replay de WAL restauran también la consola. No existe «restaurar sólo `faberloom_mesa` a las 14:03» con replicación física. Cambia un RPO de 15 min por un RPO de segundos al precio de tocar producción y de un procedimiento de recuperación con mucho más radio de impacto. |
| Sólo un dump diario | Deja hasta 24 h de pérdida sobre una base que recibe escrituras de dos usuarios. El dump cuesta 0,3 s: no hay razón para pagar ese RPO. |
| `pg_basebackup` periódico sin WAL | Restaura el clúster entero, igual que PITR, y con la misma granularidad que el dump pero con más bytes y sin poder elegir la base. |
| Réplica lógica a otra instancia | Da RPO de segundos y lectura, pero exige un segundo PostgreSQL, monitorización de lag y una promoción probada. Es el paso siguiente si el negocio pide RPO por debajo del minuto; hoy no hay instancia destino. |

## Consecuencias

- Recuperar la Mesa es restaurar 268 KiB: `pg_restore` de 302 ms hoy, y el mismo
  procedimiento sirve tanto para una base desechable como para producción.
- El respaldo **no bloquea escrituras**: `pg_dump` toma `ACCESS SHARE`, no
  `ACCESS EXCLUSIVE`. Medido durante un dump real: una transacción de escritura
  sobre `mesa_items` tardó 138 ms (el resto es el arranque de `docker exec`).
- El dump corre como el superusuario `mwt` dentro del contenedor. No hay contraseña
  en el script, en el log ni en el estado; el precio es que root en el host ya tiene
  acceso total a la base (lo tenía antes).
- La verificación es de integridad, no de contenido semántico: comprueba checksum,
  TOC, conteos, huérfanos, RLS y políticas. No prueba que cada `payload` sea el que la
  aplicación espera.
- El drill restaura con dueños y ACL del dump (no usa `--no-owner`), así que también
  falla si un rol referenciado desapareciera del clúster.
- El respaldo local vive en el mismo disco que la base. Cubre corrupción lógica,
  error humano y pérdida de la instancia; la pérdida del host la cubre la copia
  del buzón, que vive en Hostinger y no depende de este VPS.
- La copia del buzón se guarda tal cual, sin cifrado en reposo: quien lea ese
  buzón lee la base. Cifrarla no aporta si la clave queda en el mismo disco que
  protege; lo que sí aporta es una contraseña fuerte y segundo factor en la
  cuenta.

## Evidencia (2/11/2026, 19:18 UTC)

| Dato | Valor |
|---|---|
| Artifact | `mesa_20261102T191843Z.dump` |
| Tamaño | 286 625 bytes (280 KiB) |
| sha256 | `80aa8ef1c6d30c6d7e91c410872d94129aa1147141e29a526d1b776bb1cf510b` |
| Duración del dump | 201 ms |
| Ítems restaurados | 500 (mínimo exigido 460) |
| Eventos restaurados | 2 477 (mínimo exigido 2 413) |
| Eventos huérfanos | 0 |
| RLS habilitada y forzada | 2 de 2 tablas |
| Políticas RLS restauradas | 6 |
| Duración de `pg_restore` | 309 ms local; 305 ms desde la copia del buzón |
| Bases desechables | `mesa_drill_20261102t191853z` y `mesa_drill_20261102t191854z`, borradas al terminar |
| Copia externa | buzón `INBOX.Mesa-Backups`, uid 16, releída y con sha256 idéntico antes de podar |
| Estado | `OK 2026-11-02T19:18:45Z artifact=mesa_20261102T191843Z.dump … remote=off offsite=imap:imap.hostinger.com offsite_ok=1` |
| Drill externo | `OK … source=offsite bytes=286625 sha256=80aa8ef1… items=500 events=2477 restore_ms=305 dropped=1` |
| Suite | `scripts/test-backup-mesa.sh`: 86 comprobaciones, 0 fallos |
| Destino externo descartado (`a2ftp`) | `530 Login authentication failed`; la cuenta de a2hosting está suspendida |
| Ensayo de copia local (`mlocal:mesa-mwt-one`) | 274 705 bytes en destino, sha256 releído idéntico, `.sha256` y `.meta` presentes |

La página [Mesa: respaldo y restauración](../docs/faberloom/mesa-backup.md) lleva el
detalle de ejecución y los comandos.

## Operación

```sh
/opt/mwt/scripts/backup-mesa.sh                  # respaldo + verificación + copia externa + poda
/opt/mwt/scripts/backup-mesa.sh --prune-only     # sólo retención
/opt/mwt/scripts/backup-mesa.sh --check-freshness  # sano si el último respaldo sirve
/opt/mwt/scripts/restore-mesa-drill.sh           # drill sobre base desechable
/opt/mwt/scripts/restore-mesa-drill.sh --offsite # drill con la copia del buzón
/opt/mwt/scripts/restore-mesa-drill.sh --keep    # deja la base para inspeccionarla
```

```sh
# copia externa: la enciende MESA_OFFSITE=on en /etc/mwt/mesa-offsite.env
/opt/mwt/scripts/mesa-offsite.py list            # catálogo del buzón
/opt/mwt/scripts/mesa-offsite.py check           # baja la más nueva y compara sha256
/opt/mwt/scripts/mesa-offsite.py fetch --latest --out-dir /tmp/restore
```

Códigos: `backup-mesa.sh` sale con 0 si el respaldo local es válido (haya o no copia
externa), 1 si no pudo respaldar, 2 por uso. `--check-freshness` sale con 0 si está
fresco y verificado, 1 si no hay respaldo válido, 3 si el local vale pero la copia
externa falló.

Log en `/opt/mwt/logs/mesa_backup.log`. Estado del respaldo en
`/opt/mwt/mesa_backup_status.txt`; estado del drill en
`/opt/mwt/mesa_restore_drill_status.txt`. Los dos son una línea
`OK|FAIL <ISO8601> clave=valor...`, y el del respaldo admite además
`REMOTE_FAIL` como primera palabra cuando el local vale y una copia externa no. La
prueba de las piezas vive en `scripts/test-backup-mesa.sh` (retención, estado,
frescura, lector de `.env`, cliente del buzón y las guardas que impiden apuntar el
drill a `faberloom_mesa` o `mwt_one`).

```sh
# la suite corre en el host, junto a los scripts que prueba
install -m 750 /tmp/mesa-test/*.sh /tmp/mesa-test/*.py /opt/mwt/scripts/
bash /tmp/mesa-test/test-backup-mesa.sh
```

## Riesgos residuales

1. **La copia del buzón depende de un proveedor externo y de una sola cuenta.** Si
   Hostinger suspende la cuenta o alguien cambia esa contraseña, la copia deja de
   subir: el respaldo local sigue válido y el estado queda en `REMOTE_FAIL`, que es
   visible pero no avisa por sí solo. La contraseña vive en
   `/etc/mwt/mesa-offsite.env` (modo 600) y el buzón no tiene cifrado en reposo.
2. **RPO de 15 minutos** es suficiente para una Mesa operada por personas, no para
   datos financieros o de auditoría. Si el negocio pide menos, la respuesta es PITR en
   un clúster dedicado o réplica lógica, no bajar el intervalo del dump.
3. **El drill programado todavía no se ha ejecutado desde cron**; hoy se ejecutaron a
   mano el local y el externo. Las primeras ejecuciones programadas son el domingo 8/11
   a las 05:20 y 05:40 UTC y hay que revisar su estado.
4. `faberloom_mesa` creció de 460 a 500 ítems desde la migración. Los mínimos del drill
   (460 y 2 413) son un suelo histórico, no el estado esperado; la comparación exacta
   se hace contra el `.meta` del artifact.

## Revisión

Revisar este ADR si: el tamaño del dump supera los 50 MB o el dump pasa de 5 s; el
negocio pide RPO menor a 5 minutos; aparece un segundo host o una instancia gestionada;
o el drill deja de pasar dos semanas seguidas.
