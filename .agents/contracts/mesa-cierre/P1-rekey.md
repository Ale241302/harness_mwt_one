# Contrato · Cierre P1 — identidad canónica de los 436 ítems `legacy:<uuid>`

**Dueño:** agente de datos. **Estado:** abierto. **Autoridad:** decide la política de identidad y la aplica.

## Objetivo

Cerrar la identidad de los 436 ítems migrados sin `businessKey`/`sourceRef` en
`faberloom_mesa`, de modo que `business_key` deje de ser una clave "provisional"
y pase a ser una identidad canónica, estable e idempotente.

## Entradas

- Base `faberloom_mesa` (PostgreSQL 16.15) en `consola-mwt-one-postgres`, tenant
  `5525986c-3b09-4d13-bf8f-43ccaa2deae3`.
- `packages/faberloom/board/src/keys.ts` (`businessKeyOf`), `spec.ts`
  (`boardItemRecord`), `scripts/migrate-board-postgres.mjs`.
- `mesa_items.payload` con el registro completo del board: `sourceRef`,
  `artifactType`, `accountRef`, `spaceId`, `revisions[].evidence`, `runId`.

## Decisión que debes tomar (y registrar)

1. ¿Qué campos del registro identifican de verdad la fila? Deriva la clave solo
   de campos registrados; **nunca** de texto libre, del título ni de una
   suposición.
2. Si un ítem no tiene ningún campo identificador, decide si `legacy:<uuid>` es
   la identidad canónica permanente (recomendado: sí, es inmutable y
   reproducible) o si hay una fuente mejor. Documenta el porqué.
3. Qué hacer con una clave derivada que ya pertenece a otro ítem vivo: no
   sobrescribas; reporta y conserva la actual.

## Entregables

- `scripts/rekey-board-postgres.mjs`: `--dry-run` (por defecto) y `--apply`,
  idempotente, con reporte por motivo (`recorded`, `document`, `evidence`,
  `legacy`), y export previo de las claves actuales a un archivo con fecha.
- Pruebas ejecutables del script (PGlite o base desechable) que prueben:
  dry-run no escribe, apply es idempotente, colisión con ítem vivo no pisa,
  ítem sin identidad conserva `legacy:<uuid>`.
- `ADRs_MESA/ADR-007-identidad-mesa.md` con la decisión y las alternativas.
- `docs/faberloom/rekey-mesa.md` con el resultado real: cuántos ítems cambiaron,
  cuántos conservaron su clave y el conteo final.

## Invariantes

- Ningún `business_key` vivo duplicado en el tenant.
- Ninguna fila pierde `payload`, `state`, `row_version` ni eventos.
- El script se puede correr dos veces sin cambiar nada la segunda vez.
- La API sigue devolviendo 460/460 para Alejandro y Álvaro.

## Evidencia obligatoria

1. Dry-run contra la base real y su reporte.
2. Apply contra la base real.
3. Consulta final: 460 ítems, 0 claves vivas duplicadas, distribución por motivo.
4. `curl` con token real: 460 ítems para ambos usuarios.
5. Commit en Git con el script, el ADR y el informe.

## Límites

- No edites `packages/faberloom/board/src/**` ni `gateway/board-api.mjs`.
- No despliegues el gateway.
- Puedes usar SSH a la VPS y operar solo sobre `faberloom_mesa`.
- No imprimas contraseñas ni tokens.
