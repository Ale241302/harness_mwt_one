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
- Cron en el host: respaldo `*/15`, drill los domingos a las 05:20, ambos bajo
  `flock` para que no se pisen.

### Copia externa: implementada y apagada

`MESA_REMOTE` (destino rclone, vacío por omisión) sube el artifact, su `.sha256` y su
`.meta`, y **verifica la copia leyéndola de vuelta**: compara el tamaño que declara el
destino (`rclone lsjson --stat`), vuelve a bajar el artifact y exige el mismo sha256
que el original. La retención del destino replica la local: borra del remoto todo
`mesa_*` cuyo nombre ya no existe aquí, así que el destino no crece sin control.

Un fallo del remoto no invalida el respaldo local. El estado pasa a
`REMOTE_FAIL <ISO8601> reason=remote_failed remote=<destino> remote_reason=<motivo> …`,
el script sigue saliendo con 0 (el respaldo existe y verifica) y
`backup-mesa.sh --check-freshness` sale con **3**, distinto del 1 que significa
«no hay respaldo local válido». El motivo nunca se imprime con la salida cruda de
rclone: sólo el slug.

Está apagada porque hoy **no hay destino fuera del host que funcione**:

| Destino | Estado medido | Sirve como copia fuera del host |
|---|---|---|
| `a2ftp:` (FTP de a2hosting) | `530 Login authentication failed` en `about`, `lsd` y `mkdir` | No: credenciales inválidas |
| `mlocal:` (MinIO en `127.0.0.1:9000`) | Responde; volumen `mwt_minio_data` en `/var/lib/docker`, mismo `/dev/sda1` que la base | No: es el mismo host y el mismo disco |

El ensayo real con `MESA_REMOTE=mlocal:mesa-mwt-one` demuestra que el camino funciona
de punta a punta —artifact de 274 705 bytes, mismo tamaño en el destino, sha256
idéntico al releerlo— y que la copia no se finge: el estado quedó en `remote_ok=1`
sólo cuando la verificación pasó. Después se purgó el prefijo de ensayo: dejar copias
que nadie mantiene sería peor que no tenerlas. Encender el flag es una línea en el
cron, en cuanto `a2ftp` tenga credenciales válidas.

### RPO y RTO

| Métrica | Objetivo | Medido hoy | Cómo se sostiene |
|---|---|---|---|
| RPO | ≤ 15 min | 15 min + 0,3 s (peor caso del intervalo más la duración del dump) | cron `*/15`; el dump es de 226–289 ms |
| RTO | ≤ 15 min | 302 ms de `pg_restore`; drill completo ≈ 2 s | restauración probada hoy; el resto del presupuesto es detección y decisión del operador |

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
borran juntos.

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
- El respaldo vive en el mismo disco que la base. Cubre corrupción lógica, error
  humano y pérdida de la instancia; **no** cubre la pérdida del host.

## Evidencia (2/11/2026, 17:41–18:00 UTC)

| Dato | Valor |
|---|---|
| Artifact | `mesa_20261102T174140Z.dump` |
| Tamaño | 274 705 bytes (268 KiB) |
| sha256 | `a957fb3daa9479fab7f3b3adb6a6efa96f5e2acf6fbb320b3dad305bbeead0bc` |
| Duración del dump | 226 ms (2.ª ejecución 274 ms, 3.ª 289 ms) |
| Entradas del TOC | 63 |
| Ítems restaurados | 473 (mínimo exigido 460) |
| Eventos restaurados | 2 436 (mínimo exigido 2 413) |
| Eventos huérfanos | 0 |
| RLS habilitada y forzada | 2 de 2 tablas |
| Políticas RLS restauradas | 6 |
| Duración de `pg_restore` | 302 ms |
| Base desechable | `mesa_drill_20261102t174140z`, borrada al terminar |
| Rotación | 2.ª ejecución `kept=2 pruned=0`; 3.ª con un artifact plantado de 45 días `kept=3 pruned=1`, y se borraron su `.sha256` y su `.meta` |
| Estado | `OK 2026-11-02T17:41:48Z artifact=mesa_20261102T174148Z.dump … kept=3 pruned=1` |
| Destino externo real (`a2ftp`) | `530 Login authentication failed`; el respaldo real apuntado ahí dejó `REMOTE_FAIL … remote_reason=mkdir_failed` y `--check-freshness` con exit 3, con el artifact local intacto |
| Ensayo de copia (`mlocal:mesa-mwt-one`) | 274 705 bytes en destino, `rclone lsjson --stat` Size=274705, sha256 releído `bb18c62d…d044317b` idéntico al local, `.sha256` y `.meta` presentes, 2 s de ejecución |

