# Contrato · Cierre P2 — respaldo y restauración de `faberloom_mesa`

**Dueño:** agente de confiabilidad de bases. **Estado:** abierto. **Autoridad:** decide la estrategia de respaldo y fija RPO/RTO.

## Objetivo

Que `faberloom_mesa` tenga respaldo automático, verificado y con una
restauración probada, con RPO y RTO escritos y medidos. No basta con un script:
debe existir una restauración real ejecutada hoy.

## Entradas

- PostgreSQL 16.15 en `consola-mwt-one-postgres` (red `consola-mwt-one-net`).
- `/opt/mwt-one-harness/.env.mesa` (credenciales; no imprimir valores).
- `scripts/backup-harness.sh` y el patrón de estado
  `/opt/mwt/harness_backup_status.txt` como referencia de operación.
- Volumen disponible en la VPS para respaldos.

## Decisión que debes tomar (y registrar)

1. Respaldo lógico (`pg_dump -Fc`) cada N horas, o PITR con `archive_mode` +
   `pg_basebackup` + archivo de WAL. Decide según el coste y el RPO que puedas
   **demostrar**, no según lo que suene mejor.
2. Retención (cuántos respaldos y por cuánto tiempo) y verificación de
   integridad (checksum + `pg_restore --list`).
3. Dónde vive el respaldo fuera del contenedor y qué pasa si el disco se llena.

## Entregables

- `scripts/backup-mesa.sh`: respaldo con checksum, retención y archivo de estado
  legible por el healthcheck; falla con código distinto de 0 si no puede
  respaldar.
- `scripts/restore-mesa-drill.sh`: restaura el último respaldo en una base
  desechable, verifica conteos y la borra; devuelve 0 solo si el drill pasa.
- Instalación real en la VPS: cron o systemd timer, directorio de respaldos,
  estado en `/opt/mwt/mesa_backup_status.txt`.
- `ADRs_MESA/ADR-008-respaldo-mesa.md` con RPO/RTO, alternativa descartada y
  riesgos.
- `docs/faberloom/mesa-backup.md` con la evidencia del drill: fecha, duración,
  tamaño, checksum y conteos restaurados.

## Invariantes

- El respaldo no bloquea escrituras de la Mesa.
- La retención está acotada (no crece sin límite).
- La restauración se prueba en una base distinta; nunca sobre `faberloom_mesa`.
- Ningún secreto se imprime en logs ni en el estado.

## Evidencia obligatoria

1. Respaldo real ejecutado y archivo con checksum.
2. Drill real: base restaurada, 460 ítems y ≥2413 eventos, duración medida.
3. Estado escrito en `/opt/mwt/mesa_backup_status.txt`.
4. Segunda ejecución del respaldo: rota correctamente y respeta retención.
5. Commit en Git con scripts, ADR e informe.

## Límites

- No edites `packages/faberloom/board/**` ni `gateway/**`.
- No despliegues el gateway ni toques `mwt_one`.
- Puedes crear/borrar solo bases desechables para el drill.
- No imprimas contraseñas.