La página [Mesa: respaldo y restauración](../docs/faberloom/mesa-backup.md) lleva el
detalle de ejecución y los comandos.

## Operación

```sh
/opt/mwt/scripts/backup-mesa.sh                  # respaldo + verificación + poda
/opt/mwt/scripts/backup-mesa.sh --prune-only     # sólo retención
/opt/mwt/scripts/backup-mesa.sh --check-freshness  # sano si el último respaldo sirve
/opt/mwt/scripts/restore-mesa-drill.sh           # drill sobre base desechable
/opt/mwt/scripts/restore-mesa-drill.sh --keep    # deja la base para inspeccionarla
```

```sh
# copia externa: apagada por omisión; encender cuando el destino funcione
MESA_REMOTE=a2ftp:mesa-mwt-one /opt/mwt/scripts/backup-mesa.sh
MESA_REMOTE=a2ftp:mesa-mwt-one /opt/mwt/scripts/backup-mesa.sh --check-freshness
```

Códigos: `backup-mesa.sh` sale con 0 si el respaldo local es válido (haya o no copia
externa), 1 si no pudo respaldar, 2 por uso. `--check-freshness` sale con 0 si está
fresco y verificado, 1 si no hay respaldo válido, 3 si el local vale pero la copia
externa falló.

Log en `/opt/mwt/logs/mesa_backup.log`. Estado del respaldo en
`/opt/mwt/mesa_backup_status.txt`; estado del drill en
`/opt/mwt/mesa_restore_drill_status.txt`. Los dos son una línea
`OK|FAIL <ISO8601> clave=valor...`, y el del respaldo admite además
`REMOTE_FAIL` como primera palabra cuando el local vale y la copia externa no. La
prueba de las dos piezas vive en
`scripts/test-backup-mesa.sh` (retención, estado, frescura y las guardas que impiden
apuntar el drill a `faberloom_mesa` o `mwt_one`).

```sh
# la suite corre en el host, junto a los dos scripts que prueba
scp -P 2222 scripts/backup-mesa.sh scripts/restore-mesa-drill.sh scripts/test-backup-mesa.sh \
  root@187.77.218.102:/tmp/mesa-test/
ssh -p 2222 root@187.77.218.102 'bash /tmp/mesa-test/test-backup-mesa.sh'
```

## Riesgos residuales

1. **El respaldo está en el mismo host que la base y hoy no hay copia fuera de él.**
   Perder el VPS pierde todo: el RPO de 15 minutos vale para corrupción y error
   humano, no para la pérdida del host, donde el RPO real es «lo que se pueda
   rescatar del disco». La copia externa está implementada y verificada, apagada por
   falta de destino: `a2ftp` devuelve `530` y `mlocal` es el mismo disco. Arreglar las
   credenciales de `a2ftp` y poner `MESA_REMOTE=a2ftp:mesa-mwt-one` en el cron cierra
   el hueco; el ensayo con `mlocal` ya demuestra que el camino sube y verifica.
2. **RPO de 15 minutos** es suficiente para una Mesa operada por personas, no para
   datos financieros o de auditoría. Si el negocio pide menos, la respuesta es PITR en
   un clúster dedicado o réplica lógica, no bajar el intervalo del dump.
3. **El drill semanal todavía no se ha ejecutado desde cron**; hoy se ejecutó a mano.
   La primera ejecución programada es el domingo 8/11 a las 05:20 UTC y hay que
   revisar su estado.
4. `faberloom_mesa` creció de 460 a 473 ítems desde la migración. Los mínimos del drill
   (460 y 2 413) son un suelo histórico, no el estado esperado; la comparación exacta
   se hace contra el `.meta` del artifact.

## Revisión

Revisar este ADR si: el tamaño del dump supera los 50 MB o el dump pasa de 5 s; el
negocio pide RPO menor a 5 minutos; aparece un segundo host o una instancia gestionada;
o el drill deja de pasar dos semanas seguidas.
